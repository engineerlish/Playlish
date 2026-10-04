import { useEffect } from 'preact/hooks';
import type { Snapshot } from '../../../shared/types';
import { DeviceList } from '../DeviceList';

/** Spotify Connect devices (#44). The list loads when the page opens and on Refresh; it is never polled. */
export function DevicesPage({ snapshot }: { snapshot: Snapshot }) {
  useEffect(() => window.ui.refreshDevices(), []);
  const view = snapshot.devices;
  return (
    <div id="page-devices">
      <h1>Devices</h1>
      <section class="card">
        <p class="muted">Choose where your music plays. Playback moves without stopping.</p>
        <DeviceList view={view} idPrefix="device" />
        {view.error && view.list !== null && (
          <p class="error-text" role="alert">
            {view.error}
          </p>
        )}
        <div class="row">
          <button id="refreshDevices" disabled={view.loading} onClick={() => window.ui.refreshDevices()}>
            {view.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>
    </div>
  );
}
