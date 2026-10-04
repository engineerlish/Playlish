import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_SKIP_SECONDS, MediaSessionBridge, toArtwork, type ActionDetails, type MediaSessionLike, type MetadataInit } from '../src/renderer/media-session';
import type { PlaybackState } from '../src/shared/types';

function state(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    paused: false,
    positionMs: 30_000,
    durationMs: 200_000,
    track: 'Song',
    artists: 'Artist',
    album: 'Album',
    volume: 0.5,
    sampledAt: Date.now(),
    trackUri: 'spotify:track:1',
    images: [
      { url: 'https://i.scdn.co/640', width: 640, height: 640 },
      { url: 'https://i.scdn.co/64', width: 64, height: 64 },
    ],
    shuffle: false,
    repeat: 'off',
    muted: false,
    ...overrides,
  };
}

describe('MediaSessionBridge', () => {
  let handlers: Map<string, (d: ActionDetails) => void>;
  let session: MediaSessionLike & { positions: unknown[] };
  let created: MetadataInit[];
  let player: { resume: Mock<() => void>; pause: Mock<() => void>; next: Mock<() => void>; previous: Mock<() => void>; seek: Mock<(ms: number) => void> };

  beforeEach(() => {
    handlers = new Map();
    created = [];
    session = {
      metadata: null,
      playbackState: 'none',
      positions: [],
      setActionHandler: (action, handler) => {
        if (handler) handlers.set(action, handler);
      },
      setPositionState(s) {
        this.positions.push(s);
      },
    };
    player = { resume: vi.fn(), pause: vi.fn(), next: vi.fn(), previous: vi.fn(), seek: vi.fn() };
  });

  function bridge() {
    return new MediaSessionBridge(
      session,
      (init) => {
        created.push(init);
        return { ...init };
      },
      player,
    );
  }

  it('routes media keys and overlay buttons to the player', () => {
    bridge();

    handlers.get('play')?.({});
    handlers.get('pause')?.({});
    handlers.get('stop')?.({});
    handlers.get('nexttrack')?.({});
    handlers.get('previoustrack')?.({});
    handlers.get('seekto')?.({ seekTime: 42.5 });

    expect(player.resume).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(2);
    expect(player.next).toHaveBeenCalledTimes(1);
    expect(player.previous).toHaveBeenCalledTimes(1);
    expect(player.seek).toHaveBeenCalledWith(42_500);
  });

  it('skips back and forward from where the track is now, within the track', () => {
    const b = bridge();
    b.update(state({ paused: true, positionMs: 5_000 }));

    handlers.get('seekbackward')?.({});
    handlers.get('seekforward')?.({ seekOffset: 30 });

    expect(player.seek).toHaveBeenNthCalledWith(1, 0);
    expect(player.seek).toHaveBeenNthCalledWith(2, 5_000 + 30_000);
    b.update(state({ paused: true, positionMs: 195_000 }));
    handlers.get('seekforward')?.({});
    expect(player.seek).toHaveBeenLastCalledWith(200_000);
    expect(DEFAULT_SKIP_SECONDS).toBe(10);
  });

  it('shows title, artist, album and artwork, and the play state', () => {
    const b = bridge();

    b.update(state());

    expect(created).toEqual([
      {
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        artwork: [
          { src: 'https://i.scdn.co/64', sizes: '64x64' },
          { src: 'https://i.scdn.co/640', sizes: '640x640' },
        ],
      },
    ]);
    expect(session.playbackState).toBe('playing');
    expect(session.positions.at(-1)).toEqual({ duration: 200, position: 30, playbackRate: 1 });
    b.update(state({ paused: true }));
    expect(session.playbackState).toBe('paused');
  });

  it('builds new metadata only when the track changes', () => {
    const b = bridge();
    b.update(state());
    b.update(state({ positionMs: 31_000 }));
    b.update(state({ paused: true }));
    expect(created).toHaveLength(1);

    b.update(state({ trackUri: 'spotify:track:2', track: 'Next Song' }));
    expect(created).toHaveLength(2);
  });

  it('clears the overlay when playback leaves this device', () => {
    const b = bridge();
    b.update(state());

    b.update(null);

    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    expect(session.positions.at(-1)).toBeUndefined();
    // The same track coming back gets its metadata again.
    b.update(state());
    expect(created).toHaveLength(2);
  });

  it('clamps a position past the end and survives a session that rejects it', () => {
    const b = bridge();
    b.update(state({ positionMs: 250_000 }));
    expect(session.positions.at(-1)).toEqual({ duration: 200, position: 200, playbackRate: 1 });

    session.setPositionState = () => {
      throw new TypeError('bad');
    };
    expect(() => b.update(state())).not.toThrow();
  });

  it('keeps working when Chromium does not know an action', () => {
    session.setActionHandler = (action, handler) => {
      if (action === 'seekbackward') throw new TypeError('unknown action');
      if (handler) handlers.set(action, handler);
    };

    expect(() => bridge()).not.toThrow();
    handlers.get('nexttrack')?.({});
    expect(player.next).toHaveBeenCalled();
  });
});

describe('toArtwork', () => {
  it('orders images small to large and leaves out unknown sizes', () => {
    expect(toArtwork([{ url: 'b', width: 300, height: 300 }, { url: 'a', width: null, height: null }])).toEqual([{ src: 'a' }, { src: 'b', sizes: '300x300' }]);
  });
});
