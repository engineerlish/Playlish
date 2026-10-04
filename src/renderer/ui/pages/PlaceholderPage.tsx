import { PAGE_LABELS, type Page } from '../../../shared/pages';

// CHANGE HERE: what each page will hold, shown until it is built.
const COMING: Partial<Record<Page, string>> = {
  library: 'Your saved tracks, albums and playlists will appear here.',
  search: 'Search for tracks, albums, artists and playlists here.',
  queue: 'What plays next will appear here.',
  devices: 'Your Spotify Connect devices will appear here, so you can move playback between them.',
  plugins: 'Installed plugins will appear here. Playlish starts with all plugins off in safe mode.',
};

/** A friendly empty page for features that are not built yet. */
export function PlaceholderPage({ page }: { page: Page }) {
  return (
    <section class="card" id={`page-${page}`}>
      <h1>{PAGE_LABELS[page]}</h1>
      <p class="muted">{COMING[page] ?? ''}</p>
      <p class="muted">Coming in a later version.</p>
    </section>
  );
}
