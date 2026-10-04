import type { ActionResult, AlbumRow, LibraryAction, LibraryList, LibraryPage, LibraryResult, PlaylistRow, TrackRow } from '../shared/types';
import { pickArt } from './now-playing';
import type { PlayOptions } from './spotify/client';
import { SpotifyApiError, describeApiError } from './spotify/errors';
import type { Episode, Paging, PlaylistItem, SavedAlbum, SavedTrack, SimplifiedPlaylist, SimplifiedTrack, Track } from './spotify/types';

/*
 * The Library pages (#47): saved tracks, saved albums, playlists, and the tracks of an album or playlist.
 *
 * The window asks for one page at a time as the user scrolls and keeps only a few pages itself, so memory stays flat
 * however big the library is. This module turns Spotify's large responses into small rows, and checks everything the
 * window sends (list kinds, ids, offsets, URIs) before it reaches the Web API.
 */

// CHANGE HERE: rows per page (50 is the Web API maximum for these endpoints).
export const PAGE_SIZE = 50;
// CHANGE HERE: art size for list rows (40 px shown, x2 for high-DPI screens; Spotify offers 64, 300 and 640).
export const ROW_ART_PX = 64;
// CHANGE HERE: limits on what the window may ask for.
export const MAX_OFFSET = 100_000;
export const MAX_URIS = 200;

const ID = /^[A-Za-z0-9]{1,64}$/;
const URI = /^spotify:(track|episode|album|playlist|artist|show):[A-Za-z0-9]{1,64}$/;

/** Plain-language note for someone else's playlist, whose entries Spotify no longer gives to apps (February 2026). */
export const OTHERS_PLAYLIST_NOTE = "Spotify only lets apps list the songs of your own and collaborative playlists. You can still play this one.";

/** A track (or an album's track, which has no album field) as a row. */
export function trackRow(t: Track | SimplifiedTrack, artUrl: string | null = null): TrackRow {
  const album = 'album' in t ? t.album : null;
  return {
    kind: 'track',
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(', '),
    album: album?.name ?? '',
    durationMs: t.duration_ms,
    artUrl: album ? pickArt(album.images, ROW_ART_PX) : artUrl,
    playable: t.is_playable !== false && t.is_local !== true,
    explicit: t.explicit,
  };
}

/** A podcast episode in a playlist, shown like a track (the show takes the artist's place). */
export function episodeRow(e: Episode): TrackRow {
  return {
    kind: 'track',
    uri: e.uri,
    name: e.name,
    artists: e.show?.name ?? '',
    album: '',
    durationMs: e.duration_ms,
    artUrl: pickArt(e.images.length > 0 ? e.images : (e.show?.images ?? []), ROW_ART_PX),
    playable: true,
    explicit: false,
  };
}

export function albumRow(a: SavedAlbum['album']): AlbumRow {
  return {
    kind: 'album',
    id: a.id,
    uri: a.uri,
    name: a.name,
    artists: a.artists.map((x) => x.name).join(', '),
    artUrl: pickArt(a.images, ROW_ART_PX),
    totalTracks: a.total_tracks ?? null,
  };
}

export function playlistRow(p: SimplifiedPlaylist, myUserId: string | null): PlaylistRow {
  return {
    kind: 'playlist',
    id: p.id,
    uri: p.uri,
    name: p.name,
    owner: p.owner.display_name ?? p.owner.id,
    canList: p.collaborative || (myUserId !== null && p.owner.id === myUserId),
    total: p.items.total,
    artUrl: pickArt(p.images ?? [], ROW_ART_PX),
    snapshotId: p.snapshot_id,
  };
}

/** A playlist entry as a row; null when Spotify no longer has the track. */
export function playlistItemRow(entry: PlaylistItem): TrackRow | null {
  const item = entry.item;
  if (!item) return null;
  return item.type === 'episode' ? episodeRow(item) : trackRow(item);
}

/** Checks a list request from the window. Returns an error message, or null when it is fine. */
export function checkListRequest(list: unknown, offset: unknown): string | null {
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) return 'Invalid position in the list.';
  if (typeof list !== 'object' || list === null) return 'Unknown list.';
  const l = list as Record<string, unknown>;
  switch (l['kind']) {
    case 'tracks':
    case 'albums':
    case 'playlists':
      return null;
    case 'album':
      return typeof l['id'] === 'string' && ID.test(l['id']) ? null : 'Unknown album.';
    case 'playlist':
      return typeof l['id'] === 'string' && ID.test(l['id']) && typeof l['snapshotId'] === 'string' && l['snapshotId'].length > 0 && l['snapshotId'].length <= 200
        ? null
        : 'Unknown playlist.';
    default:
      return 'Unknown list.';
  }
}

/** Checks an action from the window. Returns an error message, or null when it is fine. */
export function checkAction(action: unknown): string | null {
  if (typeof action !== 'object' || action === null) return 'Unknown action.';
  const a = action as Record<string, unknown>;
  const isUri = (v: unknown) => typeof v === 'string' && URI.test(v);
  const isUris = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= MAX_URIS && v.every(isUri);
  switch (a['type']) {
    case 'play':
      if (a['contextUri'] === undefined && a['uris'] === undefined) return 'Nothing to play.';
      if (a['contextUri'] !== undefined && !isUri(a['contextUri'])) return 'Unknown item.';
      if (a['offsetUri'] !== undefined && !isUri(a['offsetUri'])) return 'Unknown item.';
      if (a['uris'] !== undefined && !isUris(a['uris'])) return 'Unknown item.';
      return null;
    case 'queue':
      return isUri(a['uri']) ? null : 'Unknown item.';
    case 'save':
    case 'remove':
      return isUris(a['uris']) ? null : 'Unknown item.';
    default:
      return 'Unknown action.';
  }
}

/** The Web API calls the library uses (a subset of SpotifyClient). */
export interface LibraryApi {
  savedTracks(offset?: number, limit?: number): Promise<Paging<SavedTrack>>;
  savedAlbums(offset?: number, limit?: number): Promise<Paging<SavedAlbum>>;
  playlists(offset?: number, limit?: number): Promise<Paging<SimplifiedPlaylist>>;
  albumTracks(albumId: string, offset?: number, limit?: number): Promise<Paging<SimplifiedTrack>>;
  playlistItems(playlistId: string, snapshotId: string, offset?: number, limit?: number): Promise<Paging<PlaylistItem>>;
  me(): Promise<{ id: string }>;
  play(options?: PlayOptions): Promise<void>;
  addToQueue(uri: string, deviceId?: string): Promise<void>;
  saveToLibrary(uris: string[]): Promise<void>;
  removeFromLibrary(uris: string[]): Promise<void>;
}

export interface LibraryDeps {
  api(): LibraryApi | null;
  /** The device to play on: the one playing now, else this computer, else null (Spotify picks the active one). */
  targetDeviceId(): string | null;
  /** Called after something started playing, so Now Playing can look again. */
  afterPlay(): void;
}

/** Plain words for a failed library call. */
export function describeLibraryError(err: unknown, list?: LibraryList): string {
  if (err instanceof SpotifyApiError) {
    if (list?.kind === 'playlist' && err.status === 403) return OTHERS_PLAYLIST_NOTE;
    return describeApiError(err);
  }
  return 'Could not reach Spotify. Check your internet connection and try again.';
}

/** Loads pages and runs actions for the Library pages. */
export class LibraryService {
  constructor(private readonly deps: LibraryDeps) {}

  /** One page of a list, as rows. */
  async page(list: unknown, offset: unknown): Promise<LibraryResult> {
    const problem = checkListRequest(list, offset);
    if (problem) return { ok: false, error: problem };
    const api = this.deps.api();
    if (!api) return { ok: false, error: 'Log in to see your library.' };
    const l = list as LibraryList;
    const at = offset as number;
    try {
      return { ok: true, page: await this.load(api, l, at) };
    } catch (err) {
      return { ok: false, error: describeLibraryError(err, l) };
    }
  }

  /** Plays, queues, saves or removes. */
  async action(action: unknown): Promise<ActionResult> {
    const problem = checkAction(action);
    if (problem) return { ok: false, error: problem };
    const api = this.deps.api();
    if (!api) return { ok: false, error: 'Log in first.' };
    const a = action as LibraryAction;
    try {
      switch (a.type) {
        case 'play': {
          const deviceId = this.deps.targetDeviceId() ?? undefined;
          await api.play({
            ...(deviceId ? { deviceId } : {}),
            ...(a.contextUri ? { contextUri: a.contextUri } : {}),
            ...(a.uris ? { uris: a.uris } : {}),
            ...(a.offsetUri ? { offset: { uri: a.offsetUri } } : {}),
          });
          this.deps.afterPlay();
          break;
        }
        case 'queue':
          await api.addToQueue(a.uri, this.deps.targetDeviceId() ?? undefined);
          break;
        case 'save':
          await api.saveToLibrary(a.uris);
          break;
        case 'remove':
          await api.removeFromLibrary(a.uris);
          break;
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeLibraryError(err) };
    }
  }

  private async load(api: LibraryApi, list: LibraryList, offset: number): Promise<LibraryPage> {
    switch (list.kind) {
      case 'tracks': {
        const p = await api.savedTracks(offset, PAGE_SIZE);
        return { offset, total: p.total, rows: p.items.map((s) => trackRow(s.track)) };
      }
      case 'albums': {
        const p = await api.savedAlbums(offset, PAGE_SIZE);
        return { offset, total: p.total, rows: p.items.map((s) => albumRow(s.album)) };
      }
      case 'playlists': {
        const [p, me] = await Promise.all([api.playlists(offset, PAGE_SIZE), api.me().catch(() => null)]);
        return { offset, total: p.total, rows: p.items.map((x) => playlistRow(x, me?.id ?? null)) };
      }
      case 'album': {
        const p = await api.albumTracks(list.id, offset, PAGE_SIZE);
        return { offset, total: p.total, rows: p.items.map((t) => trackRow(t)) };
      }
      case 'playlist': {
        const p = await api.playlistItems(list.id, list.snapshotId, offset, PAGE_SIZE);
        return { offset, total: p.total, rows: p.items.map(playlistItemRow) };
      }
    }
  }
}
