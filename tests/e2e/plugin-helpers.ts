import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import axe from 'axe-core';
import { makeZip, type ZipEntry } from '../../tools/plugins/zip-writer';

/*
 * Helpers for the plugin end-to-end tests (#101 to #104): offering a package to the file dialog, reading what plugins
 * logged, counting plugin processes, packing the example plugins, and the accessibility scan.
 */

/** Writes a package next to the profile and makes the next file dialog pick it. */
export async function offerPackage(app: ElectronApplication, userDataDir: string, name: string, data: Buffer): Promise<void> {
  const file = path.join(path.dirname(userDataDir), `${path.basename(userDataDir)}-${name}`);
  fs.writeFileSync(file, data);
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, file);
}

/** How many plugin-host processes run (it only exists while a plugin is on). */
export async function pluginProcesses(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ app: a }) => a.getAppMetrics().filter((m) => m.type === 'Utility' && m.name === 'Playlish plugins').length);
}

/** Lines the plugins wrote to plugins.log. */
export function pluginLog(userDataDir: string): string {
  const file = path.join(userDataDir, 'logs', 'plugins.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** The messages in plugins.log, one per line (the file is JSON lines). */
export function pluginMessages(userDataDir: string): string[] {
  return pluginLog(userDataDir)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { msg: string }).msg);
}

/** WCAG A and AA violations on the page, as readable lines. */
export async function violations(page: Page): Promise<string[]> {
  await page.evaluate(axe.source);
  const results = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
  );
  return results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** Packs a plugin folder (examples/<name>) the way tools/plugins/pack.ts does. */
export function packExample(name: string): Buffer {
  const dir = path.join(__dirname, '..', '..', 'examples', name);
  const files: ZipEntry[] = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .sort((a, b) => (a === 'manifest.json' ? -1 : b === 'manifest.json' ? 1 : a.localeCompare(b)))
    .map((f) => ({ name: f, data: fs.readFileSync(path.join(dir, f)) }));
  return makeZip(files);
}
