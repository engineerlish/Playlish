import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Stores the Spotify refresh token, and nothing else, encrypted with Electron's safeStorage (Windows DPAPI, bound to
 * the user's Windows account). Decided on #51:
 * - only the refresh token is persisted; the access token stays in memory
 * - no plain-text fallback: if encryption is not available, nothing is saved
 * - the token is bound to the Client ID it was issued for; another Client ID deletes it
 * - the spike's session.bin (the bare encrypted token) is migrated once, verified before the old file is removed
 */

// CHANGE HERE: file names in the user data folder.
export const TOKEN_FILE = 'refresh-token.bin';
export const LEGACY_SESSION_FILE = 'session.bin';
const FORMAT_VERSION = 1;

/** The part of Electron's safeStorage used here; a fake in tests. */
export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** The file system calls used; replaced in tests. */
export interface TokenFs {
  existsSync(file: string): boolean;
  readFileSync(file: string): Buffer;
  writeFileSync(file: string, data: Buffer): void;
  renameSync(from: string, to: string): void;
  rmSync(file: string, options: { force: true }): void;
}

/** What is encrypted inside the file. */
interface Payload {
  v: number;
  clientId: string;
  refreshToken: string;
}

/** Loads, saves and deletes the encrypted refresh token. Never throws; problems are reported. */
export class TokenStore {
  private readonly file: string;
  private readonly legacyFile: string;

  constructor(
    dir: string,
    private readonly encryptor: Encryptor,
    private readonly report: (message: string) => void = () => undefined,
    private readonly fsApi: TokenFs = fs,
  ) {
    this.file = path.join(dir, TOKEN_FILE);
    this.legacyFile = path.join(dir, LEGACY_SESSION_FILE);
  }

  /**
   * Returns the stored refresh token for this Client ID, or null. Migrates the spike's session.bin first if it exists.
   * A token stored for another Client ID, or a file that cannot be decrypted, is deleted.
   */
  load(clientId: string): string | null {
    this.migrateLegacy(clientId);
    if (!this.fsApi.existsSync(this.file)) return null;
    if (!this.encryptor.isEncryptionAvailable()) {
      this.report('stored session cannot be read: encryption is not available');
      return null;
    }
    const payload = this.readPayload(this.file);
    if (!payload) {
      this.report('stored session could not be decrypted; it was deleted');
      this.remove(this.file);
      return null;
    }
    if (payload.clientId.toLowerCase() !== clientId.toLowerCase()) {
      this.report('stored session belongs to another Client ID; it was deleted');
      this.remove(this.file);
      return null;
    }
    return payload.refreshToken;
  }

  /** Saves the refresh token for this Client ID. Returns false (and saves nothing) when encryption is unavailable. */
  save(clientId: string, refreshToken: string): boolean {
    if (!this.encryptor.isEncryptionAvailable()) {
      this.report('session not saved: encryption is not available, so you will need to log in again next time');
      return false;
    }
    const payload: Payload = { v: FORMAT_VERSION, clientId, refreshToken };
    const tmp = `${this.file}.tmp`;
    try {
      this.fsApi.writeFileSync(tmp, this.encryptor.encryptString(JSON.stringify(payload)));
      this.fsApi.renameSync(tmp, this.file);
      return true;
    } catch (err) {
      this.remove(tmp);
      this.report(`session not saved: ${(err as Error).message}`);
      return false;
    }
  }

  /** Deletes the stored session (sign out, or Spotify rejected the token). */
  clear(): void {
    this.remove(this.file);
    this.remove(`${this.file}.tmp`);
    this.remove(this.legacyFile);
  }

  /**
   * One-time move from the spike's session.bin (the bare encrypted refresh token, no Client ID). The token is saved in
   * the new format and read back; only when that matches is the old file removed. Safe to run any number of times.
   */
  private migrateLegacy(clientId: string): void {
    if (!this.fsApi.existsSync(this.legacyFile)) return;
    if (this.fsApi.existsSync(this.file)) {
      this.report('removed the old session file; a newer one already exists');
      this.remove(this.legacyFile);
      return;
    }
    if (!this.encryptor.isEncryptionAvailable()) return; // try again next start
    let token: string;
    try {
      token = this.encryptor.decryptString(this.fsApi.readFileSync(this.legacyFile)).trim();
    } catch {
      this.report('old session file could not be decrypted; it was deleted');
      this.remove(this.legacyFile);
      return;
    }
    if (!/^[A-Za-z0-9._~-]{20,}$/.test(token)) {
      this.report('old session file did not contain a token; it was deleted');
      this.remove(this.legacyFile);
      return;
    }
    if (this.save(clientId, token) && this.readPayload(this.file)?.refreshToken === token) {
      this.remove(this.legacyFile);
      this.report('moved the session to the new format');
    } else {
      this.report('could not move the old session yet; it was left in place');
    }
  }

  /** Decrypts and parses a token file, or returns null if anything about it is wrong. */
  private readPayload(file: string): Payload | null {
    try {
      const parsed = JSON.parse(this.encryptor.decryptString(this.fsApi.readFileSync(file))) as Partial<Payload>;
      if (parsed.v === FORMAT_VERSION && typeof parsed.clientId === 'string' && typeof parsed.refreshToken === 'string' && parsed.refreshToken) {
        return { v: parsed.v, clientId: parsed.clientId, refreshToken: parsed.refreshToken };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Deletes a file if it exists, ignoring errors. */
  private remove(file: string): void {
    try {
      this.fsApi.rmSync(file, { force: true });
    } catch {
      // Nothing more to do.
    }
  }
}
