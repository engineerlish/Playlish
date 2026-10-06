import { useEffect, useState } from 'preact/hooks';

/*
 * Settings → Audio (#89): choose the output device by name. The list follows devices being plugged in and out.
 */

/** Output device names on this computer, without Windows' "default" and "communications" aliases. */
async function outputNames(): Promise<string[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const names = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label !== '').map((d) => d.label);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function AudioSettings({ output }: { output: string | null }) {
  const [names, setNames] = useState<string[] | null>(null);

  useEffect(() => {
    const refresh = () => void outputNames().then(setNames, () => setNames([]));
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);

  const missing = output !== null && names !== null && !names.includes(output);
  return (
    <section class="card" id="audioSettings">
      <h2>Audio</h2>
      <label class="field" for="outputDevice">
        <span>Play on</span>
        <select
          id="outputDevice"
          value={output ?? ''}
          disabled={names === null}
          onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value;
            window.ui.setOutput(value === '' ? null : value);
          }}
        >
          <option value="">System default</option>
          {(names ?? []).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          {missing && <option value={output}>{output} (not connected)</option>}
        </select>
      </label>
      {missing && (
        <p id="outputMissing" class="muted">
          That device is not connected, so Playlish plays on the system default until it is back.
        </p>
      )}
    </section>
  );
}
