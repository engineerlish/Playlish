import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryService, MAX_URIS, OTHERS_PLAYLIST_NOTE, PAGE_SIZE, checkAction, checkListRequest } from '../src/main/library';
import { SpotifyClient } from '../src/main/spotify/client';
import { RequestQueue } from '../src/main/spotify/queue';
import type { PlaylistRow, TrackRow } from '../src/shared/types';
import { FakeSpotify } from './helpers/fake-spotify';

/*
 * The Library pages' data (#47): the real client and the library service against the fake Spotify server, answering
 * with the fixtures in tests/fixtures/spotify.
 */

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'spotify');
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as unknown;
const ok = (name: string) => ({ status: 200, body: fixture(name) });

let fake: FakeSpotify;
let target: string | null;
let played: number;

function service() {
  const client = new SpotifyClient({ getAccessToken: () => Promise.resolve('token'), baseUrl: `${fake.baseUrl}/v1`, queue: new RequestQueue(), delay: () => Promise.resolve() });
  return new LibraryService({
    api: () => client,
    targetDeviceId: () => target,
    afterPlay: () => {
      played++;
    },
  });
}

beforeEach(async () => {
  fake = await FakeSpotify.start();
  fake.on('GET', '/v1/me', ok('me.json'));
  target = 'this-computer';
  played = 0;
});

afterEach(async () => {
  await fake.stop();
});

describe('library pages', () => {
  it('lists saved tracks as small rows with small art, a page at a time', async () => {
    fake.on('GET', '/v1/me/tracks', ok('saved-tracks.json'));

    const result = await service().page({ kind: 'tracks' }, 50);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page).toMatchObject({ offset: 50, total: 3 });
    expect(result.page.rows.map((r) => (r as TrackRow).name)).toEqual(['Fixture Track 1', 'Fixture Track 2', 'Fixture Track 3']);
    expect(Object.keys(result.page.rows[0] ?? {}).sort()).toEqual(['album', 'artUrl', 'artists', 'durationMs', 'explicit', 'kind', 'name', 'playable', 'uri']);
    const [request] = fake.requestsFor('GET', '/v1/me/tracks');
    expect(request?.query.get('offset')).toBe('50');
    expect(request?.query.get('limit')).toBe(String(PAGE_SIZE));
  });

  it('lists saved albums', async () => {
    fake.on('GET', '/v1/me/albums', ok('saved-albums.json'));

    const result = await service().page({ kind: 'albums' }, 0);

    expect(result.ok && result.page.rows.map((r) => r?.kind === 'album' && r.name)).toEqual(['Fixture Album 1', 'Fixture Album 2']);
  });

  it("marks the user's own playlists as listable and other people's as not", async () => {
    fake.on('GET', '/v1/me/playlists', ok('playlists.json'));

    const result = await service().page({ kind: 'playlists' }, 0);

    const rows = result.ok ? (result.page.rows as PlaylistRow[]) : [];
    expect(rows.map((r) => [r.name, r.canList, r.total])).toEqual([
      ['Fixture Playlist', true, 3],
      ['Someone Else', false, expect.any(Number) as number],
    ]);
  });

  it("lists a playlist's entries: tracks, episodes, and null for ones Spotify no longer has", async () => {
    fake.on('GET', '/v1/playlists/playlist0000000000001/items', ok('playlist-items.json'));

    const result = await service().page({ kind: 'playlist', id: 'playlist0000000000001', snapshotId: 'snapshot-1' }, 0);

    const rows = result.ok ? result.page.rows : [];
    expect(rows.map((r) => (r ? (r as TrackRow).name : null))).toEqual(['Fixture Track 5', 'Fixture Episode 6', null]);
  });

  it("explains Spotify's refusal for someone else's playlist in plain words", async () => {
    fake.on('GET', '/v1/playlists/playlist0000000000002/items', { status: 403, body: fixture('error-not-owner.json') });

    const result = await service().page({ kind: 'playlist', id: 'playlist0000000000002', snapshotId: 'snapshot-1' }, 0);

    expect(result).toEqual({ ok: false, error: OTHERS_PLAYLIST_NOTE });
  });

  it("lists an album's tracks without repeating the album, marking unplayable ones", async () => {
    fake.on('GET', '/v1/albums/album00000000000000001/tracks', ok('album-tracks.json'));

    const result = await service().page({ kind: 'album', id: 'album00000000000000001' }, 0);

    const rows = (result.ok ? result.page.rows : []) as TrackRow[];
    expect(rows.map((r) => [r.name, r.album, r.playable, r.artists])).toEqual([
      ['Album Opener', '', true, 'Fixture Artist 1'],
      ['Album Closer', '', false, 'Fixture Artist 1, Guest'],
    ]);
  });

  it('reports network trouble without throwing', async () => {
    fake.on('GET', '/v1/me/tracks', { status: 200, dropConnection: true });

    const result = await service().page({ kind: 'tracks' }, 0);

    expect(result.ok).toBe(false);
  });
});

describe('library actions', () => {
  it('plays a context from a track on the target device', async () => {
    fake.on('PUT', '/v1/me/player/play', { status: 204 });

    const result = await service().action({ type: 'play', contextUri: 'spotify:album:album00000000000000001', offsetUri: 'spotify:track:track00000000000000012' });

    expect(result).toEqual({ ok: true });
    const [request] = fake.requestsFor('PUT', '/v1/me/player/play');
    expect(request?.query.get('device_id')).toBe('this-computer');
    expect(request?.body).toEqual({ context_uri: 'spotify:album:album00000000000000001', offset: { uri: 'spotify:track:track00000000000000012' } });
    expect(played).toBe(1);
  });

  it('plays a list of tracks (liked songs have no context) and lets Spotify pick the device when none is known', async () => {
    target = null;
    fake.on('PUT', '/v1/me/player/play', { status: 204 });

    await service().action({ type: 'play', uris: ['spotify:track:a1', 'spotify:track:a2'] });

    const [request] = fake.requestsFor('PUT', '/v1/me/player/play');
    expect(request?.query.has('device_id')).toBe(false);
    expect(request?.body).toEqual({ uris: ['spotify:track:a1', 'spotify:track:a2'] });
  });

  it('adds to the queue, saves and removes', async () => {
    fake.on('POST', '/v1/me/player/queue', { status: 204 });
    fake.on('PUT', '/v1/me/library', { status: 200 });
    fake.on('DELETE', '/v1/me/library', { status: 200 });
    const s = service();

    expect(await s.action({ type: 'queue', uri: 'spotify:track:a1' })).toEqual({ ok: true });
    expect(await s.action({ type: 'save', uris: ['spotify:album:b1'] })).toEqual({ ok: true });
    expect(await s.action({ type: 'remove', uris: ['spotify:track:a1'] })).toEqual({ ok: true });

    expect(fake.requestsFor('POST', '/v1/me/player/queue')[0]?.query.get('uri')).toBe('spotify:track:a1');
    expect(fake.requestsFor('PUT', '/v1/me/library')[0]?.query.get('uris')).toBe('spotify:album:b1');
    expect(fake.requestsFor('DELETE', '/v1/me/library')[0]?.query.get('uris')).toBe('spotify:track:a1');
  });

  it('turns a failure into a message', async () => {
    fake.on('POST', '/v1/me/player/queue', { status: 403, body: fixture('error-premium.json') });

    const result = await service().action({ type: 'queue', uri: 'spotify:track:a1' });

    expect(result.ok).toBe(false);
  });
});

describe('checks on what the window sends', () => {
  it.each([
    [{ kind: 'tracks' }, 0, null],
    [{ kind: 'album', id: 'abc123' }, 50, null],
    [{ kind: 'playlist', id: 'abc', snapshotId: 's' }, 0, null],
    [{ kind: 'tracks' }, -1, 'Invalid position in the list.'],
    [{ kind: 'tracks' }, 1.5, 'Invalid position in the list.'],
    [{ kind: 'tracks' }, 10_000_000, 'Invalid position in the list.'],
    [{ kind: 'album', id: '../me' }, 0, 'Unknown album.'],
    [{ kind: 'playlist', id: 'abc' }, 0, 'Unknown playlist.'],
    [{ kind: 'users' }, 0, 'Unknown list.'],
    [null, 0, 'Unknown list.'],
  ])('list %j at %s -> %s', (list, offset, expected) => {
    expect(checkListRequest(list, offset)).toBe(expected);
  });

  it.each([
    [{ type: 'play', contextUri: 'spotify:playlist:p1' }, null],
    [{ type: 'play' }, 'Nothing to play.'],
    [{ type: 'play', contextUri: 'https://evil.example' }, 'Unknown item.'],
    [{ type: 'play', uris: [] }, 'Unknown item.'],
    [{ type: 'queue', uri: 'spotify:track:a1' }, null],
    [{ type: 'queue', uri: 'spotify:track:a1&x=1' }, 'Unknown item.'],
    [{ type: 'save', uris: Array.from({ length: MAX_URIS + 1 }, (_, i) => `spotify:track:t${i}`) }, 'Unknown item.'],
    [{ type: 'delete-account' }, 'Unknown action.'],
  ])('action %j -> %s', (action, expected) => {
    expect(checkAction(action)).toBe(expected);
  });

  it('never calls the API for a request it refused', async () => {
    const s = service();

    expect((await s.page({ kind: 'album', id: '../../me/player' }, 0)).ok).toBe(false);
    expect((await s.action({ type: 'queue', uri: 'not-a-uri' })).ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });
});
