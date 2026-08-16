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
      //   - ui shells     raw-mode file picker, menus, spinners, animated card;
      //                   their pure formatters (theme, card text) are unit-tested
      //                   in theme.test.ts / ui-print.test.ts.
      //   - update.ts     the npm update notifier (spawns npm, prompts the user).
      //   - m0/hardcoded  canary fixtures (data, no logic).
      // Everything else is held to the strict thresholds below.
      exclude: [
        'packages/cli/src/m0/hardcoded.ts',
        'packages/cli/src/cli.ts',
        'packages/cli/src/update.ts',
        'packages/cli/src/ui/banner.ts',
        'packages/cli/src/ui/card.ts',
        'packages/cli/src/ui/picker.ts',
        'packages/cli/src/ui/progress.ts',
        'packages/cli/src/ui/prompts.ts'
      ],
      // Floors carry ~5–10pp of margin below the observed numbers on purpose: v8
      // coverage drifts a point or two between Node versions (CI runs 20 and 22),
      // so a gate pinned to the exact local value is flaky. These still enforce a
      // strong, meaningful bar (84% statements/lines, 85% functions) while being
      // robust across runtimes. The corpus git-checkout path and a few branch-heavy
      // error guards need live git/network to reach, hence their lower branch floors.
      thresholds: {
        statements: 84,
        branches: 68,
        functions: 85,
        lines: 84,
        'packages/cli/src/corpus.ts': { statements: 70, branches: 62, functions: 70, lines: 70 },
        'packages/cli/src/eval.ts': { statements: 88, branches: 68, functions: 90, lines: 88 },
        'packages/cli/src/verify.ts': { statements: 80, branches: 58, functions: 95, lines: 80 }
      }
    }
  }
});
