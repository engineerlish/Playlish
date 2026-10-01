import type { HostApi, PlaybackState, PlayerCommand } from '../shared/types';
import { FadeController, VolumeRamper } from './fade.js';

/* Minimal typings for the parts of the Spotify Web Playback SDK used here (avoids an extra @types dependency). */
interface SpotifyTrack {
  name: string;
  artists: { name: string }[];
}
interface SpotifySdkState {
  paused: boolean;
  position: number;
  duration: number;
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
}
interface SpotifyNamespace {
  Player: new (options: {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume?: number;
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
const DEVICE_NAME = 'Playlish (spike)';
// CHANGE HERE: starting volume (0..1).
const INITIAL_VOLUME = 0.5;

let player: SpotifyPlayer;
let ramper: VolumeRamper;
let fader: FadeController;
let baseVolume = INITIAL_VOLUME;
let lastState: SpotifySdkState | null = null;

/** Registers an SDK event listener with a typed payload. */
function on<T>(event: string, callback: (payload: T) => void): void {
  player.addListener(event, callback);
}

/** Converts the SDK state into the reduced state sent to the main process. */
function toPlaybackState(state: SpotifySdkState | null): PlaybackState | null {
  if (!state) return null;
  const track = state.track_window.current_track;
  return {
    paused: state.paused,
    positionMs: state.position,
    durationMs: state.duration,
    track: track.name,
    artists: track.artists.map((a) => a.name).join(', '),
    volume: baseVolume,
    sampledAt: Date.now(),
  };
}

/** Reports the latest known state (used after volume changes too, since the SDK has no volume event). */
function reportState(): void {
  window.host.state(toPlaybackState(lastState));
}

/** Executes a command from the main process. */
function handleCommand(command: PlayerCommand): void {
  switch (command.type) {
    case 'toggle':
      void player.togglePlay();
      break;
    case 'fadeToggle':
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
      void player.setVolume(baseVolume).then(reportState);
      break;
  }
}

/** Creates the SDK player, wires events to the main process and connects. */
function startPlayer(): void {
  player = new window.Spotify.Player({
    name: DEVICE_NAME,
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
  });
  for (const kind of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
    on<{ message: string }>(kind, ({ message }) => window.host.error(kind, message));
  }

  window.host.onCommand(handleCommand);
  void player.connect().then((ok) => {
    if (!ok) window.host.error('connect', 'The player could not connect to Spotify.');
  });
}

// The SDK script calls this global once it has loaded; it must exist before the script is added.
window.onSpotifyWebPlaybackSDKReady = startPlayer;
const script = document.createElement('script');
script.src = 'https://sdk.scdn.co/spotify-player.js';
script.onerror = () => window.host.error('sdk_load', 'Could not load the Spotify Web Playback SDK (no internet?).');
document.head.appendChild(script);
