# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-04

The first release: a lightweight Spotify player for Windows with Now Playing, Library, Search, Queue, Devices, media keys, the tray, and the groundwork for plugins.

### Added

- Windows packaging (`npm run dist`): a per-user installer (no administrator rights; the uninstaller can keep your settings) and a portable zip, built from the castLabs Electron, with Widevine VMP signing of the packaged app before the installer is made.
- Update check: once a day, while the window is open, Playlish asks GitHub for the latest release and shows a banner with a link to it when it is newer. Nothing about you is sent, it only ever links to this project's release pages, and it can be turned off in Settings. Installing stays manual.
- Album art in the Now Playing bar: the smallest image that looks sharp at the bar's size. The main window may now load images from Spotify's image servers (`i.scdn.co`, `mosaic.scdn.co`, `*.spotifycdn.com`) and nothing else.
- CI files an issue for each failed or flaky test on main and in the nightly run (`tools/issues/ci-report.ts`): one issue per failure, a comment when it happens again, reopened with the regression label if it was closed, at most 10 per run. They use the shared redacted issue format and appear as github-actions[bot].
- Plugins page: lists installed plugins (none until the plugin system arrives in 0.3.0) and explains what is coming. Safe mode starts Playlish with every plugin off: from the Plugins page (Restart in safe mode), with `--safe-mode`, or with `PLAYLISH_SAFE_MODE=1`.
- Queue: what plays now and what comes next (up to 20, as Spotify shows), loaded when you open the page and whenever the track changes, never on a timer. Add songs with + from any list.
- Search: songs, albums, artists and playlists as you type (after a short pause), 10 results per kind with More for the next 10 (the API's maximum per page). Play a song (the results after it follow), an artist, an album or a playlist; open albums and playlists; add songs to the queue or Liked Songs.
- Tray: the menu shows what is playing (and on which device) with Play/Pause, Next and Previous, and the tooltip names the track. New options on the Settings page: keep running in the tray when the window is closed (off means closing quits), minimize to the tray, and start in the tray. Starting Playlish again brings the running copy's window back.
- Library: Liked Songs, saved albums and playlists, and the songs of an album or your own playlists. Play from any song (albums and playlists play on from there; liked songs play the songs after it), add to the queue, save to or remove from Liked Songs. Other people's playlists can be played; Spotify no longer lets apps list their songs, and the page says so. Lists load page by page as you scroll and only the visible rows exist in the window, so a 5,000-song library adds about 10 MB once scrolled through.
- Media keys and the Windows media overlay: while Playlish plays, the overlay shows the track, artist, album and art, and its buttons, keyboard media keys and headset buttons control playback (play, pause, next, previous, seek). The smoke test checks the overlay and its pause and play buttons.
- Devices: a Devices page and a device button in the Now Playing bar list your Spotify Connect devices (this computer first, the one playing marked) and move playback to any of them without stopping it, and back. The list loads when you open it or press Refresh, never on a timer. The smoke test now checks moving playback away and back when a second device is online.
- Now Playing bar: track, artists, play/pause, previous, next, seek, shuffle, repeat (off, album or playlist, track), mute and volume, plus the fade button. It also shows and controls music playing on another Spotify device ("Playing on Kitchen speaker"). While Playlish itself plays, everything comes from the player's own events; another device is checked every 5 seconds (30 when paused) only while the window is open and visible, so Playlish in the tray makes no requests. With nothing playing, Play continues where your account left off, on this computer.
- End-to-end tests (`npm run e2e`): Playwright drives the real app against a fake Spotify and a stub of the Web Playback SDK, covering first-run setup, login and restart, main window states, Now Playing controls, the tray, and recovery from a crashed, stalled or failing player (21 tests). CI runs them on every pull request and keeps screenshots, logs and traces of failures. A test-only mode (`PLAYLISH_E2E=1`) points the app at the fake; it is refused in packaged builds and accepts only addresses on 127.0.0.1.
- New main window: a sidebar with Library, Search, Queue, Devices, Settings and Plugins (Alt+1 to Alt+6, visible keyboard focus), a Now Playing bar with progress, controls and volume, and a Settings page with account, sign out, Client ID hint, diagnostics and resource use. Library, Search, Queue, Devices and Plugins are placeholders for now. The window reopens on the last page and where you left it; if that place is no longer on a screen it opens centered. A banner asks you to log in again when new Spotify permissions are needed.
- First-run setup wizard: create your Spotify app with step-by-step instructions and the exact Redirect URI to copy, paste and check the Client ID, log in (with the likely causes shown while waiting, because Spotify's own error pages never return to Playlish, and a Cancel button), and confirm Spotify accepts the account for playback. The Client ID is saved in the settings.
- Typed Spotify client for every endpoint the MVP needs (profile, playback state and commands, devices, transfer, queue, saved tracks and albums, playlists and their items, search, saving to and removing from the library), in the current API shapes, with response shape checks, the request queue and caching. Integration tests against a fake Spotify server with fixtures.
- Shared request queue for every Spotify Web API call: user actions first, then visible pages, then background work; at most two requests at a time; identical requests in flight share one call; a rate limit pauses everything until Retry-After and retries; a used-up quota pauses background work for 10 minutes. Small response cache with expiry and a size cap.
- Sign out button: deletes the stored session and stops the player.
- `tools/audit/scan-profile.ps1` checks a profile folder for secrets stored in plain text (prints only file names and counts).
- Settings store: one validated JSON file (Client ID, close to tray, start minimized, window state, last page, volume per output device), saved atomically and debounced; invalid values fall back to defaults and a corrupt file is kept aside.
- Local smoke test (`npm run smoke`): real login, Widevine playback and audio checked on the Windows audio meter (sound, silence on pause, volume, fades), with a report in `smoke-results/` and optional issue filing after confirmation. Shared issue format and deduplication for automated failure reports.
- Performance harness (`npm run perf:idle`, `perf:ui`, `perf:soak`) that measures the real app against the budgets in `perf/budgets.json`, startup milestones in the log, and an opt-in soak driver (`PLAYLISH_SOAK=1`). CI reports performance on every pull request against main, and the nightly run adds a 30 minute soak.
- Structured logging: JSON lines with level, module, error code and context in `logs/playlish.log`, rotated at 1 MB with 3 files kept. Tokens, Client IDs, emails and the Windows user name are redacted before anything is written. `PLAYLISH_DEBUG=1` turns on debug logging.
- Crash reports in `logs/crashes` for uncaught exceptions, unhandled rejections and crashed renderer or helper processes (newest 10 kept). A crashed playback host is rebuilt automatically.
- A separate `logs/plugins.log` for plugin errors, tagged with plugin id and version.
- "Report an issue" opens a pre-filled GitHub issue with recent redacted logs in your browser to review and submit (no token in the app), and "Export diagnostics" saves a redacted bundle of logs, crash reports and system details. After a crash, the next start offers to report it once.
- Apache-2.0 license and NOTICE file.
- castLabs Electron playback spike: PKCE login over a loopback redirect, Web Playback SDK in a hidden host window, UI window that is destroyed when closed, tray icon, and a RAM/CPU logger.
- Research and architecture proposal (`docs/PROPOSAL.md`) and spike measurements (`docs/SPIKE-RESULTS.md`).
- Issue forms, pull request template, and `CONTRIBUTING.md`.
- Test tooling: Vitest with coverage, ESLint with type-aware rules, `npm run check`, and a fake Spotify server helper for offline tests.
- Unit tests for volume ramps, fades and the playback error limiter (31 tests).
- Unit tests for the Spotify API client: request shape, device-not-found retry, error parsing for the classic and July 2026 quota shapes, and user-facing messages (30 tests).
- Unit tests for the config loader, the loopback server (allowlist, path traversal, callback escaping) and the metrics logger (46 tests).
- Unit tests for PKCE login, callback validation, token exchange and refresh (29 tests).

### Changed

- Performance budgets: a separate budget for the tray after the window has been used (95 MB), checked by the soak test. A fresh tray keeps its 80 MB budget. Chromium keeps about 10 MB once it has drawn a window, and it does not grow.
- Playlish's player now appears as "Playlish" in Spotify's device lists (was "Playlish (spike)").
- Playlish no longer starts a test track by itself when the player is ready; press Play instead. The smoke test still does (`PLAYLISH_SMOKE_AUTOPLAY=1`).
- The main window is built with Preact, bundled by esbuild into one script. Preact is internal to the main window: the playback host and plugins do not depend on it. Styles moved to `ui.css`, so the window's content security policy no longer allows inline styles.
- Playlish now asks for the Spotify permissions the library, playlists and queue need. A login from before this change keeps playing and is asked to log in again once to grant them.
- The refresh token is stored in `refresh-token.bin`, encrypted with Electron's safeStorage (Windows DPAPI) and bound to the Client ID it was issued for; the access token is kept in memory only. The spike's `session.bin` is migrated once and removed only after the new file is verified. A refresh token Spotify rejects is deleted.
- The Spotify API client takes injectable `fetch`, base URL and delay, and the two playback calls share one retry routine.
- `Auth` accepts an injected `fetch` and clock so it can be tested without network access.
- Fading out no longer pauses if you move the volume slider during the fade; your volume change wins.
- Volume ramp, fade and playback-error-burst logic moved into small modules (`src/renderer/fade.ts`, `src/main/error-burst.ts`) so they can be tested.
- TypeScript is pinned to 6.0.x, the newest line supported by `typescript-eslint`.

### Removed

- `spike.config.json` and `spike.config.example.json`. On the first start the spike's `spike.config.json` is imported into the settings and then deleted, only after the Client ID has been written and read back from disk; the import is safe to run any number of times, never overwrites a different Client ID already in the settings, and leaves an invalid file untouched. `PLAYLISH_CLIENT_ID` remains as a developer override.

### Fixed

- Smoke test: moving playback to a Spotify device on the same computer (for example the Spotify app) no longer fails because the same speakers keep playing; it prefers another machine and otherwise checks what Playlish shows.
- Media keys and the Windows media overlay: the overlay showed the track as paused while it played, and its buttons did nothing. Spotify's player now drives them itself from the frame that plays the audio.
- Player commands from the window are checked in the main process; a malformed one (for example a seek to an invalid position) is ignored and logged instead of being sent to Spotify.
- Removing a song from Liked Songs while scrolled down no longer jumps the list back to the top; the songs on screen reload in place.
- The rate limit message no longer promises a retry that never happened: playback now goes through the request queue, which really does retry after Retry-After (#24).
- `npm install` now downloads the castLabs Electron binary (its package has no install script of its own); an existing, signed binary is kept.
- Some launches played no audio even though the player said it was playing (#17). The startup sequence sent a transfer immediately before the play command, which aborted the first audio load. The redundant transfer is gone (17 of 18 launches played afterwards, against 11 of 27 before).
- A malformed `spike.config.json` (a Client ID without quotes, a bad port, an invalid track URI, a file that is not a JSON object) now shows a clear message instead of crashing start-up or being silently accepted, and an empty `PLAYLISH_CLIENT_ID` no longer overrides the file (#28).
- A playback stall watchdog nudges and, if needed, rebuilds the playback host when the position stops advancing while playing.
- Closing an old playback host window can no longer clear the state of a newly created one.

[Unreleased]: https://github.com/engineerlish/Playlish/commits/main
