/*
 * Pure analysis for the performance harness: parse the app's perf.csv and log, summarize samples, check budgets, and
 * detect memory that keeps growing during a soak run. No I/O here, so it is unit tested directly.
 */

/** One row of perf.csv, written by the app's MetricsLogger every 5 seconds. */
export interface PerfSample {
  time: string;
  processes: number;
  workingSetMb: number;
  privateMb: number;
  cpuPercent: number;
}

/** Budgets from docs/PROPOSAL.md section 2 (perf/budgets.json). */
export interface Budgets {
  idleTrayPrivateMb: number;
  uiOpenPrivateMb: number;
  idleCpuPercent: number;
  coldStartTrayMs: number;
  coldStartUiMs: number;
  soakMaxGrowthPercent: number;
}

/** One budget comparison. */
export interface Check {
  name: string;
  value: number;
  limit: number;
  unit: string;
  pass: boolean;
}

export interface Summary {
  samples: number;
  privateMbAvg: number;
  privateMbMax: number;
  workingSetMbAvg: number;
  cpuPercentAvg: number;
  cpuPercentMax: number;
  processesMax: number;
}

export interface Trend {
  samplesUsed: number;
  /** Least-squares slope of private memory over time. */
  slopeMbPerHour: number;
  /** Change between the average of the first and the last tenth of the measured window. */
  growthPercent: number;
  startMb: number;
  endMb: number;
}

/** Rounds to one decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Parses perf.csv (with or without its header), skipping malformed lines. */
export function parsePerfCsv(text: string): PerfSample[] {
  const samples: PerfSample[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(',');
    if (cols.length < 5 || !/^\d{4}-\d\d-\d\dT/.test(cols[0] ?? '')) continue;
    const [time, processes, workingSetMb, privateMb, cpuPercent] = cols;
    const numbers = [processes, workingSetMb, privateMb, cpuPercent].map(Number);
    if (numbers.some((n) => !Number.isFinite(n))) continue;
    samples.push({
      time: time ?? '',
      processes: numbers[0] ?? 0,
      workingSetMb: numbers[1] ?? 0,
      privateMb: numbers[2] ?? 0,
      cpuPercent: numbers[3] ?? 0,
    });
  }
  return samples;
}

/** Keeps samples taken at or after the given time. */
export function samplesSince(samples: PerfSample[], sinceMs: number): PerfSample[] {
  return samples.filter((s) => Date.parse(s.time) >= sinceMs);
}

/** Averages and maxima over a set of samples, or null when there are none. */
export function summarize(samples: PerfSample[]): Summary | null {
  if (samples.length === 0) return null;
  const sum = (pick: (s: PerfSample) => number) => samples.reduce((total, s) => total + pick(s), 0);
  const max = (pick: (s: PerfSample) => number) => Math.max(...samples.map(pick));
  return {
    samples: samples.length,
    privateMbAvg: round1(sum((s) => s.privateMb) / samples.length),
    privateMbMax: round1(max((s) => s.privateMb)),
    workingSetMbAvg: round1(sum((s) => s.workingSetMb) / samples.length),
    cpuPercentAvg: Math.round((sum((s) => s.cpuPercent) / samples.length) * 100) / 100,
    cpuPercentMax: Math.round(max((s) => s.cpuPercent) * 100) / 100,
    processesMax: max((s) => s.processes),
  };
}

/**
 * Memory trend for a soak run. The first `warmupFraction` of samples is ignored (caches fill, the JIT warms up), then
 * a least-squares slope and the growth between the first and last tenth of the rest are computed.
 */
export function memoryTrend(samples: PerfSample[], warmupFraction = 0.2): Trend | null {
  const measured = samples.slice(Math.floor(samples.length * warmupFraction));
  if (measured.length < 10) return null;

  const t0 = Date.parse(measured[0]?.time ?? '');
  const xs = measured.map((s) => (Date.parse(s.time) - t0) / 3_600_000); // hours
  const ys = measured.map((s) => s.privateMb);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += ((xs[i] ?? 0) - meanX) * ((ys[i] ?? 0) - meanY);
    den += ((xs[i] ?? 0) - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;

  const tenth = Math.max(1, Math.floor(measured.length / 10));
  const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  const startMb = avg(ys.slice(0, tenth));
  const endMb = avg(ys.slice(-tenth));
  return {
    samplesUsed: measured.length,
    slopeMbPerHour: round1(slope),
    growthPercent: round1(startMb === 0 ? 0 : ((endMb - startMb) / startMb) * 100),
    startMb: round1(startMb),
    endMb: round1(endMb),
  };
}

/** Builds a budget check (value must be at or below the limit). */
export function check(name: string, value: number, limit: number, unit: string): Check {
  return { name, value, limit, unit, pass: value <= limit };
}

/** Reads a startup milestone (milliseconds since process start) from the app's JSON log, or null if absent. */
export function findMilestone(logText: string, code: string): number | null {
  for (const line of logText.split(/\r?\n/)) {
    if (!line.includes(`"code":"${code}"`)) continue;
    try {
      const entry = JSON.parse(line) as { code?: string; context?: { msSinceStart?: unknown } };
      const ms = entry.context?.msSinceStart;
      if (entry.code === code && typeof ms === 'number') return ms;
    } catch {
      // Ignore partial lines.
    }
  }
  return null;
}

/** Formats checks as a Markdown table. */
export function checksToMarkdown(title: string, checks: Check[]): string {
  const rows = checks.map((c) => `| ${c.name} | ${c.value} ${c.unit} | ${c.limit} ${c.unit} | ${c.pass ? 'pass' : '**FAIL**'} |`);
  return [`#### ${title}`, '', '| Check | Measured | Budget | Result |', '|---|---|---|---|', ...rows, ''].join('\n');
}
