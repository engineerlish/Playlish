import type { DeviceInfo, DevicesView } from '../../shared/types';
import { Icon } from './Icon';
import { StateMessage } from './StateMessage';

/** One line per device; the active one is marked, restricted ones cannot be picked. Used by the page and the picker. */
export function DeviceList({ view, idPrefix }: { view: DevicesView; idPrefix: string }) {
  if (view.list === null) {
    if (view.loading) return <StateMessage kind="loading" compact title="Looking for your devices…" />;
    return view.error ? <StateMessage kind="error" compact title={view.error} /> : <StateMessage kind="empty" compact icon="device" title="No devices loaded yet." />;
  }
  if (view.list.length === 0)
    return (
      <StateMessage kind="empty" compact icon="device" title="No devices found.">
        <p>Open Spotify on a phone, speaker or computer and refresh.</p>
      </StateMessage>
    );
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
      title={device.active ? `${device.name}: already playing on this device` : `Play on ${device.name}`}
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
