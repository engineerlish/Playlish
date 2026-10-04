import type { Snapshot } from '../../../shared/types';

/*
 * Plugins (#50): the page the plugin manager will live on. The plugin system itself arrives in 0.3.0; until then the
 * list is empty and the page explains what is coming. Safe mode (all plugins off) can already be used.
 */
export function PluginsPage({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div id="page-plugins">
      <h1>Plugins</h1>
      {snapshot.safeMode && (
        <div id="safeModeBanner" class="banner" role="status">
          <span>Safe mode: all plugins are off for this session.</span>
          <button id="restartNormal" onClick={() => window.ui.restart(false)}>
            Restart normally
          </button>
        </div>
      )}
      <section class="card">
        <h2>Installed</h2>
        {snapshot.plugins.length === 0 ? (
          <p id="noPlugins" class="muted">
            No plugins installed.
          </p>
        ) : (
          <ul>
            {snapshot.plugins.map((p) => (
              <li key={p.id}>
                {p.name} {p.version}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section class="card">
        <h2>Coming in a later version</h2>
        <p class="muted">
          Plugins will add features to Playlish. Each runs in its own sandbox with only the permissions you grant it, never sees your Spotify login, and can be
          turned off at any time. If a plugin ever causes trouble, safe mode starts Playlish with every plugin off.
        </p>
        {!snapshot.safeMode && (
          <div class="row">
            <button id="restartSafe" onClick={() => window.ui.restart(true)}>
              Restart in safe mode
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
