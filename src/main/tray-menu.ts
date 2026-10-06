import type { NowPlaying } from '../shared/types';

/*
 * The tray icon's menu and tooltip (#46), as plain data so they can be tested without Electron. main.ts turns the items
 * into an Electron menu and rebuilds it only when what it shows changes (track, artists, playing or paused, whether
 * controls work), never on progress updates, so the hidden app stays idle.
 */

// CHANGE HERE: longest now-playing line in the menu, and Windows' tooltip limit.
export const MENU_LINE_MAX = 60;
export const TOOLTIP_MAX = 127;

export type TrayAction = 'toggle' | 'next' | 'previous' | 'open' | 'quit';

export type TrayItem =
  | { kind: 'label'; label: string }
  | { kind: 'separator' }
  | { kind: 'action'; label: string; action: TrayAction; enabled: boolean }
  | { kind: 'submenu'; label: string; items: TrayItem[] }
  /** One choice in the "Play on" list (#89); null is the system default. */
  | { kind: 'output'; label: string; output: string | null; checked: boolean };

/** The chosen output and the outputs the playback host reported (null until it has reported any). */
export interface TrayOutputs {
  current: string | null;
  names: string[] | null;
}

/** Shortens text to `max` characters with an ellipsis. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "Song – Artist", or the song alone. */
function line(np: NowPlaying): string {
  return np.artists ? `${np.track} – ${np.artists}` : np.track;
}

/** The "Play on" submenu: the system default, every output, and the chosen one when it is not connected. */
function outputMenu({ current, names }: TrayOutputs): TrayItem[] {
  const known = names ?? [];
  const items: TrayItem[] = [
    { kind: 'output', label: 'System default', output: null, checked: current === null },
    ...known.map((name): TrayItem => ({ kind: 'output', label: clip(name, MENU_LINE_MAX), output: name, checked: name === current })),
  ];
  if (current !== null && !known.includes(current)) items.push({ kind: 'output', label: clip(`${current} (not connected)`, MENU_LINE_MAX), output: current, checked: true });
  return items;
}

/** The menu: what plays (and where), transport controls, the output choice (once known), open and quit. */
export function trayMenu(np: NowPlaying | null, canPlay: boolean, outputs?: TrayOutputs): TrayItem[] {
  const playing = np !== null && !np.paused;
  const where = np?.source === 'elsewhere' && np.deviceName ? ` (on ${np.deviceName})` : '';
  return [
    { kind: 'label', label: np ? clip(`${playing ? '▶' : '❚❚'} ${line(np)}${where}`, MENU_LINE_MAX) : 'Nothing playing' },
    { kind: 'separator' },
    { kind: 'action', label: playing ? 'Pause' : 'Play', action: 'toggle', enabled: canPlay || np !== null },
    { kind: 'action', label: 'Next', action: 'next', enabled: np !== null },
    { kind: 'action', label: 'Previous', action: 'previous', enabled: np !== null },
    { kind: 'separator' },
    ...(outputs && outputs.names !== null ? [{ kind: 'submenu', label: 'Play on', items: outputMenu(outputs) } satisfies TrayItem] : []),
    { kind: 'action', label: 'Open Playlish', action: 'open', enabled: true },
    { kind: 'action', label: 'Quit', action: 'quit', enabled: true },
  ];
}

/** The tooltip: the app name, plus what plays. */
export function trayTooltip(np: NowPlaying | null): string {
  return np ? clip(`Playlish – ${line(np)}${np.paused ? ' (paused)' : ''}`, TOOLTIP_MAX) : 'Playlish';
}

/** Changes only when the menu or tooltip would look different, so rebuilds can be skipped otherwise. */
export function trayKey(np: NowPlaying | null, canPlay: boolean, outputs?: TrayOutputs): string {
  return JSON.stringify([trayMenu(np, canPlay, outputs), trayTooltip(np)]);
}
