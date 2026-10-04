import type { UiCommand } from '../shared/types';

/*
 * Checks a command from the window before it reaches the player or the Web API. The window is Playlish's own code,
 * but a malformed value (NaN, a string, a volume of 5) should be dropped here, not sent to Spotify.
 */

// CHANGE HERE: the longest track position accepted for a seek (24 hours; podcasts can be long).
const MAX_SEEK_MS = 24 * 60 * 60 * 1000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The command if it is well formed, otherwise null. */
export function parseUiCommand(input: unknown): UiCommand | null {
  if (typeof input !== 'object' || input === null) return null;
  const c = input as Record<string, unknown>;
  switch (c['type']) {
    case 'toggle':
    case 'fadeToggle':
    case 'next':
    case 'previous':
      return { type: c['type'] };
    case 'volume':
      return finite(c['value']) && c['value'] >= 0 && c['value'] <= 1 ? { type: 'volume', value: c['value'] } : null;
    case 'seek':
      return finite(c['positionMs']) && c['positionMs'] >= 0 && c['positionMs'] <= MAX_SEEK_MS ? { type: 'seek', positionMs: Math.floor(c['positionMs']) } : null;
    case 'mute':
      return typeof c['muted'] === 'boolean' ? { type: 'mute', muted: c['muted'] } : null;
    case 'shuffle':
      return typeof c['on'] === 'boolean' ? { type: 'shuffle', on: c['on'] } : null;
    case 'repeat':
      return c['mode'] === 'off' || c['mode'] === 'context' || c['mode'] === 'track' ? { type: 'repeat', mode: c['mode'] } : null;
    default:
      return null;
  }
}
