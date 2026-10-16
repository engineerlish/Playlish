import { newQuickJSWASMModule, newVariant, RELEASE_SYNC, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from 'quickjs-emscripten';
import { DEFAULT_LIMITS, VIOLATION_WINDOW_MS, type SandboxLimits, type Violation } from './limits';

/*
 * One plugin's sandbox (#100): its own QuickJS engine compiled to WebAssembly, with hard limits.
 *
 * - Memory: a soft QuickJS limit, and a hard ceiling on the WebAssembly memory itself. The #82 probe showed the soft
 *   limit alone let a loop of large strings grow the host by 2 GB; with a fixed WebAssembly maximum the same code just
 *   gets "out of memory" inside the sandbox.
 * - CPU: an interrupt handler stops any single call after `cpuMsPerCall`, and calls stop being accepted once a
 *   plugin used `cpuMsPerMinute` within a minute. Both count CPU time of the thread that runs the plugins, not wall
 *   time, so a plugin is never charged for time the process spent waiting on a busy machine (a CI runner during the
 *   soak once turned a well-behaved plugin off that way). On Windows that clock moves in steps of about 15.6 ms.
 * - Nothing ambient: the code sees standard JavaScript plus one `playlish` object (on, call, log). No network, files,
 *   timers or host objects. Values cross the boundary as JSON only.
 *
 * After `maxViolations` limit violations within `violationWindowMs` (10 minutes by default) the sandbox disables itself
 * for good and refuses all further work. Older violations expire, so rare hiccups over days of running never add up.
 *
 * Sharing: one QuickJS engine instance costs at least 16 MB (its WebAssembly minimum), so the plugin-host process runs
 * every plugin in one shared engine (`createEngine`), each in its own QuickJS runtime with its own soft memory limit,
 * CPU budget and violation count. The hard WebAssembly ceiling then protects the plugin process as a whole: a plugin
 * that hits it gets "out of memory", is disabled after repeated violations and freed, and the others keep running.
 * Measured: 21 MB for the empty process, then about +17 MB per plugin with one engine each, which the shared engine
 * avoids.
 */

/** A QuickJS engine (WebAssembly instance) with a hard memory ceiling, shared by sandboxes. */
export interface Engine {
  module: QuickJSWASMModule;
  memory: WebAssembly.Memory;
}

/** Bytes in a WebAssembly page. QuickJS needs at least 256 pages (16 MB). */
const WASM_PAGE = 64 * 1024;
const MIN_PAGES = 256;

/** Creates an engine whose WebAssembly memory can never grow past `hardMemoryMb`. */
export async function createEngine(hardMemoryMb: number): Promise<Engine> {
  const memory = new WebAssembly.Memory({ initial: MIN_PAGES, maximum: Math.max(MIN_PAGES, Math.ceil((hardMemoryMb * 1024 * 1024) / WASM_PAGE)) });
  const module = await newQuickJSWASMModule(newVariant(RELEASE_SYNC, { wasmMemory: memory }));
  return { module, memory };
}

// The limits live in limits.ts so the main process can use them without loading QuickJS.
export { DEFAULT_LIMITS, type SandboxLimits, type Violation };

/** What the sandbox asks of the host: actions (checked by the host for permissions) and log lines. */
export interface SandboxHost {
  call(action: string, args: unknown): Promise<unknown>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}


export class SandboxDisabledError extends Error {
  constructor(readonly reasons: Violation[]) {
    super(`Plugin disabled after repeated limit violations (${reasons.join(', ')})`);
    this.name = 'SandboxDisabledError';
  }
}

// The guest side of the API, run once in every sandbox before the plugin's own code.
const PRELUDE = `
(() => {
  const handlers = new Map();
  const hostCall = globalThis.__hostCall;
  const hostLog = globalThis.__hostLog;
  delete globalThis.__hostCall;
  delete globalThis.__hostLog;
  const text = (args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  globalThis.playlish = Object.freeze({
    on(event, handler) {
      if (typeof event !== 'string' || typeof handler !== 'function') throw new TypeError('playlish.on(event, handler)');
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    call(action, args) {
      return hostCall(String(action), JSON.stringify(args === undefined ? null : args)).then((json) => JSON.parse(json));
    },
    log: (...args) => hostLog('info', text(args)),
    warn: (...args) => hostLog('warn', text(args)),
    error: (...args) => hostLog('error', text(args)),
  });
  globalThis.__dispatch = (event, payloadJson) => {
    const payload = JSON.parse(payloadJson);
    for (const handler of handlers.get(event) || []) {
      const result = handler(payload);
      if (result && typeof result.then === 'function') result.then(undefined, (e) => hostLog('error', 'Unhandled error in ' + event + ' handler: ' + e));
    }
    return (handlers.get(event) || []).length;
  };
})();
`;

/** CPU time of the current thread in ms (the whole process where Node has no per-thread clock). */
export function threadCpuMs(): number {
  const usage = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

/** "Name: message" for an error thrown inside the sandbox (dumped to plain data). */
function describeGuestError(dumped: unknown): string {
  if (typeof dumped !== 'object' || dumped === null) return String(dumped);
  const { name, message } = dumped as { name?: unknown; message?: unknown };
  return `${typeof name === 'string' ? name : 'Error'}: ${typeof message === 'string' ? message : ''}`;
}

export class PluginSandbox {
  /** Recent violations, with the (wall) time they happened. */
  private violations: { kind: Violation; at: number }[] = [];
  /** Set once the sandbox disabled itself; it never comes back. */
  private disabled = false;
  private cpuWindow: { at: number; ms: number }[] = [];
  /** CPU time (cpuNow) by which the current call must finish. */
  private deadline = 0;
  private disposed = false;

  private constructor(
    private readonly runtime: QuickJSRuntime,
    private readonly vm: QuickJSContext,
    private readonly memory: WebAssembly.Memory,
    private readonly limits: SandboxLimits,
    /** Wall clock: for the minute and violation windows. */
    private readonly now: () => number,
    /** CPU clock: for time spent and the per-call deadline. */
    private readonly cpuNow: () => number,
  ) {}

  /**
   * Creates a sandbox and runs the plugin's code once (it registers its handlers). Without an engine it gets its own,
   * with `limits.hardMemoryMb` as the ceiling.
   */
  static async create(code: string, host: SandboxHost, limits: SandboxLimits = DEFAULT_LIMITS, now?: () => number, engine?: Engine, cpuNow?: () => number): Promise<PluginSandbox> {
    const { module, memory } = engine ?? (await createEngine(limits.hardMemoryMb));
    const runtime = module.newRuntime();
    runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024);
    const vm = runtime.newContext();
    // Tests that pass their own clock use it for both.
    const sandbox = new PluginSandbox(runtime, vm, memory, limits, now ?? (() => performance.now()), cpuNow ?? now ?? threadCpuMs);
    runtime.setInterruptHandler(() => sandbox.cpuNow() > sandbox.deadline);
    sandbox.installHost(host);
    sandbox.run(() => vm.evalCode(PRELUDE, 'prelude.js'));
    sandbox.run(() => vm.evalCode(code, 'plugin.js'));
    sandbox.runPendingJobs();
    return sandbox;
  }

  /** Sends an event to the plugin's handlers. Returns how many handlers ran. */
  dispatch(event: string, payload: unknown): number {
    if (this.disposed) throw new Error('Plugin sandbox was disposed');
    const fn = this.vm.getProp(this.vm.global, '__dispatch');
    const eventHandle = this.vm.newString(event);
    const payloadHandle = this.vm.newString(JSON.stringify(payload ?? null));
    try {
      const count = this.run(() => this.vm.callFunction(fn, this.vm.undefined, eventHandle, payloadHandle));
      this.runPendingJobs();
      return typeof count === 'number' ? count : 0;
    } finally {
      fn.dispose();
      eventHandle.dispose();
      payloadHandle.dispose();
    }
  }

  /** Resource use, for the plugin manager. */
  stats(): { wasmMemoryBytes: number; cpuMsLastMinute: number; violations: Violation[]; disabled: boolean } {
    return { wasmMemoryBytes: this.memory.buffer.byteLength, cpuMsLastMinute: this.cpuLastMinute(), violations: this.recentViolations(), disabled: this.isDisabled() };
  }

  isDisabled(): boolean {
    return this.disabled;
  }

  /** The violations that still count (within the violation window). */
  private recentViolations(): Violation[] {
    const since = this.now() - (this.limits.violationWindowMs ?? VIOLATION_WINDOW_MS);
    return this.violations.filter((v) => v.at >= since).map((v) => v.kind);
  }

  /** Frees the engine. The sandbox cannot be used afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.vm.dispose();
    this.runtime.dispose();
  }

  /** The native functions behind the prelude: __hostCall (promise of JSON text) and __hostLog. */
  private installHost(host: SandboxHost): void {
    const hostCall = this.vm.newFunction('__hostCall', (actionHandle, argsHandle) => {
      const action = this.vm.getString(actionHandle);
      const argsJson = this.vm.getString(argsHandle);
      const promise = this.vm.newPromise();
      let args: unknown = null;
      try {
        args = JSON.parse(argsJson);
      } catch {
        // Not possible from the prelude, but never trust it.
      }
      host.call(action, args).then(
        (value) => this.settle(promise, true, JSON.stringify(value ?? null)),
        (err: unknown) => this.settle(promise, false, err instanceof Error ? err.message : String(err)),
      );
      return promise.handle;
    });
    const hostLog = this.vm.newFunction('__hostLog', (levelHandle, textHandle) => {
      const level = this.vm.getString(levelHandle);
      host.log(level === 'warn' || level === 'error' ? level : 'info', this.vm.getString(textHandle).slice(0, 2000));
    });
    this.vm.setProp(this.vm.global, '__hostCall', hostCall);
    this.vm.setProp(this.vm.global, '__hostLog', hostLog);
    hostCall.dispose();
    hostLog.dispose();
  }

  /** Resolves or rejects a promise the plugin is waiting on, then runs the code waiting for it (with the CPU limit). */
  private settle(promise: ReturnType<QuickJSContext['newPromise']>, ok: boolean, text: string): void {
    if (this.disposed) return;
    if (this.isDisabled()) {
      promise.dispose();
      return;
    }
    const value = ok ? this.vm.newString(text) : this.vm.newError(text);
    if (ok) promise.resolve(value);
    else promise.reject(value);
    value.dispose();
    promise.dispose();
    this.runPendingJobs();
  }

  /** Runs the plugin's pending promise jobs (async handlers, awaited calls) with the CPU limit. */
  private runPendingJobs(): void {
    if (this.disposed || this.isDisabled() || !this.runtime.hasPendingJob()) return;
    try {
      this.run(() => {
        const r = this.runtime.executePendingJobs();
        return r.error ? { error: r.error } : {};
      });
    } catch {
      // Already counted as a violation, or reported as a plugin error.
    }
  }

  /**
   * Runs one piece of plugin code with the CPU and memory limits, turns the outcome into a plain value, and counts
   * violations. Throws on any failure (and on a disabled sandbox).
   */
  private run(step: () => { value?: QuickJSHandle; error?: QuickJSHandle } | QuickJSHandle | { value: QuickJSHandle } | ReturnType<QuickJSContext['evalCode']>): unknown {
    if (this.disposed) throw new Error('Plugin sandbox was disposed');
    if (this.isDisabled()) throw new SandboxDisabledError(this.recentViolations());
    if (this.cpuLastMinute() >= this.limits.cpuMsPerMinute) {
      this.violate('cpu-minute');
      throw new Error('Plugin used its CPU budget for this minute');
    }
    const started = this.cpuNow();
    this.deadline = started + this.limits.cpuMsPerCall;
    let result: { value?: QuickJSHandle; error?: QuickJSHandle };
    try {
      const raw = step() as { value?: QuickJSHandle; error?: QuickJSHandle };
      result = raw;
    } catch (err) {
      // The engine itself failed (for example the WebAssembly memory ceiling was hit).
      this.recordCpu(started);
      this.violate('memory');
      throw err instanceof Error ? err : new Error(String(err));
    }
    this.recordCpu(started);
    if (result.error) {
      const dumped: unknown = this.vm.dump(result.error);
      result.error.dispose();
      const message = describeGuestError(dumped);
      this.violate(/interrupted/i.test(message) ? 'cpu' : /out of memory/i.test(message) ? 'memory' : 'error');
      throw new Error(message);
    }
    const value: unknown = result.value?.alive ? this.vm.dump(result.value) : undefined;
    // Shared handles (such as undefined) and ones the engine already freed must not be freed again.
    if (result.value?.alive && result.value.owner) result.value.dispose();
    return value;
  }

  /** Records the CPU time a call used (from `started`, on the CPU clock), at the current wall time. */
  private recordCpu(started: number): void {
    this.cpuWindow.push({ at: this.now(), ms: Math.max(0, this.cpuNow() - started) });
  }

  private cpuLastMinute(): number {
    const since = this.now() - 60_000;
    this.cpuWindow = this.cpuWindow.filter((c) => c.at >= since);
    return this.cpuWindow.reduce((sum, c) => sum + c.ms, 0);
  }

  private violate(kind: Violation): void {
    // Plain errors in plugin code are reported, but only limit violations count towards disabling.
    if (kind === 'error') return;
    const now = this.now();
    const since = now - (this.limits.violationWindowMs ?? VIOLATION_WINDOW_MS);
    this.violations = [...this.violations.filter((v) => v.at >= since), { kind, at: now }];
    if (this.violations.length >= this.limits.maxViolations) this.disabled = true;
  }
}
