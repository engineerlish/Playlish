/// <reference path="../../sdk/playlish.d.ts" />
// Listening stats (example plugin, #104): your top artists and tracks from the last 50 songs you played (Spotify keeps
// no more than that for apps). It refreshes when a new track starts, at most every 2 minutes so it stays far below the
// API limit, and when you press Refresh.

const TOP = 5;
// CHANGE HERE: the shortest time between two automatic refreshes.
const MIN_REFRESH_MS = 2 * 60 * 1000;

let lastRefresh = 0;
let busy = false;

/** The `n` largest counts, ties in alphabetical order. */
function top(counts, n) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

function plays(n) {
  return n === 1 ? '1 play' : n + ' plays';
}

/** Draws the panel below the sidebar. */
function show(items) {
  return playlish.call('ui.set', { slot: 'sidebar', panel: { title: 'Listening stats', items: [...items, { type: 'button', id: 'refresh', label: 'Refresh' }] } });
}

/** Reads the recent plays and shows the top artists and tracks; `force` ignores the minimum time between refreshes. */
async function refresh(force) {
  if (busy || (!force && Date.now() - lastRefresh < MIN_REFRESH_MS)) return;
  busy = true;
  try {
    const recent = await playlish.call('history.recent', { limit: 50 });
    lastRefresh = Date.now();
    if (recent.length === 0) {
      await show([{ type: 'text', text: 'Nothing played recently.', style: 'muted' }]);
      return;
    }
    const artists = new Map();
    const tracks = new Map();
    for (const track of recent) {
      for (const artist of track.artists) artists.set(artist, (artists.get(artist) || 0) + 1);
      const key = track.name + ' – ' + track.artists.join(', ');
      tracks.set(key, (tracks.get(key) || 0) + 1);
    }
    await show([
      { type: 'text', text: 'Top artists', style: 'heading' },
      { type: 'list', items: top(artists, TOP).map(([name, n]) => ({ text: name, detail: plays(n) })) },
      { type: 'text', text: 'Top tracks', style: 'heading' },
      { type: 'list', items: top(tracks, TOP).map(([name, n]) => ({ text: name, detail: plays(n) })) },
      { type: 'text', text: 'From your last ' + recent.length + ' plays.', style: 'muted' },
    ]);
  } catch (e) {
    await show([{ type: 'text', text: 'Could not load your recent plays: ' + e.message, style: 'muted' }]);
  } finally {
    busy = false;
  }
}

playlish.on('track.changed', () => refresh(false));
playlish.on('ui.action', (action) => {
  if (action.id === 'refresh') return refresh(true);
});
refresh(true);
