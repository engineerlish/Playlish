/*
 * Plugin permissions, UI slots and what the window shows about plugins (#101, plan #82). Shared by the main process
 * (which enforces them) and the window (which explains them in the install prompt and the plugin manager).
 */

/** Every permission a plugin can ask for in API v1, with the sentence the install prompt shows for it. */
export const PLUGIN_PERMISSIONS = {
  'playback.read': 'See what is playing and on which device',
  'playback.control': 'Control playback: play, pause, skip, seek and the queue',
  'library.read': 'Read your library: liked songs, saved albums and playlists',
  'library.modify': 'Change your library: save and remove songs and albums',
  'audio.control': 'Change the volume and the equalizer',
  storage: 'Keep a small amount of its own data on this computer (deleted when you uninstall it)',
} as const;

export type PluginPermission = keyof typeof PLUGIN_PERMISSIONS;

/** Where a plugin's declarative panel can appear (#103). */
export const PLUGIN_UI_SLOTS = ['plugins-page', 'sidebar'] as const;
export type PluginUiSlot = (typeof PLUGIN_UI_SLOTS)[number];

/** True for a known permission name. */
export function isPluginPermission(value: unknown): value is PluginPermission {
  return typeof value === 'string' && Object.hasOwn(PLUGIN_PERMISSIONS, value);
}

/** An installed plugin, as the plugin manager shows it. */
export interface PluginView {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  enabled: boolean;
  permissions: PluginPermission[];
  /** Why Playlish turned it off (limits, crashes or a failed start), until it is turned on again. */
  disabledReason: string | null;
}

/** The permission prompt shown before a package is installed. */
export interface PluginPrompt {
  /** Identifies this prompt; the install only goes ahead for the package that was shown. */
  token: string;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  permissions: PluginPermission[];
  /** Permissions an update asks for that the installed version did not have (all of them for a new install). */
  newPermissions: PluginPermission[];
  /** The installed version when this is an update or reinstall, else null. */
  replaces: string | null;
  /** SHA-256 of the package file, in hex. */
  sha256: string;
}
