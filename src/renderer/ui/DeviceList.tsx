import type { DeviceInfo, DevicesView } from '../../shared/types';
import { Icon } from './Icon';

/** One line per device; the active one is marked, restricted ones cannot be picked. Used by the page and the picker. */
export function DeviceList({ view, idPrefix }: { view: DevicesView; idPrefix: string }) {
  if (view.list === null) return <p class="muted">{view.loading ? 'Looking for your devices…' : (view.error ?? 'No devices loaded yet.')}</p>;
  if (view.list.length === 0) return <p class="muted">No devices found. Open Spotify on a phone, speaker or computer and refresh.</p>;
  return (
    <ul class="devices" aria-label="Spotify Connect devices">
      {view.list.map((d) => (
        <li key={d.id}>
          <DeviceButton device={d} busy={view.transferring !== null} moving={view.transferring === d.id} idPrefix={idPrefix} />
        </li>
      ))}
    </ul>
  );
}

function DeviceButton({ device, busy, moving, idPrefix }: { device: DeviceInfo; busy: boolean; moving: boolean; idPrefix: string }) {
  const state = moving ? 'Moving playback…' : device.active ? 'Playing here' : device.restricted ? 'Cannot be controlled from Playlish' : device.type;
  return (
    <button
      id={`${idPrefix}-${device.isThisDevice ? 'this' : device.id}`}
      class={`device-row${device.active ? ' active' : ''}`}
      disabled={busy || device.active || device.restricted}
      aria-current={device.active ? 'true' : undefined}
      title={device.active ? 'Already playing on this device' : `Play on ${device.name}`}
      onClick={() => window.ui.transfer(device.id)}
    >
      <Icon name="device" />
      <span class="device-text">
        <span class="device-name">{device.name}</span>
        <span class="muted">{state}</span>
      </span>
    </button>
  );
}
