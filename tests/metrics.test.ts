import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricsSample } from '../src/shared/types';

const getAppMetrics = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { getAppMetrics } }));

import { MetricsLogger, type MetricsContext } from '../src/main/metrics';

const HEADER = 'time,processes,working_set_mb,private_mb,cpu_percent,playing,ui_open,host_open\n';

let dir: string;
let csv: string;
let context: MetricsContext;
let samples: MetricsSample[];
let errors: string[];

/** One Electron process entry as returned by app.getAppMetrics(). */
function proc(workingSetKb: number, privateKb: number | undefined, cpu: number) {
  return { memory: { workingSetSize: workingSetKb, privateBytes: privateKb }, cpu: { percentCPUUsage: cpu } };
}

/** Creates a logger wired to the test context. */
function makeLogger(csvPath = csv): MetricsLogger {
  return new MetricsLogger(
    csvPath,
    () => context,
    (s) => samples.push(s),
    (e) => errors.push(e),
  );
}

/** Waits until the asynchronous append has written the expected number of lines. */
async function lines(expected: number): Promise<string[]> {
  const read = () => fs.readFileSync(csv, 'utf8').split('\n').filter(Boolean);
  await vi.waitFor(() => expect(read()).toHaveLength(expected), { timeout: 2000 });
  return read();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-metrics-'));
  csv = path.join(dir, 'perf.csv');
  context = { playing: false, uiOpen: false, hostOpen: false };
  samples = [];
  errors = [];
  getAppMetrics.mockReturnValue([proc(10_240, 5_120, 1.5)]);
});

afterEach(() => {
  vi.useRealTimers();
  // Retries cover a late append still holding the file on Windows (ENOTEMPTY / EBUSY), see #52.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('MetricsLogger', () => {
  it('writes the CSV header when the file is new', () => {
    const logger = makeLogger();

    logger.start();
    logger.stop();

    expect(fs.readFileSync(csv, 'utf8')).toBe(HEADER);
  });

  it('keeps an existing file and its content', () => {
    fs.writeFileSync(csv, `${HEADER}old,line\n`);
    const logger = makeLogger();

    logger.start();
    logger.stop();

    expect(fs.readFileSync(csv, 'utf8')).toBe(`${HEADER}old,line\n`);
  });

  it('samples every 5 seconds and not before', async () => {
    const logger = makeLogger();
    logger.start();

    await vi.advanceTimersByTimeAsync(4999);
    expect(samples).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(samples).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(samples).toHaveLength(2);
    logger.stop();
    // Let both asynchronous appends finish before the temp folder is deleted (#52: deleting it mid-write failed on CI).
    await lines(3);
  });

  it('sums memory and CPU across all processes and converts KB to MB', async () => {
    getAppMetrics.mockReturnValue([proc(102_400, 51_200, 1.25), proc(51_200, 25_600, 0.5), proc(1_024, undefined, 0.01)]);
    const logger = makeLogger();
    logger.start();

    await vi.advanceTimersByTimeAsync(5000);
    logger.stop();

    expect(samples[0]).toEqual({
      time: '2026-10-01T12:00:05.000Z',
      processes: 3,
      workingSetMb: 151,
      privateMb: 75,
      cpuPercent: 1.76,
    });
  });

  it('writes one CSV line per sample with the playing, UI and host flags', async () => {
    context = { playing: true, uiOpen: false, hostOpen: true };
    const logger = makeLogger();
    logger.start();

    await vi.advanceTimersByTimeAsync(5000);
    logger.stop();

    const written = await lines(2);
    expect(`${written[0]}\n`).toBe(HEADER);
    expect(written[1]).toBe('2026-10-01T12:00:05.000Z,1,10,5,1.5,1,0,1');
  });

  it('remembers the latest sample', async () => {
    const logger = makeLogger();
    expect(logger.getLatest()).toBeNull();
    logger.start();

    await vi.advanceTimersByTimeAsync(5000);
    logger.stop();

    expect(logger.getLatest()).toBe(samples[0]);
  });

  it('stops sampling after stop()', async () => {
    const logger = makeLogger();
    logger.start();
    await vi.advanceTimersByTimeAsync(5000);

    logger.stop();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(samples).toHaveLength(1);
  });

  it('does not run two timers when started twice', async () => {
    const logger = makeLogger();

    logger.start();
    logger.start();
    await vi.advanceTimersByTimeAsync(5000);
    logger.stop();

    expect(samples).toHaveLength(1);
  });

  it('reports a sampling failure and keeps going', async () => {
    getAppMetrics.mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });
    const logger = makeLogger();
    logger.start();

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    logger.stop();

    expect(errors).toEqual(['perf log: sampling failed: metrics unavailable']);
    expect(samples).toHaveLength(1);
  });

  it('reports a file that cannot be appended to instead of dropping data silently', async () => {
    const blocked = path.join(dir, 'a-folder');
    fs.mkdirSync(blocked);
    const logger = makeLogger(blocked);

    logger.start();
    await vi.advanceTimersByTimeAsync(5000);
    logger.stop();

    await vi.waitFor(() => expect(errors.some((e) => e.startsWith('perf log: append failed'))).toBe(true), { timeout: 2000 });
    expect(samples).toHaveLength(1); // the in-memory sample and the UI update still happen
  });

  it('reports when the file cannot be created at start', () => {
    const logger = makeLogger(path.join(dir, 'missing-folder', 'perf.csv'));

    logger.start();
    logger.stop();

    expect(errors[0]).toMatch(/^perf log: cannot create /);
  });
});
