# Spike results (concept B: castLabs Electron v44.1.0+wvcus)

*Measured on Windows 11 Pro, dev build (`electron.exe .`), 2026-10-01. Numbers are **private bytes** summed over all app processes unless noted; working set double-counts shared pages and is shown for reference.*

## Measured so far (no login needed)

| Scenario | Processes | Private MB | Working set MB | CPU (20 s avg) | Target (PROPOSAL §2) |
|---|---|---|---|---|---|
| Tray only, default Electron flags | 3 (main, GPU, utility) | 138 | 182-202 | ~0% | ≤ 80 MB private |
| Tray only, `--in-process-gpu` | 2 | 126 | 140 | n/m | |
| Tray only, `--disable-gpu` | 3 | 86 | 159 | n/m | |
| **Tray only, GPU disabled + in-process (adopted)** | **2** | **75-76** | **117-120** | **0%** | **meets** |
| UI window open, not logged in (adopted flags) | 3 | 111 | 237 | 0.05% | ≤ 300 MB (playing) |

Finding: my proposal estimated 60-90 MB idle. The stock build was 138 MB, mostly a ~60 MB GPU process. Disabling hardware acceleration and running the GPU code in the main process brought idle to **75 MB private**, inside the budget. The adopted flags are in `src/main/main.ts` (marked CHANGE HERE).

## Not measured yet (needs your Client ID and a signed Electron, see README-SPIKE.md)

- Does a VMP-signed castLabs build play a full track without license errors (the main risk).
- RAM/CPU while playing with the window hidden, and with the window open.
- Cold start time to tray and to UI.
- Volume ramps / fades, output device selection, SMTC and media keys.
- Playback host window: it uses software rendering as well; confirm that does not affect audio.

## Caveats

- Dev build only (unpackaged). A packaged build usually saves a little.
- Disabling GPU acceleration trades some UI smoothness for memory. Fine for this UI; revisit if the UI gets animation-heavy.
- `--in-process-gpu` runs GPU code inside the main process. With GPU disabled it is software rasterization only, so the stability risk is small, but the 72 h soak must confirm it.

## Silent playback investigation (#17)

Symptom: the player reports "Playing" but there is no audio. Measured with the Windows audio session meter (peak level
of the Playlish audio session) so "no audio" is not a matter of opinion.

| What was tried | Result |
|---|---|
| Original profile, as is | Audio on 11 of 27 launches (41%), silent on the rest (6 + 8 + 7 + 6 launches across four batches) |
| Fresh profile | Audio |
| Moving the playback partition aside | Not the cause: the same profile played and failed on different launches |
| Showing the playback window (hidden-window throttling) | No change (2 of 7) |
| Verbose logging of all hosts | **Silent launches have one aborted audio request** (`net::ERR_ABORTED` to the audio CDN, never retried). Audible launches download the audio in several ranges |
| Removing the extra `PUT /me/player` (transfer) sent just before the play command | **7 of 8, then 10 of 10 launches played** (17 of 18 in total) |

Cause: at startup the app sent a transfer and then a play command back to back. The transfer made the SDK start loading the
track Spotify remembered for the account; the play command then restarted it and aborted that first load, which
sometimes left the player stuck. The transfer was redundant: the play call already carries the device id, and a 404
while the new device is still unknown is retried.

One launch in the 18 froze about a second into playback (position stuck while "playing"). A stall watchdog now handles
that class of failure: if the position stands still for 5 seconds while playing it nudges the player (pause and
resume), and a second stall within 30 seconds rebuilds the playback host, at most 3 times in 5 minutes. The restart
path was verified by forcing stalls from outside the app: audio returned each time, the process count stayed the same,
and the third restart in the window gave up with a clear message.

The earlier Widevine licence 403 (seen in some sessions before this work) did not recur in the 46 launches after the
investigation began (the earlier sessions that showed it were before these runs); the error burst limiter still stops that loop after 3 errors if it comes back.

Opt-in diagnostics: set `PLAYLISH_DEBUG=1` to log every host console message, every request status (all hosts), network
errors and every player state change.
