import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AlbumRow, LibraryAction, LibraryList, LibraryRow, PlaylistRow, TrackRow } from '../../../shared/types';
import { Icon } from '../Icon';
import { usePagedList } from '../usePagedList';
import { VirtualList } from '../VirtualList';

/*
 * Library (#47): liked songs, saved albums and playlists, and the songs of an album or playlist. Lists are virtualized
 * and loaded page by page (see usePagedList and VirtualList).
 */

// CHANGE HERE: row height in px (must match .vrow content in ui.css) and how many liked songs one Play queues up.
const ROW_HEIGHT = 56;
const LIKED_PLAY_MAX = 100;

type Tab = 'tracks' | 'albums' | 'playlists';
const TABS: { id: Tab; label: string }[] = [
  { id: 'tracks', label: 'Liked Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'playlists', label: 'Playlists' },
];

type Detail = { kind: 'album'; row: AlbumRow } | { kind: 'playlist'; row: PlaylistRow };

/** Formats milliseconds as m:ss. */
function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Runs an action and reports the outcome in the page's status line. */
async function run(action: LibraryAction, say: (text: string) => void, done: string): Promise<boolean> {
  const result = await window.ui.libraryAction(action);
  say(result.ok ? done : result.error);
  return result.ok;
}

function Art({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  // Rows are reused while scrolling, so a failure belongs to one image address, not to the row.
  useEffect(() => setFailed(false), [url]);
  return url && !failed ? (
    <img class="row-art" src={url} alt="" width={40} height={40} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <div class="row-art placeholder" aria-hidden="true">
      <Icon name="note" />
    </div>
  );
}

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>('tracks');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState('');

  if (detail) return <DetailView detail={detail} onBack={() => setDetail(null)} status={status} say={setStatus} />;
  return (
    <div id="page-library" class="library">
      <h1>Library</h1>
      <div class="tabs" role="tablist" aria-label="Library">
        {TABS.map((t) => (
          <button key={t.id} id={`tab-${t.id}`} role="tab" class={`tab${tab === t.id ? ' current' : ''}`} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p class="muted library-status" role="status">
        {status}
      </p>
      <ListView key={tab} list={{ kind: tab }} say={setStatus} onOpen={setDetail} />
    </div>
  );
}

function DetailView({ detail, onBack, status, say }: { detail: Detail; onBack: () => void; status: string; say: (t: string) => void }) {
  const row = detail.row;
  const list: LibraryList = detail.kind === 'album' ? { kind: 'album', id: row.id } : { kind: 'playlist', id: row.id, snapshotId: detail.row.snapshotId };
  const canList = detail.kind === 'album' || detail.row.canList;
  return (
    <div id="page-library" class="library">
      <button id="libraryBack" class="text" onClick={onBack}>
        ← Library
      </button>
      <div class="detail-head">
        <Art url={row.artUrl} />
        <div class="meta">
          <h1 id="detailTitle">{row.name}</h1>
          <div class="muted">{detail.kind === 'album' ? detail.row.artists : `Playlist by ${detail.row.owner}`}</div>
        </div>
        <button id="playContext" class="primary" onClick={() => void run({ type: 'play', contextUri: row.uri }, say, `Playing ${row.name}.`)}>
          Play
        </button>
      </div>
      <p class="muted library-status" role="status">
        {status}
      </p>
      {canList ? (
        <ListView list={list} say={say} contextUri={row.uri} />
      ) : (
        <p id="othersNote" class="card">
          Spotify only lets apps list the songs of your own and collaborative playlists. Press Play to listen to this one.
        </p>
      )}
    </div>
  );
}

function ListView({ list, say, onOpen, contextUri }: { list: LibraryList; say: (t: string) => void; onOpen?: (d: Detail) => void; contextUri?: string }) {
  const paged = usePagedList(list);
  const want = useCallback((first: number, last: number) => paged.want(first, last), [paged.want]);
  const liked = list.kind === 'tracks';

  const playTrack = (row: TrackRow, index: number) => {
    if (!row.playable) return;
    if (contextUri) void run({ type: 'play', contextUri, offsetUri: row.uri }, say, `Playing ${row.name}.`);
    else {
      // Liked songs have no context Spotify accepts, so play the loaded songs from here on.
      const uris = paged
        .loadedFrom(index, LIKED_PLAY_MAX)
        .filter((r): r is TrackRow => r.kind === 'track' && r.playable)
        .map((r) => r.uri);
      void run({ type: 'play', uris }, say, `Playing ${row.name}.`);
    }
  };

  const renderRow = (index: number) => {
    const row = paged.rowAt(index);
    if (row === undefined) return <div class="row loading" aria-label="Loading" />;
    if (row === null) return <div class="row unavailable muted">This song is no longer available</div>;
    return <RowView row={row} index={index} liked={liked} say={say} onPlay={playTrack} onOpen={onOpen} onRemoved={paged.reload} />;
  };

  if (paged.error && paged.total === null)
    return (
      <p class="error-text" role="alert">
        {paged.error}
      </p>
    );
  if (paged.total === null) return <p class="muted">Loading…</p>;
  if (paged.total === 0) return <p class="muted">{liked ? 'No liked songs yet.' : list.kind === 'albums' ? 'No saved albums yet.' : list.kind === 'playlists' ? 'No playlists yet.' : 'Nothing here.'}</p>;
  return <VirtualList id={`list-${list.kind}`} label={TABS.find((t) => t.id === list.kind)?.label ?? 'Songs'} count={paged.total} rowHeight={ROW_HEIGHT} renderRow={renderRow} onRange={want} />;
}

function RowView(props: {
  row: LibraryRow;
  index: number;
  liked: boolean;
  say: (t: string) => void;
  onPlay: (row: TrackRow, index: number) => void;
  onOpen?: (d: Detail) => void;
  onRemoved: () => void;
}) {
  const { row, say } = props;
  if (row.kind === 'track') {
    return (
      <div class={`row${row.playable ? '' : ' unavailable'}`}>
        <button class="row-main" disabled={!row.playable} title={row.playable ? `Play ${row.name}` : 'Spotify cannot play this song'} onClick={() => props.onPlay(row, props.index)}>
          <Art url={row.artUrl} />
          <span class="row-text">
            <span class="row-title-line">
              <span class="row-title">{row.name}</span>
              {row.explicit && (
                <span class="badge" title="Explicit" aria-label="Explicit">
                  E
                </span>
              )}
            </span>
            <span class="muted">{row.album ? `${row.artists} · ${row.album}` : row.artists}</span>
          </span>
          <span class="muted time">{clock(row.durationMs)}</span>
        </button>
        <button class="icon small" aria-label={`Add ${row.name} to the queue`} title="Add to queue" disabled={!row.playable} onClick={() => void run({ type: 'queue', uri: row.uri }, say, `Added ${row.name} to the queue.`)}>
          +
        </button>
        {props.liked ? (
          <button
            class="icon small on"
            aria-label={`Remove ${row.name} from Liked Songs`}
            title="Remove from Liked Songs"
            onClick={() => void run({ type: 'remove', uris: [row.uri] }, say, `Removed ${row.name} from Liked Songs.`).then((ok) => ok && props.onRemoved())}
          >
            ♥
          </button>
        ) : (
          <button class="icon small" aria-label={`Save ${row.name} to Liked Songs`} title="Save to Liked Songs" onClick={() => void run({ type: 'save', uris: [row.uri] }, say, `Saved ${row.name} to Liked Songs.`)}>
            ♡
          </button>
        )}
      </div>
    );
  }
  const sub = row.kind === 'album' ? row.artists : `${row.owner} · ${row.total} ${row.total === 1 ? 'song' : 'songs'}`;
  return (
    <div class="row">
      <button class="row-main" title={`Open ${row.name}`} onClick={() => props.onOpen?.(row.kind === 'album' ? { kind: 'album', row } : { kind: 'playlist', row })}>
        <Art url={row.artUrl} />
        <span class="row-text">
          <span class="row-title">{row.name}</span>
          <span class="muted">{sub}</span>
        </span>
      </button>
      <button class="icon small" aria-label={`Play ${row.name}`} title="Play" onClick={() => void run({ type: 'play', contextUri: row.uri }, say, `Playing ${row.name}.`)}>
        <Icon name="play" />
      </button>
    </div>
  );
}
