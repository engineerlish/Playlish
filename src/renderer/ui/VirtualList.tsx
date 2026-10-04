import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { visibleRange } from './list-math';

/*
 * A list that only puts the rows on screen (plus a few around them) into the page, however many there are (#47).
 * Rows have a fixed height, so positions are simple arithmetic. Screen readers still hear "row 512 of 5,000"
 * through aria-setsize and aria-posinset.
 */

export function VirtualList(props: {
  id: string;
  label: string;
  count: number;
  rowHeight: number;
  renderRow: (index: number) => ComponentChildren;
  /** Told which rows are on screen, so their data can be loaded. */
  onRange: (first: number, last: number) => void;
}) {
  const { count, rowHeight, onRange } = props;
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { first, last } = visibleRange(scrollTop, viewport, rowHeight, count);
  useEffect(() => onRange(first, last), [first, last, onRange]);

  // Rows are keyed by a slot that is reused as the list scrolls, so the same few dozen elements are updated in place
  // instead of thousands being created and thrown away (that garbage alone grew the window by ~60 MB over 5,000 rows).
  const slots = Math.max(1, last - first + 1);
  const rows: ComponentChildren[] = [];
  for (let i = first; i <= last; i++) {
    rows.push(
      <div key={i % slots} class="vrow" role="listitem" aria-setsize={count} aria-posinset={i + 1} style={{ top: `${i * rowHeight}px`, height: `${rowHeight}px` }}>
        {props.renderRow(i)}
      </div>,
    );
  }
  return (
    <div id={props.id} class="vlist" ref={box} role="list" aria-label={props.label} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
      <div class="vlist-space" style={{ height: `${count * rowHeight}px` }}>
        {rows}
      </div>
    </div>
  );
}
