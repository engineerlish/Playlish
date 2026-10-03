import * as fs from 'node:fs';
import * as path from 'node:path';
import { redactText, redactValue } from './redact';

/*
 * Structured logging for the main process. One JSON object per line:
 *   {"ts":"2026-10-03T12:00:00.000Z","level":"error","module":"player","code":"PLAYBACK_STALLED","msg":"...","context":{...}}
 * Everything is redacted before it reaches a sink, and logging never throws.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  /** Stable machine-readable error code, for example PLAYBACK_STALLED. */
  code?: string;
  msg: string;
  context?: unknown;
}

export interface LogOptions {
  code?: string;
  context?: Record<string, unknown>;
  /** An error to attach; it is stored as { name, message, stack } inside the context. */
  error?: unknown;
}

/** Somewhere log lines go (a file, the console, a test array). Must not throw; the logger guards it anyway. */
export interface LogSink {
  write(line: string, entry: LogEntry): void;
}

// CHANGE HERE: size of one log file before it rotates, and how many files to keep (current + older ones).
export const DEFAULT_MAX_BYTES = 1_000_000;
export const DEFAULT_KEEP_FILES = 3;

/**
 * Appends lines to a file and rotates it by size: playlish.log -> playlish.log.1 -> playlish.log.2, dropping the
 * oldest. Total disk use is capped at about maxBytes * keepFiles. Writes are synchronous so entries are never
 * reordered or lost on a crash.
 */
export class RotatingFileSink implements LogSink {
  private size: number;

  constructor(
    readonly file: string,
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
    private readonly keepFiles: number = DEFAULT_KEEP_FILES,
  ) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  }

  /** Writes one line, rotating first if it would push the file over the size cap. */
  write(line: string): void {
    const bytes = Buffer.byteLength(line) + 1;
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
    fs.appendFileSync(this.file, `${line}\n`);
    this.size += bytes;
  }

  /** The current file and its rotated copies that exist, newest first. */
  files(): string[] {
    const all = [this.file];
    for (let i = 1; i < this.keepFiles; i++) all.push(`${this.file}.${i}`);
    return all.filter((f) => fs.existsSync(f));
  }

  /** Shifts every file one place older and starts a fresh current file. */
  private rotate(): void {
    const oldest = `${this.file}.${this.keepFiles - 1}`;
    if (this.keepFiles > 1 && fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
    for (let i = this.keepFiles - 2; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${this.file}.${i + 1}`);
    }
    if (this.keepFiles > 1) fs.renameSync(this.file, `${this.file}.1`);
    else fs.rmSync(this.file, { force: true });
    this.size = 0;
  }
}

/** Mirrors log lines to the console, with errors on stderr. Used in development. */
export class ConsoleSink implements LogSink {
  /** Prints a short human-readable form of the entry. */
  write(_line: string, entry: LogEntry): void {
    const text = `${entry.ts} ${entry.level.toUpperCase()} [${entry.module}]${entry.code ? ` ${entry.code}` : ''} ${entry.msg}`;
    if (entry.level === 'error') console.error(text);
    else console.log(text);
  }
}

/** State shared by a logger and all of its children. */
interface LoggerCore {
  sinks: LogSink[];
  level: LogLevel;
  now: () => Date;
  dropped: number;
}

/** A module-scoped logger. Create one root logger and hand out children with `child(module)`. */
export class Logger {
  private constructor(
    private readonly core: LoggerCore,
    readonly module: string,
  ) {}

  /** Creates a root logger. */
  static create(sinks: LogSink[], level: LogLevel = 'info', now: () => Date = () => new Date()): Logger {
    return new Logger({ sinks, level, now, dropped: 0 }, 'app');
  }

  /** A logger for another module that shares sinks, level and counters with this one. */
  child(module: string): Logger {
    return new Logger(this.core, module);
  }

  /** Changes the minimum level for this logger and all related loggers. */
  setLevel(level: LogLevel): void {
    this.core.level = level;
  }

  /** The current minimum level. */
  get level(): LogLevel {
    return this.core.level;
  }

  /** How many lines could not be written because a sink failed. */
  get droppedLines(): number {
    return this.core.dropped;
  }

  error(msg: string, options?: LogOptions): void {
    this.log('error', msg, options);
  }

  warn(msg: string, options?: LogOptions): void {
    this.log('warn', msg, options);
  }

  info(msg: string, options?: LogOptions): void {
    this.log('info', msg, options);
  }

  debug(msg: string, options?: LogOptions): void {
    this.log('debug', msg, options);
  }

  /** Builds, redacts and writes one entry. Never throws. */
  log(level: LogLevel, msg: string, options: LogOptions = {}): void {
    if (LEVEL_RANK[level] > LEVEL_RANK[this.core.level]) return;
    let entry: LogEntry;
    let line: string;
    try {
      const context: Record<string, unknown> | undefined =
        options.context || options.error !== undefined
          ? { ...options.context, ...(options.error !== undefined ? { error: options.error } : {}) }
          : undefined;
      entry = {
        ts: this.core.now().toISOString(),
        level,
        module: this.module,
        ...(options.code ? { code: options.code } : {}),
        msg: redactText(msg),
        ...(context ? { context: redactValue(context) } : {}),
      };
      line = JSON.stringify(entry);
    } catch {
      this.core.dropped++;
      return;
    }
    for (const sink of this.core.sinks) {
      try {
        sink.write(line, entry);
      } catch {
        this.core.dropped++;
      }
    }
  }
}

/** Parses a log file written by the logger back into entries, skipping lines that are not valid JSON. */
export function readLogEntries(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      // Skip partial or foreign lines.
    }
  }
  return entries;
}
