import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOutputDevice, outputHookScript } from '../src/main/output-hook';

/** A media element as far as the hook needs it. A fresh class per test: the hook patches its prototype. */
const makeMedia = () =>
  class FakeMedia {
  sinkId = '';
  failSink = false;
  play() {
    return Promise.resolve();
  }
  setSinkId(id: string) {
    if (this.failSink) return Promise.reject(new Error('cannot switch'));
    this.sinkId = id;
    return Promise.resolve();
  }
  };
let FakeMedia: ReturnType<typeof makeMedia>;

// CHANGE HERE if the test devices change: what enumerateDevices reports in the frame.
let devices: { kind: string; label: string; deviceId: string }[];
let deviceChange: (() => void) | null;

beforeEach(() => {
  devices = [
    { kind: 'audiooutput', label: 'Default - Speakers', deviceId: 'default' },
    { kind: 'audiooutput', label: 'Speakers', deviceId: 'spk-id' },
    { kind: 'audiooutput', label: 'Headphones', deviceId: 'hp-id' },
    { kind: 'audioinput', label: 'Headphones', deviceId: 'mic-id' },
  ];
  deviceChange = null;
  FakeMedia = makeMedia();
  vi.stubGlobal('window', {});
  vi.stubGlobal('HTMLMediaElement', FakeMedia);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices: () => Promise.resolve(devices),
      addEventListener: (_type: string, fn: () => void) => {
        deviceChange = fn;
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyOutputDevice (runs inside the playback frames)', () => {
  it('sends elements that start playing to the chosen output, matched by name', async () => {
    expect(await applyOutputDevice('Headphones')).toEqual({ status: 'found', moved: 0 });

    const el = new FakeMedia();
    await el.play();

    await vi.waitFor(() => expect(el.sinkId).toBe('hp-id'));
  });

  it('moves elements that are already playing when the choice changes, and back to the default', async () => {
    await applyOutputDevice(null);
    const el = new FakeMedia();
    await el.play();
    expect(el.sinkId).toBe('');

    expect(await applyOutputDevice('Speakers')).toEqual({ status: 'found', moved: 1 });
    expect(el.sinkId).toBe('spk-id');
    expect(await applyOutputDevice(null)).toEqual({ status: 'default', moved: 1 });
    expect(el.sinkId).toBe('');
  });

  it('plays on the default while the device is missing, and returns when it is plugged in again', async () => {
    await applyOutputDevice(null);
    const el = new FakeMedia();
    await el.play();
    devices = devices.filter((d) => d.label !== 'Headphones');

    expect(await applyOutputDevice('Headphones')).toEqual({ status: 'missing', moved: 0 });
    expect(el.sinkId).toBe('');

    devices.push({ kind: 'audiooutput', label: 'Headphones', deviceId: 'hp-id-2' });
    deviceChange?.();
    await vi.waitFor(() => expect(el.sinkId).toBe('hp-id-2'));
  });

  it('never picks an input device or the "default" alias', async () => {
    devices = [
      { kind: 'audioinput', label: 'Mic', deviceId: 'mic' },
      { kind: 'audiooutput', label: 'Mic', deviceId: 'default' },
    ];

    expect((await applyOutputDevice('Mic')).status).toBe('missing');
  });

  it('keeps playing where it is when an element cannot switch', async () => {
    await applyOutputDevice(null);
    const el = new FakeMedia();
    el.failSink = true;
    await el.play();

    expect(await applyOutputDevice('Speakers')).toEqual({ status: 'found', moved: 0 });
  });

  it('installs itself once per frame', async () => {
    /* eslint-disable @typescript-eslint/unbound-method -- comparing the method objects themselves */
    const play = FakeMedia.prototype.play;
    await applyOutputDevice('Speakers');
    const patched = FakeMedia.prototype.play;
    await applyOutputDevice('Headphones');

    expect(patched).not.toBe(play);
    expect(FakeMedia.prototype.play).toBe(patched);
    /* eslint-enable @typescript-eslint/unbound-method */
  });
});

describe('outputHookScript', () => {
  it('is the function as source text, called with the name as a JSON string', () => {
    const script = outputHookScript('Speakers "Living room"');
    expect(script.startsWith('(')).toBe(true);
    expect(script.endsWith('("Speakers \\"Living room\\"")')).toBe(true);
    expect(outputHookScript(null).endsWith('(null)')).toBe(true);
  });
});
