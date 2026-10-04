import { describe, expect, it } from 'vitest';
import { OVERSCAN, pagesToEvict, visibleRange } from '../src/renderer/ui/list-math';

describe('visibleRange', () => {
  it('renders the rows on screen plus a few around them', () => {
    expect(visibleRange(0, 560, 56, 5000)).toEqual({ first: 0, last: 10 + OVERSCAN });
    expect(visibleRange(56 * 1000, 560, 56, 5000)).toEqual({ first: 1000 - OVERSCAN, last: 1010 + OVERSCAN });
  });

  it('stays inside the list at the end and when the list is short or empty', () => {
    expect(visibleRange(56 * 4995, 560, 56, 5000).last).toBe(4999);
    expect(visibleRange(0, 560, 56, 3)).toEqual({ first: 0, last: 2 });
    expect(visibleRange(0, 560, 56, 0)).toEqual({ first: 0, last: -1 });
  });

  it('renders about the same number of rows however long the list is', () => {
    const size = (r: { first: number; last: number }) => r.last - r.first + 1;
    expect(size(visibleRange(56 * 2500, 560, 56, 5000))).toBe(size(visibleRange(56 * 250_000, 560, 56, 500_000)));
  });
});

describe('pagesToEvict', () => {
  it('keeps everything while under the cap', () => {
    expect(pagesToEvict([0, 1, 2], 1, 12)).toEqual([]);
  });

  it('drops the pages farthest from the one in view', () => {
    expect(pagesToEvict([0, 1, 2, 3, 4, 50, 51], 50, 4).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });
});
