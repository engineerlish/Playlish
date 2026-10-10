import { randomUUID } from 'node:crypto';
import type { PluginPrompt, PluginView } from '../../shared/plugins';
import { DEFAULT_LIMITS, type SandboxLimits, type Violation } from './limits';
import { PackageError, inspectPackage, type InstalledPlugin, type PackageInspection } from './store';
import { ZIP_LIMITS } from './zip';

/*
 * The plugin manager (#101): install from a file after a permission prompt, enable, disable, update and uninstall, and
 * keeping the plugin-host process in step (a plugin that is on is loaded; the process only runs while one is).
 *
 * - The prompt shows what the package asks for. Approving installs exactly the bytes that were shown (they are kept in
 *   memory, not read again), and only while the prompt is fresh.
 * - An update that asks for more permissions shows them as new in the prompt; nothing changes until it is approved.
 * - Safe mode (#50) installs and lists plugins but never loads one.
 * - A plugin that fails to start, keeps breaking its limits or crashes the plugin process is turned off, with the
 *   reason shown in the plugin manager.
 */

// CHANGE HERE: how long an install prompt stays valid.
export const PROMPT_TTL_MS = 10 * 60_000;

/** What the manager needs from the store (a PluginStore, or a fake in tests). */
export interface StoreLike {
  list(): InstalledPlugin[];
  get(id: string): InstalledPlugin | null;
  code(id: string): string;
  install(pkg: PackageInspection): InstalledPlugin;
  setEnabled(id: string, enabled: boolean, reason?: string | null): void;
  uninstall(id: string): void;
}

/** What the manager needs from the plugin host (a PluginHost, or a fake in tests). */
export interface HostLike {
  load(pluginId: string, code: string, limits: SandboxLimits): Promise<void>;
  unload(pluginId: string): void;
}

export interface PluginManagerDeps {
  store: StoreLike;
  host: HostLike;
  safeMode: boolean;
  /** Reads a package file (the size is checked before reading). */
  readFile(file: string): Buffer;
  fileSize(file: string): number;
  onChange(): void;
  log(level: 'info' | 'warn', message: string, context: Record<string, unknown>): void;
  newToken?: () => string;
  now?: () => number;
}

/** The plugin manager's message for a plugin that Playlish turned off. */
export function disabledReason(reasons: (Violation | 'crash')[]): string {
  if (reasons.includes('crash')) return 'Turned off because the plugin process crashed twice while it was running.';
  const words: Record<Violation, string> = { memory: 'memory', cpu: 'time per event', 'cpu-minute': 'time per minute', error: 'errors' };
  const unique = [...new Set(reasons)].filter((r): r is Violation => r !== 'crash').map((r) => words[r]);
  return `Turned off because it kept going over its limits (${unique.join(', ') || 'limits'}).`;
}

export class PluginManager {
  private prompt: { view: PluginPrompt; pkg: PackageInspection; at: number } | null = null;
  private error: string | null = null;
  private readonly now: () => number;
  private readonly newToken: () => string;

  constructor(private readonly deps: PluginManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.newToken = deps.newToken ?? randomUUID;
  }

  /** Loads every plugin that is on (none in safe mode). */
  async start(): Promise<void> {
    if (this.deps.safeMode) return;
    for (const plugin of this.deps.store.list()) {
      if (plugin.enabled) await this.load(plugin.manifest.id);
    }
  }

  /** Installed plugins, for the plugin manager. */
  views(): PluginView[] {
    return this.deps.store.list().map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      author: p.manifest.author,
      description: p.manifest.description,
      enabled: p.enabled,
      permissions: [...p.granted],
      disabledReason: p.disabledReason,
    }));
  }

  /** The install prompt waiting for an answer, if any. */
  pendingPrompt(): PluginPrompt | null {
    if (this.prompt && this.now() - this.prompt.at > PROMPT_TTL_MS) this.prompt = null;
    return this.prompt ? { ...this.prompt.view } : null;
  }

  /** The last install error, until it is dismissed or the next install starts. */
  lastError(): string | null {
    return this.error;
  }

  dismissError(): void {
    this.error = null;
    this.deps.onChange();
  }

  /** Reads a package the user picked and shows the permission prompt (or the reason it cannot be installed). */
  openPackage(file: string): void {
    this.prompt = null;
    this.error = null;
    try {
      if (this.deps.fileSize(file) > ZIP_LIMITS.maxArchiveBytes) throw new PackageError(`This file is larger than a plugin package can be (${ZIP_LIMITS.maxArchiveBytes / (1024 * 1024)} MB).`);
      const pkg = inspectPackage(this.deps.readFile(file));
      const installed = this.deps.store.get(pkg.manifest.id);
      const granted = installed?.granted ?? [];
      this.prompt = {
        pkg,
        at: this.now(),
        view: {
          token: this.newToken(),
          id: pkg.manifest.id,
          name: pkg.manifest.name,
          version: pkg.manifest.version,
          author: pkg.manifest.author,
          description: pkg.manifest.description,
          permissions: [...pkg.manifest.permissions],
          newPermissions: pkg.manifest.permissions.filter((p) => !granted.includes(p)),
          replaces: installed?.manifest.version ?? null,
          sha256: pkg.sha256,
        },
      };
      this.deps.log('info', 'Plugin package opened', { id: pkg.manifest.id, version: pkg.manifest.version, sha256: pkg.sha256 });
    } catch (err) {
      this.error = err instanceof PackageError ? err.message : `The file could not be read: ${(err as Error).message}`;
      this.deps.log('warn', 'Plugin package refused', { reason: this.error });
    }
    this.deps.onChange();
  }

  /** The user approved the prompt with this token: install (or update) and, if it is on, load it. */
  async approve(token: string): Promise<void> {
    const prompt = this.pendingPrompt() ? this.prompt : null;
    if (!prompt || prompt.view.token !== token) return;
    this.prompt = null;
    const { id } = prompt.pkg.manifest;
    try {
      const record = this.deps.store.install(prompt.pkg);
      this.deps.log('info', prompt.view.replaces ? 'Plugin updated' : 'Plugin installed', {
        id,
        version: record.manifest.version,
        from: prompt.view.replaces,
        sha256: record.sha256,
        permissions: record.granted,
      });
      this.deps.onChange();
      if (record.enabled && !this.deps.safeMode) await this.load(id);
    } catch (err) {
      this.error = `The plugin could not be installed: ${(err as Error).message}`;
      this.deps.log('warn', 'Plugin install failed', { id, reason: this.error });
    }
    this.deps.onChange();
  }

  cancel(token: string): void {
    if (this.prompt?.view.token !== token) return;
    this.prompt = null;
    this.deps.onChange();
  }

  /** Turns a plugin on (loads it, unless in safe mode) or off (unloads it). */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const plugin = this.deps.store.get(id);
    if (!plugin || plugin.enabled === enabled) return;
    this.deps.store.setEnabled(id, enabled);
    this.deps.log('info', enabled ? 'Plugin turned on' : 'Plugin turned off', { id });
    this.deps.onChange();
    if (this.deps.safeMode) return;
    if (enabled) await this.load(id);
    else this.deps.host.unload(id);
  }

  /** Unloads and removes a plugin with its files and storage. */
  uninstall(id: string): void {
    if (!this.deps.store.get(id)) return;
    this.deps.host.unload(id);
    this.deps.store.uninstall(id);
    this.deps.log('info', 'Plugin uninstalled', { id });
    this.deps.onChange();
  }

  /** The plugin host turned a plugin off (limits or crashes): remember it, with the reason. */
  onHostDisabled(id: string, reasons: (Violation | 'crash')[]): void {
    if (!this.deps.store.get(id)) return;
    const reason = disabledReason(reasons);
    this.deps.store.setEnabled(id, false, reason);
    this.deps.log('warn', 'Plugin turned off by Playlish', { id, reasons });
    this.deps.onChange();
  }

  /** Loads a plugin into the plugin host; one that fails to start is turned off with the reason. */
  private async load(id: string): Promise<void> {
    try {
      await this.deps.host.load(id, this.deps.store.code(id), DEFAULT_LIMITS);
    } catch (err) {
      const message = (err as Error).message.slice(0, 200);
      this.deps.store.setEnabled(id, false, `Turned off because it failed to start: ${message}`);
      this.deps.log('warn', 'Plugin failed to start', { id, error: message });
      this.deps.onChange();
    }
  }
}
