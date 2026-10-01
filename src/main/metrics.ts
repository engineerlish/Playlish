import { app } from 'electron';
import * as fs from 'node:fs';
import type { MetricsSample } from '../shared/types';

// CHANGE HERE: how often resource usage is sampled and logged.
const SAMPLE_INTERVAL_MS = 5000;

const CSV_HEADER = 'time,processes,working_set_mb,private_mb,cpu_percent,playing,ui_open,host_open\n';

export interface MetricsContext {
  playing: boolean;
  uiOpen: boolean;
  hostOpen: boolean;
}

/**
 * Samples RAM and CPU of every Electron process every few seconds, appends a CSV line and reports the latest sample.
 * This is the seed of the built-in performance overlay/log; budgets are checked against this file.
 */
export class MetricsLogger {
  private timer: NodeJS.Timeout | null = null;
  private latest: MetricsSample | null = null;

  constructor(
    readonly csvPath: string,
    private readonly context: () => MetricsContext,
    private readonly onSample: (sample: MetricsSample) => void,
    private readonly onError: (message: string) => void,
  ) {}

  /** The most recent sample, or null before the first one. */
  getLatest(): MetricsSample | null {
    return this.latest;
  }

  /** Begins sampling; writes the CSV header if the file is new. */
  start(): void {
    if (this.timer) return;
    try {
      if (!fs.existsSync(this.csvPath)) fs.writeFileSync(this.csvPath, CSV_HEADER);
    } catch (err) {
      this.onError(`perf log: cannot create ${this.csvPath}: ${(err as Error).message}`);
    }
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
  }

  /** Stops sampling. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Takes one sample; any failure is reported through onError instead of silently stopping the log. */
  private sample(): void {
    try {
      this.takeSample();
    } catch (err) {
      this.onError(`perf log: sampling failed: ${(err as Error).message}`);
    }
  }

  /** Sums working set, private bytes and CPU over all processes, appends a CSV line and notifies the listener. */
  private takeSample(): void {
    const metrics = app.getAppMetrics();
    let workingSetKb = 0;
    let privateKb = 0;
    let cpu = 0;
    for (const m of metrics) {
      workingSetKb += m.memory.workingSetSize;
      privateKb += m.memory.privateBytes ?? 0;
      cpu += m.cpu.percentCPUUsage;
    }
    const sample: MetricsSample = {
      time: new Date().toISOString(),
      processes: metrics.length,
      workingSetMb: Math.round((workingSetKb / 1024) * 10) / 10,
      privateMb: Math.round((privateKb / 1024) * 10) / 10,
      cpuPercent: Math.round(cpu * 100) / 100,
    };
    this.latest = sample;

    const ctx = this.context();
    fs.appendFile(
      this.csvPath,
      `${sample.time},${sample.processes},${sample.workingSetMb},${sample.privateMb},${sample.cpuPercent},${ctx.playing ? 1 : 0},${ctx.uiOpen ? 1 : 0},${ctx.hostOpen ? 1 : 0}\n`,
      (err) => {
        if (err) this.onError(`perf log: append failed: ${err.message}`);
      },
    );
    this.onSample(sample);
  }
}
