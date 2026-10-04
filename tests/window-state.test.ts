import { describe, expect, it } from 'vitest';
import { fitWindowState, toWindowState } from '../src/main/window-state';

const MAIN = { x: 0, y: 0, width: 1920, height: 1040 };
const LEFT = { x: -1280, y: 0, width: 1280, height: 984 };
// A portrait monitor with more area than MAIN, as on a real three-monitor setup.
const PORTRAIT = { x: -1440, y: -1114, width: 1440, height: 2512 };

describe('fitWindowState', () => {
  it('keeps a saved position that is on a screen', () => {
    expect(fitWindowState({ width: 1100, height: 720, x: 200, y: 100, maximized: false }, [MAIN])).toEqual({ width: 1100, height: 720, x: 200, y: 100, maximized: false });
  });

  it('keeps a position on a second monitor to the left', () => {
    expect(fitWindowState({ width: 1000, height: 700, x: -1200, y: 50, maximized: false }, [MAIN, LEFT])).toMatchObject({ x: -1200, y: 50 });
  });

  it('centers the window when its monitor is gone', () => {
    const fitted = fitWindowState({ width: 1000, height: 700, x: -1200, y: 50, maximized: false }, [MAIN]);

    expect(fitted).toEqual({ width: 1000, height: 700, maximized: false });
  });

  it('centers the window when only a sliver would be visible', () => {
    const fitted = fitWindowState({ width: 1000, height: 700, x: 1850, y: 100, maximized: false }, [MAIN]);

    expect(fitted.x).toBeUndefined();
  });

  it('limits the size to the primary screen when centering, even if another screen is bigger', () => {
    expect(fitWindowState({ width: 9000, height: 9000, x: null, y: null, maximized: false }, [MAIN, PORTRAIT])).toMatchObject({ width: 1920, height: 1040 });
  });

  it('limits the size to the screen the window reopens on', () => {
    expect(fitWindowState({ width: 9000, height: 9000, x: -1400, y: -1000, maximized: false }, [MAIN, PORTRAIT])).toMatchObject({ width: 1440, height: 2512, x: -1400 });
  });

  it('picks the screen showing most of a window that spans two screens', () => {
    // Mostly on LEFT (1180 px wide there), a little on MAIN (900 px): LEFT's height applies.
    expect(fitWindowState({ width: 2080, height: 1200, x: -1180, y: 0, maximized: false }, [MAIN, LEFT])).toMatchObject({ height: 984, x: -1180 });
    // Mostly on MAIN this time, which is listed first: MAIN's height applies.
    expect(fitWindowState({ width: 2000, height: 1200, x: -300, y: 0, maximized: false }, [MAIN, LEFT])).toMatchObject({ height: 1040, x: -300 });
  });

  it('shrinks a window bigger than the screen and keeps a minimum size', () => {
    expect(fitWindowState({ width: 4000, height: 3000, x: null, y: null, maximized: true }, [MAIN, LEFT])).toEqual({ width: 1920, height: 1040, maximized: true });
    expect(fitWindowState({ width: 100, height: 100, x: null, y: null, maximized: false }, [MAIN])).toMatchObject({ width: 360, height: 360 });
  });

  it('copes with no screen information', () => {
    expect(fitWindowState({ width: 1100, height: 720, x: 10, y: 10, maximized: false }, [])).toMatchObject({ width: 1100, height: 720 });
  });
});

describe('toWindowState', () => {
  it('rounds bounds and enforces the minimum size', () => {
    expect(toWindowState({ x: 10.4, y: -3.6, width: 200, height: 900.5 }, true)).toEqual({ width: 360, height: 901, x: 10, y: -4, maximized: true });
  });
});
