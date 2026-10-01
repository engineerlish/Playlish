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
