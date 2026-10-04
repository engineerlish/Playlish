# Developing Playlish: setup, run and measure

How to run Playlish from source on Windows: the first-run wizard, signing the development Electron build for Widevine, running, and measuring. Unofficial; not affiliated with Spotify. Playback needs Spotify Premium.

## 1. First start: the setup wizard

Start Playlish (see step 3) and follow the wizard. It walks you through creating your own app in the Spotify Developer Dashboard, shows the exact Redirect URI to register (`http://127.0.0.1:43821/callback`, with a copy button), checks the Client ID you paste, logs you in, and checks that Spotify accepts your account for playback (Premium is required).

Never share or paste the Client secret anywhere; Playlish never uses it.

If you used the early spike: its `spike.config.json` is imported into the settings on the first start, then removed (only after the Client ID has been saved and read back). `PLAYLISH_CLIENT_ID` still works as a developer override.

## 2. Create a castLabs EVS account and sign the dev Electron (once; this step needs you)

Widevine needs a VMP-signed Electron binary, or Spotify's license server may answer with errors. EVS is castLabs' free signing service. The signup asks for your email, name, organization and a password, so you must type those yourself.

```powershell
py -3.9 -m castlabs_evs.account signup
py -3.9 -m castlabs_evs.account confirm-signup   # enter the code emailed to you
```

Then sign the dev binary (re-run after every `npm install` that changes Electron):

```powershell
py -3.9 -m castlabs_evs.vmp sign-pkg node_modules\electron\dist
```

(`castlabs-evs` is already installed for Python 3.9 on this machine.)

## 3. Run

```powershell
npm start            # opens the UI window
npm run start:tray   # tray only (idle baseline)
```

Click **Log in with Spotify** and approve in the browser. Nothing plays by itself: press Play to continue where your account left off, or pick something in Library or Search. Closing the window keeps Playlish in the tray (Settings can change that); the tray icon or its menu brings the window back.

Useful switches: `--tray` (start in the tray), `--safe-mode` (all plugins off), `PLAYLISH_DEBUG=1` (debug logging), `PLAYLISH_CLIENT_ID` (developer override for the Client ID).

## 4. Measure

- In-app: the Resources panel, and the CSV log at `%APPDATA%\Playlish\perf.csv` (sampled every 5 s).
- External cross-check: `powershell -File scripts\measure.ps1 -Seconds 30`

## 5. Tests

```powershell
npm run check   # typecheck, lint, unit and integration tests
npm run e2e     # builds, then the end-to-end suite (Playwright, fake Spotify, no account needed)
npm run smoke   # real login, Widevine playback and audio on this machine (needs your account)
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for what each suite covers.
