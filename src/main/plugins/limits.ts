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
  maxViolations: number;
}

// CHANGE HERE: default limits (the #82 plan: 16 MB soft, 32 MB hard, 50 ms per event, 500 ms per minute).
export const DEFAULT_LIMITS: SandboxLimits = { memoryMb: 16, hardMemoryMb: 32, cpuMsPerCall: 50, cpuMsPerMinute: 500, maxViolations: 3 };

export type Violation = 'memory' | 'cpu' | 'cpu-minute' | 'error';
