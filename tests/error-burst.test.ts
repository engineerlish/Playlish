import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_ERRORS, DEFAULT_WINDOW_MS, ErrorBurstLimiter } from '../src/main/error-burst';

/** A limiter driven by a clock the test controls. */
function makeLimiter(max = 3, windowMs = 10_000) {
  let now = 1_000_000;
  const limiter = new ErrorBurstLimiter(max, windowMs, () => now);
  return {
    limiter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('ErrorBurstLimiter', () => {
  it('does not trip below the limit', () => {
    const { limiter } = makeLimiter();

    expect(limiter.record()).toBe(false);
    expect(limiter.record()).toBe(false);
  });

  it('trips when the limit is reached inside the window', () => {
    const { limiter, advance } = makeLimiter();

    limiter.record();
    advance(1000);
    limiter.record();
    advance(1000);

    expect(limiter.record()).toBe(true);
  });

  it('ignores errors that have left the window', () => {
    const { limiter, advance } = makeLimiter();

    limiter.record();
    limiter.record();
    advance(10_001);

    expect(limiter.record()).toBe(false);
  });

  it('counts an error exactly one window old as expired', () => {
    const { limiter, advance } = makeLimiter(2, 10_000);

    limiter.record();
    advance(10_000);

    expect(limiter.record()).toBe(false);
  });

  it('keeps reporting a burst while errors continue', () => {
    const { limiter } = makeLimiter(2, 10_000);

    limiter.record();

    expect(limiter.record()).toBe(true);
    expect(limiter.record()).toBe(true);
  });

  it('forgets everything on reset', () => {
    const { limiter } = makeLimiter(2, 10_000);
    limiter.record();

    limiter.reset();

    expect(limiter.record()).toBe(false);
  });

  it('defaults to 3 errors in 10 seconds', () => {
    expect(DEFAULT_MAX_ERRORS).toBe(3);
    expect(DEFAULT_WINDOW_MS).toBe(10_000);
  });
});
