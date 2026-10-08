import type { ArtImage, NowPlaying, PlaybackState, PlayerCommand, RepeatMode, UiCommand } from '../shared/types';
import type { PlayOptions } from './spotify/client';
import type { PlaybackState as ApiPlaybackState } from './spotify/types';

/*
 * The Now Playing bar's source of truth (#43).
 *
 * - When Playlish itself is the playing device, its state comes from Web Playback SDK events (pushed by the playback
 *   host). Nothing is polled.
 * - When another device plays, the Web API is polled slowly, and only while the window is visible. A hidden or closed
 *   window never polls, so an idle Playlish in the tray makes no requests at all.
 * - Commands go to whichever device plays: the SDK for this one, the Web API for others.
 */

// CHANGE HERE: smallest album art size (px) worth showing in the bar (56 px displayed, x2 for high-DPI screens).
export const ART_MIN_PX = 112;
// CHANGE HERE: how often another device's playback is checked while the window is visible.
export const POLL_PLAYING_MS = 5_000;
export const POLL_IDLE_MS = 30_000;
// CHANGE HERE: how soon to re-check another device after sending it a command (Spotify needs a moment to apply it).
export const REFRESH_AFTER_COMMAND_MS = 600;
// CHANGE HERE: checks of the Web API after Playlish moved playback to another device (ms after the move). Spotify takes
// a moment to report the new device, so one check right away is often too early.
export const CHECKS_AFTER_MOVE_MS = [0, 1_000, 2_000, 3_500, 6_000, 10_000] as const;
// CHANGE HERE: volume restored when unmuting another device whose volume before muting is unknown.
export const DEFAULT_UNMUTE_VOLUME = 0.5;

/** The smallest image at least `minPx` wide (or tall), or the largest one if none is that big. */
export function pickArt(images: readonly ArtImage[], minPx = ART_MIN_PX): string | null {
  if (images.length === 0) return null;
  const size = (i: ArtImage) => Math.max(i.width ?? 0, i.height ?? 0);
  const sorted = [...images].sort((a, b) => size(a) - size(b));
  return (sorted.find((i) => size(i) >= minPx) ?? sorted[sorted.length - 1])?.url ?? null;
}

/** Now Playing for this device, from the SDK state the playback host reported. */
export function fromSdk(state: PlaybackState): NowPlaying {
  return {
    source: 'here',
    deviceName: null,
    paused: state.paused,
    positionMs: state.positionMs,
    durationMs: state.durationMs,
    sampledAt: state.sampledAt,
    track: state.track,
    artists: state.artists,
    trackUri: state.trackUri,
    artUrl: pickArt(state.images),
    shuffle: state.shuffle,
    repeat: state.repeat,
    volume: state.volume,
    muted: state.muted,
  };
}

/** Now Playing for another device, from GET /me/player. Null when nothing plays or the device is this one. */
export function fromWebApi(state: ApiPlaybackState | null, ownDeviceId: string | null, sampledAt: number, mutedVolume: number | null): NowPlaying | null {
  if (!state || !state.item) return null;
  if (ownDeviceId !== null && state.device.id === ownDeviceId) return null;
  const item = state.item;
  const images = item.type === 'track' ? item.album.images : item.images.length > 0 ? item.images : (item.show?.images ?? []);
  const artists = item.type === 'track' ? item.artists.map((a) => a.name).join(', ') : (item.show?.name ?? '');
  const percent = state.device.supports_volume ? state.device.volume_percent : null;
  return {
    source: 'elsewhere',
    deviceName: state.device.name,
    paused: !state.is_playing,
    positionMs: state.progress_ms ?? 0,
    durationMs: item.duration_ms,
    sampledAt,
    track: item.name,
    artists,
    trackUri: item.uri,
    artUrl: pickArt(images),
    shuffle: state.shuffle_state,
    repeat: state.repeat_state,
    volume: percent === null ? null : percent / 100,
    // Muted by Playlish: volume 0 with a remembered volume to go back to.
    muted: percent === 0 && mutedVolume !== null,
  };
}

/** Delay until the next Web API check, or null for "do not poll". */
export function pollDelay(inputs: { visible: boolean; loggedIn: boolean; playingHere: boolean; elsewhere: NowPlaying | null }): number | null {
  if (!inputs.visible || !inputs.loggedIn || inputs.playingHere) return null;
  return inputs.elsewhere && !inputs.elsewhere.paused ? POLL_PLAYING_MS : POLL_IDLE_MS;
}

/** The Web API calls the controller uses (a subset of SpotifyClient, so tests can fake it). */
export interface PlaybackApi {
  playbackState(priority?: 'user' | 'visible' | 'background'): Promise<ApiPlaybackState | null>;
  play(options?: PlayOptions): Promise<void>;
  pause(deviceId?: string): Promise<void>;
  next(deviceId?: string): Promise<void>;
  previous(deviceId?: string): Promise<void>;
  seek(positionMs: number, deviceId?: string): Promise<void>;
  shuffle(state: boolean, deviceId?: string): Promise<void>;
  repeat(mode: RepeatMode, deviceId?: string): Promise<void>;
  volume(percent: number, deviceId?: string): Promise<void>;
}

export interface NowPlayingDeps {
  /** The current API client, or null before login. */
  api(): PlaybackApi | null;
  /** Sends a command to the playback host; false when there is no host. */
  sendToHost(command: PlayerCommand): boolean;
  /** This device's Spotify Connect id, once the SDK reported it. */
  ownDeviceId(): string | null;
  loggedIn(): boolean;
  /** Called whenever what the bar shows changed. */
  onChange(): void;
  /** Called when a Web API call failed (shown to the user by the caller). */
  onError(error: unknown): void;
  /** Diagnostic lines about moves between devices (#44), for the app log. */
  log?: (message: string, context: Record<string, unknown>) => void;
  now?: () => number;
}

/** Merges this device's and other devices' playback, routes commands, and polls only when the rules allow. */
export class NowPlayingController {
  private here: PlaybackState | null = null;
  private elsewhere: NowPlaying | null = null;
  private elsewhereDeviceId: string | null = null;
  private visible = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Volume (0..1) another device had before Playlish muted it. */
  private mutedVolume: number | null = null;
  private stopped = false;
  /**
   * Set when Playlish moved playback to another device. The SDK keeps reporting states after that (paused, or even
   * playing, smoke tests 2026-10-08), so it cannot say where the music is. Until the Web API reports this computer as
   * the active device again (or Playlish moves playback back here), SDK states are held instead of shown.
   */
  private movedAway = false;
  /** The SDK's latest state while moved away, shown once playback is back here. */
  private heldHere: PlaybackState | null = null;
  private readonly checks = new Set<ReturnType<typeof setTimeout>>();
  private readonly now: () => number;

  constructor(private readonly deps: NowPlayingDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** What the bar should show. */
  view(): NowPlaying | null {
    return this.here ? fromSdk(this.here) : this.elsewhere;
  }

  /** True when Playlish itself is the playing device. */
  playingHere(): boolean {
    return this.here !== null;
  }

  /** Where new playback should start: the device playing now, else this computer (null before the player is ready). */
  targetDeviceId(): string | null {
    if (!this.here && this.elsewhere && this.elsewhereDeviceId) return this.elsewhereDeviceId;
    return this.deps.ownDeviceId();
  }

  /** New state from the SDK (null when playback moved to another device or the host went away). */
  setHere(state: PlaybackState | null): void {
    if (this.movedAway) {
      this.heldHere = state;
      // Playing could mean it is back here (moved from another app), or just the SDK describing the other device:
      // only the Web API can tell.
      if (state && !state.paused) void this.poll();
      return;
    }
    const wasHere = this.here !== null;
    this.here = state;
    if (state) {
      this.elsewhere = null;
      this.elsewhereDeviceId = null;
    }
    this.deps.onChange();
    // Playback just left this device: find out where it went.
    if (wasHere && !state) this.schedule(0);
    else if (state) this.cancel();
  }

  /**
   * Playlish moved playback to another device (#44). This player stops being the source of the bar at once, and the
   * Web API is checked a few times, so the bar shows the other device as soon as Spotify reports it.
   */
  moveAway(): void {
    this.movedAway = true;
    this.heldHere = this.here;
    this.here = null;
    this.deps.log?.('Playback moved to another device; following it through the Web API', { checks: CHECKS_AFTER_MOVE_MS.length });
    this.deps.onChange();
    this.clearChecks();
    for (const delay of CHECKS_AFTER_MOVE_MS) {
      const handle = setTimeout(() => {
        this.checks.delete(handle);
        if (!this.stopped) void this.refresh();
      }, delay);
      this.checks.add(handle);
    }
  }

  /** Playlish moved playback back to this computer: its SDK state counts again, even when paused. */
  moveHere(): void {
    this.endMoveAway();
    void this.refresh();
  }

  /** Back to normal: SDK states are shown again, starting with the one held while moved away. */
  private endMoveAway(): void {
    const held = this.heldHere;
    this.movedAway = false;
    this.heldHere = null;
    this.clearChecks();
    if (held) this.setHere(held);
  }

  /** The window became visible or hidden (or the login changed); starts or stops polling accordingly. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.schedule(0);
    else this.cancel();
  }

  /** Forgets everything (sign-out). */
  reset(): void {
    this.cancel();
    this.clearChecks();
    this.movedAway = false;
    this.heldHere = null;
    this.here = null;
    this.elsewhere = null;
    this.elsewhereDeviceId = null;
    this.mutedVolume = null;
    this.deps.onChange();
  }

  /** Stops all timers for good (app quit). */
  stop(): void {
    this.stopped = true;
    this.cancel();
    this.clearChecks();
  }

  /**
   * Checks the Web API now and re-arms polling (for example right after login, when the window was already open).
   * Safe to call at any time; makes no request while playing here, logged out or before login.
   */
  async refresh(): Promise<void> {
    await this.poll();
    this.schedule();
  }

  /** One Web API check. */
  private async poll(): Promise<void> {
    const api = this.deps.api();
    if (!api || this.here || !this.deps.loggedIn()) return;
    try {
      const state = await api.playbackState('visible');
      if (this.here) return; // the SDK took over meanwhile
      if (this.movedAway) {
        const own = this.deps.ownDeviceId();
        const active = !state ? 'none' : own !== null && state.device.id === own ? 'this' : 'other';
        this.deps.log?.('Checked where playback is after a move', { active, playing: state?.is_playing ?? false });
        if (active === 'this') {
          this.elsewhere = null;
          this.elsewhereDeviceId = null;
          this.endMoveAway();
          this.deps.onChange();
          return;
        }
      }
      this.elsewhereDeviceId = state && state.device.id !== this.deps.ownDeviceId() ? state.device.id : null;
      this.elsewhere = fromWebApi(state, this.deps.ownDeviceId(), this.now(), this.mutedVolume);
      if (!this.elsewhere) this.mutedVolume = null;
      this.deps.onChange();
    } catch (err) {
      this.deps.onError(err);
    }
  }

  /** Runs a command from the UI on whichever device is playing. */
  async command(command: UiCommand): Promise<void> {
    if (this.here) return this.commandHere(command);
    if (this.elsewhere && this.elsewhereDeviceId) return this.commandElsewhere(command, this.elsewhere, this.elsewhereDeviceId);
    return this.commandIdle(command);
  }

  private async commandHere(command: UiCommand): Promise<void> {
    const api = this.deps.api();
    const deviceId = this.deps.ownDeviceId() ?? undefined;
    try {
      if (command.type === 'shuffle') await api?.shuffle(command.on, deviceId);
      else if (command.type === 'repeat') await api?.repeat(command.mode, deviceId);
      else this.deps.sendToHost(command);
    } catch (err) {
      this.deps.onError(err);
    }
  }

  private async commandElsewhere(command: UiCommand, current: NowPlaying, deviceId: string): Promise<void> {
    const api = this.deps.api();
    if (!api) return;
    // Optimistic: show the change at once; the refresh below corrects it if Spotify disagrees.
    let next: NowPlaying = { ...current };
    try {
      switch (command.type) {
        case 'toggle':
        case 'fadeToggle': // other devices have no fades; a plain pause or play
          if (current.paused) await api.play({ deviceId });
          else await api.pause(deviceId);
          next = { ...next, paused: !current.paused, positionMs: this.positionNow(current), sampledAt: this.now() };
          break;
        case 'next':
          await api.next(deviceId);
          break;
        case 'previous':
          await api.previous(deviceId);
          break;
        case 'seek':
          await api.seek(command.positionMs, deviceId);
          next = { ...next, positionMs: command.positionMs, sampledAt: this.now() };
          break;
        case 'shuffle':
          await api.shuffle(command.on, deviceId);
          next = { ...next, shuffle: command.on };
          break;
        case 'repeat':
          await api.repeat(command.mode, deviceId);
          next = { ...next, repeat: command.mode };
          break;
        case 'volume':
          await api.volume(command.value * 100, deviceId);
          this.mutedVolume = null;
          next = { ...next, volume: command.value, muted: false };
          break;
        case 'mute':
          if (command.muted) {
            this.mutedVolume = current.volume ?? DEFAULT_UNMUTE_VOLUME;
            await api.volume(0, deviceId);
            next = { ...next, volume: 0, muted: true };
          } else {
            const restore = this.mutedVolume ?? DEFAULT_UNMUTE_VOLUME;
            this.mutedVolume = null;
            await api.volume(restore * 100, deviceId);
            next = { ...next, volume: restore, muted: false };
          }
          break;
      }
      if (this.elsewhere === current) {
        this.elsewhere = next;
        this.deps.onChange();
      }
    } catch (err) {
      this.deps.onError(err);
    }
    this.schedule(REFRESH_AFTER_COMMAND_MS);
  }

  /** Nothing is playing anywhere: Play resumes the user's last playback on this device. */
  private async commandIdle(command: UiCommand): Promise<void> {
    if (command.type !== 'toggle' && command.type !== 'fadeToggle') return;
    const deviceId = this.deps.ownDeviceId();
    const api = this.deps.api();
    if (!deviceId || !api) return;
    try {
      await api.play({ deviceId });
    } catch (err) {
      this.deps.onError(err);
    }
  }

  /** Where another device's track is now, from its last sample. */
  private positionNow(state: NowPlaying): number {
    if (state.paused) return state.positionMs;
    return Math.min(state.durationMs, state.positionMs + (this.now() - state.sampledAt));
  }

  /** Arms the next check; `delayMs` overrides the policy delay (0 = now). */
  private schedule(delayMs?: number): void {
    this.cancel();
    if (this.stopped) return;
    const policy = pollDelay({ visible: this.visible, loggedIn: this.deps.loggedIn(), playingHere: this.here !== null, elsewhere: this.elsewhere });
    if (policy === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delayMs ?? policy);
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Drops the pending checks after a move. */
  private clearChecks(): void {
    for (const handle of this.checks) clearTimeout(handle);
    this.checks.clear();
  }
}
