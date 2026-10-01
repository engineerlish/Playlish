# Playlish: working rules

Playlish is a lightweight, open-source Spotify desktop client for Windows with a sandboxed plugin system. It uses only Spotify's official APIs (Web API and Web Playback SDK). It is unofficial and not affiliated with Spotify.

Repository: https://github.com/engineerlish/Playlish

## Project context

- Chosen architecture: **concept B, castLabs Electron** (Widevine-capable fork). See `docs/PROPOSAL.md` for the research and the rejected alternatives.
- Priorities, in order: stability, low resource use, plugin extensibility without letting plugins hurt the client, official-API playback with the best audio control the platform allows.
- Resource budgets live in `docs/PROPOSAL.md` section 2. Current measurements are in `docs/SPIKE-RESULTS.md`.
- Spotify API facts must come from developer.spotify.com changelogs, not memory or old tutorials.
- Protected Spotify audio is never routed through Web Audio or captured, and nothing may alter Spotify audio or sync it with visual media. EQ is system-level only (Equalizer APO).
- Tokens live in Windows Credential Manager and are never exposed to plugins. Each user supplies their own Client ID (PKCE, no client secret anywhere).

## Code conventions

- TypeScript for everything web-facing. Keep dependencies few and justify any dependency over a modest size.
- The Spotify API client stays isolated in its own module with typed responses.
- Every function gets a short comment. Hardcoded values that someone may want to change are marked `CHANGE HERE`.
- When asked for code, give full, complete files, not snippets.
- Never commit secrets, tokens, Client IDs, credentials, `.env` files, build output, logs containing user data, or `node_modules` / `target` folders.

## Git workflow

### Identity and attribution

- All GitHub and Git activity is done only as the repository owner, **engineerlish**. This includes commits, pushes, branches, pull requests, PR comments, reviews, issues, issue comments, labels, milestones, releases, and tags.
- Never add Claude, Anthropic, or any AI as an author, co-author, committer, reviewer, or participant.
- Never add `Co-Authored-By` trailers of any kind to commits.
- Never add "Generated with Claude Code", AI attribution lines, robot emoji, or links to Claude or Anthropic in commit messages, PR descriptions, issue bodies, comments, release notes, or the changelog.
- Write all commit messages, PRs, issues, and comments in a natural, professional voice, as if the owner wrote them.
- Commit using the repository's existing Git identity (`git config user.name` and `user.email`). Never change, override, or set a different author or committer identity.
- Use only the authenticated GitHub CLI session for GitHub actions. Never create or use bot accounts, GitHub Apps, separate tokens, or service accounts.
- Automated issues and PR comments created by GitHub Actions workflows must use the workflow's `GITHUB_TOKEN` or a token from the owner's account that the owner set up as a repository secret. Ask before setting this up, and never use a Claude or bot identity for it.

### Setup

- Remote `origin` is the repository above. Use the GitHub CLI (`gh`) for pull requests, issues, labels, milestones, and releases. If it is not installed or authenticated, stop and tell the owner what to run.
- Keep a `.gitignore` in place (see the code conventions for what is never committed).
- `main` is protected: all work goes through branches and pull requests, never direct commits to `main`.

### Branching

- One branch per unit of work, named by type and purpose:
  - `feat/<short-description>` for new features
  - `fix/<issue-number>-<short-description>` for bug fixes
  - `test/<short-description>` for test suites and test infrastructure
  - `docs/`, `refactor/`, `perf/`, `chore/`, `ci/`, `spike/` followed by `<short-description>`
- Keep branches focused on one thing. If work grows into something separate, start a new branch.
- Always branch from an up-to-date `main`.

### Commits

- Conventional Commits: `type(scope): short summary` in the imperative mood, under 72 characters. Examples: `feat(auth): add PKCE login flow`, `fix(player): handle expired token on resume`, `test(plugins): add sandbox crash isolation tests`.
- Add a body when the change is not obvious, explaining what changed and why.
- Commit small, logical, working units of change often. Each commit should build and pass tests.
- Never make empty, filler, or cosmetic-only commits just to show activity.
- Push the branch after each meaningful commit.

### Pull requests

- Open a draft pull request as soon as the branch has its first commit.
- The PR title follows the Conventional Commits format.
- The description includes: summary, what changed, how it was tested (automated tests added or updated, and manual checks), measured RAM/CPU impact when relevant, screenshots when the UI changed, and follow-up work.
- Link related issues with `Closes #<number>`.
- All CI checks must pass before merging. Mark the PR ready for review when complete and tested.
- Squash merge, then delete the branch.
- Ask the owner before merging anything that changes architecture, the plugin API, authentication, or security. Smaller, well-tested changes can be merged once the owner has approved the plan for that stage.

### Issues and project tracking

- Create issues for each planned feature, build stage, bug, test gap, and follow-up task, with clear titles and descriptions.
- Type labels: `feature`, `bug`, `crash`, `regression`, `test-failure`, `flaky-test`, `performance`, `memory-leak`, `audio`, `plugin-system`, `security`, `docs`, `spike`, `needs-triage`, `good first issue`.
- Severity labels: `severity:critical` (crash, data loss, security), `severity:high` (core feature broken), `severity:medium` (degraded, workaround exists), `severity:low` (minor or cosmetic).
- Area labels match the code modules: `area:auth`, `area:player`, `area:library`, `area:audio`, `area:plugins`, `area:ui`, `area:api-client`.
- Milestones match the build stages, including a Testing milestone.
- Reference issue numbers in commits and PRs, close issues through merged PRs, and comment on issues with progress when work spans multiple sessions.

### Releases

- Semantic versioning starting at 0.1.0. Keep `CHANGELOG.md` in Keep a Changelog format, updated in each PR.
- Tag and publish a GitHub release with notes at the end of each milestone, attaching the Windows installer when one exists.
- Before any release, all tests must pass and there must be no open `severity:critical` or `severity:high` issues in that milestone.

### Repo presentation

- Keep the README current as features land.
- Keep `CONTRIBUTING.md` current with the branch, commit, PR, and testing rules for outside contributors: fork the repo, open pull requests from the fork, and every PR needs tests.
- Keep PR and issue templates in `.github`: bug report, crash report, test failure, performance issue, feature request, plugin submission.
- Keep a `LICENSE` file. Ask the owner which license if one has not been chosen.

## Testing and issue tracking

### Automated test layers

- Unit tests: Spotify API client, PKCE and token refresh, rate and quota handling (including 429 with reason `QUOTA_EXCEEDED`), queue logic, volume ramps and fades, settings, Equalizer APO config read/write, plugin manifest parsing and validation, permission checks.
- Integration tests against a mocked Spotify API using recorded fixtures with the current (post-February 2026) response shapes. They run offline and never touch real accounts. Cover expired tokens, non-Premium accounts, 401, 403, 404, 429, 5xx, network loss, and malformed responses.
- Plugin system tests: sandbox isolation (a plugin that throws, loops forever, leaks memory, or floods the API must not crash or slow the client), permission enforcement, the shared API queue, auto-disable of misbehaving plugins, safe mode, install/update/uninstall, API version mismatches, malicious manifests.
- End-to-end UI tests that drive the real desktop app: first-run setup, mocked login, navigation, search, library, queue, Now Playing controls, audio settings, plugin manager, tray behavior, recovery after errors.
- Performance and memory tests against the RAM, CPU and startup budgets, including a soak test that fails if memory keeps growing. Track results over time.
- Equalizer APO integration tests use a temporary fake config directory and never touch the real system EQ.
- Static checks: type checking, linting, dependency vulnerability scanning.

### What cannot run in CI

Real Widevine playback, real Spotify accounts, real audio output, and Equalizer APO on the system cannot run in GitHub Actions and must never be attempted with stored credentials. A local smoke test script (run by the owner) covers real login, playback, device transfer, media keys, output device switching and EQ preset switching. It writes a structured report and can file issues in the same format as CI, after showing what it will file.

### CI pipeline (GitHub Actions)

- Every pull request: type check, lint, unit, integration, plugin system and E2E tests, plus a build. Post a summary comment with pass/fail counts, coverage change, and performance numbers compared to `main`.
- Every push to `main`: the full suite plus performance checks.
- Nightly: the full suite, the soak test, and dependency vulnerability scanning.
- Upload reports, screenshots, videos and logs from failed E2E runs as artifacts.
- Retry a failed test once to detect flakiness. If it passes on retry, label the issue `flaky-test` instead of `test-failure`.
- Coverage reports on every run. Set a minimum threshold for core modules once the baseline is measured, and never let it drop.

### Automatic issue creation

- A test that fails on `main` or in a nightly run creates or updates an issue, deduplicated by a fingerprint (test name plus error type and location). If an open issue matches, comment with the new occurrence. If a closed issue matches, reopen it and label it `regression`.
- Title format: `[test-failure] <suite>: <test name>` or `[crash] <area>: <error summary>`.
- Body: what failed, error and stack trace, commit SHA, branch, run link, environment (OS, app version, runtime version), steps to reproduce, the last relevant log lines, artifact links, first seen, last seen, and occurrence count.
- Apply type, area, a best-guess severity, and `needs-triage` labels automatically.
- Never include tokens, Client IDs, account emails, or other personal data. Redact before posting.
- Failures on pull request branches are reported in the PR, not as new issues.

### In-app error logging

- Structured logging with levels (error, warn, info, debug); each entry has timestamp, module, error code and context.
- Log rotation with a size cap. Redact tokens, Client IDs, emails and other personal data at the logger level, before anything is written.
- Catch unhandled exceptions and promise rejections in every process and write a crash report file.
- Track plugin errors separately, tagged with plugin id and version.
- "Report an issue" builds a pre-filled GitHub issue (error details, recent redacted logs, app version, environment) and opens it in the browser for the user to review and submit. No GitHub token is embedded in the app.
- "Export diagnostics" bundles redacted logs and system info into one file.

### Turning issues into fixes

For every bug, crash, regression, or test failure issue:

1. Reproduce it and write a failing test that captures the bug first.
2. Fix it on a `fix/<issue-number>-<short-description>` branch.
3. Confirm the new test passes and nothing else broke.
4. Open a PR with `Closes #<number>` explaining the root cause and the fix.
5. Keep the regression test permanently.

Work issues in severity order: critical, high, regressions, then the rest. Ask the owner before starting any issue that needs an architectural change.

### Ongoing

At the end of each work session, make sure everything is committed and pushed and open PRs are updated, then give a short status: tests added, pass rate, coverage, performance against the budgets, issues opened, issues fixed, and what is next.
