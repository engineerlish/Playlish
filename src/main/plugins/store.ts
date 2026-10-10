import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isPluginPermission, type PluginPermission } from '../../shared/plugins';
import { ManifestError, parseManifest, type PluginManifest } from './manifest';
import { readZip } from './zip';

/*
 * Installed plugins on disk (#101):
 *
 *   <userData>/plugins/installed.json   what is installed, enabled and granted, and each package's SHA-256
 *   <userData>/plugins/<id>/            the unpacked package
 *   <userData>/plugin-data/<id>/        the plugin's own storage (#102), deleted when it is uninstalled
 *
 * Installs and updates are atomic: the package is unpacked into a temporary folder first and swapped in only when it is
 * complete, and installed.json is written to a temporary file and renamed. Leftovers from an interrupted install are
 * removed at the next start.
 */

export interface InstalledPlugin {
  manifest: PluginManifest;
  /** SHA-256 of the package file it was installed from, in hex. */
  sha256: string;
  installedAt: string;
  updatedAt: string;
  enabled: boolean;
  /** Permissions the user approved; the plugin gets these and nothing else. */
  granted: PluginPermission[];
  /** Why Playlish turned it off, until the user turns it on again. */
  disabledReason: string | null;
}

/** A package that was read and checked, ready to be shown in the permission prompt and installed. */
export interface PackageInspection {
  manifest: PluginManifest;
  sha256: string;
  files: Map<string, Buffer>;
}

export class PackageError extends Error {
  override name = 'PackageError';
}

/** Reads a .playlish package and checks its contents and manifest; throws with a message the user can read. */
export function inspectPackage(buf: Buffer): PackageInspection {
  const sha256 = createHash('sha256').update(buf).digest('hex');
  let files: Map<string, Buffer>;
  try {
    files = readZip(buf);
  } catch (err) {
    throw new PackageError(`This is not a valid plugin package: ${(err as Error).message}`);
  }
  const manifestFile = files.get('manifest.json');
  if (!manifestFile) throw new PackageError('This is not a valid plugin package: manifest.json is missing.');
  let manifest: PluginManifest;
  try {
    manifest = parseManifest(manifestFile);
  } catch (err) {
    throw new PackageError(err instanceof ManifestError ? `The plugin's manifest is not valid: ${err.message}` : String(err));
  }
  if (!files.has(manifest.entry)) throw new PackageError(`The plugin's code file "${manifest.entry}" is missing from the package.`);
  return { manifest, sha256, files };
}

interface IndexFile {
  version: 1;
  plugins: InstalledPlugin[];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class PluginStore {
  readonly pluginsDir: string;
  readonly dataDir: string;
  private readonly indexFile: string;
  private plugins: InstalledPlugin[];

  constructor(
    userData: string,
    private readonly report: (message: string) => void = () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.pluginsDir = path.join(userData, 'plugins');
    this.dataDir = path.join(userData, 'plugin-data');
    this.indexFile = path.join(this.pluginsDir, 'installed.json');
    fs.mkdirSync(this.pluginsDir, { recursive: true });
    this.removeLeftovers();
    this.plugins = this.readIndex();
  }

  /** Every installed plugin. */
  list(): InstalledPlugin[] {
    return this.plugins.map((p) => ({ ...p }));
  }

  get(id: string): InstalledPlugin | null {
    const found = this.plugins.find((p) => p.manifest.id === id);
    return found ? { ...found } : null;
  }

  /** The plugin's script, read from its folder. */
  code(id: string): string {
    const plugin = this.require(id);
    return fs.readFileSync(this.inside(this.folder(id), plugin.manifest.entry), 'utf8');
  }

  /**
   * Installs a checked package, or updates the installed plugin with the same id. The permissions in its manifest are
   * the ones granted, so call this only after the user approved them. A new plugin starts enabled; an update keeps
   * the installed one's on/off state.
   */
  install(pkg: PackageInspection): InstalledPlugin {
    const id = pkg.manifest.id;
    const previous = this.plugins.find((p) => p.manifest.id === id) ?? null;
    const target = this.folder(id);
    const temp = path.join(this.pluginsDir, `.tmp-${id}-${randomBytes(4).toString('hex')}`);
    try {
      for (const [name, data] of pkg.files) {
        const file = this.inside(temp, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
      }
      if (fs.existsSync(target)) {
        const old = path.join(this.pluginsDir, `.old-${id}-${randomBytes(4).toString('hex')}`);
        fs.renameSync(target, old);
        fs.renameSync(temp, target);
        fs.rmSync(old, { recursive: true, force: true });
      } else {
        fs.renameSync(temp, target);
      }
    } catch (err) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw err;
    }
    const at = this.now().toISOString();
    const record: InstalledPlugin = {
      manifest: pkg.manifest,
      sha256: pkg.sha256,
      installedAt: previous?.installedAt ?? at,
      updatedAt: at,
      enabled: previous ? previous.enabled : true,
      granted: [...pkg.manifest.permissions],
      disabledReason: previous ? previous.disabledReason : null,
    };
    this.plugins = [...this.plugins.filter((p) => p.manifest.id !== id), record];
    this.writeIndex();
    return { ...record };
  }

  /** Turns a plugin on or off; `reason` says why Playlish turned it off (cleared when it is turned on). */
  setEnabled(id: string, enabled: boolean, reason: string | null = null): void {
    const plugin = this.require(id);
    plugin.enabled = enabled;
    plugin.disabledReason = enabled ? null : reason;
    this.writeIndex();
  }

  /** Removes a plugin, its files and its storage. */
  uninstall(id: string): void {
    this.require(id);
    this.plugins = this.plugins.filter((p) => p.manifest.id !== id);
    this.writeIndex();
    fs.rmSync(this.folder(id), { recursive: true, force: true });
    fs.rmSync(path.join(this.dataDir, id), { recursive: true, force: true });
  }

  private require(id: string): InstalledPlugin {
    const plugin = this.plugins.find((p) => p.manifest.id === id);
    if (!plugin) throw new Error(`Plugin "${id}" is not installed.`);
    return plugin;
  }

  private folder(id: string): string {
    return this.inside(this.pluginsDir, id);
  }

  /** `base/name`, refusing anything that would land outside `base` (names are checked before, this is a second guard). */
  private inside(base: string, name: string): string {
    const resolved = path.resolve(base, name);
    if (!resolved.startsWith(path.resolve(base) + path.sep)) throw new Error(`Refused a path outside the plugin folder: ${name}`);
    return resolved;
  }

  /** Removes temporary folders left by an install that was interrupted. */
  private removeLeftovers(): void {
    for (const entry of fs.readdirSync(this.pluginsDir)) {
      if (entry.startsWith('.tmp-') || entry.startsWith('.old-')) fs.rmSync(path.join(this.pluginsDir, entry), { recursive: true, force: true });
    }
  }

  /** Reads installed.json; a damaged file is kept aside and Playlish starts with no plugins rather than guessing. */
  private readIndex(): InstalledPlugin[] {
    if (!fs.existsSync(this.indexFile)) return [];
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      const aside = `${this.indexFile}.corrupt-${this.now().getTime()}`;
      fs.renameSync(this.indexFile, aside);
      this.report(`The list of installed plugins was damaged and was kept aside as ${path.basename(aside)}; no plugins are loaded.`);
      return [];
    }
    const plugins = (data as Partial<IndexFile>).plugins;
    if (!Array.isArray(plugins)) return [];
    const valid: InstalledPlugin[] = [];
    for (const raw of plugins as unknown[]) {
      const record = this.validRecord(raw);
      if (record && !valid.some((p) => p.manifest.id === record.manifest.id)) valid.push(record);
      else this.report('Skipped an invalid entry in the list of installed plugins.');
    }
    return valid;
  }

  /** A record from installed.json, checked as strictly as a new package (the file could have been edited). */
  private validRecord(raw: unknown): InstalledPlugin | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    let manifest: PluginManifest;
    try {
      manifest = parseManifest(JSON.stringify(r['manifest']));
    } catch {
      return null;
    }
    const granted = r['granted'];
    if (!Array.isArray(granted) || !granted.every(isPluginPermission)) return null;
    if (typeof r['sha256'] !== 'string' || !SHA256_HEX.test(r['sha256'])) return null;
    if (typeof r['enabled'] !== 'boolean' || typeof r['installedAt'] !== 'string' || typeof r['updatedAt'] !== 'string') return null;
    if (!fs.existsSync(this.folder(manifest.id))) return null;
    return {
      manifest,
      sha256: r['sha256'],
      installedAt: r['installedAt'],
      updatedAt: r['updatedAt'],
      enabled: r['enabled'],
      // Never more than the manifest asks for, even if the file says otherwise.
      granted: granted.filter((p) => manifest.permissions.includes(p)),
      disabledReason: typeof r['disabledReason'] === 'string' ? r['disabledReason'].slice(0, 300) : null,
    };
  }

  private writeIndex(): void {
    const index: IndexFile = { version: 1, plugins: this.plugins };
    const temp = `${this.indexFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(index, null, 2));
    fs.renameSync(temp, this.indexFile);
  }
}
