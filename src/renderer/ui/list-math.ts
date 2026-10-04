/*
 * Arithmetic for long lists (#47), kept apart from the components so it can be unit tested.
 */

// CHANGE HERE: extra rows kept above and below the visible ones, so fast scrolling does not show gaps.
export const OVERSCAN = 8;

/** Which rows to render for a scroll position (fixed row height). Empty range for an empty list. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = OVERSCAN): { first: number; last: number } {
  if (count === 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count - 1, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { first, last };
}

/** Pages to drop so at most `max` stay, farthest from the page in view first. */
export function pagesToEvict(loaded: readonly number[], focus: number, max: number): number[] {
  if (loaded.length <= max) return [];
  return [...loaded].sort((a, b) => Math.abs(b - focus) - Math.abs(a - focus)).slice(0, loaded.length - max);
}
