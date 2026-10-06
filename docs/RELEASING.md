# Releasing Playlish

Steps for the maintainer. Signing uses your castLabs EVS login on your own machine, so a release build is made locally, never in CI (decided in #80).

1. **Main is ready**: CI is green on `main`, and `npm run smoke` passes on your account.
2. **Version and changelog**: a pull request sets the version in `package.json` (`npm version <x.y.z> --no-git-tag-version`) and moves the "Unreleased" changes in `CHANGELOG.md` under `## [x.y.z] - <date>`. Merge it.
3. **Build** on an up-to-date `main`:
   ```powershell
   git checkout main
   git pull
   npm ci
   npm run dist
   ```
   The build VMP-signs the packaged app with EVS and verifies the signature (if your EVS login expired: `py -3.9 -m castlabs_evs.account reauth`). The installer and zip are in `release\`.
4. **Check the build**: install `release\Playlish-Setup-<x.y.z>.exe`, start Playlish, play a track, then uninstall (keep settings).
5. **Checksums**:
   ```powershell
   Get-FileHash release\Playlish-Setup-*.exe, release\Playlish-*-x64.zip -Algorithm SHA256 | Format-List Path, Hash
   ```
6. **Publish** (a tag and a GitHub Release with the two files; the notes are the changelog section plus the checksums):
   ```powershell
   gh release create v<x.y.z> release\Playlish-Setup-<x.y.z>.exe release\Playlish-<x.y.z>-x64.zip --title "Playlish <x.y.z>" --notes-file notes.md
   ```
   The update check in installed copies points people to the new release within a day.
