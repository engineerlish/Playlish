import { useEffect } from 'preact/hooks';
import type { Snapshot } from '../../../shared/types';
import { DeviceList } from '../DeviceList';
import { Icon } from '../Icon';

/** Spotify Connect devices (#44). The list loads when the page opens and on Refresh; it is never polled. */
export function DevicesPage({ snapshot }: { snapshot: Snapshot }) {
  useEffect(() => window.ui.refreshDevices(), []);
  const view = snapshot.devices;
  return (
    <div id="page-devices">
      <div class="page-head">
        <p class="muted">Choose where your music plays. Playback moves without stopping.</p>
        <span class="spacer" />
        <button id="refreshDevices" class="text" disabled={view.loading} onClick={() => window.ui.refreshDevices()}>
          <Icon name="refresh" />
          {view.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <section class="card">
        <DeviceList view={view} idPrefix="device" />
        {view.error && view.list !== null && (
          <p class="error-text" role="alert">
            {view.error}
          </p>
        )}
      </section>
    </div>
  );
}
