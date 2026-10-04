import { useEffect, useRef, useState } from 'preact/hooks';
import type { DevicesView } from '../../shared/types';
import { DeviceList } from './DeviceList';
import { Icon } from './Icon';

/** The bar's device button: opens a small list (loaded on opening) to move playback. Escape or a click outside closes it. */
export function DevicePicker({ view, disabled }: { view: DevicesView; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    window.ui.refreshDevices();
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Close once a transfer has finished.
  const wasTransferring = useRef(false);
  useEffect(() => {
    if (wasTransferring.current && view.transferring === null) setOpen(false);
    wasTransferring.current = view.transferring !== null;
  }, [view.transferring]);

  return (
    // Escape is handled on the picker itself, so it works the moment the list is drawn (#81: a listener added in an
    // effect could miss an Escape pressed right after opening).
    <div
      class="picker"
      ref={root}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') {
          setOpen(false);
          root.current?.querySelector<HTMLButtonElement>('#devicePicker')?.focus();
        }
      }}
    >
      <button
        id="devicePicker"
        class={`icon${open ? ' on' : ''}`}
        disabled={disabled}
        aria-label="Choose a device"
        title="Choose a device"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Icon name="device" />
      </button>
      {open && (
        <div class="popover" role="dialog" aria-label="Devices">
          <div class="popover-title">Play on</div>
          <DeviceList view={view} idPrefix="pick" />
        </div>
      )}
    </div>
  );
}
