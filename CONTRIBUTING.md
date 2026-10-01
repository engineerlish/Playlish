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

Checks to run before opening a pull request:

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks the main process, renderer and tests |
| `npm run lint` | ESLint with type-aware rules |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:coverage` | Same, with a coverage report in `coverage/` |
| `npm run audit:deps` | Dependency vulnerability check |
| `npm run check` | Typecheck, lint and tests together |

Tests live in `tests/`. Spotify is never called from tests: use the fake server in `tests/helpers/fake-spotify.ts`. Add a line to `CHANGELOG.md` under "Unreleased" for every user-visible change.

Playback needs a Spotify Premium account, your own Client ID from the Spotify Developer Dashboard, and a VMP-signed castLabs Electron build. See `README-SPIKE.md` for the current setup steps.

## Plugins

Plugin development docs will live in `docs/` once the plugin API lands. To share a plugin, open a plugin submission issue.
