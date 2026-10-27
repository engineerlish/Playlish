import { useEffect, useState } from 'preact/hooks';
import type { QueueResult, Snapshot, TrackRow } from '../../../shared/types';
import { Icon } from '../Icon';
import { StateMessage } from '../StateMessage';
import { RowView, run } from './LibraryPage';

/*
 * Queue (#49): what plays now and what comes next. Loaded when the page opens and again whenever the track changes
 * (which is when the queue moves), plus a Refresh button. Never on a timer.
 */

export function QueuePage({ snapshot }: { snapshot: Snapshot }) {
  const [queue, setQueue] = useState<QueueResult | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const trackUri = snapshot.playback?.trackUri ?? null;

  const load = () => {
    setLoading(true);
    void window.ui.queue().then((result) => {
      setQueue(result);
      setLoading(false);
    });
  };
  useEffect(load, [trackUri]);

  // Playing a song from the list plays it now (Spotify has no "jump to this queue entry").
  const play = (row: TrackRow) => void run({ type: 'play', uris: [row.uri] }, setStatus, `Playing ${row.name}.`);
  const rowFor = (row: TrackRow, i: number) => <RowView row={row} index={i} liked={false} say={setStatus} onPlay={play} onRemoved={() => undefined} />;

  return (
    <div id="page-queue" class="library search">
      <div class="search-body">
        <div class="page-head">
          <p class="muted library-status truncate" role="status" title={status}>
            {status}
          </p>
          <span class="spacer" />
          <button id="refreshQueue" class="text" disabled={loading} onClick={load}>
            <Icon name="refresh" />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {queue === null ? (
          <StateMessage kind="loading" title="Loading the queue…" />
        ) : !queue.ok ? (
          <StateMessage kind="error" title="Could not load the queue">
            <p class="error-text">{queue.error}</p>
          </StateMessage>
        ) : (
          <>
            <section class="search-section" id="queue-now" aria-label="Now playing">
              <h2>Now playing</h2>
              {queue.current ? <div class="search-row">{rowFor(queue.current, 0)}</div> : <StateMessage kind="empty" icon="note" compact title="Nothing is playing." />}
            </section>
            <section class="search-section" id="queue-next" aria-label="Next up">
              <h2>Next up</h2>
              {queue.next.length === 0 ? (
                <StateMessage kind="empty" icon="queue" compact title="Nothing queued.">
                  <p>Use + on any song to add it.</p>
                </StateMessage>
              ) : (
                <ol class="plain">
                  {queue.next.map((row, i) => (
                    <li key={`${row.uri}:${i}`} class="search-row">
                      {rowFor(row, i)}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
