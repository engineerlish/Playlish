import { useEffect, useState } from 'preact/hooks';
import type { EqPresetId, EqView } from '../../shared/types';

/*
 * Settings → Audio → Equalizer (#91), through Equalizer APO. Playlish only writes its own file in Equalizer APO's
 * configuration, and the EQ is off until turned on here.
 */

// CHANGE HERE: preset names and band labels (must match src/main/eq/config.ts).
const PRESETS: { id: EqPresetId; label: string }[] = [
  { id: 'flat', label: 'Flat' },
  { id: 'bassBoost', label: 'Bass boost' },
  { id: 'bassCut', label: 'Bass cut' },
  { id: 'vocal', label: 'Vocal' },
  { id: 'trebleBoost', label: 'Treble boost' },
  { id: 'custom', label: 'Custom' },
];
const BANDS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
// CHANGE HERE: how long slider moves wait before the file is written (Equalizer APO reloads on every write).
const CUSTOM_DEBOUNCE_MS = 250;

export function EqualizerSettings({ eq }: { eq: EqView }) {
  const [custom, setCustom] = useState<number[]>(eq.custom);
  useEffect(() => setCustom(eq.custom), [eq.custom.join(',')]);

  // Write custom gains a moment after the last slider move.
  useEffect(() => {
    if (custom.join(',') === eq.custom.join(',')) return;
    const timer = window.setTimeout(() => window.ui.setEq({ custom }), CUSTOM_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [custom.join(',')]);

  return (
    <div id="eqSettings" class="eq">
      <h3>Equalizer</h3>
      {eq.status === 'not-installed' ? (
        <p class="muted" id="eqNotInstalled">
          The equalizer uses Equalizer APO, a free system-wide equalizer for Windows. It is not installed.{' '}
          <button class="text" id="eqDownload" onClick={() => window.ui.openEqDownload()}>
            Get Equalizer APO
          </button>
        </p>
      ) : (
        <>
          <label class="check" for="eqEnabled">
            <input id="eqEnabled" type="checkbox" checked={eq.enabled} onChange={(e) => window.ui.setEq({ enabled: (e.target as HTMLInputElement).checked })} />
            <span>
              Use the equalizer
              <span class="muted hint">Through Equalizer APO, on the device Playlish plays on. Other apps playing on that device are affected too.</span>
            </span>
          </label>
          {eq.status === 'needs-setup' && (
            <div class="banner" id="eqSetup" role="status">
              <span>Windows needs to allow Playlish to change its equalizer file once. This shows a Windows prompt; nothing else is changed.</span>
              <button class="primary" id="eqSetupButton" onClick={() => window.ui.setupEq()}>
                Allow
              </button>
            </div>
          )}
          <label class="field" for="eqPreset">
            <span>Preset</span>
            <select id="eqPreset" value={eq.preset} disabled={!eq.enabled} onChange={(e) => window.ui.setEq({ preset: (e.target as HTMLSelectElement).value as EqPresetId })}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {eq.preset === 'custom' && (
            <div class="eq-bands" role="group" aria-label="Custom equalizer">
              {BANDS.map((band, i) => (
                <label key={band} class="eq-band">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={custom[i] ?? 0}
                    disabled={!eq.enabled}
                    aria-label={`${band} Hz`}
                    aria-valuetext={`${custom[i] ?? 0} dB`}
                    onInput={(e) => {
                      const next = [...custom];
                      next[i] = Number((e.target as HTMLInputElement).value);
                      setCustom(next);
                    }}
                  />
                  <span class="muted">{band}</span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
      {eq.error && (
        <p class="error-text" role="alert" id="eqError">
          {eq.error}
        </p>
      )}
    </div>
  );
}
