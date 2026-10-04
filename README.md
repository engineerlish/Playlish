# Playlish

A lightweight desktop player for Spotify on Windows. Unofficial; not affiliated with Spotify.

Playlish plays your Spotify music through Spotify's own official Web Playback SDK and Web API, with your own free Spotify developer app. It aims to be small and steady: it sits in the tray at about 75 MB of memory and does nothing while idle.

> Status: 0.1.0 in development. Everything below works from source; there is no installer yet.

## What it does

- **Now Playing bar**: track, artists, play/pause, previous, next, seek, shuffle, repeat, mute, volume, and a fade button that pauses and resumes with a smooth volume ramp.
- **Library**: Liked Songs, saved albums and playlists, and their songs. Play from any song, add to the queue, save or remove. Long lists stay fast and light: only the visible rows are drawn and loaded.
- **Search**: songs, albums, artists and playlists, 10 at a time with More.
- **Queue**: what plays now and next.
- **Devices**: see your Spotify Connect devices and move playback between them and this computer without stopping it. When music plays on another device, Playlish shows it and controls it.
- **Windows integration**: media keys and the Windows media overlay; a tray menu with what's playing and the controls; close or minimize to the tray; start in the tray.
- **Plugins page and safe mode**: the plugin system comes in 0.3.0. Safe mode (start with all plugins off) is already there.

## Requirements

- Windows 10 or 11.
- **Spotify Premium** (the Web Playback SDK only plays for Premium accounts).
- Your own Spotify app (free, takes a few minutes; the first-run wizard walks you through it). In Spotify's Development Mode an app works for up to 5 accounts, and its owner needs Premium.

## Getting started (from source)

1. Install [Node.js 24](https://nodejs.org/) and Git.
2. Clone and install:
   ```powershell
   git clone https://github.com/engineerlish/Playlish.git
   cd Playlish
   npm ci
   ```
3. Sign the development Electron build for Widevine (once, and again after Electron updates). See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#2-create-a-castlabs-evs-account-and-sign-the-dev-electron-once-this-step-needs-you).
4. Start it:
   ```powershell
   npm start
   ```
5. Follow the setup wizard: create your Spotify app, add the Redirect URI it shows (`http://127.0.0.1:43821/callback`), paste your Client ID, and log in.

Press Play to continue where your account left off, or pick something from the Library or Search.

## Privacy and security

- Login uses Spotify's PKCE flow; no client secret exists anywhere. Your Client ID stays in Playlish's settings on your computer.
- Only the refresh token is stored, encrypted with Windows' own protection for your account (DPAPI through Electron's safeStorage). The access token stays in memory.
- Playlish talks only to Spotify. There is no telemetry. Logs stay on your computer, and tokens, Client IDs and email addresses are removed before anything is written.
- "Report an issue" and "Export diagnostics" (Settings) open or save a redacted report that you can read before sharing.
- The window's content security policy allows no remote scripts; plugins (0.3.0) will run sandboxed and never see your login.

## Troubleshooting

- **Playback does not start, or Spotify refuses the licence**: the development Electron build must be VMP-signed; see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- **"Premium is required"**: the Web Playback SDK plays only for Premium accounts.
- **Login fails in the browser**: the Redirect URI in your Spotify app must be exactly `http://127.0.0.1:43821/callback`.
- **Something is broken by a plugin** (from 0.3.0): Settings → Plugins → Restart in safe mode, or start with `--safe-mode`.
- Still stuck: Settings → Report an issue.

## Performance budgets

Checked on every pull request and nightly (see `perf/budgets.json`): idle tray at most 80 MB (95 MB once the window has been used) and 0.1% CPU, window open at most 150 MB, usable window within 2.5 s, and no memory growth over a 30-minute soak.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and tests, and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for signing, running and measuring. Research and architecture: [docs/PROPOSAL.md](docs/PROPOSAL.md).

## License

[Apache-2.0](LICENSE). Spotify is a trademark of Spotify AB; Playlish is not affiliated with or endorsed by Spotify.
