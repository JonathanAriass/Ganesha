module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['out/', 'dist/', 'node_modules/', '*.cjs'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // Allow intentionally-unused args/vars when prefixed with _ (e.g. interface-mandated params).
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
  },
  overrides: [
    {
      files: ['src/renderer/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{ group: ['**/main/**', '../main/*', 'electron'],
            message: 'Renderer must not import from main or electron — use window.api.' }]
        }]
      }
    },
    {
      // Main process intentionally uses lazy require('electron') so persistence
      // modules import cleanly under Node/Vitest. Allow it here only.
      files: ['src/main/**/*.ts'],
      rules: { '@typescript-eslint/no-var-requires': 'off' }
    }
  ]
}
