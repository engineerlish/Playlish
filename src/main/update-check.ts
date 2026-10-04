/*
 * The update check (#80): at most once a day, and only while the window is open, Playlish asks GitHub for the latest
 * release and offers a link when it is newer. One unauthenticated GET to api.github.com; nothing about the user is
 * sent. It can be turned off in Settings. Installing stays manual (no auto-updater in 0.1.0).
 */

// CHANGE HERE: where releases are published, and how often to look.
export const RELEASES_API = 'https://api.github.com/repos/engineerlish/Playlish/releases/latest';
export const RELEASES_PAGE = 'https://github.com/engineerlish/Playlish/releases/';
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  /** The release page, always under RELEASES_PAGE. */
  url: string;
}

/** Splits "v1.2.3" or "1.2.3-beta" into numbers and a pre-release tag; null if it is not a version. */
export function parseVersion(text: string): { parts: [number, number, number]; pre: string } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim());
  if (!m) return null;
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' };
}

/** True when `candidate` is a newer version than `current` (a release beats a pre-release of the same number). */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const d = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  if (a.pre === b.pre) return false;
  if (a.pre === '') return true;
  if (b.pre === '') return false;
  return a.pre > b.pre;
}

/** Whether a check is due. */
export function checkDue(enabled: boolean, lastCheckedAt: number | null, now: number): boolean {
  return enabled && (lastCheckedAt === null || now - lastCheckedAt >= CHECK_INTERVAL_MS || now < lastCheckedAt);
}

/** Reads GitHub's latest release; returns the update if it is newer, null otherwise. Throws on network trouble. */
export async function fetchUpdate(fetchFn: typeof fetch, apiUrl: string, currentVersion: string, pagePrefix = RELEASES_PAGE): Promise<UpdateInfo | null> {
  const res = await fetchFn(apiUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Playlish' } });
  if (res.status === 404) return null; // no release published yet
  if (!res.ok) throw new Error(`update check failed (${res.status})`);
  const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
  if (typeof body.tag_name !== 'string' || typeof body.html_url !== 'string' || body.draft === true || body.prerelease === true) return null;
  // Only ever offer a link to this project's release pages.
  if (!body.html_url.startsWith(pagePrefix)) return null;
  const version = body.tag_name.replace(/^v/, '');
  return isNewer(version, currentVersion) ? { version, url: body.html_url } : null;
}
