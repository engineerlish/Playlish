import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from './logger';
import { redactValue } from './redact';

/*
 * Crash reports: one small JSON file per crash, redacted, newest N kept. The app offers "Report an issue" for the
 * newest one on the next start.
 */

export type CrashKind = 'uncaughtException' | 'unhandledRejection' | 'renderer-gone' | 'child-process-gone';

/** Version and environment details stored in every report. */
export interface AppInfo {
  appVersion: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
  osRelease: string;
}

export interface CrashReport {
  ts: string;
  kind: CrashKind;
  /** Which process crashed: main, host (playback), ui, gpu, utility... */
  process: string;
  error?: unknown;
  details?: unknown;
  app: AppInfo;
}

// CHANGE HERE: how many crash reports to keep.
export const DEFAULT_KEEP_REPORTS = 10;

/** Writes and lists crash reports in one folder. Never throws: a crash handler that crashes helps nobody. */
export class CrashRecorder {
  constructor(
    readonly dir: string,
    private readonly appInfo: AppInfo,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly keep: number = DEFAULT_KEEP_REPORTS,
  ) {}

  /** Logs the crash, writes a redacted report file, prunes old ones, and returns the file path (or null on failure). */
  record(kind: CrashKind, processName: string, payload: { error?: unknown; details?: Record<string, unknown> } = {}): string | null {
    const ts = this.now().toISOString();
    this.logger.error(`Crash: ${kind} in ${processName}`, {
      code: 'CRASH',
      ...(payload.error !== undefined ? { error: payload.error } : {}),
      context: { kind, process: processName, ...(payload.details ? { details: payload.details } : {}) },
    });
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const report: CrashReport = {
        ts,
        kind,
        process: processName,
        ...(payload.error !== undefined ? { error: redactValue(payload.error) } : {}),
        ...(payload.details ? { details: redactValue(payload.details) } : {}),
        app: this.appInfo,
      };
      const safeName = processName.replace(/[^a-z0-9-]/gi, '_');
      const file = path.join(this.dir, `crash-${ts.replace(/[:.]/g, '-')}-${safeName}.json`);
      fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
      this.prune();
      return file;
    } catch (err) {
      this.logger.error('Could not write a crash report', { code: 'CRASH_REPORT_FAILED', error: err });
      return null;
    }
  }

  /** Crash report files, newest first. */
  list(): string[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((name) => /^crash-.*\.json$/.test(name))
        .sort()
        .reverse()
        .map((name) => path.join(this.dir, name));
    } catch {
      return [];
    }
  }

  /** Reads one report, or null if it is missing or unreadable. */
  read(file: string): CrashReport | null {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as CrashReport;
    } catch {
      return null;
    }
  }

  /** Deletes everything but the newest `keep` reports. */
  private prune(): void {
    for (const file of this.list().slice(this.keep)) fs.rmSync(file, { force: true });
  }
}

/** The subset of `process` the handlers attach to (an EventEmitter), so tests can pass a fake. */
export interface ProcessLike {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

/**
 * Records uncaught exceptions and unhandled promise rejections in the main process. An uncaught exception leaves the
 * process in an unknown state, so after recording it `onFatal` is called (the app exits). A rejected promise is
 * recorded but not fatal.
 */
export function installProcessHandlers(proc: ProcessLike, recorder: CrashRecorder, onFatal: (error: Error) => void): void {
  proc.on('uncaughtException', (error) => {
    recorder.record('uncaughtException', 'main', { error });
    onFatal(error);
  });
  proc.on('unhandledRejection', (reason) => {
    recorder.record('unhandledRejection', 'main', { error: reason });
  });
}
