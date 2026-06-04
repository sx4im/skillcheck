import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/cli/test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**']
  }
});
