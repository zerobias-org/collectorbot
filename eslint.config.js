import baseConfig from '@zerobias-org/eslint-config';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['**/generated/**', '**/dist/**', '**/node_modules/**'],
  },
  ...baseConfig.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'unicorn/filename-case': 'off',
      'no-await-in-loop': 'off',
      'no-continue': 'off',
      'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement', 'WithStatement'],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'max-len': ['error', { code: 150 }],
    },
  },
];
