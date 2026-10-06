/*
 * Volume per output device (#90): the volume set while Playlish plays is remembered for the current output, and
 * restored when that output is chosen again (or when the player starts on it). Kept in settings.deviceVolumes.
 */

// CHANGE HERE: the key used for "System default", and how many devices are remembered (the settings file accepts 100).
export const DEFAULT_OUTPUT_KEY = 'System default';
export const MAX_REMEMBERED = 100;

/** The key for an output: its name, or the system default. */
export function volumeKey(output: string | null): string {
  return output ?? DEFAULT_OUTPUT_KEY;
}

/**
 * The map with `volume` remembered for `key`. Keys are kept in the order last used, so when the map is full the device
 * used longest ago is dropped. Returns a new object; the input is not changed.
 */
export function rememberVolume(volumes: Readonly<Record<string, number>>, key: string, volume: number): Record<string, number> {
  const clamped = Math.min(1, Math.max(0, volume));
  const entries = Object.entries(volumes).filter(([k]) => k !== key);
  entries.push([key, clamped]);
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED));
}

/** The remembered volume for an output, or null when it has none yet (the current volume then stays). */
export function recallVolume(volumes: Readonly<Record<string, number>>, output: string | null): number | null {
  const v = volumes[volumeKey(output)];
  return typeof v === 'number' ? v : null;
}
