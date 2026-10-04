import { useEffect, useRef, useState } from 'preact/hooks';
import type { LibraryRow, SearchKind, TrackRow } from '../../../shared/types';
import { DetailView, RowView, run, type Detail } from './LibraryPage';

/*
 * Search (#48): songs, albums, artists and playlists. Typing waits a moment before searching, answers for an older
 * query are ignored, and each section shows 10 results (the API maximum per page) with "More" for the next 10.
 */

// CHANGE HERE: how long typing must pause before a search starts, and the most results a section can show.
const DEBOUNCE_MS = 350;
const PAGE = 10;
const SECTION_MAX = 100;
// CHANGE HERE: how many search results one Play queues up.
const PLAY_MAX = 50;

const SECTIONS: { kind: SearchKind; title: string }[] = [
  { kind: 'track', title: 'Songs' },
  { kind: 'album', title: 'Albums' },
  { kind: 'artist', title: 'Artists' },
  { kind: 'playlist', title: 'Playlists' },
];

interface SectionState {
  rows: LibraryRow[];
  total: number | null;
  loading: boolean;
  error: string | null;
  /** Offset of the next page. Not the row count: Spotify's empty playlist entries are dropped from the rows. */
  next: number;
}

const EMPTY: SectionState = { rows: [], total: null, loading: false, error: null, next: 0 };

export function SearchPage() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState('');
  // Kinds that came back empty for the current query; when all are, the page says so.
  const [empty, setEmpty] = useState<{ query: string; kinds: SearchKind[] }>({ query: '', kinds: [] });
  const input = useRef<HTMLInputElement>(null);
  const reportEmpty = (q: string, kind: SearchKind) =>
    setEmpty((e) => (e.query === q ? (e.kinds.includes(kind) ? e : { query: q, kinds: [...e.kinds, kind] }) : { query: q, kinds: [kind] }));

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <div id="page-search" class="library search">
      {/* Results stay mounted under an open album or playlist, so Back returns to them without searching again. */}
      {detail && <DetailView detail={detail} onBack={() => setDetail(null)} status={status} say={setStatus} backLabel="Search results" />}
      <div class={detail ? 'hidden' : 'search-body'}>
        <h1>Search</h1>
        <input
          id="searchInput"
          ref={input}
          type="search"
          placeholder="Songs, albums, artists or playlists"
          aria-label="Search Spotify"
          autoComplete="off"
          spellcheck={false}
          maxLength={200}
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        <p class="muted library-status" role="status">
          {status}
        </p>
        {query === '' ? (
          <p class="muted">Search for songs, albums, artists and playlists.</p>
        ) : (
          SECTIONS.map((s) => <Section key={`${s.kind}:${query}`} kind={s.kind} title={s.title} query={query} say={setStatus} onOpen={setDetail} onEmpty={reportEmpty} />)
        )}
        {query !== '' && empty.query === query && empty.kinds.length === SECTIONS.length && (
          <p id="noResults" class="muted">
            No results for “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}

function Section(props: { kind: SearchKind; title: string; query: string; say: (t: string) => void; onOpen: (d: Detail) => void; onEmpty: (query: string, kind: SearchKind) => void }) {
  const { kind, title, query, say, onOpen } = props;
  const [state, setState] = useState<SectionState>(EMPTY);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false; // a newer query replaced this section; drop late answers
    },
    [],
  );

  const load = (offset: number) => {
    setState((s) => ({ ...s, loading: true }));
    void window.ui.search(query, kind, offset).then((result) => {
      if (!alive.current) return;
      setState((s) =>
        result.ok
          ? { rows: [...s.rows, ...result.page.rows.filter((r): r is LibraryRow => r !== null)], total: result.page.total, loading: false, error: null, next: offset + PAGE }
          : { ...s, loading: false, error: result.error },
      );
    });
  };
  useEffect(() => load(0), []);
  useEffect(() => {
    if (state.total === 0) props.onEmpty(query, kind);
  }, [state.total]);

  if (state.total === 0) return null;
  const tracks = state.rows.filter((r): r is TrackRow => r.kind === 'track');
  const playFrom = (row: TrackRow) => {
    const at = tracks.indexOf(row);
    const uris = tracks
      .slice(at)
      .filter((t) => t.playable)
      .slice(0, PLAY_MAX)
      .map((t) => t.uri);
    void run({ type: 'play', uris }, say, `Playing ${row.name}.`);
  };
  const more = state.total !== null && state.next < Math.min(state.total, SECTION_MAX);
  return (
    <section class="search-section" id={`results-${kind}`} aria-label={title}>
      <h2>{title}</h2>
      {state.error && (
        <p class="error-text" role="alert">
          {state.error}
        </p>
      )}
      <ul class="plain">
        {state.rows.map((row, i) => (
          <li key={`${row.uri}:${i}`} class="search-row">
            <RowView row={row} index={i} liked={false} say={say} onPlay={playFrom} onOpen={onOpen} onRemoved={() => undefined} />
          </li>
        ))}
      </ul>
      {state.total === null && !state.error && <p class="muted">Searching…</p>}
      {more && (
        <button id={`more-${kind}`} class="text" disabled={state.loading} onClick={() => load(state.next)}>
          {state.loading ? 'Loading…' : `More ${title.toLowerCase()}`}
        </button>
      )}
    </section>
  );
}
