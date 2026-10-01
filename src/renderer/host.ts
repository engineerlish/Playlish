import type { HostApi, PlaybackState, PlayerCommand } from '../shared/types';

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
// CHANGE HERE: fade duration for the fade-pause/fade-resume test, and the time between volume steps.
const FADE_MS = 800;
const RAMP_STEP_MS = 25;

let player: SpotifyPlayer;
let baseVolume = INITIAL_VOLUME;
let rampId = 0;
let lastState: SpotifySdkState | null = null;

/** Registers an SDK event listener with a typed payload. */
function on<T>(event: string, callback: (payload: T) => void): void {
  player.addListener(event, callback as (payload: never) => void);
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

/** Linearly ramps the SDK volume from one value to another; a newer ramp or volume change cancels this one. */
function ramp(from: number, to: number, durationMs: number): Promise<void> {
  const id = ++rampId;
  const steps = Math.max(1, Math.round(durationMs / RAMP_STEP_MS));
  return new Promise((resolve) => {
    let step = 0;
    const timer = setInterval(() => {
      if (id !== rampId) {
        clearInterval(timer);
        resolve();
        return;
      }
      step++;
      void player.setVolume(Math.min(1, Math.max(0, from + (to - from) * (step / steps))));
      if (step >= steps) {
        clearInterval(timer);
        resolve();
      }
    }, RAMP_STEP_MS);
  });
}

/** Pauses with a fade-out, or resumes with a fade-in, using volume ramps (the only fade method the SDK allows). */
async function fadeToggle(): Promise<void> {
  const state = await player.getCurrentState();
  if (!state) return;
  if (!state.paused) {
    await ramp(baseVolume, 0, FADE_MS);
    await player.pause();
    await player.setVolume(baseVolume);
  } else {
    await player.setVolume(0);
    await player.resume();
    await ramp(0, baseVolume, FADE_MS);
  }
}

/** Executes a command from the main process. */
function handleCommand(command: PlayerCommand): void {
  switch (command.type) {
    case 'toggle':
      void player.togglePlay();
      break;
    case 'fadeToggle':
      void fadeToggle();
      break;
    case 'next':
      void player.nextTrack();
      break;
    case 'previous':
      void player.previousTrack();
      break;
    case 'volume':
      rampId++; // cancel any running fade
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
