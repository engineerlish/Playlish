import { describe, expect, it } from 'vitest';
import { MENU_LINE_MAX, TOOLTIP_MAX, clip, trayKey, trayMenu, trayTooltip } from '../src/main/tray-menu';
import type { NowPlaying } from '../src/shared/types';

function np(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    source: 'here',
    deviceName: null,
    paused: false,
    positionMs: 0,
    durationMs: 200_000,
    sampledAt: 0,
    track: 'Song',
    artists: 'Artist',
    trackUri: null,
    artUrl: null,
    shuffle: false,
    repeat: 'off',
    volume: 0.5,
    muted: false,
    ...overrides,
  };
}

const labels = (items: ReturnType<typeof trayMenu>) => items.map((i) => (i.kind === 'separator' ? '---' : i.label));

describe('trayMenu', () => {
  it('shows what plays and offers Pause, Next and Previous', () => {
    const items = trayMenu(np(), true);

    expect(labels(items)).toEqual(['▶ Song – Artist', '---', 'Pause', 'Next', 'Previous', '---', 'Open Playlish', 'Quit']);
    expect(items.every((i) => i.kind !== 'action' || i.enabled)).toBe(true);
  });

  it('offers Play when paused, and names another device', () => {
    expect(labels(trayMenu(np({ paused: true, source: 'elsewhere', deviceName: 'Kitchen' }), true)).slice(0, 3)).toEqual([
      '❚❚ Song – Artist (on Kitchen)',
      '---',
      'Play',
    ]);
  });

  it('with nothing playing: Play only when the player is ready, Next and Previous off', () => {
    const ready = trayMenu(null, true);
    const notReady = trayMenu(null, false);

    expect(labels(ready)[0]).toBe('Nothing playing');
    expect(ready.find((i) => i.kind === 'action' && i.action === 'toggle')).toMatchObject({ enabled: true });
    expect(ready.find((i) => i.kind === 'action' && i.action === 'next')).toMatchObject({ enabled: false });
    expect(notReady.find((i) => i.kind === 'action' && i.action === 'toggle')).toMatchObject({ enabled: false });
    expect(notReady.find((i) => i.kind === 'action' && i.action === 'open')).toMatchObject({ enabled: true });
  });

  it('keeps long titles to one short line', () => {
    const first = trayMenu(np({ track: 'x'.repeat(200) }), true)[0];
    expect(first?.kind === 'label' && first.label.length).toBe(MENU_LINE_MAX);
    expect(first?.kind === 'label' && first.label.endsWith('…')).toBe(true);
  });
});

describe('trayTooltip and trayKey', () => {
  it('names the app and what plays, within the Windows limit', () => {
    expect(trayTooltip(null)).toBe('Playlish');
    expect(trayTooltip(np({ paused: true }))).toBe('Playlish – Song – Artist (paused)');
    expect(trayTooltip(np({ artists: '', track: 'y'.repeat(300) })).length).toBe(TOOLTIP_MAX);
  });

  it('ignores progress, so the menu is not rebuilt while a track plays', () => {
    expect(trayKey(np({ positionMs: 1000, sampledAt: 1 }), true)).toBe(trayKey(np({ positionMs: 90_000, sampledAt: 99 }), true));
    expect(trayKey(np(), true)).not.toBe(trayKey(np({ paused: true }), true));
    expect(trayKey(np(), true)).not.toBe(trayKey(np({ track: 'Other' }), true));
  });

  it('clip leaves short text alone', () => {
    expect(clip('abc', 5)).toBe('abc');
    expect(clip('abcdef', 5)).toBe('abcd…');
  });
});
