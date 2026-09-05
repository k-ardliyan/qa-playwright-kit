// @ts-check
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'artifacts/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'reports/',
      '.auth/',
      'tools/mcp/dist/',
      'config/playwright/',
    ],
  },
  {
    files: ['tests/**/*.spec.ts', 'examples/**/*.spec.ts'],
    ...playwright.configs['flat/recommended'],
    languageOptions: {
      ...playwright.configs['flat/recommended'].languageOptions,
      parser: tseslint.parser,
    },
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-conditional-in-test': 'warn',
      'playwright/expect-expect': 'off',
    },
  },
);
