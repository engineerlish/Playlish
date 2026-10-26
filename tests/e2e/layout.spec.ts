import type { CDPSession, Page } from '@playwright/test';
import * as fs from 'node:fs';
import type { FakeSpotify } from '../helpers/fake-spotify';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, waitForPlayerReady } from './harness';

/*
 * Layout check (polish standard): every main screen, filled with stress data (200-character titles, non-Latin scripts,
 * emoji, missing and broken art, a long queue), at window sizes from the minimum to 4K and at Windows display scaling
 * of 100, 125, 150 and 200%. Sizes and scaling are emulated in the page (CSS pixels and device pixel ratio), so the
 * test does not depend on the runner's screen. Each screen is checked for:
 *   - the page scrolling sideways, or anything sticking out of the window
 *   - text that overflows its box, or is cut off without an ellipsis
 *   - text cut with an ellipsis that has no tooltip (title) with the full text
 *   - buttons smaller than the 32px hit target
 *   - the player bar's three parts overlapping
 * Screenshots of every screen at every size (100% scaling) and in dark mode at 1280x800 are saved with the results.
 */

// CHANGE HERE: the sizes (CSS pixels; 360x360 is the window minimum in main.ts) and scale factors checked.
const SIZES = [
  { width: 360, height: 360 },
  { width: 800, height: 600 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
];
const SCALES = [1, 1.25, 1.5, 2];
const HIT_TARGET = 32;

const LONG = 'An Extraordinarily Long Song Title That Keeps Going Well Past Any Reasonable Width Of A Window, Written To Check Ellipses, Tooltips And Wrapping In Every Single Place Where Text Appears In Playlish 01234567';
const NAMES = [LONG, '夜に駆ける (Racing Into The Night) — 東京事変とYOASOBIの非常に長い日本語のタイトル', 'أغنية بعنوان طويل جداً باللغة العربية لاختبار الاتجاه', '🎧🔥 Emoji Mix 🌈✨🎶 with flags 🇳🇿🇯🇵 and families 👨‍👩‍👧‍👦', 'Short', 'Ünïcödé Ñame — Ålbum Øne'];
// Art that fails to load: blocked by the window's CSP (img-src), so the test never touches the network.
const BROKEN_ART = [{ url: 'https://example.invalid/missing.jpg', width: 64, height: 64 }];

const nameAt = (i: number) => NAMES[i % NAMES.length] ?? 'Song';
const track = (i: number) => ({
  type: 'track',
  id: `t${i}`,
  name: nameAt(i),
  uri: `spotify:track:t${i}`,
  duration_ms: 180_000 + i * 1000,
  explicit: i % 3 === 0,
  is_playable: i % 11 !== 5,
  artists: [{ id: 'a', name: nameAt(i + 1), uri: 'spotify:artist:a' }, { id: 'b', name: 'Second Artist', uri: 'spotify:artist:b' }],
  album: { id: `al${i}`, name: nameAt(i + 2), uri: `spotify:album:al${i}`, images: i % 2 ? BROKEN_ART : [], artists: [] },
});
const album = (i: number) => ({ id: `al${i}`, name: nameAt(i), uri: `spotify:album:al${i}`, images: i % 2 ? BROKEN_ART : [], artists: [{ id: 'a', name: nameAt(i + 1), uri: '' }], total_tracks: 12 });
const playlist = (i: number) => ({
  id: `pl${i}`, name: nameAt(i), uri: `spotify:playlist:pl${i}`, images: i % 2 ? BROKEN_ART : null, owner: { id: i === 0 ? 'me' : 'other', display_name: i === 0 ? 'Me' : nameAt(i + 3) },
  snapshot_id: 's', collaborative: false, public: true, description: '', items: { total: 40, href: '' },
});
const device = (id: string, name: string, type: string, active = false) => ({ id, name, type, is_active: active, is_restricted: false, is_private_session: false, volume_percent: 50, supports_volume: true });

/** Pages of `total` generated entries, answering any offset and limit. */
function paged(total: number, make: (i: number) => unknown) {
  return (request: { query: URLSearchParams }) => {
    const offset = Number(request.query.get('offset') ?? 0);
    const limit = Number(request.query.get('limit') ?? 50);
    const items = [];
    for (let i = offset; i < Math.min(total, offset + limit); i++) items.push(make(i));
    return { status: 200, body: { items, total, limit, offset, next: null, href: '' } };
  };
}

/** A library, search, queue and device list made of stress data. */
function scriptStress(fake: FakeSpotify): void {
  fake.on('GET', '/v1/me', { status: 200, body: { id: 'me', display_name: 'Me', uri: 'spotify:user:me', images: [] } });
  fake.on('GET', '/v1/me/tracks', paged(500, (i) => ({ added_at: '', track: track(i) })));
  fake.on('GET', '/v1/me/albums', paged(30, (i) => ({ added_at: '', album: album(i) })));
  fake.on('GET', '/v1/albums/al0/tracks', paged(30, (i) => {
    const { album: _album, ...t } = track(i);
    void _album;
    return t;
  }));
  fake.on('GET', '/v1/me/playlists', paged(30, playlist));
  fake.on('GET', '/v1/search', (request) => {
    const type = request.query.get('type');
    const offset = Number(request.query.get('offset') ?? 0);
    const q = request.query.get('q') ?? '';
    const page = (make: (i: number) => unknown) => ({ items: q === 'nothing' ? [] : Array.from({ length: 10 }, (_, k) => make(offset + k)), total: q === 'nothing' ? 0 : 40, limit: 10, offset, next: null, href: '' });
    const body: Record<string, unknown> = {};
    if (type === 'track') body['tracks'] = page(track);
    if (type === 'album') body['albums'] = page(album);
    if (type === 'artist') body['artists'] = page((i) => ({ id: `ar${i}`, name: nameAt(i), uri: `spotify:artist:ar${i}`, images: i % 2 ? BROKEN_ART : [] }));
    if (type === 'playlist') body['playlists'] = page(playlist);
    return { status: 200, body };
  });
  fake.on('GET', '/v1/me/player/queue', { status: 200, body: { currently_playing: track(0), queue: Array.from({ length: 200 }, (_, i) => track(i + 1)) } });
  fake.on('GET', '/v1/me/player/devices', {
    status: 200,
    body: { devices: [device('e2e-device', 'Playlish', 'Computer', true), device('kitchen', LONG, 'Speaker'), device('jp', '台所のスピーカー（とても長い名前のデバイス）', 'Speaker'), device('tv', '📺 Living room TV', 'TV')] },
  });
}

interface Problem {
  rule: string;
  where: string;
  detail: string;
}

/** Runs the layout rules in the page and returns what breaks them. */
async function layoutProblems(ui: Page): Promise<Problem[]> {
  return ui.evaluate((hit: number) => {
    const problems: { rule: string; where: string; detail: string }[] = [];
    /** A short, readable selector for an element. */
    const where = (el: Element): string => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
        parts.unshift(e.id ? `#${e.id}` : `${e.tagName.toLowerCase()}${e.classList.length ? `.${[...e.classList].join('.')}` : ''}`);
        if (e.id) break;
      }
      return parts.join(' > ');
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      // Zero-size and visually hidden (1px, for screen readers only) elements are not on screen.
      if (r.width <= 1 || r.height <= 1) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
    };
    /** True when the element sits inside a box that scrolls or clips sideways (so sticking out is intended). */
    const clippedByAncestor = (el: Element): boolean => {
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const ox = getComputedStyle(e).overflowX;
        if (ox !== 'visible') return true;
      }
      return false;
    };
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    if (document.documentElement.scrollWidth > vw + 1) problems.push({ rule: 'page scrolls sideways', where: 'html', detail: `${document.documentElement.scrollWidth} > ${vw}` });
    if (document.documentElement.scrollHeight > vh + 1) problems.push({ rule: 'page scrolls vertically', where: 'html', detail: `${document.documentElement.scrollHeight} > ${vh}` });

    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!clippedByAncestor(el) && (r.right > vw + 1 || r.left < -1)) problems.push({ rule: 'outside the window', where: where(el), detail: `left ${Math.round(r.left)}, right ${Math.round(r.right)}, window ${vw}` });

      const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      const overX = el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
      if (hasText && overX) {
        if (cs.overflowX === 'visible' && !clippedByAncestor(el)) problems.push({ rule: 'text overflows its box', where: where(el), detail: `${el.scrollWidth} > ${el.clientWidth}` });
        else if (cs.overflowX === 'hidden' && cs.textOverflow !== 'ellipsis') problems.push({ rule: 'text cut off without an ellipsis', where: where(el), detail: (el.textContent ?? '').slice(0, 40) });
        else if (cs.textOverflow === 'ellipsis' && !el.closest('[title]')) problems.push({ rule: 'truncated text has no tooltip', where: where(el), detail: (el.textContent ?? '').slice(0, 40) });
      }

      if (el instanceof HTMLButtonElement && (r.height < hit - 0.5 || r.width < hit - 0.5)) {
        problems.push({ rule: `button smaller than ${hit}px`, where: where(el), detail: `${Math.round(r.width)}x${Math.round(r.height)}` });
      }
    }

    const parts = ['.nowplaying .track', '.nowplaying .transport', '.nowplaying .volume'].map((s) => document.querySelector(s)?.getBoundingClientRect());
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i];
        const b = parts[j];
        if (a && b && a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          problems.push({ rule: 'player bar parts overlap', where: `part ${i} and ${j}`, detail: '' });
        }
      }
    // One report per rule and place is enough (a list repeats the same row many times).
    const seen = new Set<string>();
    return problems.filter((p) => (seen.has(p.rule + p.where) ? false : (seen.add(p.rule + p.where), true)));
  }, HIT_TARGET);
}

const sessions = new WeakMap<Page, CDPSession>();

/** Emulates a window size and Windows display scaling, then waits for the layout to settle. */
async function emulate(ui: Page, size: { width: number; height: number }, scale: number): Promise<void> {
  // One DevTools session per page, kept open: detaching a session drops the emulation it set.
  let cdp = sessions.get(ui);
  if (!cdp) {
    cdp = await ui.context().newCDPSession(ui);
    sessions.set(ui, cdp);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: scale, mobile: false });
  await ui.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await ui.waitForTimeout(80);
}

/** Checks one screen at every size and scale; screenshots at 100%. */
async function checkScreen(ui: Page, name: string, outDir: string, found: Record<string, Problem[]>): Promise<void> {
  for (const size of SIZES) {
    for (const scale of SCALES) {
      await emulate(ui, size, scale);
      const problems = await layoutProblems(ui);
      if (problems.length > 0) found[`${name} @ ${size.width}x${size.height} ×${scale}`] = problems;
      if (scale === 1) await ui.screenshot({ path: `${outDir}/${name}-${size.width}x${size.height}.png` });
    }
  }
  await ui.emulateMedia({ colorScheme: 'dark' });
  await emulate(ui, { width: 1280, height: 800 }, 1);
  await ui.screenshot({ path: `${outDir}/${name}-1280x800-dark.png` });
  await ui.emulateMedia({ colorScheme: 'light' });
}

test.describe('layout', () => {
  // Many screens times many sizes: give it room.
  test.setTimeout(600_000);

  test('every main screen fits, truncates with tooltips and keeps hit targets, at every size and scale', async ({ start, fake }, testInfo) => {
    scriptStress(fake);
    const outDir = testInfo.outputPath('layout');
    fs.mkdirSync(outDir, { recursive: true });
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.emulateMedia({ colorScheme: 'light' });
    const found: Record<string, Problem[]> = {};

    await checkScreen(ui, 'logged-out', outDir, found);
    await ui.click('#nav-library');
    await ui.click('#login');
    await waitForPlayerReady(app);
    await inHost(app, `window.__stub.startPlaying(${JSON.stringify(LONG)})`);
    await expect(ui.locator('#track')).toHaveText(LONG);

    await ui.click('#nav-library');
    await expect(ui.locator('#list-tracks .row-title').first()).toBeVisible();
    await checkScreen(ui, 'library-songs', outDir, found);
    await ui.click('#tab-albums');
    await expect(ui.locator('#list-albums .row-title').first()).toBeVisible();
    await checkScreen(ui, 'library-albums', outDir, found);
    await ui.locator('#list-albums .row-main').first().click();
    await expect(ui.locator('#detailTitle')).toBeVisible();
    await checkScreen(ui, 'album', outDir, found);
    await ui.click('#libraryBack');
    await ui.click('#tab-playlists');
    await ui.locator('#list-playlists .row-main').nth(1).click();
    await expect(ui.locator('#othersNote')).toBeVisible();
    await checkScreen(ui, 'playlist-not-listable', outDir, found);

    await ui.click('#nav-search');
    await checkScreen(ui, 'search-empty', outDir, found);
    await ui.fill('#searchInput', LONG.slice(0, 120));
    await expect(ui.locator('#results-track .row-title').first()).toBeVisible();
    await checkScreen(ui, 'search-results', outDir, found);
    await ui.fill('#searchInput', 'nothing');
    await expect(ui.locator('#noResults')).toBeVisible();
    await checkScreen(ui, 'search-no-results', outDir, found);

    await ui.click('#nav-queue');
    await expect(ui.locator('#queue-next .row-title').first()).toBeVisible();
    await checkScreen(ui, 'queue', outDir, found);

    await ui.click('#nav-devices');
    await expect(ui.locator('#device-kitchen')).toBeVisible();
    await checkScreen(ui, 'devices', outDir, found);
    await ui.click('#devicePicker');
    await expect(ui.locator('.popover')).toBeVisible();
    await checkScreen(ui, 'device-picker', outDir, found);
    await ui.keyboard.press('Escape');

    await ui.click('#nav-settings');
    await checkScreen(ui, 'settings', outDir, found);
    await ui.click('#nav-plugins');
    await checkScreen(ui, 'plugins', outDir, found);

    expect(found).toEqual({});
  });

  test('the setup wizard fits at every size and scale', async ({ start }, testInfo) => {
    const outDir = testInfo.outputPath('layout');
    fs.mkdirSync(outDir, { recursive: true });
    const { ui } = await start();
    const found: Record<string, Problem[]> = {};
    await checkScreen(ui, 'setup-welcome', outDir, found);
    await ui.click('#setupNext');
    await checkScreen(ui, 'setup-create-app', outDir, found);
    expect(found).toEqual({});
  });
});
