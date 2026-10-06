import type { SandboxLimits, Violation } from './sandbox';

/*
 * Messages between the main process and the plugin-host process (#100). Everything is plain data (structured clone).
 */

/** Main → plugin host. */
export type ToHost =
  | { type: 'load'; pluginId: string; code: string; limits: SandboxLimits }
  | { type: 'unload'; pluginId: string }
  | { type: 'event'; event: string; payload: unknown; pluginIds: string[] }
  | { type: 'reply'; callId: number; ok: boolean; value?: unknown; error?: string };

/** Plugin host → main. */
export type FromHost =
  | { type: 'ready' }
  | { type: 'loaded'; pluginId: string }
  | { type: 'load-failed'; pluginId: string; error: string }
  | { type: 'call'; callId: number; pluginId: string; action: string; args: unknown }
  | { type: 'log'; pluginId: string; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'event-failed'; pluginId: string; event: string; error: string }
  | { type: 'disabled'; pluginId: string; reasons: Violation[] };
