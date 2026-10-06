/*
 * Output device names (#89), shared by Settings → Audio, the playback host (which reports them for the tray menu) and
 * the main process (which checks what the host reports).
 */

// CHANGE HERE: limits on what the playback host may report: how many names, and how long one may be.
export const MAX_OUTPUTS = 64;
export const MAX_OUTPUT_NAME = 200;

/** Output names from a device list, without Windows' "default" and "communications" aliases, sorted and unique. */
export function outputNamesFrom(devices: readonly Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): string[] {
  const names = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label !== '').map((d) => d.label);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** The names as a clean list when the value is a valid report, or null for anything else. */
export function validOutputNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_OUTPUTS) return null;
  if (!value.every((n): n is string => typeof n === 'string' && n.length > 0 && n.length <= MAX_OUTPUT_NAME)) return null;
  return [...new Set(value)].sort((a, b) => a.localeCompare(b));
}
