# Playlish: Research and Architecture Proposal

*Status: research complete, awaiting concept choice. No code has been written.*
*Research date: 2026-10-01. Figures marked **(est.)** are my estimates, not measurements. Replacing them with measured numbers is the job of the spike (step 3).*

---

## 1. What the research found

### 1.1 Spotify Web API (current state)

Verified against developer.spotify.com changelogs.

| Topic | Finding | Source |
|---|---|---|
| Feb 2026 removals | 15 catalog/user endpoints removed (Get Several Tracks/Albums/Artists/..., Artist Top Tracks, New Releases, Browse Categories, `GET /users/{id}`, `GET /users/{id}/playlists`, `POST /users/{id}/playlists`) | [Feb 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) |
| Library | All save/remove/check endpoints and follow endpoints consolidated into `PUT /me/library`, `DELETE /me/library`, `GET /me/library/contains` | same |
| Playlists | `/tracks` endpoints replaced by `/items`; fields renamed (`tracks`→`items`, `track`→`item`). Full `items` only returned for the user's **own** playlists | same |
| Field removals | Track: `popularity`, `available_markets`, `external_ids`, `linked_from`. Album: `popularity`, `label`, etc. Artist: `followers`, `popularity`. User: `product`, `country`, `email` | same |
| Search | `limit` max 50 → **10**, default 20 → **5** | same |
| Quota (Jul 2026) | Up to 25 Client IDs per developer account; quota counted **per developer account**, shared by all Dev Mode Client IDs; quota failures return `429` with `"reason": "QUOTA_EXCEEDED"` | [Jul 2026 blog](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates) |
| Dev Mode | Max **5 authenticated users** per app; the **app owner must have Premium** | [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) |
| Extended Quota | Organizations only (not individuals), legal entity, launched service, **250k+ MAU**. Not realistic for this project | same |
| Rate limits | Rolling 30 s window; `429` + `Retry-After`. Quota (Dev Mode) and rate limit are separate mechanisms | [Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits) |
| Refresh tokens | One secondary source says they now expire 6 months after the original authorization. **Not confirmed in the official changelog I could fetch**, so I will treat it as likely and handle expiry gracefully either way | [vorplabs summary](https://vorplabs.com/agent-tools/spotify-api-changes) |

**What this means for Playlish**

- **The bring-your-own-Client-ID model is the only workable one.** Each user is the "developer", so the 5-user cap and the owner-Premium rule are naturally satisfied. A shared, shipped Client ID would hit the cap immediately and Extended Quota is closed to individuals.
- **Quota is the scarce resource**, and the exact numbers are unpublished. Every Spotify call needs a shared priority queue, caching, `snapshot_id` checks and request coalescing. Plugins must never call Spotify directly (already in your design).
- **No bulk-get endpoints.** The "Get Several Tracks" family is gone, so the client has to rely on what list endpoints already return, and can't enrich with per-ID lookups. This hurts things like the smart-shuffle plugin and the stats panel, which can't use popularity or audio features. I'll design those plugins around data that still exists.
- **No `product` field**, so Premium detection can't use the profile. We detect non-Premium from SDK `account_error` and the `403 PREMIUM_REQUIRED` playback response.

### 1.2 Web Playback SDK and DRM

- Requires Premium; supported browsers listed by Spotify: Chrome, Firefox, Safari, Edge ([SDK docs](https://developer.spotify.com/documentation/web-playback-sdk)).
- It requires Widevine (EME). Chromium inside stock Electron has **no** Widevine CDM, so stock Electron cannot play it.
- **castLabs Electron ("ECS")**: a maintained Electron fork that bundles Widevine. On Windows, production playback needs **VMP signing** of the packaged app. castLabs offers this free through the **EVS** service (signup required, token expires monthly, you must VMP-sign *after* code-signing on Windows, once per build) ([EVS wiki](https://github.com/castlabs/electron-releases/wiki/EVS)).
- A Spotify community thread describes **500 errors from Spotify's widevine-license endpoint** when running with a development-level Widevine license in an ECS app ([thread](https://community.spotify.com/t5/Spotify-for-Developers/Issue-using-Widevine-DRM-development-license-in-an-Electron-app/td-p/4971570)). That fits with production VMP signing being needed. A 2020 GitHub issue shows the same symptom in an unsigned ECS app ([web-playback-sdk#117](https://github.com/spotify/web-playback-sdk/issues/117)). **This is the main risk for Concept B, and the spike has to prove it with a properly signed build.**
- **WebView2 (Tauri)**: the open Microsoft feature request for Widevine in WebView2 has no owner, milestone or response since Sept 2024 ([WebView2Feedback#4828](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4828)). WebView2 supports PlayReady, but the SDK is a Widevine client. A third-party Tauri project claims WebView2 works for Spotify, but I could not verify this, and it conflicts with the open issue. **Verdict: unproven. Possible but unlikely; it needs a 1-hour test before we trust it.**
- **Web Audio**: the SDK exposes no audio node, and Chromium outputs silence if encrypted media is routed through `createMediaElementSource`. So in-app DSP is not possible, which matches your understanding. Combined with the Developer Terms prohibiting derivative works ([terms](https://developer.spotify.com/terms)), I will not build capture, loopback or any workaround. EQ is system-level only (Equalizer APO).
- **Terms**: the terms I fetched prohibit modifying, editing or creating derivative works of Spotify content and anything that helps users capture or make permanent copies. They didn't mention the visual-media sync rule you listed. I'm treating it as a hard constraint anyway.

### 1.3 Audio quality: what each path really gives you

| | Web Playback SDK | Official desktop app (via Connect) |
|---|---|---|
| Codec / bitrate | Spotify doesn't document it for the SDK. Secondary sources say web-player-class **AAC, up to 256 kbps (Premium)** | Ogg Vorbis up to 320 kbps, plus **Lossless (FLAC up to 24-bit/44.1 kHz)** |
| Lossless | **No**. Spotify's web player does not support it, and the SDK offers no quality option | **Yes**, from desktop app 1.2.67+ ([Spotify support](https://support.spotify.com/ca-en/article/lossless-audio-quality/)) |
| Quality setting | No API for it | Set manually in the official app |
| EQ / normalization / crossfade / gapless | **None exposed** (SDK reference has only volume, seek, play/pause, track skip, state) | Exist in the official app but are **not controllable through any official API**. Playlish could not toggle them; the user sets them once in Spotify |
| Volume | `setVolume(0..1)`, local, free, instant (ideal for fades) | `PUT /me/player/volume` is a Web API call. Fades would cost many quota-counted calls, so fades are impractical |

**Plain answer: Concept D gives meaningfully better audio, because it is the only route to lossless.** It costs you the "replace the official app" goal and the RAM priority, because the official app has to be running (it is a heavy Chromium Embedded Framework app itself).

The Web API itself has no audio quality, EQ, crossfade, gapless or normalization controls anywhere ([player endpoints](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)).

**Recommended resolution:** the MVP's "transfer playback to/from other Connect devices" already lets Playlish control the official desktop app as just another device. Users who want lossless can leave the official app running and hand playback to it, and keep Playlish for daily use. That gives most of Concept D's audio benefit without making D the foundation.

### 1.4 Other audio features, feasibility

| Feature | Feasibility |
|---|---|
| Precise volume, mute, ramped fades on play/pause/skip | **Yes**, `setVolume` ramped on a timer. Smooth fades need ~20-50 ms steps. Fades only work when Playlish itself is the playback device |
| Output device selection | **Uncertain**. The SDK owns its media element. Chromium's `setSinkId` would work if we can reach that element. Under B/A this likely needs a preload script that runs in the SDK's frame. This only routes output and doesn't touch the audio, but it needs a spike test. Fallback: tell the user to pick the device in Windows Sound settings |
| Per-device volume memory | **Yes**, app-side storage keyed by device ID |
| Equalizer APO integration | **Yes**. APO reads plain-text config; `Preamp:`, `Filter:` (PK/LSC/HSC...), `GraphicEQ:`, `Device:` selectors and `Include:` are supported, and config files in its config path **auto-reload on change** ([config reference](https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/)). Plan: Playlish writes one `playlish-eq.txt` and adds a single `Include:` line to `config.txt`. Needs verifying: write permissions on APO's config folder (may need a one-time elevation, to be handled in the setup guide) |

---

## 2. Budgets and how we will measure them

These are targets for the chosen concept. They apply to the whole process tree.

| Metric | Target | Notes |
|---|---|---|
| Idle RAM (tray only, no window, nothing playing) | **≤ 80 MB** (B), **≤ 50 MB** (A/C) | UI renderer destroyed when hidden |
| RAM while playing, window hidden | ≤ 200 MB (B) / ≤ 150 MB (A) | The SDK host must stay alive while playing |
| RAM with window open, playing | ≤ 300 MB (B) / ≤ 220 MB (A) | |
| Idle CPU | **< 0.1% average**, no wake-ups when hidden and paused | Timers cleared, no polling when hidden |
| CPU during playback | ≤ 2% average (hidden), ≤ 5% (window visible, progress bar animating) | |
| Cold start to tray | ≤ 1.5 s | |
| Cold start to usable UI | ≤ 2.5 s | |
| 72 h soak | RAM growth < 5% after warm-up; zero crashes | Automated soak: play, skip, search, open/close window, run plugins |

**Measurement**

1. **Built-in perf overlay and CSV log**: per-process working set and private bytes, CPU %. In Electron this is `app.getAppMetrics()`; in Tauri it's a Rust sampler. It logs every 5 s to a rotating file.
2. **External check**: `typeperf` / PowerShell `Get-Process` summed over the tree, to cross-check the overlay.
3. **Soak test script** for the 72 h run, with a leak-detection report (trend of private bytes).
4. **Cold start**: measure from process launch to first `ready` event using `Measure-Command` plus an internal timestamp.

---

## 3. Concepts

### Concept A: Tauri (Rust + WebView2)

- **Widevine**: **unproven and likely not working.** WebView2 has no Widevine support (open request, no activity). Needs a 1-hour test; if it fails, A is dead.
- **Estimates (est.)**: idle 40-70 MB (tray, no webview) / playing 120-200 MB, because msedgewebview2 processes add up; CPU very low; install 8-15 MB (relies on the WebView2 runtime preinstalled on Windows 11); startup ~0.5-1 s.
- **Audio**: SDK path only (AAC, no lossless). Volume ramps and APO integration work as in all SDK concepts.
- **Plugins**: strong. Rust host + QuickJS-WASM sandbox (see §4). Smallest base.
- **Stability risks**: if Widevine works, it depends on how WebView2 evolves; Microsoft updates the runtime on its own schedule, so we can't pin a known-good engine.
- **Packaging / updates**: Tauri updater with signed artifacts, MSI/NSIS installer.
- **Verdict**: best on paper, but gated on one binary question. **Worth a 1-hour test before ruling out.**

### Concept B: castLabs Electron

- **Widevine**: **works in principle**, with a production VMP-signed build via the free EVS service; this is the only path with documented community success for the Web Playback SDK. **Risk**: license-endpoint 500s for improperly signed builds (see §1.2). The spike must prove playback with an EVS-signed build.
- **Estimates (est.)**: idle (tray, all windows destroyed) 60-90 MB; playing hidden 150-220 MB; window open 200-300 MB; CPU idle ~0%; install ~100-130 MB packed (260+ MB unpacked); startup 1-2 s.
- **Audio**: SDK path only (AAC, no lossless). Output-device selection via `setSinkId` in a subframe preload is the most likely to work here.
- **Plugins**: JS-native. QuickJS-WASM Workers for logic, sandboxed iframes for UI (see §4).
- **Stability risks**: castLabs lags upstream Electron/Chromium by some versions, so we depend on a small company's fork cadence and on Spotify continuing to accept ECS Widevine clients. Mitigation: pin versions, keep the Spotify-facing layer thin, test each ECS bump with an automated playback smoke test.
- **Packaging / updates**: electron-builder or Forge, NSIS installer, code-sign then VMP-sign (order matters on Windows), `electron-updater`-style differential updates (no extra dependency if we write a small manifest-based updater).
- **Verdict**: heaviest of the SDK options, but the lowest risk of "it just doesn't play".

### Concept C: Native UI (Rust or C#/WinUI) plus a hidden playback host

- **Widevine**: not independent. The hidden web view is still **WebView2 (= Concept A's risk)** or an ECS/CEF process (= Concept B's engine). C doesn't solve the DRM problem; it only moves it.
- **Estimates (est.)**: native UI 30-60 MB (Rust/Slint) or 60-100 MB (WinUI 3) **plus** the playback host (80-150 MB). Total about the same as A with ECS, or *higher* than B.
- **Audio**: same as the underlying host.
- **Plugins**: hardest. Native UI means plugin UI slots can't be web content unless embedded in yet another web view; we'd build a declarative-UI plugin renderer.
- **Stability risks**: two UI technologies, an IPC boundary between them, and the largest maintenance surface of all four.
- **Benefit**: the playback host can be killed independently of the UI. A real isolation advantage, but B can get the same with a separate hidden playback window/process.
- **Verdict**: **not recommended**: most work, no RAM win once DRM is accounted for.

### Concept D: Native controller driving the official Spotify app (Connect)

- **Widevine**: not needed in our process. The official app does the playback.
- **Estimates (est.)**: Playlish itself 20-60 MB (native Rust/WinUI shell), but the **official Spotify desktop app must run alongside it (~300-500 MB (est.))**. That is worse on RAM overall and it contradicts "replaces the official app".
- **Audio**: **best quality of the four**: lossless (24-bit/44.1 kHz FLAC), Vorbis 320, the official app's EQ/normalization/crossfade/gapless. But none of those are controllable by us. Volume is controllable only via rate-limited Web API calls, so **fades aren't practical** and per-device volume is limited.
- **Plugins**: same as C (native UI) or can be web-based if the shell is a webview.
- **Stability risks**: depends on the official app being installed, running and logged in. We have no control over its updates, and its device can disappear mid-session.
- **Verdict**: a strong **fallback and companion mode**, not a foundation. In B (and A), D's behavior comes for free from Connect transfer.

### Comparison

| | A Tauri | B castLabs Electron | C Native + web host | D Connect controller |
|---|---|---|---|---|
| Widevine works | **Unproven (likely no)** | **Yes (needs EVS signing; spike must confirm)** | Same as A or B | N/A |
| Idle RAM (est.) | 40-70 MB | 60-90 MB | 70-130 MB | 20-60 MB + official app |
| Playing RAM (est.) | 120-200 MB | 150-300 MB | 150-300 MB | 20-60 MB + 300-500 MB official app |
| Install size (est.) | 8-15 MB | 100-130 MB | 30-150 MB | 10-30 MB |
| Cold start (est.) | 0.5-1 s | 1-2 s | 1-2 s | < 1 s |
| Lossless | No | No | No | **Yes** (official app only) |
| Volume fades | Yes | Yes | Yes | Impractical |
| Output device selection | Likely (to verify) | Likely (to verify) | Likely (to verify) | Official app's own setting |
| Plugin story | Strong | Strong | Hard | Medium |
| Maintenance burden | Low | Medium (fork) | **High** | Medium |

---

## 4. Plugin system outline (applies to A and B; summary only)

*Full design comes after you choose a concept; this shows the direction.*

- **Format**: a single `.playlish` file (a zip) containing `manifest.json` (id, name, version, author, description, `apiVersion`, permissions, entry, optional `ui` slots) plus code and assets. SHA-256 recorded in the install log.
- **Isolation (key design choice)**: plugin **logic runs inside QuickJS compiled to WASM**, in a Worker. QuickJS gives a hard **memory limit** and an **interrupt handler for CPU-time budgets**, which a plain Worker or iframe can't enforce, and it has no ambient access to network, files or DOM. This directly serves priority 3. Cost: one small dependency (~0.5-1 MB; justified). **Plugin UI** is either a declarative description rendered by the host (default, safest) or, with a permission, a sandboxed `<iframe sandbox>` with an opaque origin and a strict CSP.
- **API**: versioned (`apiVersion: 1`), message-based over `postMessage`. Events: `track.changed`, `playback.state`, `queue.changed`, `device.changed`. Actions: `play`, `queue.add`, `playlist.add`, `search`, `volume.set`, `volume.fade`, `eq.switchPreset`. Plugins never see tokens or call Spotify directly; every action goes through the host's single priority queue (which handles `Retry-After`, `QUOTA_EXCEEDED`, caching, coalescing).
- **Permissions** (shown at install): `playback.read`, `playback.control`, `library.modify`, `audio.control` (volume/EQ), `network:<domain>`, `storage`.
- **Resource safety**: per-plugin memory cap, CPU budget per call and per minute, call-rate cap; automatic disable after repeated violations; resource view in the plugin manager; lazy loading (a plugin loads only when its event or slot is first needed). **Safe mode** starts with all plugins off.
- **Lifecycle**: install from file/URL/GitHub release, enable, disable, update (with permission-diff re-approval), uninstall (deletes its storage). Index/catalog later: the manifest and source URL already allow it.
- **Developer experience**: template repo, typed SDK package (`@playlish/sdk`), `playlish dev` with hot reload, a short first-plugin guide.
- **Example plugins**: (1) listening stats panel (sidebar slot) using only the recently-played data that still exists, (2) smart-shuffle queue tool (queue + search permissions; no popularity or audio features since they're gone), (3) EQ preset auto-switcher by playlist (`audio.control` + `playback.read`).

---

## 5. Cross-cutting design decisions

- **Spotify client module**: one isolated `spotify/` package with typed responses and a single request queue. The Feb 2026 breakage (e.g. `/tracks` to `/items`) would then touch one place.
- **Tokens**: PKCE only, no secret. Stored in Windows Credential Manager through a small native binding (a tiny keyring library; Electron's built-in `safeStorage` uses DPAPI rather than Credential Manager, so it doesn't meet your requirement). Never passed to plugin sandboxes.
- **Errors**: distinct, plain-language states for expired session, non-Premium (`account_error` / 403), `429` rate limit (honor `Retry-After`) versus `QUOTA_EXCEEDED` (tell the user the daily dev-account quota is used up).
- **Tray behavior**: when hidden and not playing, the UI renderer is destroyed (not just hidden); the SDK host stays alive only while a Playlish playback session exists.
- **Dependencies**: aim for a handful: QuickJS-WASM (sandbox), a keyring binding, and the framework itself. UI in plain TypeScript or a tiny reactive library instead of a large framework; I'll justify any specific choice at that stage.
- **SMTC / media keys**: Chromium's Media Session API normally surfaces to SMTC and handles media keys; I'll verify the SDK's audio element triggers it in the spike, with a small native fallback if not.

---

## 6. Recommendation

**Primary choice: Concept B (castLabs Electron)**, built lean (no window while hidden, strict process hygiene, QuickJS-WASM plugins), with **Connect transfer in the MVP** so users can hand playback to the official app for lossless. That makes B+D together the real answer for audio quality.

**Why not A**: it is the best fit for your RAM priority *if* Widevine works in WebView2, but the evidence says it doesn't, and building on a bet that fails would cost the most. **I recommend a 1-hour A test inside the spike**: if it plays, we reconsider, because A would cut memory roughly in half. If you'd rather skip it, say so.

**Why not C**: most complexity and no RAM benefit once DRM is accounted for.

**Why not D alone**: best audio, but it needs the official app running, so it fails the "replace the official app" and RAM goals and kills fades.

**Biggest open risks to retire in the spike**
1. A properly EVS-signed ECS build actually plays full tracks (no license-endpoint 500s).
2. Output-device routing via `setSinkId` in the SDK frame.
3. SMTC and media keys with the SDK's media element.
4. Measured RAM/CPU against the budgets in §2.

## 7. Decision needed

1. Pick a concept: **B (recommended)**, A (after the WebView2 test), C, or D.
2. Confirm that, if B, I include the short WebView2 test inside the spike.
3. A user task for later: you'll need a Spotify Developer app (Premium account) and a free castLabs EVS account for signing. I'll walk you through both.
