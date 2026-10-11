import type { NowPlaying } from '../../shared/types';
import { playbackForPlugins, type PluginEvent } from './api';

/*
 * Events for plugins (#102), worked out from what the Now Playing bar shows. Only real changes become events: a new
 * track, a pause or resume, shuffle, repeat, volume or mute, a seek, a move to another device. Normal progress is not
 * an event (a plugin that wants the position asks with playback.get), so an idle or playing Playlish sends almost
 * nothing.
 */

// CHANGE HERE: how far the position may be from where it should be before it counts as a seek.
export const SEEK_THRESHOLD_MS = 3_000;

export class PluginEvents {
  private last: NowPlaying | null = null;

  constructor(private readonly send: (event: PluginEvent, payload: unknown) => void) {}

  /** Compares the new Now Playing state with the last one and sends the events that follow from it. */
  update(view: NowPlaying | null): void {
    const before = this.last;
    this.last = view ? { ...view } : null;
    const payload = playbackForPlugins(view);
    const trackKey = (v: NowPlaying | null) => (v ? (v.trackUri ?? `${v.track}\n${v.artists}`) : null);
    const deviceKey = (v: NowPlaying | null) => (v ? `${v.source}\n${v.deviceName ?? ''}` : null);
    const stateKey = (v: NowPlaying | null) => (v ? JSON.stringify([v.paused, v.shuffle, v.repeat, v.volume === null ? null : Math.round(v.volume * 100), v.muted]) : null);

    if (deviceKey(before) !== deviceKey(view)) this.send('device.changed', payload);
    if (trackKey(before) !== trackKey(view)) {
      this.send('track.changed', payload);
      // The queue moved on with the track.
      this.send('queue.changed', null);
      return;
    }
    if (stateKey(before) !== stateKey(view) || (before && view && this.seeked(before, view))) this.send('playback.state', payload);
  }

  /** A change to the queue that is not a new track (something was added). */
  queueChanged(): void {
    this.send('queue.changed', null);
  }

  /** True when the position is far from where the last state said it would be. */
  private seeked(before: NowPlaying, after: NowPlaying): boolean {
    const expected = before.paused ? before.positionMs : before.positionMs + (after.sampledAt - before.sampledAt);
    return Math.abs(after.positionMs - expected) > SEEK_THRESHOLD_MS;
  }
}
