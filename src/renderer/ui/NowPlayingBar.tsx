import { useEffect, useState } from 'preact/hooks';
import type { Snapshot } from '../../shared/types';

// CHANGE HERE: how often the progress bar redraws while playing (only while this window is open).
const PROGRESS_TICK_MS = 500;

/** Formats milliseconds as m:ss. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The bar along the bottom: track, progress, transport controls and volume. Album art and seeking come with #43. */
export function NowPlayingBar({ snapshot }: { snapshot: Snapshot }) {
  const playback = snapshot.playback;
  const ready = snapshot.deviceReady;
  const [now, setNow] = useState(Date.now());
  const [dragVolume, setDragVolume] = useState<number | null>(null);

  // The timer only runs while something is playing, so a paused or idle window costs nothing.
  useEffect(() => {
    if (!playback || playback.paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [playback?.paused, playback?.sampledAt]);

  const position = playback ? Math.min(playback.durationMs, playback.positionMs + (playback.paused ? 0 : now - playback.sampledAt)) : 0;
  const volume = dragVolume ?? Math.round((playback?.volume ?? 0.5) * 100);

  return (
    <footer class="nowplaying" aria-label="Now playing">
      <div class="track">
        <div id="track" class="title">{playback?.track ?? 'Nothing playing'}</div>
        <div id="artists" class="muted">{playback?.artists ?? ' '}</div>
      </div>
      <div class="transport">
        <div class="buttons">
          <button id="prev" disabled={!ready} aria-label="Previous" title="Previous" onClick={() => window.ui.command({ type: 'previous' })}>
            ⏮
          </button>
          <button id="toggle" class="play" disabled={!ready} aria-label={playback && !playback.paused ? 'Pause' : 'Play'} title="Play or pause" onClick={() => window.ui.command({ type: 'toggle' })}>
            {playback && !playback.paused ? '⏸' : '▶'}
          </button>
          <button id="next" disabled={!ready} aria-label="Next" title="Next" onClick={() => window.ui.command({ type: 'next' })}>
            ⏭
          </button>
          <button id="fade" disabled={!ready} aria-label="Pause or play with a fade" title="Pause or play with a fade" onClick={() => window.ui.command({ type: 'fadeToggle' })}>
            Fade
          </button>
          <button id="play" disabled={!ready} title="Play the test track" onClick={() => window.ui.command({ type: 'playTrack' })}>
            Test track
          </button>
        </div>
        <div class="progress">
          <span class="muted">{clock(position)}</span>
          <progress id="progress" max={playback?.durationMs || 1} value={position} aria-label="Track position" />
          <span class="muted">{clock(playback?.durationMs ?? 0)}</span>
        </div>
      </div>
      <label class="volume">
        <span class="muted">Volume</span>
        <input
          id="volume"
          type="range"
          min={0}
          max={100}
          value={volume}
          disabled={!ready}
          aria-label="Volume"
          onInput={(e) => {
            const value = Number((e.target as HTMLInputElement).value);
            setDragVolume(value);
            window.ui.command({ type: 'volume', value: value / 100 });
          }}
          onChange={() => setDragVolume(null)}
        />
      </label>
    </footer>
  );
}
