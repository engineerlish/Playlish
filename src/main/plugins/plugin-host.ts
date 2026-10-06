import type { FromHost, ToHost } from './protocol';
import type { SandboxLimits, Violation } from './sandbox';

/*
 * The main process's side of the plugin-host process (#100).
 *
 * - The process starts with the first plugin that loads and stops when the last one unloads, so Playlish without
 *   plugins (or in safe mode) has no plugin process at all.
 * - A plugin's actions arrive as messages and go to `handleCall`, which checks permissions (#102) and runs them.
 * - If the process dies, it is started again with the same plugins. If it dies again within the crash window, the
 *   plugin that was handling an event when it died is disabled and the rest come back.
 */

/** The parts of Electron's UtilityProcess used here (a fake in tests). */
export interface ChildLike {
  postMessage(message: ToHost): void;
  on(event: 'message', listener: (message: FromHost) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  kill(): boolean;
}

export interface PluginHostDeps {
  spawn(): ChildLike;
  handleCall(pluginId: string, action: string, args: unknown): Promise<unknown>;
  onLog(pluginId: string, level: 'info' | 'warn' | 'error', message: string): void;
  /** A plugin was disabled (limit violations, or crashing the host process twice). */
  onDisabled(pluginId: string, reasons: (Violation | 'crash')[]): void;
  onEventFailed(pluginId: string, event: string, error: string): void;
  warn(message: string): void;
  now?: () => number;
}

// CHANGE HERE: a second crash within this time disables the plugin that was busy.
export const CRASH_WINDOW_MS = 5 * 60_000;

interface Loaded {
  code: string;
  limits: SandboxLimits;
}

export class PluginHost {
  private child: ChildLike | null = null;
  private readonly loaded = new Map<string, Loaded>();
  private readonly waiting = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private lastCrashAt: number | null = null;
  /** Plugins that were sent an event and have not finished it (as far as the main process knows). */
  private busy: string[] = [];
  private stopping = false;
  private readonly now: () => number;

  constructor(private readonly deps: PluginHostDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** True while the plugin-host process runs. */
  running(): boolean {
    return this.child !== null;
  }

  /** Loads (or reloads) a plugin; resolves once its code ran, rejects if it failed to load. */
  load(pluginId: string, code: string, limits: SandboxLimits): Promise<void> {
    this.loaded.set(pluginId, { code, limits });
    return this.sendLoad(pluginId);
  }

  /** Unloads a plugin; the process stops when no plugin is left. */
  unload(pluginId: string): void {
    if (!this.loaded.delete(pluginId)) return;
    this.child?.postMessage({ type: 'unload', pluginId });
    if (this.loaded.size === 0) this.stop();
  }

  /** Sends an event to the given loaded plugins. */
  dispatch(event: string, payload: unknown, pluginIds: string[]): void {
    const targets = pluginIds.filter((id) => this.loaded.has(id));
    if (!this.child || targets.length === 0) return;
    this.busy = targets;
    this.child.postMessage({ type: 'event', event, payload, pluginIds: targets });
  }

  /** Stops the process (app quit, or no plugins left). */
  stop(): void {
    if (!this.child) return;
    this.stopping = true;
    this.child.kill();
    this.child = null;
  }

  private ensureChild(): ChildLike {
    if (this.child) return this.child;
    this.stopping = false;
    const child = this.deps.spawn();
    this.child = child;
    child.on('message', (m) => this.onMessage(child, m));
    child.on('exit', (code) => this.onExit(child, code));
    return child;
  }

  private sendLoad(pluginId: string): Promise<void> {
    const entry = this.loaded.get(pluginId);
    if (!entry) return Promise.resolve();
    const child = this.ensureChild();
    return new Promise((resolve, reject) => {
      this.waiting.get(pluginId)?.reject(new Error('Reloaded'));
      this.waiting.set(pluginId, { resolve, reject });
      child.postMessage({ type: 'load', pluginId, code: entry.code, limits: entry.limits });
    });
  }

  private onMessage(child: ChildLike, m: FromHost): void {
    if (child !== this.child) return;
    switch (m.type) {
      case 'ready':
        return;
      case 'loaded':
        this.waiting.get(m.pluginId)?.resolve();
        this.waiting.delete(m.pluginId);
        return;
      case 'load-failed':
        this.loaded.delete(m.pluginId);
        this.waiting.get(m.pluginId)?.reject(new Error(m.error));
        this.waiting.delete(m.pluginId);
        if (this.loaded.size === 0) this.stop();
        return;
      case 'call':
        this.deps.handleCall(m.pluginId, m.action, m.args).then(
          (value) => this.child === child && child.postMessage({ type: 'reply', callId: m.callId, ok: true, value }),
          (err: unknown) => this.child === child && child.postMessage({ type: 'reply', callId: m.callId, ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
        return;
      case 'log':
        this.deps.onLog(m.pluginId, m.level, m.message);
        return;
      case 'event-failed':
        this.deps.onEventFailed(m.pluginId, m.event, m.error);
        return;
      case 'disabled':
        this.loaded.delete(m.pluginId);
        this.deps.onDisabled(m.pluginId, m.reasons);
        if (this.loaded.size === 0) this.stop();
        return;
    }
  }

  /** The process ended: on purpose, or a crash (restart, and disable the busy plugin on a second crash). */
  private onExit(child: ChildLike, code: number): void {
    if (child !== this.child) return;
    this.child = null;
    if (this.stopping) return;
    this.deps.warn(`The plugin process stopped unexpectedly (exit code ${code})`);
    for (const w of this.waiting.values()) w.reject(new Error('The plugin process stopped'));
    this.waiting.clear();
    const now = this.now();
    if (this.lastCrashAt !== null && now - this.lastCrashAt < CRASH_WINDOW_MS) {
      for (const id of this.busy) {
        this.loaded.delete(id);
        this.deps.onDisabled(id, ['crash']);
      }
    }
    this.lastCrashAt = now;
    this.busy = [];
    for (const id of this.loaded.keys()) {
      this.sendLoad(id).catch((err: unknown) => this.deps.warn(`Reloading plugin ${id} failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}
