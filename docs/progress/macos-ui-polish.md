# Progress: macOS UI polish

Single source of truth for the `feat/macos-ui-polish` effort. The full brief is in
[docs/prompts/2026-10-25-macos-ui-polish.md](../prompts/2026-10-25-macos-ui-polish.md). Update and commit this file after
every completed task.

**Branch:** `feat/macos-ui-polish` · **PR:** https://github.com/engineerlish/Playlish/pull/124 (draft)

## How a run starts (every session, including scheduled restarts)

1. `git status`. If there are uncommitted changes from a cut-off session: run `npm run typecheck && npm test`. If they
   pass, commit them as `chore(wip): ...` and note it in the session log below; if they fail and the fix isn't obvious,
   `git stash` them (not delete) and note the stash name.
2. Read this file, find the first unchecked task, continue at its "next step".
3. After each task: tick it, update "In progress", commit (`docs(progress): ...`) and push.

## Checklist

### 0. Resume system
- [x] Progress file (this file)
- [x] Prompt saved to `docs/prompts/2026-10-25-macos-ui-polish.md`
- [x] Commit attribution off in `.claude/settings.json` (`attribution.commit` and `.pr` empty, `includeCoAuthoredBy: false`; already there)
- [x] Permissions for unattended runs in `.claude/settings.json` (npm, node, npx, git, gh only)
- [ ] Scheduled restart task: definition shown to the owner, **waiting for approval** before registering
- [x] Draft PR opened (#124)

### 1. Builds, launches, plays reliably on Windows
- [x] Smoke run 2026-10-25: build, launch, login, player ready and "Playback starts" pass
- [x] Smoke "Real audio" failed with peak 0: Windows' volume mixer has Playlish (electron.exe) muted at volume 0. Not
      set by Playlish (it never writes the mixer). Make the smoke test say so instead of just "peak 0"; the owner unmutes
      it and reruns `npm run smoke`.
- [ ] Owner smoke rerun passes all steps (needs the owner)

### 2. Design tokens and macOS/iOS style
- [x] Tokens in one place (top of `src/renderer/ui.css`): colors, radii, spacing, type, shadows, materials, motion; light and dark
- [x] Accent color setting (Settings, persisted, applied as `--accent`); default not Apple Music red
- [x] Font stack: -apple-system, then Inter (bundled, OFL, Latin subsets), Segoe UI Variable, system-ui. No SF fonts bundled.
- [x] Icons: one open set (Lucide shapes, ISC) inline, stroke style
- [x] Window: unified title bar/toolbar area, Mica/acrylic sidebar material with solid fallback, hairline separators
- [x] Controls: pill buttons, segmented control (library tabs), toggles (settings checkboxes), sheets/popovers, pressed/hover
- [x] Motion 150–250ms ease-out, off under `prefers-reduced-motion`
- [x] Every screen restyled: setup wizard, library (+ album/playlist detail), search, queue, devices, settings, plugins, player bar, banners, popovers

### 3. Polish standard
- [x] Ellipsis + full-text tooltip on every long text (titles, artists, playlists, devices, plugin names)
- [x] 32px minimum hit targets, aligned icons, visible focus
- [x] Designed loading, empty and error states on every page
- [x] Missing art, very long queues, zero-result search render cleanly
- [x] Automated overflow check (Playwright): every main screen at several sizes, stress data (200-char, non-Latin, emoji, no art), light and dark; in CI
- [x] Sizes from the minimum (360x360) to 4K, and scale factors 100/125/150/200%

### 4. Plugins
- [x] Plugin panels use the tokens (sidebar and page panels)

### 5. Measure and finish
- [x] Idle memory before (main) and after, in the PR (idle unchanged; UI open +2 MB, within run-to-run noise)
- [ ] CI green
- [x] Issues filed for out-of-scope bugs (linked below)
- [ ] Scheduled task deleted, PR marked ready for review

## In progress

Task 5: CI green on #124. Blocked: the dependency audit fails on every branch since 2026-10-22 (Electron advisories);
#126 (castLabs Electron 44.9.3) fixes it and waits for the owner. Next step: once #126 is merged, sync this branch with
main, rerun CI, then mark #124 ready for review.

Baseline on main (2026-10-25, this machine, 2 runs): idle tray 78.2 / 78.3 MB, UI open 120.8 / 122.6 MB.

## Decisions

- 2026-10-25: There is no artist page or full-screen Now Playing view today; the brief's "every screen" is read as the
  screens that exist (the player bar is the now-playing surface, album/playlist detail covers "album" and "playlists").
  New screens are features, not polish: a `needs-decision` issue asks the owner.
- 2026-10-25: Tokens live at the top of `ui.css` (one file, no extra request) rather than a separate tokens.css.
- 2026-10-25: Inter is bundled (Latin + Latin Extended, ~130 KB) because the brief asks for Inter on Windows and it
  is rarely installed; other scripts use the system fonts.
- 2026-10-25: Default accent is blue (#0062cc fill; lighter text shade in dark mode). All accents were chosen to meet
  WCAG AA with white text and as text on the page, so the axe checks keep passing.
- 2026-10-25: Mica is on only on Windows 11 build 22621+ and never in test mode (axe and screenshots need solid colours).
- 2026-10-25: Sizes and scaling in the layout check are emulated (DevTools device metrics), not real window resizes,
  so they don't depend on the runner's screen size.
- 2026-10-25: Below 480px wide the page tabs show icons only (labels stay for screen readers and tooltips).
- 2026-10-25: Icons are hand-copied Lucide paths (ISC licence, noted in NOTICE) rather than the `lucide` package, to
  keep dependencies few (CLAUDE.md).

## Known issues

- Idle memory on CI sits at 82–83 MB against the 80 MB budget since 2026-10-10 (report-only, unexplained; see #120 notes).
- PR #120 (plugin limits) is waiting for owner approval; unrelated to this work.

## Issues filed

- #126 PR: castLabs Electron 44.9.3 (fixes the failing audit; needs owner approval and a smoke run)
- #125 Artist page and full-size Now Playing view (`needs-decision`, `ui`)

## Session log

### 2026-10-25, session 1
- Done: resume system, smoke diagnosis (Windows mixer mute) and smoke hint, design tokens, Inter + Lucide, unified
  title bar with Mica, accent setting, every screen restyled, states and tooltips, layout check (sizes x scales,
  stress data) in CI, memory A/B (3 rounds), #125 filed, #126 opened.
- Next: see "In progress".
- Needs the owner: approve the scheduled task; unmute Playlish in the Windows volume mixer and rerun `npm run smoke`.
