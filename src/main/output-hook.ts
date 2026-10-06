// This file runs in a browser frame, not in the main process (see below), so it needs the DOM types.
/// <reference lib="dom" />

/*
 * Output device selection (#89). The Web Playback SDK plays from inside its own cross-origin iframe, where neither the
 * playback host page nor the main window can reach its media element. The main process injects this function into
 * every frame of the playback host (webFrameMain.executeJavaScript), so it also runs in the SDK's frame.
 *
 * It routes every media element to the chosen device when it starts playing, and moves the ones already playing when
 * the choice changes. Devices are chosen by name: device ids are different for every website origin, so the id the
 * window sees would not match the id inside the SDK's frame.
 *
 * Keep this function self-contained (no imports, no outside variables): it is turned into source text and run in
 * another page.
 */

export interface OutputHookResult {
  /** 'default' when no device was asked for; 'found' when the named device exists here; 'missing' when it does not. */
  status: 'default' | 'found' | 'missing';
  /** How many media elements in this frame were moved. */
  moved: number;
}

interface HookState {
  label: string | null;
  sinkId: string;
  elements: Set<HTMLMediaElement>;
}

/** Installs the hook once per frame (later calls only change the device) and applies the device with this name. */
export async function applyOutputDevice(label: string | null): Promise<OutputHookResult> {
  const w = window as unknown as { __playlishOutput?: HookState };
  if (!w.__playlishOutput) {
    const state: HookState = { label: null, sinkId: '', elements: new Set() };
    w.__playlishOutput = state;
    // Kept to call it with the right element from the replacement below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPlay = HTMLMediaElement.prototype.play;
    // Every element that plays is remembered (to move it later) and sent to the chosen device first.
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      state.elements.add(this);
      if (state.sinkId !== '' && this.sinkId !== state.sinkId) void this.setSinkId(state.sinkId).catch(() => undefined);
      return originalPlay.call(this);
    };
    // A device plugged in again gets the music back.
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      void (window as unknown as { __playlishApply?: (l: string | null) => Promise<OutputHookResult> }).__playlishApply?.(state.label);
    });
  }
  const state = w.__playlishOutput;
  const apply = async (wanted: string | null): Promise<OutputHookResult> => {
    state.label = wanted;
    let status: OutputHookResult['status'] = 'default';
    let sinkId = '';
    if (wanted !== null) {
      const devices = navigator.mediaDevices ? await navigator.mediaDevices.enumerateDevices() : [];
      const match = devices.find((d) => d.kind === 'audiooutput' && d.label === wanted && d.deviceId !== 'default' && d.deviceId !== 'communications');
      // A missing device (unplugged) plays on the system default until it is back.
      status = match ? 'found' : 'missing';
      sinkId = match?.deviceId ?? '';
    }
    state.sinkId = sinkId;
    let moved = 0;
    for (const el of state.elements) {
      if (el.sinkId === sinkId) continue;
      try {
        await el.setSinkId(sinkId);
        moved++;
      } catch {
        // An element that cannot switch keeps playing where it is.
      }
    }
    return { status, moved };
  };
  (window as unknown as { __playlishApply?: typeof apply }).__playlishApply = apply;
  return apply(label);
}

/** Source text that installs the hook and applies `label` in whatever frame it runs in. */
export function outputHookScript(label: string | null): string {
  return `(${applyOutputDevice.toString()})(${JSON.stringify(label)})`;
}
