# Example plugins

Three plugins that show what the Playlish plugin API can do, and a template to start from. The plugin guide is
[docs/PLUGINS.md](../docs/PLUGINS.md).

| Folder | What it does | Permissions |
|---|---|---|
| [listening-stats](listening-stats) | Your top artists and tracks from the songs you played recently, below the sidebar | library.read, playback.read |
| [smart-shuffle](smart-shuffle) | Queues a mix from your liked songs: no songs from your last mixes, and never two songs by the same artist in a row | library.read, playback.control, storage |
| [eq-by-playlist](eq-by-playlist) | Switches the equalizer preset when music plays from a playlist you chose (needs Equalizer APO, Settings, Audio) | playback.read, library.read, audio.control, storage |
| [template](template) | Counts the tracks you play, with a reset button: a starting point | playback.read, storage |

To try one:

```bash
npm run plugin:pack -- examples/listening-stats
```

Then in Playlish: Plugins, Install from file, and pick `examples/listening-stats.playlish`.

Listening stats reads your listening history, which needs a Spotify permission Playlish asks for since 0.3.0. If you
logged in before, Playlish asks you to log in once more.
