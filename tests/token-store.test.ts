import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_SESSION_FILE, TOKEN_FILE, TokenStore, type Encryptor } from '../src/main/token-store';

const CLIENT = '0123456789abcdef0123456789abcdef';
const OTHER_CLIENT = 'fedcba9876543210fedcba9876543210';
const TOKEN = `AQ${'r'.repeat(130)}`;

/** A reversible stand-in for DPAPI: XOR with a key, so the file never contains the token as text. */
function fakeEncryptor(available = true): Encryptor & { available: boolean } {
  const key = 0x5a;
  const enc = {
    available,
    isEncryptionAvailable: () => enc.available,
    encryptString: (text: string) => Buffer.from([...Buffer.from(`ENC:${text}`, 'utf8')].map((b) => b ^ key)),
    decryptString: (data: Buffer) => {
      const text = Buffer.from([...data].map((b) => b ^ key)).toString('utf8');
      if (!text.startsWith('ENC:')) throw new Error('Error while decrypting the ciphertext');
      return text.slice(4);
    },
  };
  return enc;
}

let dir: string;
let reports: string[];
const tokenFile = () => path.join(dir, TOKEN_FILE);
const legacyFile = () => path.join(dir, LEGACY_SESSION_FILE);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-tokens-'));
  reports = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('TokenStore', () => {
  it('round-trips the refresh token for the same Client ID', () => {
    const store = new TokenStore(dir, fakeEncryptor(), (m) => reports.push(m));

    expect(store.save(CLIENT, TOKEN)).toBe(true);

    expect(new TokenStore(dir, fakeEncryptor()).load(CLIENT)).toBe(TOKEN);
  });

  it('never writes the token, or anything readable, in plain text', () => {
    new TokenStore(dir, fakeEncryptor()).save(CLIENT, TOKEN);

    const bytes = fs.readFileSync(tokenFile());
    expect(bytes.toString('latin1')).not.toContain(TOKEN);
    expect(bytes.toString('latin1')).not.toContain('refreshToken');
    expect(fs.readdirSync(dir)).toEqual([TOKEN_FILE]);
  });

  it('saves nothing when encryption is not available', () => {
    const store = new TokenStore(dir, fakeEncryptor(false), (m) => reports.push(m));

    expect(store.save(CLIENT, TOKEN)).toBe(false);

    expect(fs.readdirSync(dir)).toEqual([]);
    expect(reports[0]).toMatch(/encryption is not available/);
  });

  it('returns nothing (and keeps the file) when encryption is unavailable at load time', () => {
    new TokenStore(dir, fakeEncryptor()).save(CLIENT, TOKEN);

    expect(new TokenStore(dir, fakeEncryptor(false), (m) => reports.push(m)).load(CLIENT)).toBeNull();
    expect(fs.existsSync(tokenFile())).toBe(true);
  });

  it('deletes a token stored for another Client ID', () => {
    new TokenStore(dir, fakeEncryptor()).save(OTHER_CLIENT, TOKEN);

    const store = new TokenStore(dir, fakeEncryptor(), (m) => reports.push(m));

    expect(store.load(CLIENT)).toBeNull();
    expect(fs.existsSync(tokenFile())).toBe(false);
    expect(reports).toEqual(['stored session belongs to another Client ID; it was deleted']);
  });

  it('matches the Client ID without regard to case', () => {
    new TokenStore(dir, fakeEncryptor()).save(CLIENT.toUpperCase(), TOKEN);

    expect(new TokenStore(dir, fakeEncryptor()).load(CLIENT)).toBe(TOKEN);
  });

  it('deletes a file that cannot be decrypted (for example copied from another Windows account)', () => {
    fs.writeFileSync(tokenFile(), Buffer.from('not encrypted by this account'));

    const store = new TokenStore(dir, fakeEncryptor(), (m) => reports.push(m));

    expect(store.load(CLIENT)).toBeNull();
    expect(fs.existsSync(tokenFile())).toBe(false);
  });

  it('deletes a decryptable file with the wrong shape', () => {
    const enc = fakeEncryptor();
    fs.writeFileSync(tokenFile(), enc.encryptString(JSON.stringify({ v: 1, clientId: CLIENT })));

    expect(new TokenStore(dir, enc).load(CLIENT)).toBeNull();
    expect(fs.existsSync(tokenFile())).toBe(false);
  });

  it('clear() removes the session, a leftover temporary file and the old spike file', () => {
    const enc = fakeEncryptor();
    new TokenStore(dir, enc).save(CLIENT, TOKEN);
    fs.writeFileSync(`${tokenFile()}.tmp`, 'x');
    fs.writeFileSync(legacyFile(), enc.encryptString(TOKEN));

    new TokenStore(dir, enc).clear();

    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('leaves no temporary file behind when a write fails', () => {
    const failingFs = {
      ...fs,
      renameSync: () => {
        throw new Error('disk full');
      },
    };
    const store = new TokenStore(dir, fakeEncryptor(), (m) => reports.push(m), failingFs);

    expect(store.save(CLIENT, TOKEN)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(reports[0]).toMatch(/disk full/);
  });
});

describe('TokenStore migration from the spike session.bin', () => {
  it('moves the token to the new format, verifies it, then removes the old file', () => {
    const enc = fakeEncryptor();
    fs.writeFileSync(legacyFile(), enc.encryptString(TOKEN));

    const store = new TokenStore(dir, enc, (m) => reports.push(m));

    expect(store.load(CLIENT)).toBe(TOKEN);
    expect(fs.readdirSync(dir)).toEqual([TOKEN_FILE]);
    expect(reports).toContain('moved the session to the new format');
  });

  it('is safe to run twice', () => {
    const enc = fakeEncryptor();
    fs.writeFileSync(legacyFile(), enc.encryptString(TOKEN));

    expect(new TokenStore(dir, enc).load(CLIENT)).toBe(TOKEN);
    expect(new TokenStore(dir, enc).load(CLIENT)).toBe(TOKEN);
    expect(fs.readdirSync(dir)).toEqual([TOKEN_FILE]);
  });

  it('keeps the old file when the new one cannot be written, and tries again next time', () => {
    const enc = fakeEncryptor();
    fs.writeFileSync(legacyFile(), enc.encryptString(TOKEN));
    const failingFs = {
      ...fs,
      renameSync: () => {
        throw new Error('disk full');
      },
    };

    expect(new TokenStore(dir, enc, (m) => reports.push(m), failingFs as never).load(CLIENT)).toBeNull();
    expect(fs.existsSync(legacyFile())).toBe(true);
    expect(reports).toContain('could not move the old session yet; it was left in place');

    expect(new TokenStore(dir, enc).load(CLIENT)).toBe(TOKEN);
    expect(fs.existsSync(legacyFile())).toBe(false);
  });

  it('waits when encryption is not available instead of deleting the old file', () => {
    const enc = fakeEncryptor();
    fs.writeFileSync(legacyFile(), enc.encryptString(TOKEN));

    expect(new TokenStore(dir, fakeEncryptor(false)).load(CLIENT)).toBeNull();
    expect(fs.existsSync(legacyFile())).toBe(true);
  });

  it('removes an old file that cannot be decrypted or does not hold a token', () => {
    fs.writeFileSync(legacyFile(), Buffer.from('garbage'));
    expect(new TokenStore(dir, fakeEncryptor(), (m) => reports.push(m)).load(CLIENT)).toBeNull();
    expect(fs.existsSync(legacyFile())).toBe(false);

    const enc = fakeEncryptor();
    fs.writeFileSync(legacyFile(), enc.encryptString('{"not":"a token"}'));
    expect(new TokenStore(dir, enc).load(CLIENT)).toBeNull();
    expect(fs.existsSync(legacyFile())).toBe(false);
  });

  it('drops the old file when a new-format session already exists', () => {
    const enc = fakeEncryptor();
    new TokenStore(dir, enc).save(CLIENT, TOKEN);
    fs.writeFileSync(legacyFile(), enc.encryptString(`AQ${'o'.repeat(130)}`));

    expect(new TokenStore(dir, enc).load(CLIENT)).toBe(TOKEN);
    expect(fs.existsSync(legacyFile())).toBe(false);
  });
});
