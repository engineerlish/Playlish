import type { ArtImage, PlaybackState } from '../shared/types';

/*
 * Media keys and the Windows media overlay (#45), through the browser's Media Session API in the playback host.
 * Chromium hands the session to Windows (System Media Transport Controls), so the overlay shows the track and its
 * buttons, keyboard media keys and headset buttons all arrive here as action handlers. Checked on castLabs Electron 44:
 * a hidden window's session appears in the overlay and its play/pause/next buttons reach these handlers, with no extra
 * Chromium flags.
 *
 * This module takes the session and the player calls as parameters, so it can be unit tested outside a browser.
 */

// CHANGE HERE: how far the overlay's skip-back/skip-forward buttons jump when Windows does not say.
export const DEFAULT_SKIP_SECONDS = 10;

type Action = 'play' | 'pause' | 'stop' | 'nexttrack' | 'previoustrack' | 'seekto' | 'seekbackward' | 'seekforward';

export interface ActionDetails {
  seekTime?: number;
  seekOffset?: number;
}

export interface MetadataInit {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string; sizes?: string }[];
}

/** The parts of navigator.mediaSession used here. */
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: Action, handler: ((details: ActionDetails) => void) | null): void;
  setPositionState?(state?: { duration: number; position: number; playbackRate: number }): void;
}

export interface PlayerCalls {
  resume(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seek(positionMs: number): void;
}

/** Artwork entries in the form Media Session expects ("300x300" sizes), largest last. */
export function toArtwork(images: readonly ArtImage[]): { src: string; sizes?: string }[] {
  return [...images]
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
    .map((i) => (i.width && i.height ? { src: i.url, sizes: `${i.width}x${i.height}` } : { src: i.url }));
}

/** Keeps the Media Session in step with the player and routes the overlay's buttons and media keys to it. */
export class MediaSessionBridge {
  private trackKey: string | null = null;
  private last: PlaybackState | null = null;

  constructor(
    private readonly session: MediaSessionLike,
    private readonly createMetadata: (init: MetadataInit) => unknown,
    private readonly player: PlayerCalls,
  ) {
    const handlers: [Action, (details: ActionDetails) => void][] = [
      ['play', () => player.resume()],
      ['pause', () => player.pause()],
      ['stop', () => player.pause()],
      ['nexttrack', () => player.next()],
      ['previoustrack', () => player.previous()],
      ['seekto', (d) => d.seekTime !== undefined && player.seek(d.seekTime * 1000)],
      ['seekbackward', (d) => player.seek(Math.max(0, this.positionMs() - (d.seekOffset ?? DEFAULT_SKIP_SECONDS) * 1000))],
      ['seekforward', (d) => player.seek(Math.min(this.last?.durationMs ?? 0, this.positionMs() + (d.seekOffset ?? DEFAULT_SKIP_SECONDS) * 1000))],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // An action this Chromium does not know; the others still work.
      }
    }
  }

  /** Called with every state the SDK reports (null when playback left this device). */
  update(state: PlaybackState | null): void {
    this.last = state;
    if (!state) {
      this.trackKey = null;
      this.session.metadata = null;
      this.session.playbackState = 'none';
      this.setPosition(null);
      return;
    }
    // Metadata (and its artwork download) only when the track changes, not on every progress update.
    const key = `${state.trackUri ?? ''}|${state.track}|${state.artists}`;
    if (key !== this.trackKey) {
      this.trackKey = key;
      this.session.metadata = this.createMetadata({ title: state.track, artist: state.artists, album: state.album, artwork: toArtwork(state.images) });
    }
    this.session.playbackState = state.paused ? 'paused' : 'playing';
    this.setPosition(state);
  }

  /** Where the track is now, from the last sample. */
  private positionMs(): number {
    const s = this.last;
    if (!s) return 0;
    return s.paused ? s.positionMs : Math.min(s.durationMs, s.positionMs + (Date.now() - s.sampledAt));
  }

  /** The overlay's progress bar; Chromium rejects positions past the end, so those are clamped. */
  private setPosition(state: PlaybackState | null): void {
    if (!this.session.setPositionState) return;
    try {
      if (!state || state.durationMs <= 0) this.session.setPositionState();
      else this.session.setPositionState({ duration: state.durationMs / 1000, position: Math.min(state.positionMs, state.durationMs) / 1000, playbackRate: 1 });
    } catch {
      // Invalid numbers from the SDK must not break playback reporting.
    }
  }
}
