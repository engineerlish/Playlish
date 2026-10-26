# Prompt: macOS UI polish (2026-10-25)

The owner's full instructions for the `feat/macos-ui-polish` effort, saved so every session (including the scheduled
restarts) reads the same brief. Progress lives in `docs/progress/macos-ui-polish.md`.

---

<context>
Playlish (repo: github.com/engineerlish/Playlish) is my lightweight, customizable Spotify desktop client, meant to replace the official Spotify app with a sturdy, low-memory base plus a plugin system people can write and share. A lot of it is built and it's in its testing phase. The goal now is to get it finished: running reliably with a polished macOS/iOS-style UI.

Read the repo's CLAUDE.md, README and docs first, then the codebase, so you know the stack, structure and what's done. If CLAUDE.md doesn't exist, create one in this session that captures what you learn plus the git rules below.
</context>

<git_rules>
All GitHub activity must be mine alone, because this is a public, actively watched repo.
- Every commit is authored by my existing git identity. Before the first commit, check `git config user.name` and `git config user.email` belong to engineerlish; if not, stop and tell me. Never set or change git identity yourself.
- No Claude attribution anywhere: no "Co-Authored-By: Claude" trailers and no "Generated with Claude Code" lines in commits, PRs, issues, tags or release notes. Disable Claude Code's commit attribution in `.claude/settings.json` using the setting your installed version documents, and verify each commit with `git log -1 --format='%an <%ae>%n%B'` before pushing.
- Professional workflow: branch `feat/macos-ui-polish`, small Conventional Commits, push often, open a draft PR early and keep its description updated as a progress log. Mark it ready for review only when everything is done.
</git_rules>

<goal>
1. The app builds, launches and plays music reliably on Windows (my machine). Fix anything blocking that first, before any UI work.
2. A macOS/iOS-inspired design: the feel of a native macOS app, not a copy of Apple Music's layout or styling.
3. Every screen and control is polished: no cutoffs, overflow, misalignment or visual bugs at any supported size.
</goal>

<design_direction>
- macOS window feel: a unified toolbar and title bar area, a translucent sidebar using a frosted/vibrancy-style material (with a solid fallback where the platform or performance doesn't support it), hairline separators, generous but precise spacing
- Typography: the system font stack (-apple-system / SF on Apple platforms), falling back to Inter on Windows. Don't bundle SF Pro or SF Symbols; their licenses restrict them to Apple platforms. Use a consistent open icon set (e.g. Lucide) styled to match.
- iOS-style controls: pill and segmented controls, smooth toggles, rounded rectangles (~10–12px radius on cards, smaller on controls), clear pressed and hover states, sheets and popovers instead of hard modals
- Light and dark modes that both look intentional, with an accent color I can change in settings (pick a default that isn't Apple Music's red)
- Subtle, quick motion (150–250ms, ease-out) that respects reduced-motion settings
- Keep it lightweight: CSS and native-ish effects over heavy animation libraries, and no measurable regression in memory or CPU. Record idle memory before and after in the PR.

Put the design tokens (colors, radii, spacing, typography, shadows, materials) in one place, and make sure existing plugin UI surfaces inherit them so plugins don't look out of place.
</design_direction>

<polish_standard>
"Polished" means all of these hold on every screen (now playing, player bar, library, playlists, search, album, artist, queue, settings, plugin manager, any dialogs):
- No clipped or overflowing text. Long titles, artist names and playlist names truncate with an ellipsis and show the full text in a tooltip.
- Nothing overlaps, jitters or shifts layout during playback, loading or hover
- Buttons have consistent sizes, hit targets of at least 32px, aligned icons and labels, and visible keyboard focus
- Loading, empty and error states exist and look designed (no blank panels or raw error text)
- Missing album art, very long queues, and zero-result searches all render cleanly

Check it systematically, not by eye alone:
- Test window sizes from the app's minimum up to 4K, plus Windows display scaling at 100%, 125%, 150% and 200%
- If the UI is web-based, add an automated check (e.g. Playwright) that screenshots each main screen at several sizes and flags elements whose content overflows their box unintentionally, and run it in CI
- Use stress data: 200-character titles, non-Latin scripts, emoji, missing images
</polish_standard>

<resume_system>
This work will run over multiple sessions because usage limits will cut sessions off without warning. Set this up FIRST, before any other work:

1. Create `docs/progress/macos-ui-polish.md` as the single source of truth: a checklist of every task in this prompt, what's done, what's in progress (with exact file and next step), known issues, and decisions made. Update it and commit it after every completed task, so a cut-off loses at most one task's work.
2. Save this prompt to `docs/prompts/2026-10-25-macos-ui-polish.md` so future sessions read the full instructions.
3. Create a scheduled task that restarts this work automatically:
   - If your environment offers Claude Code's own scheduled tasks, use that. Otherwise create a Windows Task Scheduler task that runs every 5 hours and launches Claude Code headless in the repo folder with a prompt like: "Read docs/prompts/2026-10-25-macos-ui-polish.md and docs/progress/macos-ui-polish.md, then continue the work from where the progress file says it stopped."
   - Show me the exact command or task definition you're creating and wait for my approval before registering it.
   - For unattended runs, allow only the commands this work needs (package manager, build, test, git, gh) in the project's `.claude/settings.json` permissions. Never use a flag that skips all permission checks.
   - Each run first checks for leftover uncommitted changes from a cut-off session and either commits them as WIP or discards them if broken, noting which in the progress file.
   - When everything in the "done when" list is complete, the run deletes the scheduled task, records that in the progress file, and marks the PR ready for review.

Work continuously through the checklist until the session ends or the work is done. Don't stop to ask questions mid-work; for judgment calls, choose the option most consistent with this prompt, note it in the progress file, and keep going.
</resume_system>

<issues>
For bugs you find but don't fix in this effort (out of scope, or need my decision), open a GitHub issue with steps to reproduce, a screenshot where useful, and a label (`bug`, `ui`, `needs-decision`). Link them in the progress file.
</issues>

<done_when>
- [ ] App builds, launches and plays music reliably on Windows
- [ ] Every screen uses the new macOS/iOS-style design tokens, in light and dark mode
- [ ] Polish standard passes on every screen at all tested sizes and scaling levels, with the automated overflow check in CI
- [ ] Plugin UI inherits the design tokens
- [ ] Idle memory not worse than before (numbers in the PR)
- [ ] Progress file complete, scheduled task removed, open issues filed
- [ ] CI green, PR marked ready for review, every commit attributed only to engineerlish
</done_when>

<code_standards>
Write complete files, never snippets or "rest unchanged" placeholders. Match existing conventions.
</code_standards>

<report>
At the end of each session, the last entry in the progress file and PR description should say: what got done this session, what's next, and anything that needs my input.
</report>
