# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- The Spotify API client takes injectable `fetch`, base URL and delay, and the two playback calls share one retry routine.
- `Auth` accepts an injected `fetch` and clock so it can be tested without network access.
- Fading out no longer pauses if you move the volume slider during the fade; your volume change wins.
- Volume ramp, fade and playback-error-burst logic moved into small modules (`src/renderer/fade.ts`, `src/main/error-burst.ts`) so they can be tested.
- TypeScript is pinned to 6.0.x, the newest line supported by `typescript-eslint`.

### Fixed

- Some launches played no audio even though the player said it was playing (#17). The startup sequence sent a transfer immediately before the play command, which aborted the first audio load. The redundant transfer is gone (17 of 18 launches played afterwards, against 11 of 27 before).
- A playback stall watchdog nudges and, if needed, rebuilds the playback host when the position stops advancing while playing.
- Closing an old playback host window can no longer clear the state of a newly created one.

[Unreleased]: https://github.com/engineerlish/Playlish/commits/main
