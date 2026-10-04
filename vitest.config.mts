import { defineConfig } from 'vitest/config';

// Unit and integration tests live in tests/. Coverage deliberately includes every source file (not only the ones
// that are imported by tests) so the reported number is an honest baseline.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Tests use a node:http fetch instead of the built-in one, which crashed Windows test workers at exit.
    setupFiles: ['tests/helpers/use-http-fetch.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    // On CI a failed test runs once more; a pass on the retry is reported as flaky in the summary (scripts/ci-summary.mjs).
    retry: process.env['CI'] ? 1 : 0,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reportsDirectory: 'coverage',
      // CHANGE HERE: coverage floors (lines). Core logic is unit tested almost completely; the entry points (main.ts,
      // host.ts, the preload scripts and the window UI) are covered by the end-to-end suite instead.
      thresholds: {
        lines: 65,
        'src/main/{spotify,logging}/**': { lines: 95 },
        'src/main/!(main|app-logging).ts': { lines: 95 },
        'src/renderer/{fade,stall}.ts': { lines: 95 },
      },
    },
  },
});
