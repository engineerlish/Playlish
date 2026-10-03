/*
 * The pages of the main window. Shared by the main process (which remembers the last page) and the UI.
 * A value module (unlike types.ts), so it is imported normally.
 */

export const PAGES = ['library', 'search', 'queue', 'devices', 'settings', 'plugins'] as const;

export type Page = (typeof PAGES)[number];

// CHANGE HERE: page names shown in the sidebar.
export const PAGE_LABELS: Readonly<Record<Page, string>> = {
  library: 'Library',
  search: 'Search',
  queue: 'Queue',
  devices: 'Devices',
  settings: 'Settings',
  plugins: 'Plugins',
};

/** True for a known page name. */
export function isPage(value: unknown): value is Page {
  return typeof value === 'string' && (PAGES as readonly string[]).includes(value);
}
