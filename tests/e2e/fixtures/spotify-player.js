// Stand-in for https://sdk.scdn.co/spotify-player.js in the end-to-end tests (#9). Served by the app itself only in
// test mode (see src/main/e2e.ts). It mimics the parts of the Web Playback SDK that src/renderer/host.ts uses, plays no
// audio, needs no Widevine, and records every call so tests can check what the app asked for.
//
// Tests drive it from the main process with webContents.executeJavaScript, through window.__stub:
//   __stub.calls                  every player method called, in order, as { method, args }
//   __stub.startPlaying(name?)    what Spotify does after a successful play request: a playing state is reported
//   __stub.emit(event, payload)   fires any SDK event, such as 'playback_error' or 'account_error'
//   __stub.state()                the current state (as getCurrentState would return it)
//   __stub.freeze()               stops the position from advancing, to simulate a stalled player
//   __stub.set({ shuffle, repeat, context }) changes shuffle, repeat (0 off, 1 context, 2 track) or the playing context
//                                 (an album or playlist URI, or null), as Spotify would report it
(() => {
  // CHANGE HERE: what the fake tracks are called and how long they are.
  const TRACKS = ['E2E Song One', 'E2E Song Two', 'E2E Song Three'];
  const DURATION_MS = 200000;
  const DEVICE_ID = 'e2e-device';

  const listeners = new Map();
  const calls = [];
  let trackIndex = 0;
  let current = null; // { paused, basePosition, since } or null before anything plays
  let frozen = false;
  let volume = 0.5;
  let shuffle = false;
  let repeatMode = 0;
  let contextUri = null;

  function emit(event, payload) {
    for (const callback of listeners.get(event) ?? []) callback(payload);
  }

  function position() {
    if (!current) return 0;
    if (current.paused || frozen) return current.basePosition;
    return Math.min(DURATION_MS, current.basePosition + (Date.now() - current.since));
  }

  function state() {
    if (!current) return null;
    return {
      paused: current.paused,
      position: position(),
      duration: DURATION_MS,
      shuffle,
      repeat_mode: repeatMode,
      context: contextUri ? { uri: contextUri } : null,
      track_window: {
        current_track: {
          name: TRACKS[trackIndex],
          uri: `spotify:track:e2e${trackIndex + 1}`,
          artists: [{ name: 'E2E Artist' }],
          album: {
            images: [640, 64, 300].map((size) => ({ url: `https://i.scdn.co/image/e2e-${trackIndex + 1}-${size}`, width: size, height: size })),
          },
        },
      },
    };
  }

  function setPaused(paused) {
    if (!current) current = { paused: true, basePosition: 0, since: Date.now() };
    current = { paused, basePosition: position(), since: Date.now() };
    emit('player_state_changed', state());
  }

  function record(method, args) {
    calls.push({ method, args: [...args] });
  }

  class Player {
    constructor(options) {
      this.options = options;
      record('constructor', [{ name: options.name, volume: options.volume, enableMediaSession: options.enableMediaSession }]);
      if (typeof options.volume === 'number') volume = options.volume;
    }
    addListener(event, callback) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(callback);
      return true;
    }
    removeListener(event) {
      listeners.delete(event);
      return true;
    }
    connect() {
      record('connect', []);
      // Like the real SDK: ask for a token first, and only report the device once one arrives.
      this.options.getOAuthToken((token) => {
        record('token', [typeof token === 'string' && token.length > 0]);
        setTimeout(() => emit('ready', { device_id: DEVICE_ID }), 50);
      });
      return Promise.resolve(true);
    }
    disconnect() {
      record('disconnect', []);
    }
    getCurrentState() {
      return Promise.resolve(state());
    }
    togglePlay() {
      record('togglePlay', []);
      setPaused(current ? !current.paused : false);
      return Promise.resolve();
    }
    pause() {
      record('pause', []);
      setPaused(true);
      return Promise.resolve();
    }
    resume() {
      record('resume', []);
      setPaused(false);
      return Promise.resolve();
    }
    nextTrack() {
      record('nextTrack', []);
      trackIndex = Math.min(TRACKS.length - 1, trackIndex + 1);
      current = { paused: false, basePosition: 0, since: Date.now() };
      emit('player_state_changed', state());
      return Promise.resolve();
    }
    previousTrack() {
      record('previousTrack', []);
      trackIndex = Math.max(0, trackIndex - 1);
      current = { paused: false, basePosition: 0, since: Date.now() };
      emit('player_state_changed', state());
      return Promise.resolve();
    }
    seek(positionMs) {
      record('seek', [positionMs]);
      if (current) current = { ...current, basePosition: positionMs, since: Date.now() };
      emit('player_state_changed', state());
      return Promise.resolve();
    }
    setVolume(value) {
      record('setVolume', [value]);
      volume = value;
      return Promise.resolve();
    }
    getVolume() {
      return Promise.resolve(volume);
    }
  }

  window.Spotify = { Player };
  window.__stub = {
    calls,
    emit,
    state,
    volume: () => volume,
    startPlaying(name) {
      if (name) trackIndex = Math.max(0, TRACKS.indexOf(name));
      frozen = false;
      current = { paused: false, basePosition: 0, since: Date.now() };
      emit('player_state_changed', state());
    },
    set(changes) {
      if ('shuffle' in changes) shuffle = changes.shuffle;
      if ('repeat' in changes) repeatMode = changes.repeat;
      if ('context' in changes) contextUri = changes.context;
      emit('player_state_changed', state());
    },
    freeze() {
      if (current) current = { ...current, basePosition: position(), since: Date.now() };
      frozen = true;
    },
  };
  // The real SDK calls this once it has loaded.
  setTimeout(() => window.onSpotifyWebPlaybackSDKReady(), 0);
})();
