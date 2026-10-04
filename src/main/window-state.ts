import type { WindowState } from './settings';

/*
 * Restoring the window where the user left it, safely: if that place is no longer on any screen (a monitor was
 * unplugged, the resolution changed), the window is centered instead of opening somewhere invisible.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// CHANGE HERE: how much of the window must be visible on a screen for its saved position to be used.
export const MIN_VISIBLE_WIDTH = 160;
export const MIN_VISIBLE_HEIGHT = 80;
export const MIN_SIZE = { width: 360, height: 360 };

/** Area shared by two rectangles (0 when they do not overlap). */
function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

// CHANGE HERE: screen assumed when Electron reports none.
const FALLBACK_AREA: Rect = { x: 0, y: 0, width: 1280, height: 800 };

/**
 * Turns saved window state into options for opening the window. The position is kept only if enough of the window
 * would be visible on one of the screens' work areas; otherwise the window opens centered on the primary screen. The
 * size is limited to the screen the window will actually open on (not the largest one: with a portrait monitor that
 * could be taller than the screen in use).
 *
 * `workAreas` must list the primary screen first.
 */
export function fitWindowState(saved: WindowState, workAreas: Rect[]): { width: number; height: number; x?: number; y?: number; maximized: boolean } {
  const primary = workAreas[0] ?? FALLBACK_AREA;
  let target = primary;
  let keepPosition = false;
  if (saved.x !== null && saved.y !== null) {
    const rect = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
    // The screen showing the most of the window is the one it reopens on.
    let bestArea = 0;
    for (const area of workAreas) {
      const o = overlap(rect, area);
      if (o.width >= MIN_VISIBLE_WIDTH && o.height >= MIN_VISIBLE_HEIGHT && o.width * o.height > bestArea) {
        bestArea = o.width * o.height;
        target = area;
        keepPosition = true;
      }
    }
  }
  const width = Math.max(MIN_SIZE.width, Math.min(saved.width, target.width));
  const height = Math.max(MIN_SIZE.height, Math.min(saved.height, target.height));
  const result = { width, height, maximized: saved.maximized };
  return keepPosition && saved.x !== null && saved.y !== null ? { ...result, x: saved.x, y: saved.y } : result;
}

/** Window state to save from the window's normal (not maximized) bounds. */
export function toWindowState(bounds: Rect, maximized: boolean): WindowState {
  return {
    width: Math.max(MIN_SIZE.width, Math.round(bounds.width)),
    height: Math.max(MIN_SIZE.height, Math.round(bounds.height)),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    maximized,
  };
}
