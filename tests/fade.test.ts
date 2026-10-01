import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FADE_MS, FadeController, RAMP_STEP_MS, VolumeRamper, clampVolume, type FadePlayer } from '../src/renderer/fade';

/** Collects every volume the ramper sets. */
function makeSink() {
  const volumes: number[] = [];
  return { volumes, setVolume: (v: number) => void volumes.push(v) };
}

describe('clampVolume', () => {
  it('keeps values inside 0..1', () => {
    expect(clampVolume(-0.2)).toBe(0);
    expect(clampVolume(0.4)).toBe(0.4);
    expect(clampVolume(1.7)).toBe(1);
  });
});

describe('VolumeRamper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('steps linearly and ends exactly on the target', async () => {
    const sink = makeSink();
    const ramper = new VolumeRamper(sink, undefined, 25);

    const done = ramper.ramp(0, 1, 100);
    await vi.advanceTimersByTimeAsync(100);

    expect(await done).toBe(true);
    expect(sink.volumes).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('does not set any volume before the first step', () => {
    const sink = makeSink();
    const ramper = new VolumeRamper(sink, undefined, 25);

    void ramper.ramp(0, 1, 100);

    expect(sink.volumes).toEqual([]);
    expect(ramper.isRamping).toBe(true);
  });

  it('ramps downwards', async () => {
    const sink = makeSink();
    const ramper = new VolumeRamper(sink, undefined, 25);

    const done = ramper.ramp(0.8, 0, 100);
    await vi.advanceTimersByTimeAsync(100);
    await done;

    expect(sink.volumes).toHaveLength(4);
    expect(sink.volumes[3]).toBe(0);
    expect(sink.volumes).toEqual([...sink.volumes].sort((a, b) => b - a));
  });

  it('uses round(duration / step) steps and at least one', async () => {
    const sink = makeSink();
    const ramper = new VolumeRamper(sink, undefined, 25);

    const longRamp = ramper.ramp(0, 1, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await longRamp;
    expect(sink.volumes).toHaveLength(40);

    sink.volumes.length = 0;
    const instant = ramper.ramp(0, 1, 0);
    await vi.advanceTimersByTimeAsync(25);
    expect(await instant).toBe(true);
    expect(sink.volumes).toEqual([1]);
  });

  it('ends exactly on the target even when the steps do not divide evenly', async () => {
    const sink = makeSink();
    const ramper = new VolumeRamper(sink, undefined, 25);

    const done = ramper.ramp(0.1, 0.7, 75);
    await vi.advanceTimersByTimeAsync(75);
    await done;

    expect(sink.volumes.at(-1)).toBe(0.7);
  });

  it('keeps every value inside 0..1', async () => {
    const sink = makeSink();
    const ramper = new VolumeRamper(sink, undefined, 25);

    const up = ramper.ramp(0.9, 1.5, 100);
    await vi.advanceTimersByTimeAsync(100);
    await up;
    const down = ramper.ramp(0.1, -0.5, 100);
    await vi.advanceTimersByTimeAsync(100);
    await down;

    expect(Math.max(...sink.volumes)).toBe(1);
    expect(Math.min(...sink.volumes)).toBe(0);
  });

  it('starting a new ramp cancels the running one', async () => {
    const sink = makeSink();
    const ramper = new VolumeRamper(sink, undefined, 25);

    const first = ramper.ramp(0, 1, 100);
    await vi.advanceTimersByTimeAsync(50); // two steps: 0.25, 0.5
    const second = ramper.ramp(0.5, 0, 50);

    expect(await first).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(await second).toBe(true);
    expect(sink.volumes).toEqual([0.25, 0.5, 0.25, 0]);
  });

  it('cancel stops the ramp where it is and resolves false', async () => {
    const sink = makeSink();
    const ramper = new VolumeRamper(sink, undefined, 25);

    const ramp = ramper.ramp(0, 1, 100);
    await vi.advanceTimersByTimeAsync(25);
    ramper.cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(await ramp).toBe(false);
    expect(sink.volumes).toEqual([0.25]);
    expect(ramper.isRamping).toBe(false);
  });

  it('cancel without a running ramp does nothing', () => {
    const ramper = new VolumeRamper(makeSink(), undefined, 25);

    expect(() => ramper.cancel()).not.toThrow();
    expect(ramper.isRamping).toBe(false);
  });

  it('reports sink failures and keeps ramping', async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const sink = {
      setVolume: () => {
        calls++;
        if (calls === 1) throw new Error('sync failure');
        if (calls === 2) return Promise.reject(new Error('async failure'));
        return undefined;
      },
    };
    const ramper = new VolumeRamper(sink, undefined, 25, (e) => errors.push(e));

    const done = ramper.ramp(0, 1, 100);
    await vi.advanceTimersByTimeAsync(100);

    expect(await done).toBe(true);
    expect(calls).toBe(4);
    expect(errors.map((e) => (e as Error).message)).toEqual(['sync failure', 'async failure']);
  });

  it('uses the documented default step', () => {
    expect(RAMP_STEP_MS).toBe(25);
  });
});

describe('FadeController', () => {
  /** A fake SDK player that records the order of calls, including the volumes set. */
  function makePlayer(paused: boolean | null) {
    const calls: string[] = [];
    const player: FadePlayer = {
      getCurrentState: () => Promise.resolve(paused === null ? null : { paused }),
      pause: () => {
        calls.push('pause');
        return Promise.resolve();
      },
      resume: () => {
        calls.push('resume');
        return Promise.resolve();
      },
      setVolume: (v) => {
        calls.push(`volume:${v}`);
      },
    };
    return { player, calls };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fades out, pauses, then restores the user volume', async () => {
    const { player, calls } = makePlayer(false);
    const ramper = new VolumeRamper(player, undefined, 25);
    const fader = new FadeController(player, ramper, () => 0.5, 100);

    const toggle = fader.toggle();
    await vi.advanceTimersByTimeAsync(100);
    await toggle;

    expect(calls).toEqual(['volume:0.375', 'volume:0.25', 'volume:0.125', 'volume:0', 'pause', 'volume:0.5']);
  });

  it('starts silent, resumes, then fades up to the user volume', async () => {
    const { player, calls } = makePlayer(true);
    const ramper = new VolumeRamper(player, undefined, 25);
    const fader = new FadeController(player, ramper, () => 0.5, 100);

    const toggle = fader.toggle();
    await vi.advanceTimersByTimeAsync(100);
    await toggle;

    expect(calls).toEqual(['volume:0', 'resume', 'volume:0.125', 'volume:0.25', 'volume:0.375', 'volume:0.5']);
  });

  it('does nothing when there is no playback state', async () => {
    const { player, calls } = makePlayer(null);
    const fader = new FadeController(player, new VolumeRamper(player, undefined, 25), () => 0.5, 100);

    await fader.toggle();

    expect(calls).toEqual([]);
  });

  it('fades back to the volume the user has now, not the one from construction time', async () => {
    const { player, calls } = makePlayer(true);
    let base = 0.5;
    const fader = new FadeController(player, new VolumeRamper(player, undefined, 25), () => base, 100);

    base = 0.8;
    const toggle = fader.toggle();
    await vi.advanceTimersByTimeAsync(100);
    await toggle;

    expect(calls.at(-1)).toBe('volume:0.8');
  });

  it('does not pause when the user changes the volume mid fade-out', async () => {
    const { player, calls } = makePlayer(false);
    const ramper = new VolumeRamper(player, undefined, 25);
    const fader = new FadeController(player, ramper, () => 0.5, 100);

    const toggle = fader.toggle();
    await vi.advanceTimersByTimeAsync(50);
    ramper.cancel(); // what the host does when the volume slider moves
    await vi.advanceTimersByTimeAsync(500);
    await toggle;

    expect(calls).not.toContain('pause');
    expect(calls).toEqual(['volume:0.375', 'volume:0.25']);
  });

  it('exposes the documented default fade length', () => {
    expect(FADE_MS).toBe(800);
  });
});
