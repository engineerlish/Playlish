import { PLUGIN_UI_SLOTS, isPluginPermission, type PluginPermission, type PluginUiSlot } from '../../shared/plugins';
import { isSafeEntryName } from './zip';

/*
 * manifest.json of a plugin package (#101). It comes from someone else, so it is checked strictly: every field has a
 * type and a size limit, unknown fields and unknown permissions are refused, and a manifest for a newer plugin API says
 * so instead of half-working.
 */

// CHANGE HERE: the plugin API version this Playlish speaks, and the manifest limits.
export const PLUGIN_API_VERSION = 1;
export const MANIFEST_MAX_BYTES = 64 * 1024;
const MAX_ID = 64;
const MAX_NAME = 60;
const MAX_AUTHOR = 60;
const MAX_DESCRIPTION = 300;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  apiVersion: number;
  permissions: PluginPermission[];
  /** The script that runs in the sandbox, relative to the package root. */
  entry: string;
  ui: PluginUiSlot[];
}

export class ManifestError extends Error {
  override name = 'ManifestError';
}

const ALLOWED_KEYS = new Set(['id', 'name', 'version', 'author', 'description', 'apiVersion', 'permissions', 'entry', 'ui']);
// Lower-case words joined by "." or "-", for example "com.example.listening-stats". It names a folder on disk.
const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
// Plain x.y.z versions, so updates can be compared.
const VERSION_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
// Windows cannot have folders with these names (even with an extension).
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
// Control characters and the bidirectional overrides that could disguise a name in the prompt.
// eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses.
const HIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

/** A one-line text field: a string, trimmed, not empty (unless optional), at most `max` characters, nothing hidden. */
function text(value: unknown, field: string, max: number, optional = false): string {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string') throw new ManifestError(`"${field}" must be text.`);
  const trimmed = value.trim();
  if (!optional && trimmed === '') throw new ManifestError(`"${field}" must not be empty.`);
  if (trimmed.length > max) throw new ManifestError(`"${field}" is longer than ${max} characters.`);
  if (HIDDEN_CHARACTERS.test(trimmed)) throw new ManifestError(`"${field}" contains control or hidden characters.`);
  return trimmed;
}

/** Parses and checks manifest.json; throws a ManifestError that says what is wrong. */
export function parseManifest(raw: Buffer | string): PluginManifest {
  const source = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (Buffer.byteLength(source) > MANIFEST_MAX_BYTES) throw new ManifestError(`manifest.json is larger than ${MANIFEST_MAX_BYTES} bytes.`);
  let data: unknown;
  try {
    data = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    throw new ManifestError('manifest.json is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new ManifestError('manifest.json must be a JSON object.');
  const m = data as Record<string, unknown>;
  const unknown = Object.keys(m).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) throw new ManifestError(`Unknown field(s) in manifest.json: ${unknown.slice(0, 5).join(', ')}.`);

  // The API version first: a plugin for a newer Playlish gets that message rather than a confusing one.
  if (typeof m['apiVersion'] !== 'number' || !Number.isInteger(m['apiVersion'])) throw new ManifestError('"apiVersion" must be a whole number.');
  if (m['apiVersion'] > PLUGIN_API_VERSION) throw new ManifestError(`This plugin needs a newer Playlish (plugin API ${m['apiVersion']}; this version supports ${PLUGIN_API_VERSION}).`);
  if (m['apiVersion'] !== PLUGIN_API_VERSION) throw new ManifestError(`Plugin API ${m['apiVersion']} is not supported (this version supports ${PLUGIN_API_VERSION}).`);

  if (typeof m['id'] !== 'string' || m['id'].length > MAX_ID || !ID_PATTERN.test(m['id'])) {
    throw new ManifestError(`"id" must be lower-case letters and digits joined by "." or "-" (at most ${MAX_ID} characters), for example "com.example.my-plugin".`);
  }
  if (RESERVED_WINDOWS_NAMES.test(m['id'].split(/[.-]/)[0] ?? '')) throw new ManifestError(`"id" must not start with a name Windows reserves (${m['id']}).`);
  if (typeof m['version'] !== 'string' || !VERSION_PATTERN.test(m['version'])) throw new ManifestError('"version" must look like 1.2.3.');

  if (!Array.isArray(m['permissions'])) throw new ManifestError('"permissions" must be a list (it can be empty).');
  const permissions: PluginPermission[] = [];
  for (const p of m['permissions'] as unknown[]) {
    if (!isPluginPermission(p)) throw new ManifestError(`Unknown permission: ${JSON.stringify(p).slice(0, 40)}.`);
    if (permissions.includes(p)) throw new ManifestError(`Permission "${p}" is listed twice.`);
    permissions.push(p);
  }

  if (typeof m['entry'] !== 'string' || !m['entry'].endsWith('.js') || !isSafeEntryName(m['entry'])) {
    throw new ManifestError('"entry" must be a .js file inside the package, for example "main.js".');
  }

  const ui: PluginUiSlot[] = [];
  if (m['ui'] !== undefined) {
    if (!Array.isArray(m['ui'])) throw new ManifestError('"ui" must be a list of slots.');
    for (const slot of m['ui'] as unknown[]) {
      if (typeof slot !== 'string' || !(PLUGIN_UI_SLOTS as readonly string[]).includes(slot)) throw new ManifestError(`Unknown UI slot: ${JSON.stringify(slot).slice(0, 40)} (use ${PLUGIN_UI_SLOTS.join(' or ')}).`);
      if (ui.includes(slot as PluginUiSlot)) throw new ManifestError(`UI slot "${slot}" is listed twice.`);
      ui.push(slot as PluginUiSlot);
    }
  }

  return {
    id: m['id'],
    name: text(m['name'], 'name', MAX_NAME),
    version: m['version'],
    author: text(m['author'], 'author', MAX_AUTHOR),
    description: text(m['description'], 'description', MAX_DESCRIPTION, true),
    apiVersion: m['apiVersion'],
    permissions,
    entry: m['entry'],
    ui,
  };
}
