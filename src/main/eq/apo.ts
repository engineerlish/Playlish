import * as path from 'node:path';
import { INCLUDE_LINE, OWN_FILE, addInclude, buildOwnFile, hasInclude, removeInclude } from './config';

/*
 * Finding Equalizer APO and applying Playlish's EQ to it (#91). File and registry access come in as parameters, so the
 * tests run against a fake config folder (#12).
 */

// CHANGE HERE: where Equalizer APO records its config folder, and the backup made before config.txt is first changed.
export const REGISTRY_KEY = 'HKLM\\SOFTWARE\\EqualizerAPO';
export const BACKUP_SUFFIX = '.playlish-backup';
const OFF_TEXT = '# Written by Playlish. The Playlish equalizer is off.\r\n';

export interface ApoFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, encoding: 'utf8'): string;
  writeFileSync(p: string, data: string): void;
  renameSync(from: string, to: string): void;
  copyFileSync(from: string, to: string): void;
  rmSync(p: string, options?: { force?: boolean }): void;
}

export interface ApoDeps {
  /** Equalizer APO's config folder from the registry, or null when it is not installed. */
  configPath(): string | null;
  fs: ApoFs;
}

export type ApoStatus =
  | { installed: false }
  | {
      installed: true;
      configPath: string;
      /** Playlish can change config.txt itself (no Windows prompt needed). */
      configWritable: boolean;
      /** Playlish can write its own file (after the one-time setup when config.txt is not writable). */
      ownWritable: boolean;
      /** config.txt already includes Playlish's file. */
      included: boolean;
    };

/** Reads ConfigPath from the output of `reg query <key> /v ConfigPath`. */
export function parseRegQuery(output: string): string | null {
  const m = /^\s*ConfigPath\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im.exec(output);
  return m?.[1] ?? null;
}

/** True when a file can be written in that place (tried, then removed). */
function canWrite(fs: ApoFs, file: string): boolean {
  const probe = `${file}.playlish-probe`;
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** True when an existing file can be changed. */
function canModify(fs: ApoFs, file: string): boolean {
  if (!fs.existsSync(file)) return canWrite(fs, file);
  try {
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

/** Whether Equalizer APO is installed, and what Playlish may change in its config folder. */
export function apoStatus(deps: ApoDeps): ApoStatus {
  const configPath = deps.configPath();
  if (!configPath || !deps.fs.existsSync(path.join(configPath, 'config.txt'))) return { installed: false };
  const config = path.join(configPath, 'config.txt');
  const own = path.join(configPath, OWN_FILE);
  return {
    installed: true,
    configPath,
    configWritable: canModify(deps.fs, config),
    ownWritable: canModify(deps.fs, own),
    included: hasInclude(deps.fs.readFileSync(config, 'utf8')),
  };
}

/**
 * Writes a file through a temporary file, so Equalizer APO never reads half of it. After the one-time setup only
 * playlish.txt itself is writable, not the folder, so then it is written in place.
 */
function writeAtomic(fs: ApoFs, file: string, text: string): void {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
  } catch {
    fs.writeFileSync(file, text);
    return;
  }
  fs.renameSync(tmp, file);
}

export type ApplyResult = 'applied' | 'off' | 'not-installed' | 'needs-setup';

/**
 * Applies the EQ. On: writes playlish.txt and makes sure config.txt includes it (backing config.txt up once first).
 * Off: removes the Include line and the file when config.txt can be changed, otherwise leaves an empty playlish.txt.
 * 'needs-setup' means the one-time Windows prompt (elevatedSetupScript) is needed first.
 */
export function applyEq(deps: ApoDeps, settings: { enabled: boolean; gains: readonly number[]; device: string | null }): ApplyResult {
  const status = apoStatus(deps);
  if (!status.installed) return 'not-installed';
  const { fs } = deps;
  const config = path.join(status.configPath, 'config.txt');
  const own = path.join(status.configPath, OWN_FILE);

  if (!settings.enabled) {
    if (status.configWritable) {
      if (status.included) writeAtomic(fs, config, removeInclude(fs.readFileSync(config, 'utf8')));
      fs.rmSync(own, { force: true });
    } else if (status.ownWritable) {
      writeAtomic(fs, own, OFF_TEXT);
    }
    return 'off';
  }

  if (!status.ownWritable || (!status.included && !status.configWritable)) return 'needs-setup';
  writeAtomic(fs, own, buildOwnFile(settings.gains, settings.device));
  if (!status.included) {
    const backup = `${config}${BACKUP_SUFFIX}`;
    if (!fs.existsSync(backup)) fs.copyFileSync(config, backup);
    writeAtomic(fs, config, addInclude(fs.readFileSync(config, 'utf8')));
  }
  return 'applied';
}

/**
 * The PowerShell script run once with administrator rights (one Windows prompt) when the config folder is not writable
 * for the user: it backs up config.txt, adds the Include line, creates playlish.txt and makes only that file writable
 * for this Windows user. Nothing else changes. Safe to run twice.
 */
export function elevatedSetupScript(configPath: string, windowsUser: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const dir = q(configPath);
  return [
    '$ErrorActionPreference = "Stop"',
    `$config = Join-Path ${dir} 'config.txt'`,
    `$own = Join-Path ${dir} ${q(OWN_FILE)}`,
    `$backup = $config + ${q(BACKUP_SUFFIX)}`,
    'if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $config -Destination $backup }',
    `$text = [IO.File]::ReadAllText($config)`,
    `if ($text -notmatch '(?im)^\\s*include\\s*:\\s*playlish\\.txt\\s*$') {`,
    `  if ($text.Length -gt 0 -and -not $text.EndsWith("\`n")) { $text += "\`r\`n" }`,
    `  [IO.File]::WriteAllText($config, $text + ${q(INCLUDE_LINE)} + "\`r\`n")`,
    '}',
    `if (-not (Test-Path -LiteralPath $own)) { [IO.File]::WriteAllText($own, ${q(OFF_TEXT.trimEnd())} + "\`r\`n") }`,
    `& icacls.exe $own /grant ${q(`${windowsUser}:(M)`)} | Out-Null`,
  ].join('\r\n');
}
