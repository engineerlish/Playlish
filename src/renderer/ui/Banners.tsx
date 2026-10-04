import type { Snapshot } from '../../shared/types';

/** Messages that stay until they are dealt with: missing permissions, a crash to report, a server that could not start. */
export function Banners({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div class="banners">
      {snapshot.configError && (
        <div id="configPanel" class="banner error" role="alert">
          {snapshot.configError}
        </div>
      )}
      {snapshot.needsRelogin && (
        <div id="reloginBanner" class="banner" role="alert">
          <span>Playlish needs a few new Spotify permissions. Log in again once to grant them; playback keeps working meanwhile.</span>
          <button class="primary" id="relogin" onClick={() => window.ui.login()}>
            Log in again
          </button>
        </div>
      )}
      {snapshot.crashNotice && (
        <div id="crashPanel" class="banner" role="alert">
          <span id="crashText">
            Playlish recovered from a crash ({snapshot.crashNotice.kind} in {snapshot.crashNotice.process}) at {new Date(snapshot.crashNotice.when).toLocaleString()}. Would you like
            to report it? You can review everything before it is sent.
          </span>
          <button id="crashReport" class="primary" onClick={() => window.ui.answerCrashNotice('report')}>
            Report it
          </button>
          <button id="crashDismiss" onClick={() => window.ui.answerCrashNotice('dismiss')}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
