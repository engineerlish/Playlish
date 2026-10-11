import type { PanelNode, PluginPanelView } from '../../shared/plugins';

/*
 * A plugin's panel (#103), drawn with Playlish's own controls from the plugin's description. It is plain data: text is
 * shown as text (never as HTML), and every click or change is sent to the main process, which checks it against the
 * panel before the plugin hears of it. A plugin updates its panel to show the new state.
 */

/** A DOM id that is safe and unique for a control in one plugin's panel. */
function controlId(view: PluginPanelView, id: string): string {
  return `pp-${view.pluginId.replace(/[^a-z0-9]/g, '-')}-${view.slot}-${id}`;
}

function Node({ view, node }: { view: PluginPanelView; node: PanelNode }) {
  const send = (id: string, value: boolean | number | string | null) => window.ui.pluginUiAction(view.pluginId, view.slot, id, value);
  switch (node.type) {
    case 'text':
      return node.style === 'heading' ? <h3 class="pp-heading">{node.text}</h3> : <p class={node.style === 'muted' ? 'muted' : undefined}>{node.text}</p>;
    case 'list':
      return (
        <ol class="pp-list">
          {node.items.map((item, i) => (
            <li key={i}>
              <span>{item.text}</span>
              {item.detail && <span class="muted"> {item.detail}</span>}
            </li>
          ))}
        </ol>
      );
    case 'button':
      return (
        <button id={controlId(view, node.id)} onClick={() => send(node.id, null)}>
          {node.label}
        </button>
      );
    case 'toggle':
      return (
        <label class="check">
          <input id={controlId(view, node.id)} type="checkbox" checked={node.value} onChange={(e) => send(node.id, (e.target as HTMLInputElement).checked)} />
          <span>{node.label}</span>
        </label>
      );
    case 'slider':
      return (
        <label class="pp-field" for={controlId(view, node.id)}>
          <span>{node.label}</span>
          <input
            id={controlId(view, node.id)}
            type="range"
            min={node.min}
            max={node.max}
            step={node.step}
            value={node.value}
            onChange={(e) => send(node.id, Number((e.target as HTMLInputElement).value))}
          />
        </label>
      );
    case 'select':
      return (
        <label class="pp-field" for={controlId(view, node.id)}>
          <span>{node.label}</span>
          <select id={controlId(view, node.id)} value={node.value} onChange={(e) => send(node.id, (e.target as HTMLSelectElement).value)}>
            {node.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
  }
}

export function PluginPanel({ view }: { view: PluginPanelView }) {
  const title = view.panel.title || view.pluginName;
  return (
    <section class={`plugin-panel slot-${view.slot}`} aria-label={`${title} (plugin: ${view.pluginName})`} data-plugin={view.pluginId}>
      <h2 class="pp-title">{title}</h2>
      {view.panel.items.map((node, i) => (
        <Node key={'id' in node ? node.id : `n${i}`} view={view} node={node} />
      ))}
      <p class="muted pp-from">From the plugin {view.pluginName}</p>
    </section>
  );
}
