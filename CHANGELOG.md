# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- castLabs Electron playback spike: PKCE login over a loopback redirect, Web Playback SDK in a hidden host window, UI window that is destroyed when closed, tray icon, and a RAM/CPU logger.
- Research and architecture proposal (`docs/PROPOSAL.md`) and spike measurements (`docs/SPIKE-RESULTS.md`).
- Issue forms, pull request template, and `CONTRIBUTING.md`.
- Test tooling: Vitest with coverage, ESLint with type-aware rules, `npm run check`, and a fake Spotify server helper for offline tests.

### Changed

- TypeScript is pinned to 6.0.x, the newest line supported by `typescript-eslint`.

[Unreleased]: https://github.com/engineerlish/Playlish/commits/main
