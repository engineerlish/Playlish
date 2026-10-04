import type { EqPresetId, EqView } from '../../shared/types';
import { apoStatus, applyEq, elevatedSetupScript, type ApoDeps } from './apo';
import { gainsFor } from './config';

/*
 * The equalizer as the app sees it (#91): status for the Settings page, applying the settings to Equalizer APO, and the
 * one-time Windows prompt when its config folder is not writable for the user.
 */

export interface EqSettings {
  enabled: boolean;
  preset: EqPresetId;
  custom: number[];
}

export interface EqDeps {
  apo: ApoDeps;
  settings(): { eq: EqSettings; outputDevice: string | null };
  /** The name of the system's default output (for "System default"), or null when it cannot be told. */
  defaultOutputName(): Promise<string | null>;
  /** Runs a PowerShell script with administrator rights (one Windows prompt); false if it was cancelled or failed. */
  runElevated(script: string): Promise<boolean>;
  /** DOMAIN\user of the person running Playlish. */
  windowsUser(): string;
  onChange(): void;
  warn(message: string, error?: unknown): void;
}

export class EqController {
  private status: EqView['status'] = 'not-installed';
  private error: string | null = null;
  private busy = Promise.resolve();

  constructor(private readonly deps: EqDeps) {}

  /** What the Settings page shows. */
  view(): EqView {
    const { eq } = this.deps.settings();
    return { status: this.status, enabled: eq.enabled, preset: eq.preset, custom: [...eq.custom], error: this.error };
  }

  /** Applies the current settings (one at a time, in order). */
  apply(): Promise<void> {
    this.busy = this.busy.then(() => this.applyNow());
    return this.busy;
  }

  /** The one-time Windows prompt, then applying again. */
  async setup(): Promise<void> {
    const status = apoStatus(this.deps.apo);
    if (!status.installed) return;
    const ok = await this.deps.runElevated(elevatedSetupScript(status.configPath, this.deps.windowsUser()));
    if (!ok) {
      this.error = 'The Windows prompt was cancelled or failed, so the equalizer cannot be changed yet.';
      this.deps.onChange();
      return;
    }
    this.error = null;
    await this.apply();
  }

  private async applyNow(): Promise<void> {
    const { eq, outputDevice } = this.deps.settings();
    try {
      // The EQ follows the device Playlish plays on; for "System default", the device that is the default right now.
      const device = outputDevice ?? (eq.enabled ? await this.deps.defaultOutputName() : null);
      const result = applyEq(this.deps.apo, { enabled: eq.enabled, gains: gainsFor(eq.preset, eq.custom), device });
      this.status = result === 'not-installed' ? 'not-installed' : result === 'needs-setup' ? 'needs-setup' : 'ready';
      this.error = null;
    } catch (err) {
      this.error = 'Could not change the Equalizer APO configuration.';
      this.deps.warn('Applying the equalizer failed', err);
      const status = apoStatus(this.deps.apo);
      this.status = status.installed ? this.status : 'not-installed';
    }
    this.deps.onChange();
  }
}
