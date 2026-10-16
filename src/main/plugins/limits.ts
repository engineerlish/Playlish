/*
 * Plugin limits (#100) in a module of their own: the main process needs them without loading QuickJS, which only the
 * plugin-host process uses.
 */

export interface SandboxLimits {
  /** QuickJS heap limit (MB). */
  memoryMb: number;
  /** Hard WebAssembly memory ceiling (MB); must be larger than memoryMb. */
  hardMemoryMb: number;
  cpuMsPerCall: number;
  cpuMsPerMinute: number;
  /** Violations within `violationWindowMs` that turn a plugin off. */
  maxViolations: number;
  /** How long a violation counts (default 10 minutes), so rare hiccups over days never add up. */
  violationWindowMs?: number;
}

// CHANGE HERE: how long a limit violation counts towards turning a plugin off.
export const VIOLATION_WINDOW_MS = 10 * 60_000;

// CHANGE HERE: default limits (the #82 plan: 16 MB soft, 32 MB hard, 50 ms per event, 500 ms per minute).
export const DEFAULT_LIMITS: SandboxLimits = { memoryMb: 16, hardMemoryMb: 32, cpuMsPerCall: 50, cpuMsPerMinute: 500, maxViolations: 3 };

export type Violation = 'memory' | 'cpu' | 'cpu-minute' | 'error';
