import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['testy/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
