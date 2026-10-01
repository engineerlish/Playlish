import { describe, expect, it } from 'vitest';
import { ESCALATE_WINDOW_MS, STALL_THRESHOLD_MS, StallDetector, StallRecovery } from '../src/renderer/stall';

const playing = (positionMs: number) => ({ paused: false, positionMs });

describe('StallDetector', () => {
  it('does not report a stall while the position advances', () => {
    const detector = new StallDetector(5000);

    expect(detector.observe(playing(0), 0)).toBe(false);
    expect(detector.observe(playing(2000), 2000)).toBe(false);
    expect(detector.observe(playing(4000), 4000)).toBe(false);
    expect(detector.observe(playing(6000), 6000)).toBe(false);
  });

  it('reports a stall once the position has stood still for the threshold', () => {
    const detector = new StallDetector(5000);

    detector.observe(playing(1003), 1000);

    expect(detector.observe(playing(1003), 5999)).toBe(false);
    expect(detector.observe(playing(1003), 6000)).toBe(true);
    expect(detector.observe(playing(1003), 9000)).toBe(true);
  });

  it('counts from the last change in position, not from the first sample', () => {
    const detector = new StallDetector(5000);

    detector.observe(playing(0), 0);
    detector.observe(playing(1000), 4000);

    expect(detector.observe(playing(1000), 8999)).toBe(false);
    expect(detector.observe(playing(1000), 9000)).toBe(true);
  });

  it('recovers as soon as the position moves again', () => {
    const detector = new StallDetector(5000);
    detector.observe(playing(500), 0);
    expect(detector.observe(playing(500), 6000)).toBe(true);

    expect(detector.observe(playing(1500), 7000)).toBe(false);
  });

  it('never reports a stall while paused, however long', () => {
    const detector = new StallDetector(5000);

    detector.observe({ paused: true, positionMs: 30241 }, 0);

    expect(detector.observe({ paused: true, positionMs: 30241 }, 60_000)).toBe(false);
  });

  it('starts counting afresh after a pause', () => {
    const detector = new StallDetector(5000);
    detector.observe(playing(700), 0);
    detector.observe({ paused: true, positionMs: 700 }, 10_000);

    expect(detector.observe(playing(700), 11_000)).toBe(false);
    expect(detector.observe(playing(700), 15_999)).toBe(false);
    expect(detector.observe(playing(700), 16_000)).toBe(true);
  });

  it('ignores missing player state', () => {
    const detector = new StallDetector(5000);
    detector.observe(playing(700), 0);

    expect(detector.observe(null, 20_000)).toBe(false);
    expect(detector.observe(playing(700), 21_000)).toBe(false);
  });

  it('can be reset after a recovery attempt', () => {
    const detector = new StallDetector(5000);
    detector.observe(playing(900), 0);
    expect(detector.observe(playing(900), 6000)).toBe(true);

    detector.reset();

    expect(detector.observe(playing(900), 6500)).toBe(false);
  });

  it('uses a 5 second default threshold', () => {
    expect(STALL_THRESHOLD_MS).toBe(5000);
  });
});

describe('StallRecovery', () => {
  it('does nothing while playback is healthy', () => {
    const recovery = new StallRecovery(30_000);

    expect(recovery.next(false, 0)).toBe('none');
    expect(recovery.next(false, 10_000)).toBe('none');
  });

  it('nudges first', () => {
    const recovery = new StallRecovery(30_000);

    expect(recovery.next(true, 1000)).toBe('nudge');
  });

  it('restarts when the stall comes back soon after a nudge', () => {
    const recovery = new StallRecovery(30_000);
    recovery.next(true, 1000);

    expect(recovery.next(true, 16_000)).toBe('restart');
  });

  it('nudges again when the earlier nudge is old enough', () => {
    const recovery = new StallRecovery(30_000);
    recovery.next(true, 1000);

    expect(recovery.next(true, 31_000)).toBe('nudge');
  });

  it('starts over with a nudge after a restart', () => {
    const recovery = new StallRecovery(30_000);
    recovery.next(true, 1000);
    recovery.next(true, 10_000); // restart

    expect(recovery.next(true, 12_000)).toBe('nudge');
  });

  it('does not count a healthy period as an escalation', () => {
    const recovery = new StallRecovery(30_000);
    recovery.next(true, 1000);
    expect(recovery.next(false, 5000)).toBe('none');

    expect(recovery.next(true, 40_000)).toBe('nudge');
  });

  it('uses a 30 second default escalation window', () => {
    expect(ESCALATE_WINDOW_MS).toBe(30_000);
  });
});
