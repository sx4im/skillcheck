import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/cli/test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/cli/src/**/*.ts'],
      // The coverage gate measures the decision-making logic. Excluded from the
      // PERCENTAGE denominator (but still tested behaviourally) are the interactive
      // terminal shells, which need a pseudo-terminal to exercise line-by-line:
      //   - cli.ts        command router + interactive setup loop — driven end to
      //                   end by main.e2e.test.ts against the real pipeline.
      //   - ui.ts         raw-mode file picker, spinners, animated card; its pure
      //                   formatters are unit-tested in ui-print.test.ts.
      //   - update.ts     the npm update notifier (spawns npm, prompts the user).
      //   - m0/hardcoded  canary fixtures (data, no logic).
      // Everything else is held to the strict thresholds below.
      exclude: [
        'packages/cli/src/m0/hardcoded.ts',
        'packages/cli/src/ui.ts',
        'packages/cli/src/update.ts',
        'packages/cli/src/cli.ts'
      ],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 85,
        // The corpus git-checkout path and a couple of branch-heavy error guards
        // need live git / network to reach; floored here so they cannot regress.
        'packages/cli/src/corpus.ts': { statements: 78, branches: 70, functions: 77, lines: 76 },
        'packages/cli/src/eval.ts': { statements: 88, branches: 64, functions: 90, lines: 88 },
        'packages/cli/src/verify.ts': { statements: 84, branches: 64, functions: 100, lines: 84 }
      }
    }
  }
});
