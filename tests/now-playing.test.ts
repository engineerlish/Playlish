import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKS_AFTER_MOVE_MS,
  DEFAULT_UNMUTE_VOLUME,
  NowPlayingController,
  POLL_IDLE_MS,
  POLL_PLAYING_MS,
  REFRESH_AFTER_COMMAND_MS,
  fromSdk,
  fromWebApi,
  pickArt,
  pollDelay,
  type PlaybackApi,
} from '../src/main/now-playing';
import type { PlaybackState as ApiPlaybackState, Track } from '../src/main/spotify/types';
import type { PlaybackState, PlayerCommand } from '../src/shared/types';

/** When the last check after a move happens. */
const LAST_CHECK_MS = CHECKS_AFTER_MOVE_MS[CHECKS_AFTER_MOVE_MS.length - 1] ?? 0;

const IMAGES = [
  { url: 'https://i.scdn.co/640', width: 640, height: 640 },
  { url: 'https://i.scdn.co/64', width: 64, height: 64 },
  { url: 'https://i.scdn.co/300', width: 300, height: 300 },
];

function sdkState(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    paused: false,
    positionMs: 1000,
    durationMs: 200_000,
    track: 'Here Song',
    artists: 'Here Artist',
    album: 'Here Album',
    volume: 0.7,
    sampledAt: 5000,
    trackUri: 'spotify:track:here',
    images: IMAGES,
    shuffle: false,
    repeat: 'off',
    muted: false,
    ...overrides,
  };
}

const TRACK: Track = {
  type: 'track',
  id: 't1',
  name: 'Kitchen Song',
  uri: 'spotify:track:t1',
  duration_ms: 180_000,
  explicit: false,
  artists: [
    { id: 'a1', name: 'One', uri: 'spotify:artist:a1' },
    { id: 'a2', name: 'Two', uri: 'spotify:artist:a2' },
  ],
  album: { id: 'al', name: 'Album', uri: 'spotify:album:al', images: IMAGES, artists: [] },
};

function apiState(overrides: Partial<ApiPlaybackState> = {}, device: Partial<ApiPlaybackState['device']> = {}): ApiPlaybackState {
  return {
    device: {
      id: 'kitchen',
      name: 'Kitchen speaker',
      type: 'Speaker',
      is_active: true,
      is_restricted: false,
      is_private_session: false,
      volume_percent: 40,
      supports_volume: true,
      ...device,
    },
    repeat_state: 'context',
    shuffle_state: true,
    context: null,
    timestamp: 0,
    progress_ms: 30_000,
    is_playing: true,
    item: TRACK,
    currently_playing_type: 'track',
    ...overrides,
  };
}

describe('pickArt', () => {
  it('picks the smallest image that is big enough', () => {
    expect(pickArt(IMAGES, 112)).toBe('https://i.scdn.co/300');
    expect(pickArt(IMAGES, 64)).toBe('https://i.scdn.co/64');
  });

  it('falls back to the largest image, and to null without images', () => {
    expect(pickArt(IMAGES, 1000)).toBe('https://i.scdn.co/640');
    expect(pickArt([])).toBeNull();
  });

  it('copes with missing sizes', () => {
    expect(pickArt([{ url: 'https://i.scdn.co/x', width: null, height: null }], 112)).toBe('https://i.scdn.co/x');
  });
});

describe('fromSdk and fromWebApi', () => {
  it('marks SDK state as playing here', () => {
    expect(fromSdk(sdkState())).toMatchObject({ source: 'here', deviceName: null, track: 'Here Song', artUrl: 'https://i.scdn.co/300', volume: 0.7 });
  });

  it('maps another device from the Web API', () => {
    expect(fromWebApi(apiState(), 'ours', 9000, null)).toEqual({
      source: 'elsewhere',
      deviceName: 'Kitchen speaker',
      paused: false,
      positionMs: 30_000,
      durationMs: 180_000,
      sampledAt: 9000,
      track: 'Kitchen Song',
      artists: 'One, Two',
      trackUri: 'spotify:track:t1',
      artUrl: 'https://i.scdn.co/300',
      shuffle: true,
      repeat: 'context',
      volume: 0.4,
      muted: false,
    });
  });

  it('ignores this device, empty players and items it cannot show', () => {
    expect(fromWebApi(apiState({}, { id: 'ours' }), 'ours', 0, null)).toBeNull();
    expect(fromWebApi(null, 'ours', 0, null)).toBeNull();
    expect(fromWebApi(apiState({ item: null }), 'ours', 0, null)).toBeNull();
  });

  it('shows no volume for devices that do not allow changing it', () => {
    expect(fromWebApi(apiState({}, { supports_volume: false }), null, 0, null)?.volume).toBeNull();
  });

  it('reads episodes (show name and image)', () => {
    const episode = { type: 'episode' as const, id: 'e', name: 'Episode 1', uri: 'spotify:episode:e', duration_ms: 1000, images: [], show: { id: 's', name: 'The Show', uri: 'spotify:show:s', images: IMAGES } };
    expect(fromWebApi(apiState({ item: episode }), null, 0, null)).toMatchObject({ track: 'Episode 1', artists: 'The Show', artUrl: 'https://i.scdn.co/300' });
  });

  it('reports muted only for a device Playlish muted', () => {
    expect(fromWebApi(apiState({}, { volume_percent: 0 }), null, 0, null)?.muted).toBe(false);
    expect(fromWebApi(apiState({}, { volume_percent: 0 }), null, 0, 0.4)?.muted).toBe(true);
  });
});

describe('pollDelay (the polling rules)', () => {
  const playingElsewhere = fromWebApi(apiState(), null, 0, null);
  const pausedElsewhere = fromWebApi(apiState({ is_playing: false }), null, 0, null);

  it('never polls while the window is hidden or closed, whatever plays', () => {
    expect(pollDelay({ visible: false, loggedIn: true, playingHere: false, elsewhere: playingElsewhere })).toBeNull();
    expect(pollDelay({ visible: false, loggedIn: true, playingHere: false, elsewhere: null })).toBeNull();
  });

  it('never polls while Playlish itself is playing (SDK events cover it) or logged out', () => {
    expect(pollDelay({ visible: true, loggedIn: true, playingHere: true, elsewhere: null })).toBeNull();
    expect(pollDelay({ visible: true, loggedIn: false, playingHere: false, elsewhere: null })).toBeNull();
  });

  it('polls slowly when another device plays, and very slowly otherwise', () => {
    expect(pollDelay({ visible: true, loggedIn: true, playingHere: false, elsewhere: playingElsewhere })).toBe(POLL_PLAYING_MS);
    expect(pollDelay({ visible: true, loggedIn: true, playingHere: false, elsewhere: pausedElsewhere })).toBe(POLL_IDLE_MS);
    expect(pollDelay({ visible: true, loggedIn: true, playingHere: false, elsewhere: null })).toBe(POLL_IDLE_MS);
  });
});

describe('NowPlayingController', () => {
  let api: { [K in keyof PlaybackApi]: ReturnType<typeof vi.fn> };
  let sent: PlayerCommand[];
  let changes: number;
  let errors: unknown[];
  let loggedIn: boolean;
  let ownDevice: string | null;
  let logs: { message: string; context: Record<string, unknown> }[];

  function controller() {
    return new NowPlayingController({
      api: () => api as unknown as PlaybackApi,
      sendToHost: (c) => {
        sent.push(c);
        return true;
      },
      ownDeviceId: () => ownDevice,
      loggedIn: () => loggedIn,
      onChange: () => {
        changes++;
      },
      onError: (e) => errors.push(e),
      log: (message, context) => logs.push({ message, context }),
      now: () => Date.now(),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    api = {
      playbackState: vi.fn().mockResolvedValue(apiState()),
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      next: vi.fn().mockResolvedValue(undefined),
      previous: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      shuffle: vi.fn().mockResolvedValue(undefined),
      repeat: vi.fn().mockResolvedValue(undefined),
      volume: vi.fn().mockResolvedValue(undefined),
    };
    sent = [];
    changes = 0;
    errors = [];
    loggedIn = true;
    ownDevice = 'ours';
    logs = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('makes no requests at all while the window is hidden', async () => {
    const c = controller();
    c.setVisible(false);
    await vi.advanceTimersByTimeAsync(10 * POLL_IDLE_MS);

    expect(api.playbackState).not.toHaveBeenCalled();
  });

  it('checks at once when the window opens, then keeps polling at the right pace, and stops when hidden', async () => {
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.playbackState).toHaveBeenCalledTimes(1);
    expect(c.view()?.deviceName).toBe('Kitchen speaker');

    await vi.advanceTimersByTimeAsync(POLL_PLAYING_MS);
    expect(api.playbackState).toHaveBeenCalledTimes(2);

    c.setVisible(false);
    await vi.advanceTimersByTimeAsync(10 * POLL_IDLE_MS);
    expect(api.playbackState).toHaveBeenCalledTimes(2);
  });

  it('starts polling after a login when the window was already open', async () => {
    loggedIn = false;
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS * 2);
    expect(api.playbackState).not.toHaveBeenCalled();

    loggedIn = true;
    await c.refresh();
    await vi.advanceTimersByTimeAsync(POLL_PLAYING_MS);

    expect(api.playbackState).toHaveBeenCalledTimes(2);
  });

  it('stops polling once Playlish plays, and SDK state wins over the Web API', async () => {
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);

    c.setHere(sdkState());
    await vi.advanceTimersByTimeAsync(10 * POLL_IDLE_MS);

    expect(api.playbackState).toHaveBeenCalledTimes(1);
    expect(c.view()).toMatchObject({ source: 'here', track: 'Here Song' });
  });

  it('looks for the new device as soon as playback leaves this one', async () => {
    const c = controller();
    c.setVisible(true);
    c.setHere(sdkState());
    await vi.advanceTimersByTimeAsync(0);
    expect(api.playbackState).not.toHaveBeenCalled();

    c.setHere(null);
    await vi.advanceTimersByTimeAsync(0);

    expect(api.playbackState).toHaveBeenCalledTimes(1);
    expect(c.view()?.source).toBe('elsewhere');
  });

  it('ignores a Web API answer that arrives after the SDK took over', async () => {
    let answer: (v: ApiPlaybackState) => void = () => undefined;
    api.playbackState.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);

    c.setHere(sdkState());
    answer(apiState());
    await vi.advanceTimersByTimeAsync(0);

    expect(c.view()?.source).toBe('here');
    // The late answer was dropped, so nothing stale shows once playback leaves this device.
    api.playbackState.mockReturnValue(new Promise(() => undefined));
    c.setHere(null);
    expect(c.view()).toBeNull();
  });

  it('sends player commands to the SDK while playing here, shuffle and repeat to the Web API for this device', async () => {
    const c = controller();
    c.setHere(sdkState());

    await c.command({ type: 'seek', positionMs: 42_000 });
    await c.command({ type: 'mute', muted: true });
    await c.command({ type: 'shuffle', on: true });
    await c.command({ type: 'repeat', mode: 'track' });

    expect(sent).toEqual([
      { type: 'seek', positionMs: 42_000 },
      { type: 'mute', muted: true },
    ]);
    expect(api.shuffle).toHaveBeenCalledWith(true, 'ours');
    expect(api.repeat).toHaveBeenCalledWith('track', 'ours');
  });

  it('controls another device through the Web API, updates at once and re-checks shortly after', async () => {
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);

    await c.command({ type: 'toggle' });
    expect(api.pause).toHaveBeenCalledWith('kitchen');
    expect(c.view()?.paused).toBe(true);
    await c.command({ type: 'next' });
    await c.command({ type: 'previous' });
    await c.command({ type: 'seek', positionMs: 1234 });
    await c.command({ type: 'shuffle', on: false });
    await c.command({ type: 'repeat', mode: 'off' });
    await c.command({ type: 'volume', value: 0.25 });

    expect(api.next).toHaveBeenCalledWith('kitchen');
    expect(api.previous).toHaveBeenCalledWith('kitchen');
    expect(api.seek).toHaveBeenCalledWith(1234, 'kitchen');
    expect(api.shuffle).toHaveBeenCalledWith(false, 'kitchen');
    expect(api.repeat).toHaveBeenCalledWith('off', 'kitchen');
    expect(api.volume).toHaveBeenCalledWith(25, 'kitchen');
    expect(sent).toEqual([]);

    api.playbackState.mockClear();
    await vi.advanceTimersByTimeAsync(REFRESH_AFTER_COMMAND_MS);
    expect(api.playbackState).toHaveBeenCalledTimes(1);
  });

  it('plays a paused device and treats fade as a plain toggle elsewhere', async () => {
    api.playbackState.mockResolvedValue(apiState({ is_playing: false }));
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);

    await c.command({ type: 'fadeToggle' });

    expect(api.play).toHaveBeenCalledWith({ deviceId: 'kitchen' });
    expect(c.view()?.paused).toBe(false);
  });

  it('mutes another device and restores its volume when unmuted', async () => {
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);

    await c.command({ type: 'mute', muted: true });
    expect(api.volume).toHaveBeenLastCalledWith(0, 'kitchen');
    expect(c.view()).toMatchObject({ muted: true, volume: 0 });

    await c.command({ type: 'mute', muted: false });
    expect(api.volume).toHaveBeenLastCalledWith(40, 'kitchen');
    expect(c.view()).toMatchObject({ muted: false, volume: 0.4 });
  });

  it('unmutes to a default volume when the old one is unknown', async () => {
    api.playbackState.mockResolvedValue(apiState({}, { volume_percent: null }));
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);

    await c.command({ type: 'mute', muted: true });
    await c.command({ type: 'mute', muted: false });

    expect(api.volume).toHaveBeenLastCalledWith(DEFAULT_UNMUTE_VOLUME * 100, 'kitchen');
  });

  it('with nothing playing anywhere, Play resumes the last playback on this device', async () => {
    api.playbackState.mockResolvedValue(null);
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);

    await c.command({ type: 'toggle' });
    await c.command({ type: 'next' });

    expect(api.play).toHaveBeenCalledWith({ deviceId: 'ours' });
    expect(api.next).not.toHaveBeenCalled();
  });

  it('starts new playback where music plays now, else on this computer', async () => {
    const c = controller();
    expect(c.targetDeviceId()).toBe('ours');
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.targetDeviceId()).toBe('kitchen');
    c.setHere(sdkState());
    expect(c.targetDeviceId()).toBe('ours');
  });

  it('reports API errors instead of throwing', async () => {
    api.pause.mockRejectedValue(new Error('403'));
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);

    await c.command({ type: 'toggle' });

    expect(errors).toHaveLength(1);
    expect(c.view()?.paused).toBe(false);
  });

  it('does not poll when logged out, and forgets everything on reset', async () => {
    loggedIn = false;
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS * 3);
    expect(api.playbackState).not.toHaveBeenCalled();

    c.setHere(sdkState());
    c.reset();
    expect(c.view()).toBeNull();
    expect(changes).toBeGreaterThan(0);
  });

  it('after moving playback away, shows the other device even while the SDK still reports its paused state', async () => {
    const c = controller();
    c.setVisible(true);
    c.setHere(sdkState());
    // Spotify does not report the new device at once.
    api.playbackState.mockResolvedValueOnce(null);

    c.moveAway();
    expect(c.view()).toBeNull();
    c.setHere(sdkState({ paused: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.view()).toBeNull();

    await vi.advanceTimersByTimeAsync(CHECKS_AFTER_MOVE_MS[1]);
    expect(c.view()).toMatchObject({ source: 'elsewhere', deviceName: 'Kitchen speaker' });
    // A late paused state from the SDK changes nothing.
    c.setHere(sdkState({ paused: true }));
    expect(c.view()?.source).toBe('elsewhere');
  });

  it('after moving playback away, a playing SDK state does not take the bar back while Spotify says it plays elsewhere', async () => {
    const c = controller();
    c.setHere(sdkState());
    c.moveAway();
    await vi.advanceTimersByTimeAsync(0);
    const checks = api.playbackState.mock.calls.length;

    // The SDK goes on describing the playback, now on the other device.
    c.setHere(sdkState({ paused: false, positionMs: 9_000 }));
    await vi.advanceTimersByTimeAsync(0);

    // It asked Spotify at once, and kept showing the other device.
    expect(api.playbackState.mock.calls.length).toBe(checks + 1);
    expect(c.view()).toMatchObject({ source: 'elsewhere', deviceName: 'Kitchen speaker' });
  });

  it('after moving playback away, the bar comes back here once Spotify reports this computer as the player', async () => {
    const c = controller();
    c.setHere(sdkState());
    api.playbackState.mockResolvedValueOnce(apiState()).mockResolvedValue(apiState({}, { id: 'ours', name: 'Playlish' }));
    c.moveAway();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.view()?.source).toBe('elsewhere');

    // Moved back from another app: the SDK plays, and Spotify now names this computer.
    c.setHere(sdkState({ track: 'Back Here', paused: false }));
    await vi.advanceTimersByTimeAsync(0);

    expect(c.view()).toMatchObject({ source: 'here', track: 'Back Here' });
    // No more checks after that.
    const calls = api.playbackState.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LAST_CHECK_MS);
    expect(api.playbackState.mock.calls.length).toBe(calls);
  });

  it('logs the move and every check after it', async () => {
    const c = controller();
    c.setHere(sdkState());
    api.playbackState.mockResolvedValueOnce(null).mockResolvedValue(apiState());
    c.moveAway();
    await vi.advanceTimersByTimeAsync(CHECKS_AFTER_MOVE_MS[1]);

    expect(logs.map((l) => l.context)).toEqual([
      { checks: CHECKS_AFTER_MOVE_MS.length },
      { active: 'none', playing: false },
      { active: 'other', playing: true },
    ]);
  });

  it('moving playback back here lets a paused SDK state count again', async () => {
    const c = controller();
    c.setVisible(true);
    c.moveAway();
    await vi.advanceTimersByTimeAsync(0);

    c.moveHere();
    c.setHere(sdkState({ paused: true }));

    expect(c.view()).toMatchObject({ source: 'here', paused: true });
  });

  it('checks a few times after a move, then only at the normal pace', async () => {
    const c = controller();
    c.setVisible(true);
    c.setHere(sdkState());
    api.playbackState.mockResolvedValue(apiState({ is_playing: false }));

    c.moveAway();
    await vi.advanceTimersByTimeAsync(LAST_CHECK_MS);
    expect(api.playbackState).toHaveBeenCalledTimes(CHECKS_AFTER_MOVE_MS.length);

    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    expect(api.playbackState).toHaveBeenCalledTimes(CHECKS_AFTER_MOVE_MS.length + 1);
  });

  it('reset() forgets a move away and its pending checks', async () => {
    const c = controller();
    c.moveAway();
    c.reset();
    await vi.advanceTimersByTimeAsync(LAST_CHECK_MS);

    expect(api.playbackState).not.toHaveBeenCalled();
    c.setHere(sdkState({ paused: true }));
    expect(c.view()).toMatchObject({ source: 'here', paused: true });
  });

  it('stop() ends polling for good', async () => {
    const c = controller();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    c.stop();
    c.setVisible(true);
    await vi.advanceTimersByTimeAsync(POLL_IDLE_MS * 3);

    expect(api.playbackState).toHaveBeenCalledTimes(1);
  });
});
