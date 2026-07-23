import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Pin the timezone so locale-formatted dates in render snapshots are
    // deterministic across developer machines and CI.
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/types.ts'],
      reporter: ['text', 'html'],
    },
  },
});
