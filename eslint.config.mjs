import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Flat config. Lints the CLI TypeScript (src + tests). The dashboard ships
// plain-JS serverless functions typed via JSDoc and checked with
// `tsc --checkJs` (dashboard/tsconfig.json, run by dashboard `npm run
// typecheck`); the Next.js site is type-checked by `next build`.
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'packages/site/**', 'dashboard/**', 'scripts/**', '**/*.d.ts']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/cli/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off'
    }
  }
);
