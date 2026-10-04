import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicesController, REFRESH_AFTER_TRANSFER_MS, THIS_DEVICE_NAME, toDeviceList, type DevicesApi } from '../src/main/devices';
import type { Device } from '../src/main/spotify/types';

function device(id: string | null, name: string, overrides: Partial<Device> = {}): Device {
  return { id, name, type: 'Speaker', is_active: false, is_restricted: false, is_private_session: false, volume_percent: 50, supports_volume: true, ...overrides };
}

describe('toDeviceList', () => {
  it('puts this computer first, then the active device, then the rest by name', () => {
    const list = toDeviceList([device('b', 'Bedroom'), device('k', 'Kitchen', { is_active: true }), device('ours', 'Playlish'), device('a', 'Attic')], 'ours');

    expect(list.map((d) => d.id)).toEqual(['ours', 'k', 'a', 'b']);
    expect(list[0]).toMatchObject({ name: THIS_DEVICE_NAME, isThisDevice: true });
    expect(list[1]).toMatchObject({ active: true, volume: 0.5 });
  });

  it('adds this computer while Spotify does not list it yet (just started or restarted)', () => {
    const list = toDeviceList([device('k', 'Kitchen', { is_active: true })], 'new-id');

    expect(list[0]).toMatchObject({ id: 'new-id', isThisDevice: true, active: false });
  });

  it('follows a new id for this computer after a player restart', () => {
    const devices = [device('old-id', 'Playlish'), device('new-id', 'Playlish')];

    const list = toDeviceList(devices, 'new-id');

    expect(list.find((d) => d.isThisDevice)?.id).toBe('new-id');
    expect(list.filter((d) => d.isThisDevice)).toHaveLength(1);
  });

  it('leaves out devices without an id and keeps restricted ones (shown disabled)', () => {
    const list = toDeviceList([device(null, 'Ghost'), device('', 'Empty'), device('tv', 'TV', { is_restricted: true })], null);

    expect(list).toEqual([expect.objectContaining({ id: 'tv', restricted: true })]);
  });

  it('reports no volume for devices that do not allow changing it', () => {
    expect(toDeviceList([device('x', 'X', { supports_volume: false })], null)[0]?.volume).toBeNull();
    expect(toDeviceList([device('x', 'X', { volume_percent: null })], null)[0]?.volume).toBeNull();
  });
});

describe('DevicesController', () => {
  let api: { devices: ReturnType<typeof vi.fn>; transfer: ReturnType<typeof vi.fn> };
  let own: string | null;
  let playing: boolean;
  let afterTransfer: number;
  let errors: unknown[];

  function controller() {
    return new DevicesController({
      api: () => api as unknown as DevicesApi,
      ownDeviceId: () => own,
      isPlaying: () => playing,
      onChange: () => undefined,
      afterTransfer: () => {
        afterTransfer++;
      },
      onError: (e) => errors.push(e),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    api = {
      devices: vi.fn().mockResolvedValue([device('ours', 'Playlish', { is_active: true }), device('k', 'Kitchen')]),
      transfer: vi.fn().mockResolvedValue(undefined),
    };
    own = 'ours';
    playing = true;
    afterTransfer = 0;
    errors = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads nothing until asked, then loads with user priority', async () => {
    const c = controller();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.devices).not.toHaveBeenCalled();
    expect(c.view().list).toBeNull();

    await c.refresh();

    expect(api.devices).toHaveBeenCalledWith('user');
    expect(c.view().list?.map((d) => d.id)).toEqual(['ours', 'k']);
  });

  it('never refreshes on a timer', async () => {
    const c = controller();
    await c.refresh();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(api.devices).toHaveBeenCalledTimes(1);
  });

  it('moves playback, keeps it playing, marks the new device active at once and re-checks shortly after', async () => {
    const c = controller();
    await c.refresh();

    await c.transfer('k');

    expect(api.transfer).toHaveBeenCalledWith('k', true);
    expect(c.view().list?.find((d) => d.active)?.id).toBe('k');
    expect(afterTransfer).toBe(1);
    await vi.advanceTimersByTimeAsync(REFRESH_AFTER_TRANSFER_MS);
    expect(api.devices).toHaveBeenCalledTimes(2);
  });

  it('does not start playback when nothing was playing', async () => {
    playing = false;
    const c = controller();
    await c.refresh();

    await c.transfer('k');

    expect(api.transfer).toHaveBeenCalledWith('k', false);
  });

  it('brings playback back to this computer using its current id', async () => {
    api.devices.mockResolvedValue([device('k', 'Kitchen', { is_active: true })]);
    own = 'restarted-id';
    const c = controller();
    await c.refresh();

    await c.transfer('restarted-id');

    expect(api.transfer).toHaveBeenCalledWith('restarted-id', true);
  });

  it('refuses devices that were never listed', async () => {
    const c = controller();
    await c.refresh();

    await c.transfer('somewhere-else');

    expect(api.transfer).not.toHaveBeenCalled();
  });

  it('reports failures in plain words and keeps the old list', async () => {
    const c = controller();
    await c.refresh();
    api.transfer.mockRejectedValue(new Error('404'));

    await c.transfer('k');

    expect(c.view().error).toBe('Could not move playback to that device.');
    expect(c.view().list?.find((d) => d.active)?.id).toBe('ours');
    expect(errors).toHaveLength(1);
    expect(afterTransfer).toBe(0);
  });

  it('reports a failed refresh', async () => {
    api.devices.mockRejectedValue(new Error('500'));
    const c = controller();

    await c.refresh();

    expect(c.view()).toMatchObject({ list: null, loading: false, error: 'Could not load your devices.' });
  });

  it('ignores a second refresh or transfer while one is running', async () => {
    let finish: (v: Device[]) => void = () => undefined;
    api.devices.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const c = controller();

    const first = c.refresh();
    expect(c.view().loading).toBe(true);
    await c.refresh();
    finish([device('k', 'Kitchen')]);
    await first;

    expect(api.devices).toHaveBeenCalledTimes(1);
  });

  it('forgets the list on reset and stops a pending re-check', async () => {
    const c = controller();
    await c.refresh();
    await c.transfer('k');
    c.reset();
    await vi.advanceTimersByTimeAsync(REFRESH_AFTER_TRANSFER_MS * 2);

    expect(c.view().list).toBeNull();
    expect(api.devices).toHaveBeenCalledTimes(1);
  });
});
