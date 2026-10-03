# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- The rate limit message no longer promises a retry that never happened: playback now goes through the request queue, which really does retry after Retry-After (#24).
- `npm install` now downloads the castLabs Electron binary (its package has no install script of its own); an existing, signed binary is kept.
- Some launches played no audio even though the player said it was playing (#17). The startup sequence sent a transfer immediately before the play command, which aborted the first audio load. The redundant transfer is gone (17 of 18 launches played afterwards, against 11 of 27 before).
- A malformed `spike.config.json` (a Client ID without quotes, a bad port, an invalid track URI, a file that is not a JSON object) now shows a clear message instead of crashing start-up or being silently accepted, and an empty `PLAYLISH_CLIENT_ID` no longer overrides the file (#28).
- A playback stall watchdog nudges and, if needed, rebuilds the playback host when the position stops advancing while playing.
- Closing an old playback host window can no longer clear the state of a newly created one.

[Unreleased]: https://github.com/engineerlish/Playlish/commits/main
