import type { SetupAction, SetupView } from '../../shared/types';

/** Sends an action to the wizard in the main process. */
const act = (action: SetupAction) => window.ui.setup(action);

/** The first-run wizard. All logic lives in the main process (setup.ts); this only draws the current step. */
export function SetupWizard({ view }: { view: SetupView }) {
  const step = view.step;
  return (
    <div class="wizard" id="setupPanel">
      <div class="muted" id="setupProgress">
        Step {view.stepNumber} of {view.stepCount}
      </div>

      {step === 'welcome' && (
        <section data-step="welcome">
          <h1>Welcome to Playlish</h1>
          <p>Playlish plays Spotify with your own free Spotify developer app, so it needs a few minutes of setup.</p>
          <ul>
            <li>Spotify Premium (playback needs it).</li>
            <li>A Spotify developer account: free, same login as Spotify.</li>
          </ul>
        </section>
      )}

      {step === 'create-app' && (
        <section data-step="create-app">
          <h1>Create your Spotify app</h1>
          <ol>
            <li>
              Open the dashboard and log in:{' '}
              <button id="openDashboard" onClick={() => act({ type: 'open-dashboard' })}>
                Open Spotify dashboard
              </button>
            </li>
            <li>
              Choose <strong>Create app</strong>. Any name and description will do.
            </li>
            <li>
              Add this Redirect URI exactly: <code id="redirectUri">{view.redirectUri}</code>{' '}
              <button id="copyRedirect" onClick={() => act({ type: 'copy-redirect-uri' })}>
                Copy
              </button>
            </li>
            <li>
              Tick <strong>Web API</strong> and <strong>Web Playback SDK</strong>, accept the terms, and save.
            </li>
            <li>
              Open the app's <strong>Settings</strong> and copy the <strong>Client ID</strong>. Never share the Client secret; Playlish does not use it.
            </li>
          </ol>
        </section>
      )}

      {step === 'client-id' && (
        <section data-step="client-id">
          <h1>Paste your Client ID</h1>
          <label for="clientIdInput" class="muted">
            Client ID
          </label>
          <input
            id="clientIdInput"
            autoComplete="off"
            spellcheck={false}
            placeholder="32 characters, 0-9 and a-f"
            value={view.clientId}
            onInput={(e) => act({ type: 'set-client-id', value: (e.target as HTMLInputElement).value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') act({ type: 'next' });
            }}
          />
          <div id="clientIdState" class="muted">
            {view.clientId === '' ? '' : view.clientIdValid ? 'Looks right.' : 'Not a Client ID yet.'}
          </div>
        </section>
      )}

      {step === 'login' && (
        <section data-step="login">
          <h1>Log in with Spotify</h1>
          <p>Your browser opens Spotify's login page. Come back here when it says you can close the tab.</p>
          <ul id="waitingHints" class="muted">
            {view.waitingHints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </section>
      )}

      {step === 'player-check' && (
        <section data-step="player-check">
          <h1>Starting the player</h1>
          <p>Checking that Spotify accepts this account for playback.</p>
        </section>
      )}

      {step === 'done' && (
        <section data-step="done">
          <h1>All set</h1>
          <p>Playlish is ready.</p>
        </section>
      )}

      {view.error && (
        <div id="setupError" class="banner error" role="alert">
          <strong id="setupErrorText">{view.error.message}</strong>
          {view.error.hints.length > 0 && (
            <ul id="setupHints">
              {view.error.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div class="row">
        {!view.busy && step !== 'welcome' && step !== 'done' && step !== 'player-check' && (
          <button id="setupBack" onClick={() => act({ type: 'back' })}>
            Back
          </button>
        )}
        {(step === 'welcome' || step === 'create-app' || step === 'client-id') && (
          <button id="setupNext" class="primary" onClick={() => act({ type: 'next' })}>
            Next
          </button>
        )}
        {step === 'login' && !view.busy && view.error === null && (
          <button id="setupLogin" class="primary" onClick={() => act({ type: 'login' })}>
            Log in with Spotify
          </button>
        )}
        {step === 'login' && view.busy && (
          <button id="setupCancel" onClick={() => act({ type: 'cancel-login' })}>
            Cancel
          </button>
        )}
        {!view.busy && view.error !== null && (step === 'login' || step === 'player-check') && (
          <button id="setupRetry" class="primary" onClick={() => act({ type: 'retry' })}>
            Try again
          </button>
        )}
        {step === 'done' && (
          <button id="setupFinish" class="primary" onClick={() => act({ type: 'finish' })}>
            Start using Playlish
          </button>
        )}
      </div>
    </div>
  );
}
