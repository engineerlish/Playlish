import { describe, expect, it } from 'vitest';
import { MAX_OUTPUTS, MAX_OUTPUT_NAME, outputNamesFrom, validOutputNames } from '../src/shared/outputs';

describe('outputNamesFrom', () => {
  it('keeps named outputs only, without the default and communications aliases, sorted and unique', () => {
    const devices = [
      { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' },
      { kind: 'audiooutput', deviceId: 'communications', label: 'Communications - Headset' },
      { kind: 'audiooutput', deviceId: 'a', label: 'Speakers' },
      { kind: 'audiooutput', deviceId: 'b', label: 'Headset' },
      { kind: 'audiooutput', deviceId: 'c', label: 'Speakers' },
      { kind: 'audiooutput', deviceId: 'd', label: '' },
      { kind: 'audioinput', deviceId: 'e', label: 'Microphone' },
    ] as const;

    expect(outputNamesFrom(devices)).toEqual(['Headset', 'Speakers']);
  });
});

describe('validOutputNames', () => {
  it('accepts a list of names and returns it sorted and unique', () => {
    expect(validOutputNames(['Speakers', 'Headset', 'Speakers'])).toEqual(['Headset', 'Speakers']);
    expect(validOutputNames([])).toEqual([]);
  });

  it('rejects anything that is not a reasonable list of names', () => {
    expect(validOutputNames(null)).toBeNull();
    expect(validOutputNames('Speakers')).toBeNull();
    expect(validOutputNames(['Speakers', 3])).toBeNull();
    expect(validOutputNames([''])).toBeNull();
    expect(validOutputNames(['x'.repeat(MAX_OUTPUT_NAME + 1)])).toBeNull();
    expect(validOutputNames(Array.from({ length: MAX_OUTPUTS + 1 }, (_, i) => `Output ${i}`))).toBeNull();
  });
});
