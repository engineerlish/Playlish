/*
 * Small inline SVG icons (24x24, drawn with currentColor), so the UI needs no icon font or image files.
 */

// CHANGE HERE: icon shapes (SVG path data on a 24x24 grid).
const PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  next: 'M6 6l8.5 6L6 18zM16 6h2v12h-2z',
  previous: 'M6 6h2v12H6zM9.5 12L18 18V6z',
  shuffle: 'M10.6 9.2L5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zM14.8 13.4l-1.4 1.4 3.1 3.1-2 2.1H20v-5.5l-2 2z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2z',
  repeatOne: 'M7 7h10v3l4-4-4-4v3H5v6h2zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2zM13 15V9h-1l-2 1v1h1.5v4z',
  volume: 'M3 9v6h4l5 5V4L7 9zM16.5 12A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  muted: 'M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5zM19 12a7 7 0 0 1-.6 2.8l1.5 1.5A9 9 0 0 0 14 3.2v2.1A7 7 0 0 1 19 12zM4.3 3L3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3a7 7 0 0 1-2.3 1.2v2.1a9 9 0 0 0 3.7-1.8l2 2 1.3-1.3zM12 4L9.9 6.1 12 8.2z',
  note: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3z',
  device: 'M4 6h16v10H4zM2 18h20v2H2z',
} as const;

export type IconName = keyof typeof PATHS;

/** One icon; decorative, so screen readers skip it (the button carries the label). */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}
