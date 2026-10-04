import { useEffect, useState } from 'preact/hooks';
import type { NowPlaying, RepeatMode, Snapshot, UiCommand } from '../../shared/types';
import { Icon, type IconName } from './Icon';

// CHANGE HERE: how often the progress bar redraws while playing (only while this window is open).
const PROGRESS_TICK_MS = 500;
// CHANGE HERE: seek slider resolution (arrow keys move by this much; Page Up/Down by a tenth of the track).
const SEEK_STEP_MS = 1_000;

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'context', context: 'track', track: 'off' };
const REPEAT_LABEL: Record<RepeatMode, string> = { off: 'Repeat is off', context: 'Repeating the album or playlist', track: 'Repeating this track' };

/** Formats milliseconds as m:ss. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Where the track is now: the last sample plus the time since, while playing. */
function positionAt(p: NowPlaying, now: number): number {
  return p.paused ? p.positionMs : Math.min(p.durationMs, p.positionMs + (now - p.sampledAt));
}

const send = (command: UiCommand) => window.ui.command(command);

/** A square icon button. `pressed` makes it a toggle button for screen readers. */
function IconButton(props: { id: string; icon: IconName; label: string; disabled: boolean; pressed?: boolean; primary?: boolean; onClick: () => void }) {
  return (
    <button
      id={props.id}
      class={`icon${props.primary ? ' play' : ''}${props.pressed ? ' on' : ''}`}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      {...(props.pressed !== undefined ? { 'aria-pressed': props.pressed } : {})}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/** The bar along the bottom: art, track, transport controls, seek, shuffle, repeat, mute and volume (#43). */
export function NowPlayingBar({ snapshot }: { snapshot: Snapshot }) {
  const playback = snapshot.playback;
  // Controls work when this device's player is ready or another device is playing (controlled through the Web API).
  const ready = snapshot.deviceReady || playback !== null;
  const hasTrack = playback !== null;
  const [now, setNow] = useState(Date.now());
  const [dragVolume, setDragVolume] = useState<number | null>(null);
  const [dragSeek, setDragSeek] = useState<number | null>(null);
  const [artFailed, setArtFailed] = useState(false);

  // The timer only runs while something is playing, so a paused or idle window costs nothing.
  useEffect(() => {
    if (!playback || playback.paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [playback?.paused, playback?.sampledAt]);

  useEffect(() => setArtFailed(false), [playback?.artUrl]);

  const position = dragSeek ?? (playback ? positionAt(playback, now) : 0);
  const volume = dragVolume ?? Math.round((playback?.muted ? 0 : (playback?.volume ?? 0.5)) * 100);
  const playing = playback !== null && !playback.paused;
  const volumeLocked = playback !== null && playback.volume === null;

  return (
    <footer class="nowplaying" aria-label="Now playing">
      <div class="track">
        {playback?.artUrl && !artFailed ? (
          <img id="art" class="art" src={playback.artUrl} alt="" width={56} height={56} onError={() => setArtFailed(true)} />
        ) : (
          <div class="art placeholder" aria-hidden="true">
            <Icon name="note" />
          </div>
        )}
        <div class="meta">
          <div id="track" class="title">{playback?.track ?? 'Nothing playing'}</div>
          <div id="artists" class="muted">{playback?.artists ?? (snapshot.deviceReady ? 'Press play to continue where you left off' : ' ')}</div>
          {playback?.source === 'elsewhere' && (
            <div id="device" class="device">
              <Icon name="device" /> Playing on {playback.deviceName}
            </div>
          )}
        </div>
      </div>

      <div class="transport">
        <div class="buttons">
          <IconButton id="shuffle" icon="shuffle" label="Shuffle" disabled={!hasTrack} pressed={playback?.shuffle ?? false} onClick={() => send({ type: 'shuffle', on: !(playback?.shuffle ?? false) })} />
          <IconButton id="prev" icon="previous" label="Previous" disabled={!hasTrack} onClick={() => send({ type: 'previous' })} />
          <IconButton id="toggle" icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} disabled={!ready} primary onClick={() => send({ type: 'toggle' })} />
          <IconButton id="next" icon="next" label="Next" disabled={!hasTrack} onClick={() => send({ type: 'next' })} />
          <IconButton
            id="repeat"
            icon={playback?.repeat === 'track' ? 'repeatOne' : 'repeat'}
            label={REPEAT_LABEL[playback?.repeat ?? 'off']}
            disabled={!hasTrack}
            pressed={(playback?.repeat ?? 'off') !== 'off'}
            onClick={() => send({ type: 'repeat', mode: NEXT_REPEAT[playback?.repeat ?? 'off'] })}
          />
          <button
            id="fade"
            class="text"
            disabled={!hasTrack}
            title={playback?.source === 'elsewhere' ? 'Fades work on this device only; this pauses or plays' : 'Pause or play with a fade'}
            onClick={() => send({ type: 'fadeToggle' })}
          >
            Fade
          </button>
        </div>
        <div class="progress">
          <span class="muted time" id="position">{clock(position)}</span>
          <input
            id="seek"
            type="range"
            min={0}
            max={playback?.durationMs || 1}
            step={SEEK_STEP_MS}
            value={position}
            disabled={!hasTrack}
            aria-label="Track position"
            aria-valuetext={`${clock(position)} of ${clock(playback?.durationMs ?? 0)}`}
            onInput={(e) => setDragSeek(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => {
              const value = Number((e.target as HTMLInputElement).value);
              setDragSeek(null);
              send({ type: 'seek', positionMs: value });
            }}
          />
          <span class="muted time" id="duration">{clock(playback?.durationMs ?? 0)}</span>
        </div>
      </div>

      <div class="volume">
        <IconButton
          id="mute"
          icon={playback?.muted || volume === 0 ? 'muted' : 'volume'}
          label={playback?.muted ? 'Unmute' : 'Mute'}
          disabled={!ready || volumeLocked}
          pressed={playback?.muted ?? false}
          onClick={() => send({ type: 'mute', muted: !(playback?.muted ?? false) })}
        />
        <input
          id="volume"
          type="range"
          min={0}
          max={100}
          value={volume}
          disabled={!ready || volumeLocked}
          aria-label="Volume"
          title={volumeLocked ? 'This device does not allow volume changes' : 'Volume'}
          onInput={(e) => {
            const value = Number((e.target as HTMLInputElement).value);
            setDragVolume(value);
            send({ type: 'volume', value: value / 100 });
          }}
          onChange={() => setDragVolume(null)}
        />
      </div>
    </footer>
  );
}
