import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Minimal ESLint for a TypeScript + React/Ink codebase. Formatting is owned by
 * Prettier (`npm run format`), so this config carries no stylistic rules — only
 * correctness-oriented ones. Most are `warn` (not `error`) so lint is advisory
 * and can be adopted incrementally rather than blocking the build on day one.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'test/**', // tests aren't in the typecheck include either
      '**/*.d.ts',
      'src/ascii/**', // generated / art data tables
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TypeScript already flags undefined identifiers (and knows Node/DOM
      // globals via lib), so ESLint's no-undef is redundant and misfires on
      // `process`/`fetch`/etc. — the typescript-eslint recommended stance.
      'no-undef': 'off',
      // Advisory, not blocking — surface issues without failing everyone's build.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off', // we intentionally match ESC / control bytes
      // Pre-existing regex escapes and let/const nits — keep advisory rather than
      // mass-rewriting regexes (which risks changing behavior).
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // bin/handoff.js and this config are Node scripts using Node globals
    // (process, fetch, setTimeout, console). TS files are checked by tsc; for
    // plain JS, disable no-undef rather than enumerate a globals table.
    files: ['**/*.js'],
    rules: {
      'no-undef': 'off',
      'no-useless-escape': 'warn',
    },
  },
);
