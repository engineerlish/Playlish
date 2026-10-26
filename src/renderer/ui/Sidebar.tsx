import { PAGES, PAGE_LABELS, type Page } from '../../shared/pages';
import type { PluginPanelView } from '../../shared/plugins';
import { Icon, type IconName } from './Icon';
import { PluginPanel } from './PluginPanel';

// CHANGE HERE: the icon next to each page in the sidebar.
const PAGE_ICONS: Record<Page, IconName> = { library: 'library', search: 'search', queue: 'queue', devices: 'device', settings: 'settings', plugins: 'plugins' };

/**
 * The page list on the left, on the window material. Each entry is a real button, so Tab and Enter work, and the
 * current page is announced. Its top is part of the title bar (drag to move the window). Plugins' sidebar panels
 * (#103) go below it.
 */
export function Sidebar({ current, onNavigate, panels = [] }: { current: Page; onNavigate: (page: Page) => void; panels?: PluginPanelView[] }) {
  return (
    <div class="sidebar">
      <nav aria-label="Pages">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <Icon name="note" />
          </span>
          Playlish
        </div>
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
                <Icon name={PAGE_ICONS[page]} />
                <span class="nav-label">{PAGE_LABELS[page]}</span>
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
