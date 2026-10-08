/*
 * Equalizer APO configuration (#91), as plain text functions. Playlish owns one file, playlish.txt, in Equalizer APO's
 * config folder, and adds a single "Include: playlish.txt" line to config.txt. Nothing else in the user's
 * configuration is touched. Syntax: https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/
 */

// CHANGE HERE: the bands (Hz) of the 10-band EQ, the gain range, and the presets.
export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const MAX_GAIN_DB = 12;
export const PRESETS = {
  flat: { label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bassBoost: { label: 'Bass boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  bassCut: { label: 'Bass cut', gains: [-8, -6, -4, -2, 0, 0, 0, 0, 0, 0] },
  vocal: { label: 'Vocal', gains: [-3, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  trebleBoost: { label: 'Treble boost', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
} as const satisfies Record<string, { label: string; gains: readonly number[] }>;
export type PresetId = keyof typeof PRESETS | 'custom';

export const OWN_FILE = 'playlish.txt';
export const INCLUDE_LINE = `Include: ${OWN_FILE}`;
const OWN_MARKER = '# Written by Playlish';

/** Gains clamped to ±MAX_GAIN_DB and rounded to 0.5 dB; exactly one per band. */
export function cleanGains(gains: readonly number[]): number[] {
  return BANDS.map((_, i) => {
    const g = gains[i];
    if (typeof g !== 'number' || !Number.isFinite(g)) return 0;
    return Math.round(Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, g)) * 2) / 2;
  });
}

/** The gains for a preset, or the custom ones. */
export function gainsFor(preset: PresetId, custom: readonly number[]): number[] {
  return cleanGains(preset === 'custom' ? custom : PRESETS[preset].gains);
}

/** A negative preamp as large as the biggest boost, so boosted bands cannot clip (0 when nothing is boosted). */
export function preampFor(gains: readonly number[]): number {
  const boost = Math.max(0, ...gains);
  return boost === 0 ? 0 : -boost;
}

/**
 * A "Device:" pattern for an output name. Equalizer APO matches when every word of the pattern appears in the device's
 * name, connection name or GUID, and ";" separates alternatives, so it is removed. Null when there is no usable word.
 */
export function devicePattern(name: string): string | null {
  const words = name.replace(/[;\r\n]/g, ' ').split(/\s+/).filter((w) => w !== '' && w !== '-');
  return words.length > 0 ? words.join(' ') : null;
}

/** The whole content of playlish.txt. With no device, the EQ applies to every output Equalizer APO is installed on. */
export function buildOwnFile(gains: readonly number[], device: string | null): string {
  const clean = cleanGains(gains);
  const pattern = device === null ? null : devicePattern(device);
  const lines = [
    `${OWN_MARKER}. Playlish changes this file; edit its Equalizer settings instead.`,
    pattern ? `Device: ${pattern}` : 'Device: all',
    `Preamp: ${preampFor(clean)} dB`,
    `GraphicEQ: ${BANDS.map((f, i) => `${f} ${clean[i] ?? 0}`).join('; ')}`,
    // Back to every device, so lines another file adds after ours are not limited to Playlish's device.
    'Device: all',
    '',
  ];
  return lines.join('\r\n');
}

/** True when config.txt already includes playlish.txt (any spacing or case). */
export function hasInclude(configText: string): boolean {
  return configText.split(/\r?\n/).some((l) => /^\s*include\s*:\s*playlish\.txt\s*$/i.test(l));
}

/** config.txt with the Include line added at the end, once. Line endings follow the file. */
export function addInclude(configText: string): string {
  if (hasInclude(configText)) return configText;
  const eol = configText.includes('\r\n') ? '\r\n' : '\n';
  const body = configText === '' || configText.endsWith('\n') ? configText : configText + eol;
  return `${body}${INCLUDE_LINE}${eol}`;
}

/** config.txt without Playlish's Include line(s); everything else stays exactly as it was. */
export function removeInclude(configText: string): string {
  return configText
    .split(/(?<=\n)/)
    .filter((line) => !/^\s*include\s*:\s*playlish\.txt\s*(\r?\n)?$/i.test(line))
    .join('');
}
