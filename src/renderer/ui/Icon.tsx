/*
 * Small inline SVG icons, so the UI needs no icon font or image files. The shapes are from Lucide (https://lucide.dev,
 * ISC licence, see NOTICE): 24x24, drawn with a 2px rounded stroke in currentColor. Transport icons are also filled,
 * like the system's media controls.
 */

// CHANGE HERE: icon shapes (Lucide SVG path data on a 24x24 grid).
const PATHS = {
  play: 'M6 4.5a1 1 0 0 1 1.5-.86l11.5 7a1 1 0 0 1 0 1.72l-11.5 7A1 1 0 0 1 6 18.5z',
  pause: 'M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  next: 'M5 4l10 8-10 8zM19 5v14',
  previous: 'M19 20L9 12l10-8zM5 19V5',
  shuffle: 'M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4',
  repeat: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  repeatOne: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3M11 10h1v4',
  volume: 'M11 5L6 9H2v6h4l5 4zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14',
  muted: 'M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  note: 'M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  device: 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 6h.01',
  plus: 'M5 12h14M12 5v14',
  heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z',
  back: 'M15 18l-6-6 6-6',
  library: 'M16 6l4 14M12 6v14M8 8v12M4 4v16',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  queue: 'M21 15V6M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 12H3M16 6H3M12 18H3',
  settings: 'M20 7h-9M14 17H5M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  plugins: 'M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3',
  refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
  alert: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
} as const;

export type IconName = keyof typeof PATHS;

// Drawn filled as well as stroked.
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['play', 'pause', 'next', 'previous']);

/** One icon; decorative, so screen readers skip it (the button carries the label). `filled` fills an outline icon (a liked heart). */
export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d={PATHS[name]}
        fill={filled || FILLED.has(name) ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
