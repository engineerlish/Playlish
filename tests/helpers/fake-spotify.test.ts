import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeSpotify } from './fake-spotify';

describe('FakeSpotify test helper', () => {
  let fake: FakeSpotify;

  beforeEach(async () => {
    fake = await FakeSpotify.start();
  });

  afterEach(async () => {
    await fake.stop();
  });

  it('serves scripted responses in order and repeats the last one', async () => {
    fake.on('PUT', '/v1/me/player', { status: 404 }, { status: 404 }, { status: 204 });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await fetch(`${fake.baseUrl}/v1/me/player`, { method: 'PUT' })).status);
    }

    expect(statuses).toEqual([404, 404, 204, 204]);
  });

  it('records method, path, query, headers and a parsed JSON body', async () => {
    fake.on('PUT', '/v1/me/player/play', { status: 204 });

    await fetch(`${fake.baseUrl}/v1/me/player/play?device_id=abc`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: ['spotify:track:1'] }),
    });

    const [request] = fake.requestsFor('PUT', '/v1/me/player/play');
    expect(request?.query.get('device_id')).toBe('abc');
    expect(request?.headers.authorization).toBe('Bearer test-token');
    expect(request?.body).toEqual({ uris: ['spotify:track:1'] });
  });

  it('can build a response from the request', async () => {
    fake.on('GET', '/echo', (request) => ({ status: 200, body: { state: request.query.get('state') } }));

    expect(await (await fetch(`${fake.baseUrl}/echo?state=xyz`)).json()).toEqual({ state: 'xyz' });
  });

  it('answers unscripted routes with a Spotify-shaped 404', async () => {
    const res = await fetch(`${fake.baseUrl}/v1/nothing`);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { status: 404 } });
  });

  it('sends JSON for objects and raw text for strings (malformed body tests)', async () => {
    fake.on('GET', '/json', { status: 200, body: { ok: true } });
    fake.on('GET', '/broken', { status: 200, body: '{"truncated":' });

    expect(await (await fetch(`${fake.baseUrl}/json`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`${fake.baseUrl}/broken`)).text()).toBe('{"truncated":');
  });

  it('can send headers such as Retry-After', async () => {
    fake.on('GET', '/limited', {
      status: 429,
      headers: { 'Retry-After': '7' },
      body: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' },
    });

    const res = await fetch(`${fake.baseUrl}/limited`);

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('7');
  });

  it('can simulate network loss by dropping the connection', async () => {
    fake.on('GET', '/gone', { status: 200, dropConnection: true });

    await expect(fetch(`${fake.baseUrl}/gone`)).rejects.toThrow();
  });
});
