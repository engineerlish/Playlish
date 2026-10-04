import type { Snapshot } from '../../../shared/types';

/** Account, diagnostics and the resource readout. Audio settings arrive in 0.2.0. */
export function SettingsPage({ snapshot }: { snapshot: Snapshot }) {
  const m = snapshot.metrics;
  return (
    <div id="page-settings">
      <h1>Settings</h1>

      <section class="card">
        <h2>Account</h2>
        <p>
          {snapshot.loggedIn ? 'Logged in to Spotify.' : 'Not logged in.'}{' '}
          {snapshot.clientIdHint && <span class="muted">Spotify app Client ID ending in {snapshot.clientIdHint}.</span>}
        </p>
        <div class="row">
          {snapshot.loggedIn ? (
            <button id="signOut" onClick={() => window.ui.signOut()}>
              Sign out
            </button>
          ) : (
            <button id="login" class="primary" onClick={() => window.ui.login()}>
              Log in with Spotify
            </button>
          )}
        </div>
      </section>

      <section class="card">
        <h2>Help and diagnostics</h2>
        <p class="muted">Reports open in your browser so you can read and edit them before anything is sent. Tokens and personal data are removed.</p>
        <div class="row">
          <button id="reportIssue" onClick={() => window.ui.reportIssue()}>
            Report an issue
          </button>
          <button id="exportDiagnostics" onClick={() => window.ui.exportDiagnostics()}>
            Export diagnostics
          </button>
        </div>
      </section>

      <section class="card">
        <h2>Resources</h2>
        <p id="metrics" class="muted">
          {m ? `${m.processes} processes · private memory ${m.privateMb} MB · working set ${m.workingSetMb} MB · CPU ${m.cpuPercent}%` : 'Waiting for the first sample…'}
        </p>
        <p class="muted">
          Performance log: <code id="logPath">{snapshot.perfLogPath}</code>
        </p>
      </section>

      <section class="card">
        <h2>About</h2>
        <p class="muted">Playlish {snapshot.appVersion}. Unofficial; not affiliated with Spotify.</p>
      </section>
    </div>
  );
}
