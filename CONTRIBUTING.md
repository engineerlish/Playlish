# Contributing to Playlish

Thanks for helping out. Playlish is an unofficial, open-source Spotify client for Windows and is not affiliated with Spotify.

## Ground rules

- Use only Spotify's official APIs (Web API and Web Playback SDK). Pull requests that use librespot, reverse-engineered endpoints, or anything outside Spotify's Developer Terms will not be accepted.
- Nothing may capture, process, or alter Spotify audio, or sync it with visual media.
- Never commit secrets, tokens, Client IDs, credentials, or personal data.

## License

Playlish is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution you agree that it is licensed under the same terms (Apache-2.0, section 5), unless you state otherwise in the pull request.

## How to contribute

1. **Fork** the repository and clone your fork. Open pull requests from your fork, not from branches on this repo.
2. Create a branch from an up-to-date `main`, named by type and purpose:
   `feat/…`, `fix/<issue-number>-…`, `test/…`, `docs/…`, `refactor/…`, `perf/…`, `chore/…`, `ci/…`, or `spike/…`.
3. Keep each branch focused on one thing.
4. Make small, logical commits that build and pass tests.
5. Open a pull request against `main`. A draft is fine while you are working.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): short summary`, in the imperative mood and under 72 characters. Add a body when the change is not obvious.

Examples: `feat(auth): add PKCE login flow`, `fix(player): handle expired token on resume`, `test(plugins): add sandbox crash isolation tests`.

## Pull requests

- The title follows the Conventional Commits format.
- Fill in the template: summary, what changed, how it was tested, performance impact, screenshots for UI changes, and follow-up work.
- Link the issue with `Closes #<number>`.
- **Every pull request needs tests.** Bug fixes need a regression test that fails without the fix.
- CI must pass. Pull requests are squash-merged.
- Changes to architecture, the plugin API, authentication, or security are discussed in an issue first.

## Reporting problems

Use the issue templates: bug report, crash report, test failure, performance issue, feature request, or plugin submission. Please redact tokens, your Client ID, and your email address. The app's "Export diagnostics" option produces a redacted bundle. Report security problems privately through the repository's security advisory form.

## Development

```powershell
npm install
npm run build
npm start
```

`npm install` also downloads the castLabs Electron binary (its package has no install script of its own, so the root `postinstall` runs it). It skips the download when the binary is already there, so a VMP-signed binary is kept.

Checks to run before opening a pull request:

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks the main process, renderer, tests, tools and the example plugins (against `sdk/playlish.d.ts`) |
| `npm run lint` | ESLint with type-aware rules |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:coverage` | Same, with a coverage report in `coverage/` |
| `npm run audit:deps` | Dependency vulnerability check |
| `npm run check` | Typecheck, lint and tests together |
| `npm run e2e` | Builds, then runs the end-to-end suite (Playwright driving the real app) |
| `npm run perf:idle`, `perf:ui`, `perf:soak` | Measures the real app against `perf/budgets.json` (Windows); `node tools/perf/run.ts --plugins` runs with the example plugins on |
| `npm run smoke` | Real login, playback and audio on your machine (needs your Spotify account; never run in CI) |
| `npm run plugin:pack -- <folder>` | Packs a plugin folder into a `.playlish` file, checked as Playlish checks it at install |

Tests live in `tests/`. Spotify is never called from tests: use the fake server in `tests/helpers/fake-spotify.ts`. End-to-end tests live in `tests/e2e/`: they start the built app in test mode (`PLAYLISH_E2E=1`, unpackaged builds only, loopback addresses only) against the fake server, with a stub of the Web Playback SDK (`tests/e2e/fixtures/spotify-player.js`), so they need no Spotify account, no Premium and no Widevine. When one fails, its screenshot, app log and Playwright trace are in `e2e-results/` (and in the CI artifacts). Add a line to `CHANGELOG.md` under "Unreleased" for every user-visible change.

Playback needs a Spotify Premium account, your own Client ID from the Spotify Developer Dashboard, and a VMP-signed castLabs Electron build. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the setup steps.

## Plugins

The plugin guide is [docs/PLUGINS.md](docs/PLUGINS.md): the sandbox and its limits, the manifest, permissions, events, actions, panels and packing. The types are in [sdk/playlish.d.ts](sdk/playlish.d.ts), and [examples/](examples) has three example plugins and a template to start from.

Changes to the plugin API or its permissions need an issue first (see above): plugins run code from other people, so every action is checked against the permissions the user approved, and new actions need tests for that check.

To share a plugin, open a plugin submission issue.
