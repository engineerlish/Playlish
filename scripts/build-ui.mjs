// Bundles the Preact main-window UI (src/renderer/ui) into the single ui.js the window loads.
// The playback host page is not bundled: it stays plain tsc output and never loads Preact.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/renderer/ui/main.tsx'],
  outfile: 'dist/web/renderer/ui.js',
  bundle: true,
  format: 'esm',
  // CHANGE HERE: must match the Chromium in the pinned Electron version.
  target: 'chrome152',
  minify: true,
  sourcemap: true,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('ui bundled');
