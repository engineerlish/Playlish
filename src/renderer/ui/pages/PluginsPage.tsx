import { useEffect, useRef, useState } from 'preact/hooks';
import { PLUGIN_PERMISSIONS, type PluginPrompt, type PluginView } from '../../../shared/plugins';
import type { Snapshot } from '../../../shared/types';
import { PluginPanel } from '../PluginPanel';

/*
 * Plugins (#50, #101): the plugin manager. Install a .playlish file after a permission prompt, turn plugins on and off,
 * uninstall them, and see why Playlish turned one off. Safe mode starts Playlish with every plugin off.
 */

/** The permission prompt for a package that is about to be installed or updated. */
function InstallPrompt({ prompt }: { prompt: PluginPrompt }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Move focus to the prompt, so keyboard and screen reader users land on the question.
  useEffect(() => heading.current?.focus(), [prompt.token]);
  const update = prompt.replaces !== null;
  return (
    <section id="pluginPrompt" class="card prompt" aria-labelledby="pluginPromptTitle">
      <h2 id="pluginPromptTitle" ref={heading} tabIndex={-1}>
        {update ? `Update ${prompt.name} from ${prompt.replaces} to ${prompt.version}?` : `Install ${prompt.name} ${prompt.version}?`}
      </h2>
      <p class="muted">
        By {prompt.author} · <code>{prompt.id}</code>
      </p>
      {prompt.description && <p>{prompt.description}</p>}
      {prompt.permissions.length === 0 ? (
        <p id="promptNoPermissions">This plugin asks for no permissions.</p>
      ) : (
        <>
          <p>It will be allowed to:</p>
          <ul id="promptPermissions" class="perm-list">
            {prompt.permissions.map((p) => (
              <li key={p}>
                {PLUGIN_PERMISSIONS[p]}
                {update && prompt.newPermissions.includes(p) && <span class="badge new">new</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="muted">It runs in a sandbox, never sees your Spotify login, and you can turn it off or remove it at any time.</p>
      <p class="muted small">
        Package SHA-256: <code title={prompt.sha256}>{prompt.sha256.slice(0, 16)}…</code>
      </p>
      <div class="row">
        <button id="approvePlugin" class="primary" onClick={() => window.ui.approvePlugin(prompt.token)}>
          {update ? 'Update' : 'Install'}
        </button>
        <button id="cancelPlugin" onClick={() => window.ui.cancelPlugin(prompt.token)}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/** One installed plugin: what it is, what it may do, on/off and uninstall. */
function PluginRow({ plugin, safeMode }: { plugin: PluginView; safeMode: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const id = `plugin-${plugin.id.replace(/[^a-z0-9]/g, '-')}`;
  return (
    <li id={id} class="plugin">
      <div class="plugin-head">
        <label class="check">
          <input
            type="checkbox"
            class="plugin-enabled"
            checked={plugin.enabled}
            aria-label={`${plugin.name} on`}
            onChange={(e) => window.ui.setPluginEnabled(plugin.id, (e.target as HTMLInputElement).checked)}
          />
          <span>
            <span class="plugin-name">{plugin.name}</span> <span class="muted">{plugin.version}</span>
            <span class="hint muted">By {plugin.author}</span>
          </span>
        </label>
      </div>
      {plugin.description && <p class="plugin-description">{plugin.description}</p>}
      <p class="muted small plugin-permissions">
        {plugin.permissions.length === 0 ? 'No permissions.' : `Allowed to: ${plugin.permissions.map((p) => PLUGIN_PERMISSIONS[p].toLowerCase()).join('; ')}.`}
      </p>
      {plugin.disabledReason && <p class="error-text plugin-disabled-reason">{plugin.disabledReason}</p>}
      {safeMode && plugin.enabled && <p class="muted small">Not running: safe mode.</p>}
      <div class="row">
        {confirming ? (
          <>
            <span>Remove {plugin.name} and its data?</span>
            <button class="confirm-uninstall" onClick={() => window.ui.uninstallPlugin(plugin.id)}>
              Uninstall
            </button>
            <button class="keep-plugin" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button class="uninstall" onClick={() => setConfirming(true)}>
            Uninstall…
          </button>
        )}
      </div>
    </li>
  );
}

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
      {snapshot.pluginError && (
        <div id="pluginError" class="banner error" role="alert">
          <p>{snapshot.pluginError}</p>
          <button id="dismissPluginError" onClick={() => window.ui.dismissPluginError()}>
            Dismiss
          </button>
        </div>
      )}
      {snapshot.pluginPrompt && <InstallPrompt prompt={snapshot.pluginPrompt} />}
      {snapshot.pluginPanels
        .filter((p) => p.slot === 'plugins-page')
        .map((p) => (
          <div key={p.pluginId} class="card">
            <PluginPanel view={p} />
          </div>
        ))}
      <section class="card">
        <div class="row-head">
          <h2>Installed</h2>
          <button id="installPlugin" onClick={() => window.ui.installPlugin()}>
            Install from file…
          </button>
        </div>
        {snapshot.plugins.length === 0 ? (
          <p id="noPlugins" class="muted">
            No plugins installed.
          </p>
        ) : (
          <ul id="pluginList" class="plugin-list">
            {snapshot.plugins.map((p) => (
              <PluginRow key={p.id} plugin={p} safeMode={snapshot.safeMode} />
            ))}
          </ul>
        )}
        <p class="muted small">
          Plugins come as .playlish files. Each runs in its own sandbox with only the permissions you grant it, never sees your Spotify login, and can be turned off at any time.
        </p>
      </section>
      {!snapshot.safeMode && (
        <section class="card">
          <h2>Safe mode</h2>
          <p class="muted">If a plugin ever causes trouble, safe mode starts Playlish with every plugin off.</p>
          <div class="row">
            <button id="restartSafe" onClick={() => window.ui.restart(true)}>
              Restart in safe mode
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
