import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Recursive on purpose. These used to be three exact directories
    // (src/main/__tests__, src/main/services/__tests__,
    // src/renderer/src/lib/__tests__), so a test file placed anywhere else -
    // src/main/services/ai/__tests__, say - was silently never run: vitest
    // reported a green suite and simply did not know the file existed. A test
    // that does not run is worse than no test, because it reads as coverage.
    include: [
      'src/main/**/__tests__/**/*.test.ts',
      'src/renderer/src/**/__tests__/**/*.test.ts',
    ],
    environment: 'node',
    globals: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts'],
      exclude: [
        'src/main/__tests__/**',
        'src/main/**/__tests__/**',
        'src/main/index.ts',
        'src/main/systemAudioNative.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});
