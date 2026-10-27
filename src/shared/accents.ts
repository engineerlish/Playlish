/*
 * Accent colours the user can pick in Settings. Shared by the main process (which stores the choice) and the UI (which
 * sets data-accent on <html>; the colours themselves are tokens in ui.css). A value module, imported normally.
 */

// CHANGE HERE: the accent choices (each needs a :root[data-accent] rule in ui.css, except the default) and their names.
export const ACCENTS = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'graphite'] as const;

export type Accent = (typeof ACCENTS)[number];

export const DEFAULT_ACCENT: Accent = 'blue';

export const ACCENT_LABELS: Readonly<Record<Accent, string>> = {
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  orange: 'Orange',
  green: 'Green',
  teal: 'Teal',
  graphite: 'Graphite',
};

/** True for a known accent name. */
export function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && (ACCENTS as readonly string[]).includes(value);
}
