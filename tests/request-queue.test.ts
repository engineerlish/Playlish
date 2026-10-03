import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponseCache } from '../src/main/spotify/cache';
import { QuotaPausedError, SpotifyApiError, describeApiError } from '../src/main/spotify/errors';
import { QUOTA_PAUSE_MS, RequestQueue, type Priority } from '../src/main/spotify/queue';

/** A job whose completion the test controls. */
function deferred<T = string>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rateLimit = (sec?: number) => new SpotifyApiError(429, undefined, 'Too many requests', sec);
const quota = () => new SpotifyApiError(429, 'QUOTA_EXCEEDED', 'Too many requests');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestQueue ordering', () => {
  it('runs user actions first, then visible pages, then background, first come first served within each', async () => {
    const queue = new RequestQueue({ concurrency: 1 });
    const order: string[] = [];
    const gate = deferred();
    const first = queue.run({ priority: 'background', endpoint: 'gate', run: () => gate.promise });

    const jobs = (
      [
        ['background', 'b1'],
        ['visible', 'v1'],
        ['user', 'u1'],
        ['background', 'b2'],
        ['user', 'u2'],
        ['visible', 'v2'],
      ] as [Priority, string][]
    ).map(([priority, name]) => queue.run({ priority, endpoint: name, run: () => Promise.resolve(order.push(name)) }));
    gate.resolve('done');
    await Promise.all([first, ...jobs]);

    expect(order).toEqual(['u1', 'u2', 'v1', 'v2', 'b1', 'b2']);
  });

  it('never runs more requests at once than the concurrency cap', async () => {
    const queue = new RequestQueue({ concurrency: 2 });
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const all = gates.map((g, i) =>
      queue.run({
        priority: 'visible',
        endpoint: `e${i}`,
        run: async () => {
          running++;
          peak = Math.max(peak, running);
          await g.promise;
          running--;
          return i;
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(running).toBe(2);
    for (const g of gates) g.resolve('x');
    await Promise.all(all);

    expect(peak).toBe(2);
  });
});

describe('RequestQueue coalescing', () => {
  it('shares one call between identical in-flight requests', async () => {
    const queue = new RequestQueue();
    const run = vi.fn(() => Promise.resolve({ devices: [] }));

    const [a, b, c] = await Promise.all([
      queue.run({ priority: 'visible', endpoint: 'GET /me/player/devices', key: 'GET /me/player/devices', run }),
      queue.run({ priority: 'visible', endpoint: 'GET /me/player/devices', key: 'GET /me/player/devices', run }),
      queue.run({ priority: 'user', endpoint: 'GET /me/player/devices', key: 'GET /me/player/devices', run }),
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(queue.status().endpoints['GET /me/player/devices']).toMatchObject({ calls: 1, coalesced: 2 });
  });

  it('makes a new call once the shared one has finished, including after a failure', async () => {
    const queue = new RequestQueue();
    const run = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok');

    await expect(queue.run({ priority: 'visible', endpoint: 'e', key: 'k', run })).rejects.toThrow('network');
    await expect(queue.run({ priority: 'visible', endpoint: 'e', key: 'k', run })).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not share requests without a key (for example commands)', async () => {
    const queue = new RequestQueue();
    const run = vi.fn(() => Promise.resolve(undefined));

    await Promise.all([queue.run({ priority: 'user', endpoint: 'PUT /me/player/pause', run }), queue.run({ priority: 'user', endpoint: 'PUT /me/player/pause', run })]);

    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('RequestQueue rate limits (429)', () => {
  it('pauses every request for Retry-After, then retries the same request and succeeds', async () => {
    const queue = new RequestQueue({ concurrency: 1 });
    const run = vi.fn().mockRejectedValueOnce(rateLimit(3)).mockResolvedValueOnce('played');
    const other = vi.fn(() => Promise.resolve('other'));

    const first = queue.run({ priority: 'user', endpoint: 'PUT /me/player/play', run });
    const second = queue.run({ priority: 'visible', endpoint: 'GET /me/tracks', run: other });
    await vi.advanceTimersByTimeAsync(2999);
    expect(run).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(queue.status().rateLimitedUntil?.toISOString()).toBe('2026-10-03T12:00:03.000Z');

    await vi.advanceTimersByTimeAsync(1);

    await expect(first).resolves.toBe('played');
    await expect(second).resolves.toBe('other');
    expect(queue.status().endpoints['PUT /me/player/play']).toMatchObject({ calls: 2, rateLimited: 1, failures: 0 });
  });

  it('retries the rate-limited request before newer requests of the same priority', async () => {
    const queue = new RequestQueue({ concurrency: 1 });
    const order: string[] = [];
    const flaky = vi.fn().mockRejectedValueOnce(rateLimit(1)).mockImplementation(() => Promise.resolve(order.push('first')));

    const a = queue.run({ priority: 'visible', endpoint: 'a', run: flaky });
    const b = queue.run({ priority: 'visible', endpoint: 'b', run: () => Promise.resolve(order.push('second')) });
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([a, b]);

    expect(order).toEqual(['first', 'second']);
  });

  it('uses a default wait when Retry-After is missing', async () => {
    const queue = new RequestQueue();
    const run = vi.fn().mockRejectedValueOnce(rateLimit()).mockResolvedValueOnce('ok');

    const job = queue.run({ priority: 'user', endpoint: 'e', run });
    await vi.advanceTimersByTimeAsync(4999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(job).resolves.toBe('ok');
  });

  it('gives up after a few retries and reports the rate limit', async () => {
    const queue = new RequestQueue({ maxRateLimitRetries: 2 });
    const run = vi.fn().mockRejectedValue(rateLimit(1));

    const job = queue.run({ priority: 'user', endpoint: 'e', run });
    const outcome = job.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await outcome).toBeInstanceOf(SpotifyApiError);
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe('RequestQueue quota (429 QUOTA_EXCEEDED)', () => {
  it('never retries a quota error and refuses background work for a while', async () => {
    const queue = new RequestQueue();
    const run = vi.fn().mockRejectedValue(quota());

    await expect(queue.run({ priority: 'visible', endpoint: 'GET /me/tracks', run })).rejects.toMatchObject({ reason: 'QUOTA_EXCEEDED' });
    expect(run).toHaveBeenCalledTimes(1);

    const background = vi.fn(() => Promise.resolve('x'));
    await expect(queue.run({ priority: 'background', endpoint: 'refresh', run: background })).rejects.toBeInstanceOf(QuotaPausedError);
    expect(background).not.toHaveBeenCalled();
    expect(queue.status().quotaPausedUntil).not.toBeNull();
  });

  it('still tries what the user does during the pause', async () => {
    const queue = new RequestQueue();
    await queue.run({ priority: 'visible', endpoint: 'e', run: () => Promise.reject(quota()) }).catch(() => undefined);

    await expect(queue.run({ priority: 'user', endpoint: 'PUT /me/player/pause', run: () => Promise.resolve('paused') })).resolves.toBe('paused');
  });

  it('refuses background work that was already waiting when the quota ran out', async () => {
    const queue = new RequestQueue({ concurrency: 1 });
    const gate = deferred();
    const failing = queue.run({ priority: 'user', endpoint: 'e', run: () => gate.promise });
    const waiting = queue.run({ priority: 'background', endpoint: 'refresh', run: () => Promise.resolve('x') });
    const settled = waiting.catch((e: unknown) => e);

    gate.reject(quota());
    await failing.catch(() => undefined);

    expect(await settled).toBeInstanceOf(QuotaPausedError);
  });

  it('accepts background work again after the pause', async () => {
    const queue = new RequestQueue();
    await queue.run({ priority: 'visible', endpoint: 'e', run: () => Promise.reject(quota()) }).catch(() => undefined);

    vi.advanceTimersByTime(QUOTA_PAUSE_MS);

    await expect(queue.run({ priority: 'background', endpoint: 'refresh', run: () => Promise.resolve('back') })).resolves.toBe('back');
  });
});

describe('RequestQueue errors and statistics', () => {
  it('passes other errors straight through without retrying', async () => {
    const queue = new RequestQueue();
    const run = vi.fn().mockRejectedValue(new SpotifyApiError(403, 'PREMIUM_REQUIRED', 'Premium required'));

    await expect(queue.run({ priority: 'user', endpoint: 'PUT /me/player/play', run })).rejects.toMatchObject({ status: 403 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.status().endpoints['PUT /me/player/play']).toMatchObject({ calls: 1, failures: 1 });
  });

  it('keeps going after a job throws something that is not an API error', async () => {
    const queue = new RequestQueue({ concurrency: 1 });

    await expect(queue.run({ priority: 'user', endpoint: 'e', run: () => Promise.reject(new TypeError('fetch failed')) })).rejects.toThrow('fetch failed');
    await expect(queue.run({ priority: 'user', endpoint: 'e', run: () => Promise.resolve(1) })).resolves.toBe(1);
    expect(queue.status()).toMatchObject({ waiting: 0, active: 0 });
  });
});

describe('describeApiError', () => {
  it('describes a rate limit as something Playlish retries (#24)', () => {
    expect(describeApiError(rateLimit(7))).toBe('Spotify asked Playlish to slow down. Trying again in 7 seconds.');
  });

  it('explains the quota and what Playlish does about it', () => {
    const message = describeApiError(quota());

    expect(message).toMatch(/developer quota is used up/);
    expect(message).toMatch(/Background updates are paused/);
  });
});

describe('ResponseCache', () => {
  it('returns a value until it expires', () => {
    const cache = new ResponseCache(10);
    cache.set('GET /me/tracks?offset=0', { items: [1] }, 1000);

    vi.advanceTimersByTime(999);
    expect(cache.get('GET /me/tracks?offset=0')).toEqual({ items: [1] });
    vi.advanceTimersByTime(1);
    expect(cache.get('GET /me/tracks?offset=0')).toBeUndefined();
  });

  it('keeps entries without expiry until they are evicted', () => {
    const cache = new ResponseCache(10);
    cache.set('playlist:abc:snap1:0', [1], Infinity);

    vi.advanceTimersByTime(365 * 24 * 3_600_000);

    expect(cache.get('playlist:abc:snap1:0')).toEqual([1]);
  });

  it('drops the least recently used entry beyond the cap', () => {
    const cache = new ResponseCache(2);
    cache.set('a', 1, Infinity);
    cache.set('b', 2, Infinity);
    cache.get('a'); // a is now more recent than b
    cache.set('c', 3, Infinity);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('invalidates by prefix and clears everything', () => {
    const cache = new ResponseCache(10);
    cache.set('library:tracks:0', 1, Infinity);
    cache.set('library:albums:0', 2, Infinity);
    cache.set('search:x', 3, Infinity);

    cache.invalidate('library:');
    expect([cache.get('library:tracks:0'), cache.get('library:albums:0'), cache.get('search:x')]).toEqual([undefined, undefined, 3]);

    cache.clear();
    expect(cache.size).toBe(0);
  });
});
