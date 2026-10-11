/// <reference path="../../sdk/playlish.d.ts" />
// EQ by playlist (example plugin, #104): switches the equalizer preset when music plays from a playlist you chose.
// The rules are kept in its own storage. Your on/off choice for the equalizer stays yours: if it is off, the plugin
// says so instead of turning it on.

/** @typedef {Playlish.ArgsOf<'eq.preset'>['preset']} Preset */

/** @type {[Preset, string][]} */
const PRESETS = [
  ['flat', 'Flat'],
  ['bassBoost', 'Bass boost'],
  ['bassCut', 'Bass cut'],
  ['vocal', 'Vocal'],
  ['trebleBoost', 'Treble boost'],
];

/** Playlist URI to { name, preset }. @type {Record<string, { name: string; preset: Preset }>} */
let rules = {};
let playlists = [];
let chosenPlaylist = null;
/** @type {Preset} */
let chosenPreset = 'bassBoost';
let status = '';
/** The context the current preset was chosen for, so it is set once per playlist, not on every event. */
let applied = null;

function presetName(id) {
  const found = PRESETS.find((p) => p[0] === id);
  return found ? found[1] : id;
}

function draw() {
  /** @type {Playlish.PanelItem[]} */
  const items = [{ type: 'text', text: 'Switches the equalizer preset when music plays from one of these playlists.' }];
  const entries = Object.entries(rules);
  if (entries.length > 0) items.push({ type: 'list', items: entries.map(([, rule]) => ({ text: rule.name, detail: presetName(rule.preset) })) });
  else items.push({ type: 'text', text: 'No playlists chosen yet.', style: 'muted' });
  if (playlists.length > 0) {
    items.push({ type: 'select', id: 'playlist', label: 'Playlist', options: playlists.map((p) => ({ value: p.uri, label: p.name })), value: chosenPlaylist });
    items.push({ type: 'select', id: 'preset', label: 'Preset', options: PRESETS.map(([value, label]) => ({ value, label })), value: chosenPreset });
    items.push({ type: 'button', id: 'add', label: 'Use this preset for the playlist' });
    if (rules[chosenPlaylist]) items.push({ type: 'button', id: 'remove', label: 'Remove the rule for this playlist' });
  }
  if (status) items.push({ type: 'text', text: status, style: 'muted' });
  return playlish.call('ui.set', { slot: 'plugins-page', panel: { title: 'EQ by playlist', items } });
}

/** Sets the preset for what plays now, if a rule covers it and it was not set already. */
async function apply(playback) {
  const context = playback && playback.context;
  if (!context || context === applied) return;
  applied = context;
  const rule = rules[context];
  if (!rule) return;
  const result = await playlish.call('eq.preset', { preset: rule.preset });
  if (result.status === 'applied') status = 'Playing from ' + rule.name + ': ' + presetName(rule.preset) + '.';
  else if (result.status === 'off') status = 'Playing from ' + rule.name + ', but the equalizer is off (Settings, Audio).';
  else status = 'The equalizer is not ready (' + result.status + ').';
  await draw();
}

async function saveRules(message) {
  await playlish.call('storage.set', { key: 'rules', value: rules });
  status = message;
  // A new rule may cover what plays now.
  applied = null;
  await apply(await playlish.call('playback.get'));
}

playlish.on('track.changed', apply);
playlish.on('playback.state', apply);
playlish.on('ui.action', async (action) => {
  if (action.id === 'playlist') chosenPlaylist = String(action.value);
  else if (action.id === 'preset') chosenPreset = /** @type {Preset} */ (String(action.value));
  else if (action.id === 'add' && chosenPlaylist) {
    const playlist = playlists.find((p) => p.uri === chosenPlaylist);
    rules[chosenPlaylist] = { name: playlist ? playlist.name : chosenPlaylist, preset: chosenPreset };
    await saveRules('Saved.');
  } else if (action.id === 'remove' && chosenPlaylist) {
    delete rules[chosenPlaylist];
    await saveRules('Removed.');
  }
  await draw();
});

async function start() {
  rules = /** @type {typeof rules} */ ((await playlish.call('storage.get', { key: 'rules' })) || {});
  try {
    playlists = (await playlish.call('library.playlists', { limit: 50 })).items;
  } catch (e) {
    status = 'Could not load your playlists: ' + e.message;
  }
  chosenPlaylist = playlists.length > 0 ? playlists[0].uri : null;
  await draw();
  await apply(await playlish.call('playback.get'));
}
start();
