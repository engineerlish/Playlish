import { PAGES, PAGE_LABELS, type Page } from '../../shared/pages';

/** The page list on the left. Each entry is a real button, so Tab and Enter work, and the current page is announced. */
export function Sidebar({ current, onNavigate }: { current: Page; onNavigate: (page: Page) => void }) {
  return (
    <nav class="sidebar" aria-label="Pages">
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
  );
}
