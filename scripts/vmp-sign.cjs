// electron-builder afterSign hook (#80): Widevine VMP signing of the packaged app with castLabs EVS, then a check.
// Spotify's licence server can refuse playback from an unsigned build. Runs on the packaged folder, after the
// executable got its final name and any code signing, and before the installer and zip are built.
//
// Needs Python 3.9 with castlabs-evs and an EVS account (`py -3.9 -m castlabs_evs.account reauth` if the login has
// expired). PLAYLISH_SKIP_VMP=1 skips signing for local test builds; such builds may not play.
const { execFileSync } = require('node:child_process');

// CHANGE HERE: how Python with castlabs-evs is started.
const PYTHON = ['py', ['-3.9']];

module.exports = async function vmpSign(context) {
  const dir = context.appOutDir;
  if (process.env.PLAYLISH_SKIP_VMP === '1') {
    console.log(`  • VMP signing skipped (PLAYLISH_SKIP_VMP=1): ${dir} may not play protected content`);
    return;
  }
  const run = (args) => execFileSync(PYTHON[0], [...PYTHON[1], '-m', ...args, dir], { stdio: 'inherit' });
  console.log(`  • VMP signing ${dir}`);
  run(['castlabs_evs.vmp', 'sign-pkg']);
  run(['castlabs_evs.vmp', 'verify-pkg']);
};
