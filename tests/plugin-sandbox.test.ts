import { describe, expect, it } from 'vitest';
import { PluginSandbox, SandboxDisabledError, type SandboxHost, type SandboxLimits } from '../src/main/plugins/sandbox';

/*
 * #11: the plugin sandbox. Every probe from the #82 plan is a test here.
 */

const LIMITS: SandboxLimits = { memoryMb: 8, hardMemoryMb: 32, cpuMsPerCall: 50, cpuMsPerMinute: 1000, maxViolations: 3 };

/** A host that records calls and logs, answering `echo` with its arguments and rejecting `fail`. */
function recordingHost() {
  const calls: { action: string; args: unknown }[] = [];
  const logs: string[] = [];
  const host: SandboxHost = {
    call: (action, args) => {
      calls.push({ action, args });
      if (action === 'fail') return Promise.reject(new Error('not allowed'));
      return Promise.resolve(action === 'echo' ? args : null);
    },
    log: (level, message) => logs.push(`${level}: ${message}`),
  };
  return { host, calls, logs };
}

/** Lets promises settled by the host run inside the sandbox. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('isolation', () => {
  it('has no network, files, timers or host objects, only the playlish API', async () => {
    const { host, calls } = recordingHost();
    await PluginSandbox.create(
      `playlish.call('report', { fetch: typeof fetch, require: typeof require, process: typeof process, setTimeout: typeof setTimeout, hostCall: typeof __hostCall, api: Object.keys(playlish).sort() });`,
      host,
      LIMITS,
    );

    expect(calls[0]?.args).toEqual({ fetch: 'undefined', require: 'undefined', process: 'undefined', setTimeout: 'undefined', hostCall: 'undefined', api: ['call', 'error', 'log', 'on', 'warn'] });
  });

  it('keeps every plugin to itself', async () => {
    const a = recordingHost();
    const b = recordingHost();
    await PluginSandbox.create(`globalThis.secret = 'a';`, a.host, LIMITS);
    await PluginSandbox.create(`playlish.call('report', typeof secret);`, b.host, LIMITS);

    expect(b.calls[0]?.args).toBe('undefined');
  });
});

describe('the API', () => {
  it('delivers events to handlers and counts them', async () => {
    const { host, calls } = recordingHost();
    const sandbox = await PluginSandbox.create(`playlish.on('track.changed', (t) => playlish.call('seen', t.name)); playlish.on('track.changed', () => {});`, host, LIMITS);

    expect(sandbox.dispatch('track.changed', { name: 'Song' })).toBe(2);
    expect(sandbox.dispatch('unknown.event', {})).toBe(0);
    expect(calls).toEqual([{ action: 'seen', args: 'Song' }]);
  });

  it('calls the host and gets the answer back as plain data', async () => {
    const { host, calls } = recordingHost();
    await PluginSandbox.create(`playlish.call('echo', { n: 41 }).then((r) => playlish.call('result', r.n + 1));`, host, LIMITS);
    await settle();

    expect(calls.at(-1)).toEqual({ action: 'result', args: 42 });
  });

  it('lets the plugin catch a refused call', async () => {
    const { host, calls } = recordingHost();
    await PluginSandbox.create(`playlish.call('fail').catch((e) => playlish.call('caught', String(e.message)));`, host, LIMITS);
    await settle();

    expect(calls.at(-1)).toEqual({ action: 'caught', args: 'not allowed' });
  });

  it('forwards log lines with their level, and errors in async handlers', async () => {
    const { host, logs } = recordingHost();
    const sandbox = await PluginSandbox.create(`playlish.log('hello', { a: 1 }); playlish.warn('careful'); playlish.on('x', async () => { throw new Error('oops'); });`, host, LIMITS);
    sandbox.dispatch('x', null);
    await settle();

    expect(logs[0]).toBe('info: hello {"a":1}');
    expect(logs[1]).toBe('warn: careful');
    expect(logs.some((l) => l.startsWith('error: Unhandled error in x handler') && l.includes('oops'))).toBe(true);
  });

  it('reports a plain error in plugin code without counting it as a limit violation', async () => {
    const { host } = recordingHost();
    const sandbox = await PluginSandbox.create(`playlish.on('x', () => { throw new TypeError('bad'); });`, host, LIMITS);

    expect(() => sandbox.dispatch('x', null)).toThrow('TypeError: bad');
    expect(sandbox.stats().violations).toEqual([]);
  });
});

describe('limits', () => {
  it('stops an endless loop at the CPU limit per call', async () => {
    const { host } = recordingHost();
    const sandbox = await PluginSandbox.create(`playlish.on('spin', () => { for (;;) {} });`, host, LIMITS);
    const started = performance.now();

    expect(() => sandbox.dispatch('spin', null)).toThrow(/interrupted/);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(sandbox.stats().violations).toEqual(['cpu']);
  });

  it('refuses work once the CPU budget for the minute is used', async () => {
    const { host } = recordingHost();
    const sandbox = await PluginSandbox.create(`playlish.on('work', () => { const t = Date.now(); while (Date.now() - t < 40) {} });`, host, { ...LIMITS, cpuMsPerMinute: 100 });

    sandbox.dispatch('work', null);
    sandbox.dispatch('work', null);
    sandbox.dispatch('work', null);

    expect(() => sandbox.dispatch('work', null)).toThrow('CPU budget');
    expect(sandbox.stats().violations).toContain('cpu-minute');
  });

  it('keeps memory inside the hard ceiling even with the large-string pattern from the #82 probe', async () => {
    const { host } = recordingHost();
    const before = process.memoryUsage().rss;
    const sandbox = await PluginSandbox.create(`playlish.on('grow', () => { const a = []; for (;;) a.push('x'.repeat(1e5)); });`, host, LIMITS);

    expect(() => sandbox.dispatch('grow', null)).toThrow(/out of memory|memory/i);
    const grewMb = (process.memoryUsage().rss - before) / 1048576;
    // The probe without a ceiling grew the process by about 2 GB.
    expect(grewMb).toBeLessThan(150);
    expect(sandbox.stats().wasmMemoryBytes).toBeLessThanOrEqual(LIMITS.hardMemoryMb * 1024 * 1024);
    expect(sandbox.stats().violations).toEqual(['memory']);
  });

  it('disables itself after repeated violations and refuses all further work', async () => {
    const { host } = recordingHost();
    const sandbox = await PluginSandbox.create(`playlish.on('spin', () => { for (;;) {} }); playlish.on('ok', () => {});`, host, LIMITS);
    for (let i = 0; i < LIMITS.maxViolations; i++) expect(() => sandbox.dispatch('spin', null)).toThrow();

    expect(sandbox.isDisabled()).toBe(true);
    expect(() => sandbox.dispatch('ok', null)).toThrow(SandboxDisabledError);
  });

  it('can be freed, and refuses work afterwards', async () => {
    const { host } = recordingHost();
    const sandbox = await PluginSandbox.create(`playlish.on('ok', () => {});`, host, LIMITS);
    sandbox.dispose();

    expect(() => sandbox.dispatch('ok', null)).toThrow('disposed');
  });
});
