import { defineConfig } from 'vitest/config';

// Unit and integration tests live in tests/. Coverage deliberately includes every source file (not only the ones
// that are imported by tests) so the reported number is an honest baseline.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reportsDirectory: 'coverage',
    },
  },
});
