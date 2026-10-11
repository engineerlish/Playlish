/// <reference path="../../sdk/playlish.d.ts" />
// Smart shuffle (example plugin, #104): queues a mix from your liked songs. Songs from its last mixes are left out
// (it remembers the last 200 it queued, in its own storage), and two songs by the same artist never follow each other.
// A mix of up to 30 songs takes at most 40 calls, so it stays under the limit of 60 Spotify calls a minute.

const PAGE = 50;
// CHANGE HERE: how many liked songs it reads (pages of 50), and how many queued songs it remembers.
const MAX_PAGES = 10;
const REMEMBER = 200;

let size = 20;
let status = 'Ready.';
let busy = false;

function draw() {
  return playlish.call('ui.set', {
    slot: 'plugins-page',
    panel: {
      title: 'Smart shuffle',
      items: [
        { type: 'text', text: 'Queues a mix from your liked songs: no songs from your last mixes, and never two songs by the same artist in a row.' },
        { type: 'slider', id: 'size', label: 'Songs in a mix: ' + size, min: 5, max: 30, step: 5, value: size },
        { type: 'button', id: 'mix', label: busy ? 'Working…' : 'Queue a mix' },
        { type: 'text', text: status, style: 'muted' },
      ],
    },
  });
}

/** Up to MAX_PAGES pages of liked songs. */
async function likedSongs() {
  const songs = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await playlish.call('library.liked', { offset: page * PAGE, limit: PAGE });
    songs.push(...result.items);
    if (songs.length >= result.total || result.items.length === 0) break;
  }
  return songs;
}

/** Shuffles in place (Fisher-Yates). */
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** `n` songs: fresh ones first (all of them if there are not enough), never the same lead artist twice in a row. */
function pickMix(songs, recent, n) {
  const fresh = songs.filter((s) => !recent.includes(s.uri));
  const pool = shuffle((fresh.length >= n ? fresh : songs).slice());
  const mix = [];
  while (mix.length < n && pool.length > 0) {
    const previous = mix[mix.length - 1];
    let next = pool.findIndex((s) => !previous || s.artists[0] !== previous.artists[0]);
    if (next < 0) next = 0;
    mix.push(pool.splice(next, 1)[0]);
  }
  return mix;
}

async function queueMix() {
  if (busy) return;
  busy = true;
  status = 'Reading your liked songs…';
  await draw();
  try {
    const songs = await likedSongs();
    if (songs.length === 0) {
      status = 'You have no liked songs yet.';
      return;
    }
    // Storage values come back as whatever was saved; say what it is for the type checker.
    const recent = /** @type {string[]} */ ((await playlish.call('storage.get', { key: 'recent' })) || []);
    const mix = pickMix(songs, recent, size);
    for (const song of mix) await playlish.call('queue.add', { uri: song.uri });
    await playlish.call('storage.set', { key: 'recent', value: [...mix.map((s) => s.uri), ...recent].slice(0, REMEMBER) });
    status = 'Queued ' + mix.length + (mix.length === 1 ? ' song' : ' songs') + ', starting with ' + mix[0].name + '.';
  } catch (e) {
    status = 'Could not queue a mix: ' + e.message;
  } finally {
    busy = false;
    await draw();
  }
}

playlish.on('ui.action', (action) => {
  if (action.id === 'size') {
    size = Number(action.value);
    return draw();
  }
  if (action.id === 'mix') return queueMix();
});
draw();
