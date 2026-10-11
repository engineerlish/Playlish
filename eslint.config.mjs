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
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tools/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  { files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'], ...typed('./tsconfig.main.json') },
  { files: ['src/renderer/**/*.ts'], ...typed('./tsconfig.renderer.json') },
  // The Preact UI is bundled by esbuild and checked with its own JSX settings.
  { files: ['src/renderer/ui/**/*.ts', 'src/renderer/ui/**/*.tsx'], ...typed('./tsconfig.ui.json') },
  { files: ['tests/**/*.ts'], ...typed('./tsconfig.test.json') },
  // End-to-end tests also run code inside the app's pages, so they get the DOM types.
  { files: ['tests/e2e/**/*.ts'], ...typed('./tsconfig.e2e.json') },
  { files: ['tools/**/*.ts'], ...typed('./tsconfig.tools.json') },
  // The Web Playback SDK stub runs in the playback host page (a browser), not in Node.
  {
    files: ['tests/e2e/fixtures/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { window: 'readonly', setTimeout: 'readonly' } },
  },
  // Example plugins (#104): one script each, run in the plugin sandbox, where the only global is `playlish`.
  {
    files: ['examples/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { playlish: 'readonly' } },
  },
  // Plain JS/config files: no type information.
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.config.ts', '**/*.config.mts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', require: 'readonly', module: 'writable' } },
  },
);
