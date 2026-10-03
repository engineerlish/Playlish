/*
 * Typed Spotify Web API models, limited to the fields Playlish uses, in their current shapes (verified against
 * developer.spotify.com in October 2026, after the February 2026 changes):
 * - the current user has no email, country, product or followers
 * - tracks and artists have no popularity; albums no label or popularity
 * - playlists report their size in `items.total` (the old `tracks` field is deprecated) and playlist entries hold the
 *   track or episode under `item`
 * - the queue and playback state can contain podcast episodes as well as tracks
 * Keeping these in one file means a future API change is fixed here and in the fixtures, nowhere else.
 */

export interface Image {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SimplifiedArtist {
  id: string;
  name: string;
  uri: string;
}

export interface Artist extends SimplifiedArtist {
  images: Image[];
  genres?: string[];
}

export interface SimplifiedAlbum {
  id: string;
  name: string;
  uri: string;
  images: Image[];
  artists: SimplifiedArtist[];
  album_type?: string;
  release_date?: string;
  total_tracks?: number;
}

export interface Track {
  type: 'track';
  id: string | null;
  name: string;
  uri: string;
  duration_ms: number;
  explicit: boolean;
  artists: SimplifiedArtist[];
  album: SimplifiedAlbum;
  is_local?: boolean;
  is_playable?: boolean;
}

export interface Episode {
  type: 'episode';
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  images: Image[];
  show?: { id: string; name: string; uri: string; images: Image[] };
}

export type PlayableItem = Track | Episode;

export interface Paging<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
  previous?: string | null;
}

export interface CurrentUser {
  id: string;
  display_name: string | null;
  uri: string;
  images: Image[];
}

export interface Device {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  is_private_session: boolean;
  volume_percent: number | null;
  supports_volume: boolean;
}

export type RepeatMode = 'off' | 'track' | 'context';

export interface PlaybackState {
  device: Device;
  repeat_state: RepeatMode;
  shuffle_state: boolean;
  context: { uri: string; type: string } | null;
  timestamp: number;
  progress_ms: number | null;
  is_playing: boolean;
  item: PlayableItem | null;
  currently_playing_type: string;
}

export interface Queue {
  currently_playing: PlayableItem | null;
  queue: PlayableItem[];
}

export interface SavedTrack {
  added_at: string;
  track: Track;
}

export interface SavedAlbum {
  added_at: string;
  album: SimplifiedAlbum;
}

export interface SimplifiedPlaylist {
  id: string;
  name: string;
  uri: string;
  images: Image[] | null;
  owner: { id: string; display_name: string | null };
  snapshot_id: string;
  collaborative: boolean;
  public: boolean | null;
  description: string | null;
  /** Number of entries (renamed from `tracks` in February 2026). */
  items: { total: number; href: string };
}

export interface PlaylistItem {
  added_at: string | null;
  is_local: boolean;
  /** The track or episode (renamed from `track` in February 2026); null when Spotify no longer has it. */
  item: PlayableItem | null;
}

export type SearchType = 'track' | 'album' | 'artist' | 'playlist';

export interface SearchResults {
  tracks?: Paging<Track>;
  albums?: Paging<SimplifiedAlbum>;
  artists?: Paging<Artist>;
  /** Spotify sometimes returns null entries in playlist search results; they are kept as null here. */
  playlists?: Paging<SimplifiedPlaylist | null>;
}
