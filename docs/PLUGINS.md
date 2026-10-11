# Writing a Playlish plugin

A Playlish plugin is one JavaScript file plus a `manifest.json`, packed into a `.playlish` file. It runs in a sandbox,
asks Playlish to do things through a small API, and can show a panel that Playlish draws for it. This guide covers
everything a plugin can do; the exact types are in [`sdk/playlish.d.ts`](../sdk/playlish.d.ts).

The quickest start is the [template](../examples/template), and the three example plugins show real uses:

| Example | What it shows |
|---|---|
| [Listening stats](../examples/listening-stats) | Reading your history, a sidebar panel, refreshing on events without flooding the API |
| [Smart shuffle](../examples/smart-shuffle) | Paging through liked songs, queueing, storage, a slider and a button |
| [EQ by playlist](../examples/eq-by-playlist) | The playing context, the equalizer, choices in a panel, rules kept in storage |

## What a plugin can and cannot do

A plugin runs in [QuickJS](https://bellard.org/quickjs/) compiled to WebAssembly, in a separate process.

- It has standard JavaScript (ES2023: `async`/`await`, `Map`, `Set`, `JSON`, `Math`, `Date`) and one global object,
  `playlish`.
- It has no `fetch`, no `require` or `import`, no `process`, no file system, no DOM and no timers. It cannot reach the
  network, the disk or the window. Everything goes through `playlish.call(...)`, and every call is checked.
- It never sees your Spotify login. It gets plain data back (track names, URIs), never tokens.
- Values cross into Playlish as JSON.

Limits, per plugin:

| Limit | Value | What happens |
|---|---|---|
| Memory | 16 MB per plugin; 64 MB for all plugins together (a hard ceiling) | The call fails with "out of memory" |
| Time per event or call | 50 ms | The code is interrupted |
| Time per minute | 500 ms | Further work fails until the minute is over |
| Spotify calls | 60 a minute | Calls over the limit are refused |
| Panel updates | 120 a minute | Updates over the limit are refused |

A plugin that keeps breaking these limits (3 times), keeps calling far over the API limit, or crashes the plugin
process twice is turned off, and the plugin manager shows why. Safe mode (Plugins page, Restart in safe mode, or
`--safe-mode`) starts Playlish with every plugin off.

## The manifest

```json
{
  "id": "com.example.my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "author": "Your name",
  "description": "What it does, in one sentence.",
  "apiVersion": 1,
  "permissions": ["playback.read", "storage"],
  "entry": "main.js",
  "ui": ["plugins-page"]
}
```

| Field | Rules |
|---|---|
| `id` | Lower-case letters and digits joined by `.` or `-`, at most 64 characters, for example `com.example.my-plugin`. It names the plugin's folder, so it must not start with a name Windows reserves (`con`, `nul`, `com1` and so on). An update must keep the same id. |
| `name`, `author` | Text, at most 60 characters. |
| `description` | Optional, at most 300 characters. |
| `version` | `x.y.z`, for example `1.2.0`. |
| `apiVersion` | `1`. A plugin written for a newer API is refused with "needs a newer Playlish". |
| `permissions` | The permissions below; can be empty. |
| `entry` | The script, a `.js` file inside the package. |
| `ui` | Optional: `plugins-page`, `sidebar` or both, the places it may show a panel. |

Unknown fields, unknown permissions and names with hidden or control characters are refused.

## Permissions

The install prompt shows each permission in plain words. An update that asks for more shows the new ones and needs
approval again.

| Permission | Allows |
|---|---|
| `playback.read` | Events, and `playback.get` |
| `playback.control` | `play`, `pause`, `next`, `previous`, `queue.add` |
| `library.read` | `library.liked`, `library.playlists`, `history.recent` |
| `library.modify` | `library.save` |
| `audio.control` | `volume.set`, `volume.fade`, `eq.preset` |
| `storage` | `storage.get`, `storage.set`, `storage.delete`, `storage.keys` |

`search` and `ui.set` need no permission (`ui.set` needs the slot in the manifest). Ask for the fewest permissions
your plugin needs: people see the list before they install it.

## Events

```js
playlish.on('track.changed', (playback) => {
  if (!playback) return; // nothing plays any more
  playlish.log('Now playing: ' + playback.track.name);
});
```

| Event | When | Data |
|---|---|---|
| `track.changed` | A new track starts, or nothing plays any more | `Playback` or `null` |
| `playback.state` | Pause or resume, shuffle, repeat, volume, mute, a seek, or a different context | `Playback` or `null` |
| `device.changed` | Playback moves to another device (or back) | `Playback` or `null` |
| `queue.changed` | The track changed, or something was added to the queue | `null` |
| `ui.action` | A click or change in the plugin's own panel | `{ slot, id, value }` |

There is no event for normal progress; ask with `playback.get` when you need the position. Handlers may be `async`;
an error in one is written to the plugin's log.

`Playback` looks like this:

```js
{
  track: { uri: 'spotify:track:…', name: 'Song', artists: 'Artist A, Artist B' },
  paused: false,
  positionMs: 61000,
  durationMs: 213000,
  device: 'this computer', // or the name of the Spotify device that plays
  shuffle: false,
  repeat: 'off',           // 'off', 'context' or 'track'
  volume: 0.5,             // 0 to 1, or null
  context: 'spotify:playlist:…' // what it plays from, or null
}
```

## Actions

```js
const results = await playlish.call('search', { query: 'daft punk', type: 'track', limit: 5 });
await playlish.call('queue.add', { uri: results[0].uri });
```

| Action | Permission | Arguments | Result |
|---|---|---|---|
| `playback.get` | playback.read | | `Playback` or `null` |
| `play` | playback.control | `{ uris }` (tracks or episodes, up to 50), or `{ contextUri, offset? }` (album, playlist, artist, show), or nothing to resume | `null` |
| `pause`, `next`, `previous` | playback.control | | `null` |
| `queue.add` | playback.control | `{ uri }` (track or episode) | `null` |
| `library.liked` | library.read | `{ offset?, limit? }` (limit 1 to 50) | `{ total, offset, items: Track[] }` |
| `library.playlists` | library.read | `{ offset?, limit? }` | `{ total, offset, items: { uri, name, tracks }[] }` |
| `history.recent` | library.read | `{ limit? }` (1 to 50) | `Track[]` with `playedAt`, newest first |
| `library.save` | library.modify | `{ uris, remove? }` (up to 50) | `null` |
| `search` | none | `{ query, type?, limit? }` (type: track, album, artist, playlist; limit 1 to 20) | `{ uri, name, artists? }[]` |
| `volume.set` | audio.control | `{ value }` (0 to 1) | `null` |
| `volume.fade` | audio.control | | `null` (fade out and pause, or resume and fade in; this computer only) |
| `eq.preset` | audio.control | `{ preset }` (flat, bassBoost, bassCut, vocal, trebleBoost) | `{ status }`: applied, off, not-installed or needs-setup |
| `storage.get` | storage | `{ key }` | the value, or `null` |
| `storage.set` | storage | `{ key, value }` (any JSON value) | `null` |
| `storage.delete` | storage | `{ key }` | `null` |
| `storage.keys` | storage | | `string[]` |
| `ui.set` | none (slot in manifest) | `{ slot, panel }`, `panel: null` removes it | `null` |

`Track` is `{ uri, name, artists: string[], album, durationMs }`.

Every call returns a promise. A refused or failed call rejects it with an `Error` whose message says why, for example
`"library.save" needs the "library.modify" permission` or `Rate limit: at most 60 Spotify calls a minute.` Catch
errors where they can happen:

```js
try {
  await playlish.call('next');
} catch (e) {
  playlish.warn('Could not skip: ' + e.message);
}
```

Spotify calls run at background priority, behind anything you do in Playlish yourself, so they may take a moment when
you are busy in the window.

Playback commands go to whichever device plays: this computer's player when Playlish plays, or the other device
through Spotify.

`eq.preset` keeps your own choice: if the equalizer is off in Settings, the preset is saved and the plugin gets `off`.
It never turns the equalizer on.

### Storage

Each plugin has up to 1 MB of its own storage, kept in Playlish's settings folder and deleted when the plugin is
uninstalled. Keys are 1 to 100 of `A-Z a-z 0-9 . _ : -`. Values are any JSON (`null` is not stored: use
`storage.delete`).

## Panels

A plugin with a `ui` slot in its manifest can show a panel there. Playlish draws it with its own controls: the plugin
describes it, and no plugin code runs in the window. Text is always shown as text, never as HTML.

```js
function draw(count) {
  return playlish.call('ui.set', {
    slot: 'plugins-page',
    panel: {
      title: 'Counter',
      items: [
        { type: 'text', text: 'Clicked ' + count + ' times' },
        { type: 'button', id: 'add', label: 'Add one' },
      ],
    },
  });
}

let count = 0;
playlish.on('ui.action', (action) => {
  if (action.id === 'add') return draw(++count);
});
draw(count);
```

| Item | Fields | `ui.action` value |
|---|---|---|
| `text` | `text`, `style?` (heading, normal, muted) | |
| `list` | `items`: text, or `{ text, detail? }` (up to 100) | |
| `button` | `id`, `label` | none (`null`) |
| `toggle` | `id`, `label`, `value?` | `true` or `false` |
| `slider` | `id`, `label`, `min?`, `max?`, `step?`, `value?` | a number in range, on a step |
| `select` | `id`, `label`, `options` (text, or `{ value, label }`), `value?` | the chosen option's value |

At most 50 items; text up to 500 characters, labels up to 80; ids are 1 to 40 of `A-Z a-z 0-9 _ -` and unique in the
panel. Playlish checks every click and change against the panel it showed before the plugin hears of it, and a
plugin's panels disappear when it is turned off.

After a `ui.action`, call `ui.set` again to show the new state; the panel only changes when the plugin says so.

The `sidebar` slot is narrow (about 160 pixels): keep sidebar panels short. It is hidden in very narrow windows.

## Types in your editor

Start the script with a reference to the SDK types, and editors that understand TypeScript (VS Code does) will check
your calls, arguments and results:

```js
/// <reference path="../../sdk/playlish.d.ts" />
```

In plain JavaScript, literal types widen (`type: 'text'` becomes `string`), so give arrays of panel items a JSDoc
type: `/** @type {Playlish.PanelItem[]} */`. The example plugins are checked this way in this repository
(`npm run typecheck` includes `tsconfig.examples.json`).

## Packing and installing

```bash
npm run plugin:pack -- path/to/my-plugin
```

This writes `path/to/my-plugin.playlish` (or the file given with `--out`). Every file in the folder goes in except
hidden ones, and the package is checked exactly as Playlish checks it at install, so a package that packs also
installs. A package can be at most 5 MB (10 MB unpacked, 200 files), with simple file names only.

Then, in Playlish: Plugins, Install from file, pick the file, and read the prompt before you click Install.

## Debugging

- `playlish.log`, `playlish.warn` and `playlish.error` write to `plugins.log` in Playlish's logs folder, tagged with
  the plugin's id and version. Settings, Export diagnostics includes it.
- A refused permission is written there too.
- If Playlish turns a plugin off, the Plugins page says why. Turn it on again after fixing the cause.

## Updating a plugin

Keep the `id`, raise the `version`, pack it, and install the new file. Updating keeps the plugin's storage and its
on/off state. If the new version asks for more permissions, the prompt marks them as new.
