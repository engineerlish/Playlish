import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOAK_CYCLE_MS, SOAK_LOG_EVERY, startSoakDriver, type SoakHooks } from '../src/main/soak-driver';
import type { PlaybackState } from '../src/shared/types';

/** Records every hook call in order. */
function recordingHooks() {
  const calls: string[] = [];
  const hooks: SoakHooks = {
    openUi: () => calls.push('open'),
    closeUi: () => calls.push('close'),
    simulateState: (state: PlaybackState | null) => calls.push(state ? `state:${state.paused ? 'paused' : 'playing'}@${state.positionMs}` : 'state:none'),
    progress: (cycles) => calls.push(`progress:${cycles}`),
  };
  return { hooks, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startSoakDriver', () => {
  it('runs one open, play, close, pause cycle straight away', async () => {
    const { hooks, calls } = recordingHooks();

    const stop = startSoakDriver(hooks);
    await vi.advanceTimersByTimeAsync(SOAK_CYCLE_MS - 1);
    stop();

    expect(calls).toEqual([
      'open',
      'state:playing@500',
      'state:playing@1000',
      'state:playing@1500',
      'state:playing@2000',
      'state:playing@2500',
      'state:playing@3000',
      'close',
      'state:paused@3000',
    ]);
  });

  it('repeats the cycle on the interval', async () => {
    const { hooks, calls } = recordingHooks();

    const stop = startSoakDriver(hooks);
    await vi.advanceTimersByTimeAsync(SOAK_CYCLE_MS * 3 - 1);
    stop();

    expect(calls.filter((c) => c === 'open')).toHaveLength(3);
    expect(calls.filter((c) => c === 'close')).toHaveLength(3);
  });

  it('reports progress every few cycles', async () => {
    const { hooks, calls } = recordingHooks();

    const stop = startSoakDriver(hooks);
    await vi.advanceTimersByTimeAsync(SOAK_CYCLE_MS * (SOAK_LOG_EVERY * 2) - 1);
    stop();

    expect(calls.filter((c) => c.startsWith('progress:'))).toEqual([`progress:${SOAK_LOG_EVERY}`, `progress:${SOAK_LOG_EVERY * 2}`]);
  });

  it('stops everything, including steps already scheduled inside a cycle', async () => {
    const { hooks, calls } = recordingHooks();

    const stop = startSoakDriver(hooks);
    await vi.advanceTimersByTimeAsync(1_000);
    stop();
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(SOAK_CYCLE_MS * 5);

    expect(calls.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
