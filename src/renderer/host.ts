import type { ArtImage, HostApi, PlaybackState, PlayerCommand, RepeatMode } from '../shared/types';
import { FadeController, VolumeRamper } from './fade.js';
import { StallDetector, StallRecovery } from './stall.js';

/* Minimal typings for the parts of the Spotify Web Playback SDK used here (avoids an extra @types dependency). */
interface SpotifyTrack {
  name: string;
  uri?: string;
  artists: { name: string }[];
  album?: { name?: string; images?: { url: string; width?: number | null; height?: number | null }[] };
}
interface SpotifySdkState {
  paused: boolean;
  position: number;
  duration: number;
  shuffle?: boolean;
  /** 0 off, 1 repeat the context, 2 repeat the track. */
  repeat_mode?: number;
  track_window: { current_track: SpotifyTrack };
}
interface SpotifyPlayer {
  connect(): Promise<boolean>;
  addListener(event: string, callback: (payload: never) => void): boolean;
  getCurrentState(): Promise<SpotifySdkState | null>;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  setVolume(volume: number): Promise<void>;
  seek(positionMs: number): Promise<void>;
}
interface SpotifyNamespace {
  Player: new (options: {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume?: number;
    /** Lets the SDK's own player (inside its iframe, where the audio plays) drive media keys and the OS overlay. */
    enableMediaSession?: boolean;
  }) => SpotifyPlayer;
}

declare global {
  interface Window {
    host: HostApi;
    Spotify: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

// CHANGE HERE: name shown in the Spotify Connect device list.
const DEVICE_NAME = 'Playlish';
// CHANGE HERE: starting volume (0..1).
const INITIAL_VOLUME = 0.5;
// CHANGE HERE: how often playback progress is checked while playing (the timer does not run while paused).
const WATCHDOG_INTERVAL_MS = 2000;

let player: SpotifyPlayer;
let ramper: VolumeRamper;
let fader: FadeController;
let baseVolume = INITIAL_VOLUME;
let muted = false;
const stallDetector = new StallDetector();
const stallRecovery = new StallRecovery();
let watchdogTimer: number | null = null;
let lastState: SpotifySdkState | null = null;

/** Registers an SDK event listener with a typed payload. */
function on<T>(event: string, callback: (payload: T) => void): void {
  player.addListener(event, callback);
}

const REPEAT_MODES: readonly RepeatMode[] = ['off', 'context', 'track'];

/** Converts the SDK state into the reduced state sent to the main process. */
function toPlaybackState(state: SpotifySdkState | null): PlaybackState | null {
  if (!state) return null;
  const track = state.track_window.current_track;
  const images: ArtImage[] = (track.album?.images ?? []).map((i) => ({ url: i.url, width: i.width ?? null, height: i.height ?? null }));
  return {
    paused: state.paused,
    positionMs: state.position,
    durationMs: state.duration,
    track: track.name,
    artists: track.artists.map((a) => a.name).join(', '),
    album: track.album?.name ?? '',
    volume: baseVolume,
    sampledAt: Date.now(),
    trackUri: track.uri ?? null,
    images,
    shuffle: state.shuffle ?? false,
    repeat: REPEAT_MODES[state.repeat_mode ?? 0] ?? 'off',
    muted,
  };
}

/** Reports the latest known state (used after volume changes too, since the SDK has no volume event). */
function reportState(): void {
  const state = toPlaybackState(lastState);
  window.host.state(state);
}

/**
 * Checks that a "playing" player is really advancing. Some launches start playing and then freeze (#17). A first stall
 * is nudged with pause and resume; a repeat soon after asks the main process to rebuild this host.
 */
async function checkStall(): Promise<void> {
  const state = await player.getCurrentState();
  const now = Date.now();
  const stalled = stallDetector.observe(state ? { paused: state.paused, positionMs: state.position } : null, now);
  const action = stallRecovery.next(stalled, now);
  if (action === 'nudge') {
    window.host.log(`playback stalled at ${state?.position ?? -1} ms; nudging with pause and resume`);
    stallDetector.reset();
    await player.pause();
    await player.resume();
  } else if (action === 'restart') {
    window.host.log(`playback stalled again at ${state?.position ?? -1} ms; asking for a host restart`);
    stallDetector.reset();
    window.host.error('stalled', 'Playback stopped advancing and a nudge did not help.');
  }
}

/** Runs the stall check only while the player is playing, so a paused or idle player has no timer at all. */
function syncWatchdog(): void {
  const playing = lastState !== null && !lastState.paused;
  if (playing && watchdogTimer === null) {
    watchdogTimer = window.setInterval(() => {
      checkStall().catch((err: unknown) => window.host.log(`stall check failed: ${String(err)}`));
    }, WATCHDOG_INTERVAL_MS);
  } else if (!playing && watchdogTimer !== null) {
    window.clearInterval(watchdogTimer);
    watchdogTimer = null;
    stallDetector.reset();
  }
}

/** Executes a command from the main process. */
function handleCommand(command: PlayerCommand): void {
  switch (command.type) {
    case 'toggle':
      void player.togglePlay();
      break;
    case 'fadeToggle':
      muted = false; // a fade ends at the user's volume
      void fader.toggle();
      break;
    case 'next':
      void player.nextTrack();
      break;
    case 'previous':
      void player.previousTrack();
      break;
    case 'volume':
      ramper.cancel(); // the user's volume change wins over a running fade
      baseVolume = Math.min(1, Math.max(0, command.value));
      muted = false; // moving the slider unmutes
      void player.setVolume(baseVolume).then(reportState);
      break;
    case 'seek':
      void player.seek(Math.max(0, Math.floor(command.positionMs)));
      break;
    case 'mute':
      ramper.cancel();
      muted = command.muted;
      // The remembered volume stays; unmuting goes back to it.
      void player.setVolume(muted ? 0 : baseVolume).then(reportState);
      break;
  }
}

/** Creates the SDK player, wires events to the main process and connects. */
function startPlayer(): void {
  player = new window.Spotify.Player({
    name: DEVICE_NAME,
    // Media keys, headset buttons and the Windows media overlay (#45). The SDK plays inside its own iframe, and only the
    // frame with the audio can report the real play state to Windows; a Media Session in this page showed the track
    // as paused and its buttons did nothing (smoke test, 2026-10-04).
    enableMediaSession: true,
    volume: INITIAL_VOLUME,
    getOAuthToken: (callback) => {
      window.host.getToken().then(callback, (err: Error) => window.host.error('token', err.message));
    },
  });

  ramper = new VolumeRamper(player, undefined, undefined, (err) => window.host.error('volume', String(err)));
  fader = new FadeController(player, ramper, () => baseVolume);
  on<{ device_id: string }>('ready', ({ device_id }) => window.host.ready(device_id));
  on<{ device_id: string }>('not_ready', () => window.host.error('not_ready', 'The player went offline.'));
  on<SpotifySdkState | null>('player_state_changed', (state) => {
    lastState = state;
    reportState();
    syncWatchdog();
  });
  for (const kind of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
    on<{ message: string }>(kind, ({ message }) => window.host.error(kind, message));
  }

  window.host.onCommand(handleCommand);
  void player.connect().then((ok) => {
    if (!ok) window.host.error('connect', 'The player could not connect to Spotify.');
  });
}

/** Sends uncaught errors and unhandled promise rejections in this page to the main process log. */
function forwardPageErrors(report: (message: string, stack?: string) => void): void {
  window.addEventListener('error', (event) => {
    const error = event.error as unknown;
    report(event.message || String(error), error instanceof Error ? error.stack : undefined);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    report(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`, reason instanceof Error ? reason.stack : undefined);
  });
}

forwardPageErrors((message, stack) => window.host.reportError(message, stack));

// The SDK script calls this global once it has loaded; it must exist before the script is added.
window.onSpotifyWebPlaybackSDKReady = startPlayer;
const script = document.createElement('script');
script.src = 'https://sdk.scdn.co/spotify-player.js';
script.onerror = () => window.host.error('sdk_load', 'Could not load the Spotify Web Playback SDK (no internet?).');
document.head.appendChild(script);
