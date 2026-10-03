import { describe, expect, it } from 'vitest';
import { REDACTED, redactText, redactValue } from '../src/main/logging/redact';

const ACCESS_TOKEN = `BQD${'a1B2c3D4e5_-'.repeat(15)}`; // shaped like a real Spotify access token (180 chars)
const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const TRACK_FILE_ID = 'cd9cb24b945af352c709a2d2882b99744ca67034'; // 40 hex: a CDN file id, not a secret
const DEVICE_ID = '941d631c8a92ec2ff34e6710440b222da4b1217b';

describe('redactText: secrets', () => {
  it('removes Bearer tokens', () => {
    const out = redactText(`Authorization: Bearer ${ACCESS_TOKEN}`);

    expect(out).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it('removes Basic credentials', () => {
    expect(redactText('Authorization: Basic dXNlcjpwYXNz')).toBe(`Authorization: Basic ${REDACTED}`);
  });

  it('removes secret values from JSON text', () => {
    const out = redactText('{"access_token":"abc.def","refresh_token": "r-1","expires_in":3600}');

    expect(out).toBe(`{"access_token":"${REDACTED}","refresh_token": "${REDACTED}","expires_in":3600}`);
  });

  it('removes OAuth values from query strings and form bodies', () => {
    const out = redactText('GET /callback?code=AQB-secret&state=xyz123 then grant_type=refresh_token&refresh_token=r-2&client_id=x');

    expect(out).not.toMatch(/AQB-secret|xyz123|r-2/);
    expect(out).toContain(`code=${REDACTED}`);
    expect(out).toContain(`state=${REDACTED}`);
    expect(out).toContain(`refresh_token=${REDACTED}`);
    expect(out).toContain('grant_type=refresh_token');
  });

  it('removes a code_verifier from a form body', () => {
    expect(redactText('code_verifier=abcDEF123-_.~')).toBe(`code_verifier=${REDACTED}`);
  });

  it('replaces 32-character Client IDs', () => {
    expect(redactText(`client ${CLIENT_ID} failed`)).toBe('client [CLIENT_ID] failed');
    expect(redactText(CLIENT_ID.toUpperCase())).toBe('[CLIENT_ID]');
  });

  it('replaces long opaque tokens even without a label', () => {
    expect(redactText(`token was ${ACCESS_TOKEN}.`)).toBe('token was [TOKEN].');
  });

  it('replaces email addresses', () => {
    expect(redactText('signed in as someone.name+tag@example.co.uk now')).toBe('signed in as [EMAIL] now');
  });

  it('replaces the user name in Windows paths, including escaped backslashes', () => {
    expect(redactText('C:\\Users\\elijah\\AppData\\Roaming\\Playlish')).toBe('C:\\Users\\[USER]\\AppData\\Roaming\\Playlish');
    expect(redactText('"C:\\\\Users\\\\elijah\\\\file"')).toBe('"C:\\\\Users\\\\[USER]\\\\file"');
  });

  it('replaces the user name in POSIX paths', () => {
    expect(redactText('/Users/someone/Library and /home/other/x')).toBe('/Users/[USER]/Library and /home/[USER]/x');
  });
});

describe('redactText: keeps useful information', () => {
  it('does not touch ordinary status codes and numbers', () => {
    const line = 'Spotify error 403: status code: 403, code 404, retry in 30 seconds, position=30241ms';

    expect(redactText(line)).toBe(line);
  });

  it('does not touch 40-character track file and device ids', () => {
    const line = `GET audio/${TRACK_FILE_ID} on device ${DEVICE_ID}`;

    expect(redactText(line)).toBe(line);
  });

  it('keeps hosts and paths of URLs', () => {
    const line = '[host http 403] POST api.spotify.com/v1/widevine-license/v1/audio/license';

    expect(redactText(line)).toBe(line);
  });

  it('keeps words that merely contain a secret field name', () => {
    const line = 'encode=yes; unicode=1; statement=ok; tokens left: 3';

    expect(redactText(line)).toBe(line);
  });

  it('is idempotent', () => {
    const once = redactText(`Bearer ${ACCESS_TOKEN} code=abc ${CLIENT_ID} a@b.io`);

    expect(redactText(once)).toBe(once);
  });
});

describe('redactValue', () => {
  it('blanks secret keys in objects regardless of value', () => {
    const out = redactValue({ accessToken: 'x', refresh_token: 'y', clientId: 'z', password: 1, Authorization: 'q', state: 's', code: 'c' });

    expect(out).toEqual({
      accessToken: REDACTED,
      refresh_token: REDACTED,
      clientId: REDACTED,
      password: REDACTED,
      Authorization: REDACTED,
      state: REDACTED,
      code: REDACTED,
    });
  });

  it('keeps harmless keys that only look similar', () => {
    const out = redactValue({ statusCode: 403, errorCode: 'E1', tokensLeft: 3 }) as Record<string, unknown>;

    expect(out['statusCode']).toBe(403);
    expect(out['errorCode']).toBe('E1');
  });

  it('cleans strings deep inside objects and arrays', () => {
    const out = redactValue({ request: { headers: [`Bearer ${ACCESS_TOKEN}`], url: '/cb?code=abc' } });

    expect(out).toEqual({ request: { headers: [`Bearer ${REDACTED}`], url: `/cb?code=${REDACTED}` } });
  });

  it('turns errors into plain, redacted objects', () => {
    const error = new Error(`token request failed for ${CLIENT_ID}`);

    const out = redactValue(error) as { name: string; message: string; stack?: string };

    expect(out.name).toBe('Error');
    expect(out.message).toBe('token request failed for [CLIENT_ID]');
    expect(out.stack).not.toContain(CLIENT_ID);
  });

  it('survives cycles and very deep values', () => {
    const cyclic: Record<string, unknown> = { name: 'a' };
    cyclic['self'] = cyclic;
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 20; i++) {
      deep['next'] = {};
      deep = deep['next'] as Record<string, unknown>;
    }

    expect(redactValue(cyclic)).toEqual({ name: 'a', self: '[Circular]' });
    expect(JSON.stringify(redactValue(root))).toContain('[Too deep]');
  });

  it('passes through numbers, booleans and null, and labels functions', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(false)).toBe(false);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(() => 1)).toBe('[function]');
  });
});
