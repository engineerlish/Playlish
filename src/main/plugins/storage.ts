import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * A plugin's own storage (#102, permission "storage"): a small key-value store of JSON values, one file per plugin in
 * <userData>/plugin-data/<id>/storage.json, deleted when the plugin is uninstalled (#101). Writes are atomic, and the
 * whole store of one plugin can never be larger than the quota.
 */

// CHANGE HERE: storage quota per plugin, and the key format.
export const STORAGE_QUOTA_BYTES = 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

export class StorageError extends Error {
  override name = 'StorageError';
}

export class PluginStorage {
  private readonly cache = new Map<string, Record<string, unknown>>();

  /** `dataDir` is <userData>/plugin-data; plugin ids were checked when the plugin was installed. */
  constructor(private readonly dataDir: string) {}

  get(pluginId: string, key: string): unknown {
    this.checkKey(key);
    const value = this.load(pluginId)[key];
    return value === undefined ? null : value;
  }

  keys(pluginId: string): string[] {
    return Object.keys(this.load(pluginId)).sort();
  }

  /** Stores a JSON value; refuses one that would take the plugin's store over the quota. */
  set(pluginId: string, key: string, value: unknown): void {
    this.checkKey(key);
    if (value === undefined || value === null) throw new StorageError('Use storage.delete to remove a value.');
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch {
      throw new StorageError('The value cannot be stored as JSON.');
    }
    const next = { ...this.load(pluginId), [key]: JSON.parse(json) as unknown };
    this.save(pluginId, next);
  }

  delete(pluginId: string, key: string): void {
    this.checkKey(key);
    const current = this.load(pluginId);
    if (!(key in current)) return;
    const next = { ...current };
    delete next[key];
    this.save(pluginId, next);
  }

  /** Forgets the cached copy (after uninstall, the files are gone already). */
  forget(pluginId: string): void {
    this.cache.delete(pluginId);
  }

  private checkKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new StorageError('Keys are 1 to 100 letters, digits, ".", "_", ":" or "-".');
  }

  private file(pluginId: string): string {
    return path.join(this.dataDir, pluginId, 'storage.json');
  }

  private load(pluginId: string): Record<string, unknown> {
    const cached = this.cache.get(pluginId);
    if (cached) return cached;
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(pluginId), 'utf8')) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      // No store yet, or a damaged one: start empty.
    }
    // A plain object without a prototype, so keys such as "__proto__" stay ordinary keys.
    const clean = Object.assign(Object.create(null) as Record<string, unknown>, data);
    this.cache.set(pluginId, clean);
    return clean;
  }

  private save(pluginId: string, data: Record<string, unknown>): void {
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json) > STORAGE_QUOTA_BYTES) throw new StorageError(`The plugin's storage would be larger than ${STORAGE_QUOTA_BYTES / 1024} KB.`);
    const file = this.file(pluginId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, json);
    fs.renameSync(`${file}.tmp`, file);
    this.cache.set(pluginId, Object.assign(Object.create(null) as Record<string, unknown>, data));
  }
}
