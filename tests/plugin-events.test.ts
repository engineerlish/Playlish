import { beforeEach, describe, expect, it } from 'vitest';
import { PluginEvents, SEEK_THRESHOLD_MS } from '../src/main/plugins/events';
import type { NowPlaying } from '../src/shared/types';

function np(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    source: 'here', deviceName: null, paused: false, positionMs: 0, durationMs: 200_000, sampledAt: 0, track: 'One', artists: 'A',
    trackUri: 'spotify:track:1', artUrl: null, shuffle: false, repeat: 'off', volume: 0.5, muted: false, ...overrides,
  };
}

let sent: { event: string; payload: unknown }[];
let events: PluginEvents;
const names = () => sent.map((s) => s.event);

beforeEach(() => {
  sent = [];
  events = new PluginEvents((event, payload) => sent.push({ event, payload }));
});

describe('PluginEvents', () => {
  it('a first track sends device, track and queue events', () => {
    events.update(np());
    expect(names()).toEqual(['device.changed', 'track.changed', 'queue.changed']);
    expect(sent[1]?.payload).toMatchObject({ track: { uri: 'spotify:track:1', name: 'One' }, device: 'this computer' });
  });

  it('normal progress sends nothing', () => {
    events.update(np({ positionMs: 0, sampledAt: 0 }));
    sent = [];
    events.update(np({ positionMs: 5_000, sampledAt: 5_000 }));
    events.update(np({ positionMs: 60_000, sampledAt: 60_000 }));
    expect(sent).toEqual([]);
  });

  it('pause, shuffle, repeat, volume, mute and seeks send playback.state', () => {
    events.update(np());
    sent = [];
    events.update(np({ paused: true }));
    events.update(np({ paused: true, shuffle: true }));
    events.update(np({ paused: true, shuffle: true, repeat: 'track' }));
    events.update(np({ paused: true, shuffle: true, repeat: 'track', volume: 0.2 }));
    events.update(np({ paused: true, shuffle: true, repeat: 'track', volume: 0.2, muted: true }));
    events.update(np({ paused: true, shuffle: true, repeat: 'track', volume: 0.2, muted: true, positionMs: SEEK_THRESHOLD_MS + 1 }));
    expect(names()).toEqual(Array(6).fill('playback.state'));
  });

  it('playing from another playlist with the same track sends playback.state', () => {
    events.update(np({ contextUri: 'spotify:playlist:a' }));
    sent = [];
    events.update(np({ contextUri: 'spotify:playlist:b' }));
    expect(names()).toEqual(['playback.state']);
    expect(sent[0]?.payload).toMatchObject({ context: 'spotify:playlist:b' });
  });

  it('a new track sends track.changed and queue.changed (not playback.state)', () => {
    events.update(np());
    sent = [];
    events.update(np({ trackUri: 'spotify:track:2', track: 'Two', paused: true }));
    expect(names()).toEqual(['track.changed', 'queue.changed']);
  });

  it('a move to another device sends device.changed', () => {
    events.update(np());
    sent = [];
    events.update(np({ source: 'elsewhere', deviceName: 'Kitchen speaker' }));
    expect(names()).toEqual(['device.changed']);
    expect(sent[0]?.payload).toMatchObject({ device: 'Kitchen speaker' });
  });

  it('nothing playing any more sends device and track events with null', () => {
    events.update(np());
    sent = [];
    events.update(null);
    expect(sent).toEqual([
      { event: 'device.changed', payload: null },
      { event: 'track.changed', payload: null },
      { event: 'queue.changed', payload: null },
    ]);
  });

  it('queueChanged sends queue.changed', () => {
    events.queueChanged();
    expect(sent).toEqual([{ event: 'queue.changed', payload: null }]);
  });
});
