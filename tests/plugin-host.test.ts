import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createHostHandler } from '../src/main/plugins/host-process';
import { CRASH_WINDOW_MS, PluginHost, type ChildLike } from '../src/main/plugins/plugin-host';
import type { FromHost, ToHost } from '../src/main/plugins/protocol';
import type { SandboxLimits } from '../src/main/plugins/sandbox';

/*
 * #11: the plugin host's lifecycle, with the real message handler and real sandboxes in a fake child process.
 */

const LIMITS: SandboxLimits = { memoryMb: 8, hardMemoryMb: 32, cpuMsPerCall: 50, cpuMsPerMinute: 1000, maxViolations: 3 };

/** A child process in this process: messages go to the real host handler, and it can "crash". */
class FakeChild extends EventEmitter implements ChildLike {
  killed = false;
  private readonly handle = createHostHandler((m: FromHost) => queueMicrotask(() => this.emit('message', m)));
  postMessage(message: ToHost): void {
    if (!this.killed) void this.handle(message);
  }
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
  crash(): void {
    this.killed = true;
    this.emit('exit', 1);
  }
}

function setup() {
  const children: FakeChild[] = [];
  const calls: { pluginId: string; action: string; args: unknown }[] = [];
  const disabled: { pluginId: string; reasons: string[] }[] = [];
  const failures: string[] = [];
  let clock = 0;
  const host = new PluginHost({
    spawn: () => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    handleCall: (pluginId, action, args) => {
      calls.push({ pluginId, action, args });
      return action === 'denied' ? Promise.reject(new Error('Permission missing: playback.control')) : Promise.resolve({ ok: true });
    },
    onLog: () => undefined,
    onDisabled: (pluginId, reasons) => disabled.push({ pluginId, reasons }),
    onEventFailed: (pluginId, event, error) => failures.push(`${pluginId}/${event}: ${error}`),
    warn: () => undefined,
    now: () => clock,
  });
  return { host, children, calls, disabled, failures, tick: (ms: number) => (clock += ms) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('PluginHost', () => {
  it('starts no process until a plugin loads, and stops it when the last one unloads', async () => {
    const { host, children } = setup();
    expect(host.running()).toBe(false);

    await host.load('a', `playlish.on('x', () => {});`, LIMITS);
    expect(host.running()).toBe(true);
    expect(children).toHaveLength(1);

    host.unload('a');
    expect(host.running()).toBe(false);
    expect(children[0]?.killed).toBe(true);
  });

  it('runs a plugin action through the host handler and returns the answer, or the refusal', async () => {
    const { host, calls } = setup();
    await host.load('a', `playlish.on('track.changed', async (t) => { const r = await playlish.call('queue.add', { uri: t.uri }); await playlish.call('denied').catch((e) => playlish.call('report', [r, e.message])); });`, LIMITS);

    host.dispatch('track.changed', { uri: 'spotify:track:1' }, ['a']);
    await settle();

    expect(calls).toEqual([
      { pluginId: 'a', action: 'queue.add', args: { uri: 'spotify:track:1' } },
      { pluginId: 'a', action: 'denied', args: null },
      { pluginId: 'a', action: 'report', args: [{ ok: true }, 'Permission missing: playback.control'] },
    ]);
  });

  it('rejects a plugin whose code does not even run', async () => {
    const { host } = setup();

    await expect(host.load('broken', `this is not javascript`, LIMITS)).rejects.toThrow(/SyntaxError/);
    expect(host.running()).toBe(false);
  });

  it('only sends events to the plugins named', async () => {
    const { host, calls } = setup();
    await host.load('a', `playlish.on('e', () => playlish.call('from', 'a'));`, LIMITS);
    await host.load('b', `playlish.on('e', () => playlish.call('from', 'b'));`, LIMITS);

    host.dispatch('e', null, ['b']);
    await settle();

    expect(calls.map((c) => c.pluginId)).toEqual(['b']);
  });

  it('reports a plugin that the sandbox disabled after repeated violations, keeping the others', async () => {
    const { host, disabled, failures } = setup();
    await host.load('spinner', `playlish.on('e', () => { for (;;) {} });`, LIMITS);
    await host.load('calm', `playlish.on('e', () => {});`, LIMITS);

    for (let i = 0; i < LIMITS.maxViolations; i++) host.dispatch('e', null, ['spinner', 'calm']);
    await settle();

    expect(disabled).toEqual([{ pluginId: 'spinner', reasons: ['cpu', 'cpu', 'cpu'] }]);
    expect(failures.filter((f) => f.startsWith('spinner/e: ')).length).toBe(LIMITS.maxViolations);
    expect(host.running()).toBe(true);
  });

  it('restarts after a crash with every plugin, and disables the busy plugin on a second crash in the window', async () => {
    const { host, children, disabled, calls, tick } = setup();
    await host.load('a', `playlish.on('e', () => playlish.call('alive', 'a'));`, LIMITS);
    await host.load('b', `playlish.on('e', () => playlish.call('alive', 'b'));`, LIMITS);

    host.dispatch('e', null, ['a']);
    children[0]?.crash();
    await settle();
    expect(children).toHaveLength(2);
    expect(disabled).toEqual([]);

    tick(CRASH_WINDOW_MS - 1);
    host.dispatch('e', null, ['a']);
    children[1]?.crash();
    await settle();

    expect(disabled).toEqual([{ pluginId: 'a', reasons: ['crash'] }]);
    calls.length = 0;
    host.dispatch('e', null, ['a', 'b']);
    await settle();
    expect(calls).toEqual([{ pluginId: 'b', action: 'alive', args: 'b' }]);
  });

  it('a crash long after the previous one is forgiven', async () => {
    const { host, children, disabled, tick } = setup();
    await host.load('a', `playlish.on('e', () => {});`, LIMITS);
    host.dispatch('e', null, ['a']);
    children[0]?.crash();
    await settle();

    tick(CRASH_WINDOW_MS + 1);
    host.dispatch('e', null, ['a']);
    children[1]?.crash();
    await settle();

    expect(disabled).toEqual([]);
    expect(host.running()).toBe(true);
  });
});
