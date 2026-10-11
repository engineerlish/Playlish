/// <reference path="../../sdk/playlish.d.ts" />
// A starting point for a Playlish plugin (see docs/PLUGINS.md). It counts the tracks you play, keeps the count in its
// storage, and shows it on the Plugins page with a button to reset it.
//
// To try it: npm run plugin:pack -- examples/template, then Plugins, Install from file, and pick template.playlish.

let count = 0;

function draw() {
  return playlish.call('ui.set', {
    slot: 'plugins-page',
    panel: {
      title: 'My plugin',
      items: [
        { type: 'text', text: 'Tracks played since the last reset: ' + count },
        { type: 'button', id: 'reset', label: 'Reset' },
      ],
    },
  });
}

async function save() {
  await playlish.call('storage.set', { key: 'count', value: count });
  await draw();
}

// Events need the "playback.read" permission.
playlish.on('track.changed', (playback) => {
  if (!playback) return;
  count++;
  playlish.log('Now playing: ' + playback.track.name);
  return save();
});

// Clicks in the panel.
playlish.on('ui.action', (action) => {
  if (action.id === 'reset') {
    count = 0;
    return save();
  }
});

// Runs once when the plugin starts.
async function start() {
  count = Number(await playlish.call('storage.get', { key: 'count' })) || 0;
  await draw();
}
start();
