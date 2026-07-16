import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsparser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' }, globals: { ...globals.browser, ...globals.node } },
    plugins: { '@typescript-eslint': tseslint, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: { ...tseslint.configs.recommended.rules, ...reactHooks.configs.recommended.rules, 'react-refresh/only-export-components': 'off', 'react-hooks/exhaustive-deps': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
  prettier,
];
