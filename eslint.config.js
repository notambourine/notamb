import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2024 },
  },
  {
    files: ['src/site/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**', 'test/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/ntb.ts'],
    extends: tseslint.configs.recommended,
    languageOptions: { globals: globals.browser },
    rules: {
      // `(window as any)` is deliberate in the copy-paste output — typing
      // third-party globals would bloat every generated snippet.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
