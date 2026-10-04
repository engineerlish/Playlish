/*
 * Safe mode (#50): start with every plugin off, to get out of a plugin that breaks the app. The plugin system arrives
 * in 0.3.0; this only decides the flag at start-up so that it can rely on it.
 */

// CHANGE HERE: how safe mode is asked for.
export const SAFE_MODE_FLAG = '--safe-mode';
export const SAFE_MODE_ENV = 'PLAYLISH_SAFE_MODE';

/** True when this start should keep all plugins off. */
export function isSafeMode(argv: readonly string[], env: Record<string, string | undefined>): boolean {
  return argv.includes(SAFE_MODE_FLAG) || env[SAFE_MODE_ENV] === '1';
}

/** The command-line arguments for restarting in or out of safe mode (the current ones, with the flag added or removed). */
export function relaunchArgs(argv: readonly string[], safe: boolean): string[] {
  const rest = argv.slice(1).filter((a) => a !== SAFE_MODE_FLAG);
  return safe ? [...rest, SAFE_MODE_FLAG] : rest;
}
