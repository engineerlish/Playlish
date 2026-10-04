import { describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS, RELEASES_PAGE, checkDue, fetchUpdate, isNewer, parseVersion } from '../src/main/update-check';

describe('versions', () => {
  it.each([
    ['0.1.0', '0.0.1-spike', true],
    ['0.1.1', '0.1.0', true],
    ['v1.0.0', '0.9.9', true],
    ['0.1.0', '0.1.0', false],
    ['0.1.0', '0.1.0-beta', true],
    ['0.1.0-beta', '0.1.0', false],
    ['0.1.0-rc.2', '0.1.0-rc.1', true],
    ['0.0.9', '0.1.0', false],
    ['latest', '0.1.0', false],
  ])('%s newer than %s: %s', (a, b, expected) => {
    expect(isNewer(a, b)).toBe(expected);
  });

  it('parses tags with or without v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ parts: [1, 2, 3], pre: '' });
    expect(parseVersion('1.2')).toBeNull();
  });
});

describe('checkDue', () => {
  it('checks when on and a day has passed, never when off', () => {
    expect(checkDue(true, null, 1000)).toBe(true);
    expect(checkDue(true, 0, CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(checkDue(true, 0, CHECK_INTERVAL_MS)).toBe(true);
    expect(checkDue(false, null, 1000)).toBe(false);
  });

  it('checks again if the clock went backwards', () => {
    expect(checkDue(true, 5000, 1000)).toBe(true);
  });
});

describe('fetchUpdate', () => {
  const reply = (status: number, body: unknown) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('offers a newer release with its page, asking GitHub with no credentials', async () => {
    const f = reply(200, { tag_name: 'v0.2.0', html_url: `${RELEASES_PAGE}tag/v0.2.0` });

    expect(await fetchUpdate(f, 'https://api.example/latest', '0.1.0')).toEqual({ version: '0.2.0', url: `${RELEASES_PAGE}tag/v0.2.0` });
    const init = f.mock.calls[0]?.[1];
    expect(Object.keys((init?.headers ?? {}) as Record<string, string>).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('offers nothing for the same or an older version, drafts, pre-releases or no release at all', async () => {
    expect(await fetchUpdate(reply(200, { tag_name: 'v0.1.0', html_url: `${RELEASES_PAGE}tag/v0.1.0` }), 'u', '0.1.0')).toBeNull();
    expect(await fetchUpdate(reply(200, { tag_name: 'v0.2.0', html_url: `${RELEASES_PAGE}x`, prerelease: true }), 'u', '0.1.0')).toBeNull();
    expect(await fetchUpdate(reply(200, { tag_name: 'v0.2.0', html_url: `${RELEASES_PAGE}x`, draft: true }), 'u', '0.1.0')).toBeNull();
    expect(await fetchUpdate(reply(404, { message: 'Not Found' }), 'u', '0.1.0')).toBeNull();
  });

  it('never offers a link outside the project release pages', async () => {
    expect(await fetchUpdate(reply(200, { tag_name: 'v9.0.0', html_url: 'https://evil.example/download' }), 'u', '0.1.0')).toBeNull();
  });

  it('throws on server or network trouble, so the caller can try again later', async () => {
    await expect(fetchUpdate(reply(500, {}), 'u', '0.1.0')).rejects.toThrow('update check failed (500)');
  });
});
