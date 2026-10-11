import { PAGES, PAGE_LABELS, type Page } from '../../shared/pages';
import type { PluginPanelView } from '../../shared/plugins';
import { PluginPanel } from './PluginPanel';

/**
 * The page list on the left. Each entry is a real button, so Tab and Enter work, and the current page is announced.
 * Plugins' sidebar panels (#103) go below it.
 */
export function Sidebar({ current, onNavigate, panels = [] }: { current: Page; onNavigate: (page: Page) => void; panels?: PluginPanelView[] }) {
  return (
    <div class="sidebar">
      <nav aria-label="Pages">
        <div class="brand">Playlish</div>
        <ul>
          {PAGES.map((page, i) => (
            <li key={page}>
              <button
                id={`nav-${page}`}
                class={page === current ? 'nav current' : 'nav'}
                aria-current={page === current ? 'page' : undefined}
                title={`${PAGE_LABELS[page]} (Alt+${i + 1})`}
                onClick={() => onNavigate(page)}
              >
                {PAGE_LABELS[page]}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {panels.length > 0 && (
        <aside class="sidebar-panels" aria-label="Plugin panels">
          {panels.map((p) => (
            <PluginPanel key={p.pluginId} view={p} />
          ))}
        </aside>
      )}
    </div>
  );
}
