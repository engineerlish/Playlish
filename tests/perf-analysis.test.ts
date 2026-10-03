import { describe, expect, it } from 'vitest';
import {
  check,
  checksToMarkdown,
  findMilestone,
  memoryTrend,
  parsePerfCsv,
  samplesSince,
  summarize,
  type PerfSample,
} from '../tools/perf/analysis';

const HEADER = 'time,processes,working_set_mb,private_mb,cpu_percent,playing,ui_open,host_open';

/** Builds samples 5 seconds apart with the given private memory values. */
function series(privateMb: number[], start = Date.UTC(2026, 9, 3, 12)): PerfSample[] {
  return privateMb.map((mb, i) => ({
    time: new Date(start + i * 5000).toISOString(),
    processes: 2,
    workingSetMb: mb * 1.5,
    privateMb: mb,
    cpuPercent: 0,
  }));
}

describe('parsePerfCsv', () => {
  it('reads rows and skips the header, blank and malformed lines', () => {
    const text = [
      HEADER,
      '2026-10-03T12:00:05.000Z,2,119.6,76,0.03,0,0,0',
      '',
      'garbage',
      '2026-10-03T12:00:10.000Z,2,abc,76,0,0,0,0',
      '2026-10-03T12:00:15.000Z,3,236.3,112.8,0.48,0,1,0',
    ].join('\r\n');

    expect(parsePerfCsv(text)).toEqual([
      { time: '2026-10-03T12:00:05.000Z', processes: 2, workingSetMb: 119.6, privateMb: 76, cpuPercent: 0.03 },
      { time: '2026-10-03T12:00:15.000Z', processes: 3, workingSetMb: 236.3, privateMb: 112.8, cpuPercent: 0.48 },
    ]);
  });
});

describe('samplesSince', () => {
  it('keeps samples at or after the start of the measuring window', () => {
    const samples = series([70, 71, 72, 73]);

    expect(samplesSince(samples, Date.parse(samples[2]?.time ?? '')).map((s) => s.privateMb)).toEqual([72, 73]);
  });
});

describe('summarize', () => {
  it('averages and finds maxima', () => {
    const samples = series([70, 80, 90]);
    samples[1] = { ...(samples[1] as PerfSample), cpuPercent: 0.3, processes: 3 };

    expect(summarize(samples)).toEqual({
      samples: 3,
      privateMbAvg: 80,
      privateMbMax: 90,
      workingSetMbAvg: 120,
      cpuPercentAvg: 0.1,
      cpuPercentMax: 0.3,
      processesMax: 3,
    });
  });

  it('returns null without samples', () => {
    expect(summarize([])).toBeNull();
  });
});

describe('memoryTrend', () => {
  it('reports no growth for flat memory', () => {
    const trend = memoryTrend(series(Array.from({ length: 120 }, () => 76)));

    expect(trend).toMatchObject({ slopeMbPerHour: 0, growthPercent: 0, startMb: 76, endMb: 76 });
  });

  it('detects steady growth and measures its slope', () => {
    // 0.01 MB every 5 seconds = 7.2 MB per hour
    const trend = memoryTrend(series(Array.from({ length: 720 }, (_, i) => 100 + i * 0.01)));

    expect(trend?.slopeMbPerHour).toBeCloseTo(7.2, 1);
    expect(trend?.growthPercent).toBeGreaterThan(4);
  });

  it('ignores the warm-up period', () => {
    // A big start-up climb, then flat: not a leak.
    const values = [...Array.from({ length: 30 }, (_, i) => 50 + i), ...Array.from({ length: 120 }, () => 80)];

    expect(memoryTrend(series(values))?.growthPercent).toBe(0);
  });

  it('is not fooled by noise around a flat line', () => {
    const values = Array.from({ length: 200 }, (_, i) => 80 + (i % 2 === 0 ? 0.8 : -0.8));

    expect(Math.abs(memoryTrend(series(values))?.growthPercent ?? 99)).toBeLessThan(1);
  });

  it('needs enough samples to say anything', () => {
    expect(memoryTrend(series([1, 2, 3]))).toBeNull();
  });
});

describe('check and checksToMarkdown', () => {
  it('passes at the limit and fails above it', () => {
    expect(check('Idle RAM', 80, 80, 'MB').pass).toBe(true);
    expect(check('Idle RAM', 80.1, 80, 'MB').pass).toBe(false);
  });

  it('formats a readable table', () => {
    const md = checksToMarkdown('Idle tray', [check('Idle RAM', 75.9, 80, 'MB'), check('Idle CPU', 0.2, 0.1, '%')]);

    expect(md).toContain('| Idle RAM | 75.9 MB | 80 MB | pass |');
    expect(md).toContain('| Idle CPU | 0.2 % | 0.1 % | **FAIL** |');
  });
});

describe('findMilestone', () => {
  it('reads the milliseconds from the matching log entry', () => {
    const log = [
      '{"ts":"x","level":"info","module":"app","msg":"Playlish starting"}',
      '{"ts":"x","level":"info","module":"app","code":"STARTUP_TRAY","msg":"Tray ready","context":{"msSinceStart":812}}',
    ].join('\n');

    expect(findMilestone(log, 'STARTUP_TRAY')).toBe(812);
    expect(findMilestone(log, 'STARTUP_UI')).toBeNull();
  });

  it('ignores broken lines and entries without a number', () => {
    const log = ['{"code":"STARTUP_UI", broken', '{"code":"STARTUP_UI","context":{"msSinceStart":"soon"}}'].join('\n');

    expect(findMilestone(log, 'STARTUP_UI')).toBeNull();
  });
});
