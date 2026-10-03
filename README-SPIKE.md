# Playlish spike: how to test it

Goal of the spike: log in with PKCE, play one full track through the Web Playback SDK in castLabs Electron, and measure RAM/CPU.
Unofficial; not affiliated with Spotify. Requires Spotify Premium on the developer account.

## 1. First start: the setup wizard

Start Playlish (see step 3) and follow the wizard. It walks you through creating your own app in the Spotify Developer Dashboard, shows the exact Redirect URI to register (`http://127.0.0.1:43821/callback`, with a copy button), checks the Client ID you paste, logs you in, and checks that Spotify accepts your account for playback (Premium is required).

Never share or paste the Client secret anywhere; Playlish never uses it.

If you used the spike before: its `spike.config.json` is imported into the settings on the first start, then removed (only after the Client ID has been saved and read back). `PLAYLISH_CLIENT_ID` still works as a developer override.

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

Click **Log in with Spotify**, approve in the browser, and the test track should start. Also try: the volume slider, **Fade ⏯** (pause/resume with a volume ramp), prev/next, and closing the UI window (music keeps playing from the tray icon; the tray icon's menu reopens the window).

## 4. Measure

- In-app: the Resources panel, and the CSV log at `%APPDATA%\Playlish\perf.csv` (sampled every 5 s).
- External cross-check: `powershell -File scripts\measure.ps1 -Seconds 30`

## Known spike limits (fixed in the MVP)

- Tokens are kept in memory only, so you log in on every start. Windows Credential Manager storage comes with the MVP.
- No media keys/SMTC yet, and output-device selection is not tested yet.
- The loopback server serves only the four spike files and the OAuth callback, bound to 127.0.0.1.
