import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Type-aware linting per code area, each using the tsconfig that the code is actually compiled with.
const typed = (project) => ({
  languageOptions: { parserOptions: { project, tsconfigRootDir: import.meta.dirname } },
});

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  { files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'], ...typed('./tsconfig.main.json') },
  { files: ['src/renderer/**/*.ts'], ...typed('./tsconfig.renderer.json') },
  { files: ['tests/**/*.ts'], ...typed('./tsconfig.test.json') },
  // Plain JS/config files: no type information.
  {
    files: ['**/*.mjs', '**/*.config.ts', '**/*.config.mts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' } },
  },
);
