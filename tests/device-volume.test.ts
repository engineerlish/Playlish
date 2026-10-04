import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_KEY, MAX_REMEMBERED, recallVolume, rememberVolume, volumeKey } from '../src/main/device-volume';

describe('volume per output device', () => {
  it('keys outputs by name, and the system default by its own key', () => {
    expect(volumeKey('Headphones')).toBe('Headphones');
    expect(volumeKey(null)).toBe(DEFAULT_OUTPUT_KEY);
  });

  it('remembers and recalls per output, clamped to 0..1, without changing the input', () => {
    const start = { Speakers: 0.4 };
    const next = rememberVolume(start, 'Headphones', 1.5);

    expect(next).toEqual({ Speakers: 0.4, Headphones: 1 });
    expect(start).toEqual({ Speakers: 0.4 });
    expect(recallVolume(next, 'Headphones')).toBe(1);
    expect(recallVolume(next, null)).toBeNull();
    expect(recallVolume(rememberVolume(next, DEFAULT_OUTPUT_KEY, -1), null)).toBe(0);
  });

  it('drops the device used longest ago when full', () => {
    let volumes: Record<string, number> = {};
    for (let i = 0; i < MAX_REMEMBERED; i++) volumes = rememberVolume(volumes, `Device ${i}`, 0.5);
    volumes = rememberVolume(volumes, 'Device 0', 0.6); // used again, so now the newest
    volumes = rememberVolume(volumes, 'New device', 0.7);

    expect(Object.keys(volumes)).toHaveLength(MAX_REMEMBERED);
    expect(volumes['Device 1']).toBeUndefined();
    expect(volumes['Device 0']).toBe(0.6);
    expect(volumes['New device']).toBe(0.7);
  });
});
