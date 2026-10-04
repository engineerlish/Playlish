import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { LibraryList, LibraryRow } from '../../shared/types';
import { pagesToEvict } from './list-math';

/*
 * Loads a long list page by page as rows come into view, and keeps only a few pages in memory: the ones farthest
 * from what is on screen are dropped first and simply load again if scrolled back to. So memory stays flat however
 * long the list is (#47).
 */

// CHANGE HERE: rows per page (must match PAGE_SIZE in src/main/library.ts) and how many pages stay in memory.
export const PAGE_ROWS = 50;
export const MAX_PAGES = 12;

export interface PagedList {
  /** Total rows, or null until the first page arrived. */
  total: number | null;
  /** A loaded row, null for an entry Spotify no longer has, undefined while not loaded. */
  rowAt: (index: number) => LibraryRow | null | undefined;
  /** Asks for the rows from `first` to `last` (inclusive) to be loaded. */
  want: (first: number, last: number) => void;
  error: string | null;
  /** Loaded rows from `index` on, for playing a list without a context (liked songs). */
  loadedFrom: (index: number, max: number) => LibraryRow[];
  /** Drops everything and loads again (after a change such as removing a song). */
  reload: () => void;
}

/** Stable key for a list, so switching lists starts fresh. */
export function listKey(list: LibraryList): string {
  return list.kind === 'album' ? `album:${list.id}` : list.kind === 'playlist' ? `playlist:${list.id}:${list.snapshotId}` : list.kind;
}

export function usePagedList(list: LibraryList): PagedList {
  const key = listKey(list);
  const pages = useRef(new Map<number, (LibraryRow | null)[]>());
  const loading = useRef(new Set<number>());
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setVersion] = useState(0);
  const generation = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;
  /** The rows last asked for, so a reload can load what is on screen again (not only the first page). */
  const lastRange = useRef<[number, number]>([0, 0]);

  const load = useCallback((page: number) => {
    if (pages.current.has(page) || loading.current.has(page)) return;
    loading.current.add(page);
    const gen = generation.current;
    void window.ui.library(listRef.current, page * PAGE_ROWS).then((result) => {
      if (gen !== generation.current) return; // the list changed meanwhile
      loading.current.delete(page);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      pages.current.set(page, result.page.rows);
      setTotal(result.page.total);
      setVersion((v) => v + 1);
    });
  }, []);

  const reset = useCallback(() => {
    generation.current++;
    pages.current.clear();
    loading.current.clear();
    setTotal(null);
    setError(null);
    setVersion((v) => v + 1);
    load(0);
  }, [load]);

  useEffect(reset, [key]);

  const want = useCallback(
    (first: number, last: number) => {
      lastRange.current = [first, last];
      const from = Math.floor(Math.max(0, first) / PAGE_ROWS);
      const to = Math.floor(Math.max(0, last) / PAGE_ROWS);
      for (let p = from; p <= to; p++) load(p);
      for (const p of pagesToEvict([...pages.current.keys()], Math.floor((from + to) / 2), MAX_PAGES)) pages.current.delete(p);
    },
    [load],
  );

  const rowAt = (index: number) => {
    const page = pages.current.get(Math.floor(index / PAGE_ROWS));
    return page ? page[index % PAGE_ROWS] : undefined;
  };

  const loadedFrom = (index: number, max: number) => {
    const out: LibraryRow[] = [];
    for (let i = index; out.length < max; i++) {
      const row = rowAt(i);
      if (row === undefined) break;
      if (row) out.push(row);
    }
    return out;
  };

  // A reload (after removing a song) keeps the list and its scroll position: the total stays until the new pages
  // arrive, and the rows on screen are asked for again (the list only asks when the visible range changes).
  const reload = useCallback(() => {
    generation.current++;
    pages.current.clear();
    loading.current.clear();
    setVersion((v) => v + 1);
    want(...lastRange.current);
  }, [want]);

  return { total, rowAt, want, error, loadedFrom, reload };
}
