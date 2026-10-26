# Progress: macOS UI polish

Single source of truth for the `feat/macos-ui-polish` effort. The full brief is in
[docs/prompts/2026-10-25-macos-ui-polish.md](../prompts/2026-10-25-macos-ui-polish.md). Update and commit this file after
every completed task.

**Branch:** `feat/macos-ui-polish` · **PR:** (draft, link below once opened)

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
- [ ] Permissions for unattended runs in `.claude/settings.json` (npm, node, npx, git, gh only)
- [ ] Scheduled restart task: definition shown to the owner, **waiting for approval** before registering
- [ ] Draft PR opened

### 1. Builds, launches, plays reliably on Windows
- [x] Smoke run 2026-10-25: build, launch, login, player ready and "Playback starts" pass
- [ ] Smoke "Real audio" failed with peak 0: Windows' volume mixer has Playlish (electron.exe) muted at volume 0. Not
      set by Playlish (it never writes the mixer). Make the smoke test say so instead of just "peak 0"; the owner unmutes
      it and reruns `npm run smoke`.
- [ ] Owner smoke rerun passes all steps (needs the owner)

### 2. Design tokens and macOS/iOS style
- [ ] Tokens in one place (`src/renderer/tokens.css`): colors, radii, spacing, type, shadows, materials, motion; light and dark
- [ ] Accent color setting (Settings, persisted, applied as `--accent`); default not Apple Music red
- [ ] Font stack: -apple-system / system-ui, then Inter (if installed), Segoe UI Variable, sans-serif. No SF fonts bundled.
- [ ] Icons: one open set (Lucide shapes, ISC) inline, stroke style
- [ ] Window: unified title bar/toolbar area, Mica/acrylic sidebar material with solid fallback, hairline separators
- [ ] Controls: pill buttons, segmented control (library tabs), toggles (settings checkboxes), sheets/popovers, pressed/hover
- [ ] Motion 150–250ms ease-out, off under `prefers-reduced-motion`
- [ ] Every screen restyled: setup wizard, library (+ album/playlist detail), search, queue, devices, settings, plugins, player bar, banners, popovers

### 3. Polish standard
- [ ] Ellipsis + full-text tooltip on every long text (titles, artists, playlists, devices, plugin names)
- [ ] 32px minimum hit targets, aligned icons, visible focus
- [ ] Designed loading, empty and error states on every page
- [ ] Missing art, very long queues, zero-result search render cleanly
- [ ] Automated overflow check (Playwright): every main screen at several sizes, stress data (200-char, non-Latin, emoji, no art), light and dark; in CI
- [ ] Sizes from the minimum (360x360) to 4K, and scale factors 100/125/150/200%

### 4. Plugins
- [ ] Plugin panels use the tokens (sidebar and page panels)

### 5. Measure and finish
- [ ] Idle memory before (main) and after, in the PR
- [ ] CI green
- [ ] Issues filed for out-of-scope bugs (linked below)
- [ ] Scheduled task deleted, PR marked ready for review

## In progress

Task 0: permissions, scheduled-task proposal, draft PR. Next step: add the permission allowlist, commit, push, open the draft PR.

## Decisions

- 2026-10-25: There is no artist page or full-screen Now Playing view today; the brief's "every screen" is read as the
  screens that exist (the player bar is the now-playing surface, album/playlist detail covers "album" and "playlists").
  New screens are features, not polish: a `needs-decision` issue asks the owner.
- 2026-10-25: Icons are hand-copied Lucide paths (ISC licence, noted in NOTICE) rather than the `lucide` package, to
  keep dependencies few (CLAUDE.md).

## Known issues

- Idle memory on CI sits at 82–83 MB against the 80 MB budget since 2026-10-10 (report-only, unexplained; see #120 notes).
- PR #120 (plugin limits) is waiting for owner approval; unrelated to this work.

## Issues filed

(none yet)

## Session log

### 2026-10-25, session 1
- Done: resume system files, branch.
- Next: see "In progress".
- Needs the owner: approve the scheduled task; unmute Playlish in the Windows volume mixer and rerun `npm run smoke`.
