import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleSink, Logger, RotatingFileSink, readLogEntries, type LogEntry, type LogSink } from '../src/main/logging/logger';

const FIXED = new Date('2026-10-03T12:00:00.000Z');

/** A sink that keeps everything in memory. */
function memorySink() {
  const lines: string[] = [];
  const entries: LogEntry[] = [];
  const sink: LogSink = {
    write: (line, entry) => {
      lines.push(line);
      entries.push(entry);
    },
  };
  return { sink, lines, entries };
}

describe('Logger', () => {
  it('writes one JSON line with timestamp, level, module, code, message and context', () => {
    const { sink, lines } = memorySink();
    const log = Logger.create([sink], 'info', () => FIXED).child('player');

    log.error('Playback stalled', { code: 'PLAYBACK_STALLED', context: { positionMs: 1003 } });

    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: '2026-10-03T12:00:00.000Z',
      level: 'error',
      module: 'player',
      code: 'PLAYBACK_STALLED',
      msg: 'Playback stalled',
      context: { positionMs: 1003 },
    });
  });

  it('leaves out code and context when there are none', () => {
    const { sink, entries } = memorySink();

    Logger.create([sink], 'info', () => FIXED).info('Started');

    expect(entries[0]).toEqual({ ts: FIXED.toISOString(), level: 'info', module: 'app', msg: 'Started' });
  });

  it('filters by level and can change level at runtime for all children', () => {
    const { sink, entries } = memorySink();
    const root = Logger.create([sink], 'warn');
    const child = root.child('auth');

    child.info('hidden');
    child.debug('hidden');
    child.warn('shown');
    root.setLevel('debug');
    child.debug('now shown');

    expect(entries.map((e) => e.msg)).toEqual(['shown', 'now shown']);
    expect(child.level).toBe('debug');
  });

  it('redacts the message and the context before any sink sees them', () => {
    const { sink, lines } = memorySink();
    const log = Logger.create([sink]);

    log.warn('callback ?code=AQB123&state=s1 from user@example.com', {
      context: { refreshToken: 'r-1', url: '/cb?code=x', header: 'Bearer abc.def' },
    });

    const line = lines[0] ?? '';
    expect(line).not.toMatch(/AQB123|s1|user@example\.com|r-1|abc\.def/);
    expect(JSON.parse(line)).toMatchObject({ context: { refreshToken: '[REDACTED]', url: '/cb?code=[REDACTED]' } });
  });

  it('stores an attached error as name, message and stack, redacted', () => {
    const { sink, entries } = memorySink();

    Logger.create([sink]).error('Token request failed', { error: new TypeError('fetch failed for 0123456789abcdef0123456789abcdef') });

    const error = (entries[0]?.context as { error: { name: string; message: string; stack: string } }).error;
    expect(error.name).toBe('TypeError');
    expect(error.message).toBe('fetch failed for [CLIENT_ID]');
    expect(typeof error.stack).toBe('string');
  });

  it('never throws when a sink fails, keeps writing to the other sinks and counts the drop', () => {
    const good = memorySink();
    const bad: LogSink = {
      write: () => {
        throw new Error('disk full');
      },
    };
    const log = Logger.create([bad, good.sink]);

    expect(() => log.error('still logged')).not.toThrow();
    expect(good.entries).toHaveLength(1);
    expect(log.droppedLines).toBe(1);
  });

  it('never throws on context that cannot be serialized', () => {
    const { sink, entries } = memorySink();
    const log = Logger.create([sink]);

    expect(() => log.info('big number', { context: { n: 10n as unknown as number } })).not.toThrow();
    expect(entries).toHaveLength(0);
    expect(log.droppedLines).toBe(1);
  });
});

describe('RotatingFileSink', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-logs-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the folder and appends lines', () => {
    const file = path.join(dir, 'nested', 'playlish.log');
    const sink = new RotatingFileSink(file, 1000, 3);

    sink.write('one');
    sink.write('two');

    expect(fs.readFileSync(file, 'utf8')).toBe('one\ntwo\n');
  });

  it('rotates when the next line would exceed the size cap', () => {
    const file = path.join(dir, 'playlish.log');
    const sink = new RotatingFileSink(file, 20, 3);

    sink.write('aaaaaaaaa'); // 10 bytes with newline
    sink.write('bbbbbbbbb'); // 20 bytes: still fits
    sink.write('ccccccccc'); // would be 30: rotate first

    expect(fs.readFileSync(file, 'utf8')).toBe('ccccccccc\n');
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toBe('aaaaaaaaa\nbbbbbbbbb\n');
  });

  it('keeps only the configured number of files', () => {
    const file = path.join(dir, 'playlish.log');
    const sink = new RotatingFileSink(file, 10, 3);

    for (const letter of ['a', 'b', 'c', 'd', 'e']) sink.write(letter.repeat(9));

    expect(sink.files()).toEqual([file, `${file}.1`, `${file}.2`]);
    expect(fs.existsSync(`${file}.3`)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('eeeeeeeee\n');
    expect(fs.readFileSync(`${file}.2`, 'utf8')).toBe('ccccccccc\n');
  });

  it('caps total disk use at about size times files, however much is logged', () => {
    const file = path.join(dir, 'playlish.log');
    const sink = new RotatingFileSink(file, 1000, 3);

    for (let i = 0; i < 2000; i++) sink.write(`line ${i} ${'x'.repeat(40)}`);

    const total = sink.files().reduce((sum, f) => sum + fs.statSync(f).size, 0);
    expect(total).toBeLessThanOrEqual(3000);
  });

  it('continues an existing file and counts its size', () => {
    const file = path.join(dir, 'playlish.log');
    fs.writeFileSync(file, 'x'.repeat(15));
    const sink = new RotatingFileSink(file, 20, 2);

    sink.write('new line');

    expect(fs.readFileSync(`${file}.1`, 'utf8')).toBe('x'.repeat(15));
    expect(fs.readFileSync(file, 'utf8')).toBe('new line\n');
  });

  it('writes a single line larger than the cap instead of losing it', () => {
    const file = path.join(dir, 'playlish.log');
    const sink = new RotatingFileSink(file, 10, 2);

    sink.write('y'.repeat(50));

    expect(fs.readFileSync(file, 'utf8')).toBe(`${'y'.repeat(50)}\n`);
  });

  it('works end to end with the logger and can be read back', () => {
    const file = path.join(dir, 'playlish.log');
    const log = Logger.create([new RotatingFileSink(file)], 'info', () => FIXED).child('auth');

    log.info('Logged in');
    log.error('Refresh failed', { code: 'SESSION_EXPIRED' });
    fs.appendFileSync(file, 'not json\n');

    const entries = readLogEntries(fs.readFileSync(file, 'utf8'));
    expect(entries.map((e) => [e.level, e.module, e.code, e.msg])).toEqual([
      ['info', 'auth', undefined, 'Logged in'],
      ['error', 'auth', 'SESSION_EXPIRED', 'Refresh failed'],
    ]);
  });
});

describe('ConsoleSink', () => {
  it('prints errors to stderr and everything else to stdout', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const log = Logger.create([new ConsoleSink()], 'debug', () => FIXED).child('player');

    log.error('broke', { code: 'X' });
    log.info('fine');

    expect(errorSpy).toHaveBeenCalledWith('2026-10-03T12:00:00.000Z ERROR [player] X broke');
    expect(logSpy).toHaveBeenCalledWith('2026-10-03T12:00:00.000Z INFO [player] fine');
  });
});
