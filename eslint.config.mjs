import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Flat config. Lints the CLI TypeScript (src + tests). The dashboard ships its
// own plain-JS serverless functions and the Next.js site has its own toolchain,
// so both are out of scope here; build artifacts are ignored.
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
