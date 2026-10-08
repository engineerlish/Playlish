import { describe, expect, it } from 'vitest';
import { BANDS, INCLUDE_LINE, MAX_GAIN_DB, PRESETS, addInclude, buildOwnFile, cleanGains, devicePattern, gainsFor, hasInclude, preampFor, removeInclude } from '../src/main/eq/config';

describe('gains and preamp', () => {
  it('cleans gains: one per band, clamped, rounded to 0.5 dB, bad values as 0', () => {
    expect(cleanGains([20, -20, 1.26, Number.NaN])).toEqual([MAX_GAIN_DB, -MAX_GAIN_DB, 1.5, 0, 0, 0, 0, 0, 0, 0]);
    expect(cleanGains([])).toHaveLength(BANDS.length);
  });

  it('presets and custom gains', () => {
    expect(gainsFor('flat', [])).toEqual(Array(10).fill(0));
    expect(gainsFor('bassBoost', [])).toEqual([...PRESETS.bassBoost.gains]);
    expect(gainsFor('custom', [3, 3])).toEqual([3, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('lowers the preamp by the biggest boost so nothing clips', () => {
    expect(preampFor([6, 2, -3])).toBe(-6);
    expect(preampFor([-8, -2])).toBe(0);
  });
});

describe('playlish.txt', () => {
  it('limits the EQ to the chosen device, with preamp and all ten bands, then resets the device filter', () => {
    const text = buildOwnFile([6, 5, 4, 2, 0, 0, 0, 0, 0, 0], 'Speakers (Realtek High Definition Audio)');
    const lines = text.split('\r\n');

    expect(lines[0]).toMatch(/^# Written by Playlish/);
    expect(lines[1]).toBe('Device: Speakers (Realtek High Definition Audio)');
    expect(lines[2]).toBe('Preamp: -6 dB');
    expect(lines[3]).toBe('GraphicEQ: 31 6; 62 5; 125 4; 250 2; 500 0; 1000 0; 2000 0; 4000 0; 8000 0; 16000 0');
    expect(lines[4]).toBe('Device: all');
  });

  it('applies to every output without a device, and cleans names that would break the syntax', () => {
    expect(buildOwnFile([], null).split('\r\n')[1]).toBe('Device: all');
    expect(devicePattern('Bad; Name\r\nHere')).toBe('Bad Name Here');
    expect(devicePattern('Default - Speakers')).toBe('Default Speakers');
    expect(devicePattern(' ; ')).toBeNull();
  });
});

describe('the Include line in config.txt', () => {
  const USER = 'Preamp: -3 dB\r\nGraphicEQ: 100 2\r\n';

  it('is added once at the end, keeping the user lines and line endings', () => {
    const once = addInclude(USER);

    expect(once).toBe(`${USER}${INCLUDE_LINE}\r\n`);
    expect(addInclude(once)).toBe(once);
    expect(addInclude('Preamp: 0 dB')).toBe(`Preamp: 0 dB\n${INCLUDE_LINE}\n`);
    expect(addInclude('')).toBe(`${INCLUDE_LINE}\n`);
  });

  it('is recognised in any spacing or case, and removed without touching anything else', () => {
    const mixed = `${USER}include:   PLAYLISH.TXT\r\nCopy: L=R\r\n`;

    expect(hasInclude(mixed)).toBe(true);
    expect(removeInclude(mixed)).toBe(`${USER}Copy: L=R\r\n`);
    expect(removeInclude(addInclude(USER))).toBe(USER);
    expect(hasInclude('Include: other.txt')).toBe(false);
    expect(removeInclude('Include: other.txt\n')).toBe('Include: other.txt\n');
  });
});
