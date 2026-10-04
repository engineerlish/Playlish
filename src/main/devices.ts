import type { DeviceInfo, DevicesView } from '../shared/types';
import type { Device } from './spotify/types';

/*
 * Spotify Connect devices (#44): the list shown on the Devices page and in the bar's picker, and moving playback
 * between devices. The list is fetched when someone looks at it (page or picker opened, refresh button, after a
 * transfer), never on a timer.
 */

// CHANGE HERE: how soon to re-check the list after a transfer (Spotify needs a moment to switch the active device).
export const REFRESH_AFTER_TRANSFER_MS = 800;
// CHANGE HERE: the name shown for Playlish's own player in the list.
export const THIS_DEVICE_NAME = 'This computer (Playlish)';

/**
 * The list as the UI shows it: this computer first, then the active device, then the rest by name. Devices without an
 * id cannot be controlled through the Web API and are left out. If Spotify does not list this computer yet (it takes a
 * moment after the player starts or restarts), it is added so playback can always be brought back.
 */
export function toDeviceList(devices: readonly Device[], ownDeviceId: string | null): DeviceInfo[] {
  const list: DeviceInfo[] = devices
    .filter((d): d is Device & { id: string } => typeof d.id === 'string' && d.id !== '')
    .map((d) => ({
      id: d.id,
      name: d.id === ownDeviceId ? THIS_DEVICE_NAME : d.name,
      type: d.type,
      active: d.is_active,
      restricted: d.is_restricted,
      isThisDevice: d.id === ownDeviceId,
      volume: d.supports_volume && d.volume_percent !== null ? d.volume_percent / 100 : null,
    }));
  if (ownDeviceId && !list.some((d) => d.isThisDevice)) {
    list.push({ id: ownDeviceId, name: THIS_DEVICE_NAME, type: 'Computer', active: false, restricted: false, isThisDevice: true, volume: null });
  }
  const rank = (d: DeviceInfo) => (d.isThisDevice ? 0 : d.active ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export interface DevicesApi {
  devices(priority?: 'user' | 'visible' | 'background'): Promise<Device[]>;
  transfer(deviceId: string, play?: boolean): Promise<void>;
}

export interface DevicesDeps {
  api(): DevicesApi | null;
  ownDeviceId(): string | null;
  /** Whether something is playing right now (a transfer keeps it playing). */
  isPlaying(): boolean;
  onChange(): void;
  /** Called after a transfer went through, so Now Playing can look again. */
  afterTransfer(): void;
  onError(error: unknown): void;
}

/** Holds the device list and performs transfers. */
export class DevicesController {
  private devices: Device[] | null = null;
  private loading = false;
  private transferring: string | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: DevicesDeps) {}

  /** What the UI shows. Rebuilt on every call so a new own device id (after a player restart) is picked up at once. */
  view(): DevicesView {
    return {
      list: this.devices ? toDeviceList(this.devices, this.deps.ownDeviceId()) : null,
      loading: this.loading,
      transferring: this.transferring,
      error: this.error,
    };
  }

  /** Fetches the list now (page or picker opened, or the refresh button). */
  async refresh(): Promise<void> {
    const api = this.deps.api();
    if (!api || this.loading) return;
    this.loading = true;
    this.deps.onChange();
    try {
      this.devices = await api.devices('user');
      this.error = null;
    } catch (err) {
      this.error = 'Could not load your devices.';
      this.deps.onError(err);
    } finally {
      this.loading = false;
      this.deps.onChange();
    }
  }

  /** Moves playback to a device, keeping it playing if it was. */
  async transfer(deviceId: string): Promise<void> {
    const api = this.deps.api();
    if (!api || this.transferring) return;
    const known = this.view().list?.some((d) => d.id === deviceId) ?? false;
    if (!known) return; // only devices the user was shown
    this.transferring = deviceId;
    this.deps.onChange();
    try {
      await api.transfer(deviceId, this.deps.isPlaying());
      this.error = null;
      // Show the new active device at once; the refresh below confirms it.
      this.devices = (this.devices ?? []).map((d) => ({ ...d, is_active: d.id === deviceId }));
      this.deps.afterTransfer();
    } catch (err) {
      this.error = 'Could not move playback to that device.';
      this.deps.onError(err);
    } finally {
      this.transferring = null;
      this.deps.onChange();
    }
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, REFRESH_AFTER_TRANSFER_MS);
  }

  /** Forgets the list (sign-out). */
  reset(): void {
    this.cancel();
    this.devices = null;
    this.error = null;
    this.deps.onChange();
  }

  /** Stops the pending refresh (app quit). */
  stop(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
