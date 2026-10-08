import { expect, test } from './fixtures';
import { TEST_CLIENT_ID } from './harness';

/*
 * #100: the plugin-host script runs in a real Electron utility process, loads a plugin into its QuickJS sandbox, and
 * answers events. Also records what that process costs in memory (the #82 budget: about 20 to 30 MB with plugins on).
 */
test('the plugin host runs plugins in a real utility process', async ({ start }) => {
  const { app } = await start({ clientId: TEST_CLIENT_ID });

  const result = await app.evaluate(async ({ app: electronApp, utilityProcess }) => {
    const path = process.mainModule!.require('node:path') as typeof import('node:path');
    const child = utilityProcess.fork(path.join(electronApp.getAppPath(), 'dist', 'main', 'plugins', 'host-process.js'), [], { serviceName: 'Playlish plugins', stdio: 'ignore' });
    const messages: { type: string; [k: string]: unknown }[] = [];
    const next = (type: string) =>
      new Promise<{ type: string; [k: string]: unknown }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${type} message`)), 15_000);
        child.on('message', (m: { type: string; [k: string]: unknown }) => {
          messages.push(m);
          if (m.type === type) {
            clearTimeout(timer);
            resolve(m);
          }
        });
      });
    const limits = { memoryMb: 16, hardMemoryMb: 32, cpuMsPerCall: 50, cpuMsPerMinute: 500, maxViolations: 3 };
    await next('ready');
    const loaded = next('loaded');
    child.postMessage({ type: 'load', pluginId: 'demo', code: `playlish.on('track.changed', (t) => playlish.call('seen', t.name));`, limits });
    await loaded;
    const call = next('call');
    child.postMessage({ type: 'event', event: 'track.changed', payload: { name: 'Song' }, pluginIds: ['demo'] });
    const seen = await call;
    const pid = child.pid;
    const metric = electronApp.getAppMetrics().find((m) => m.pid === pid);
    child.kill();
    return { seen, privateMb: Math.round(((metric?.memory.privateBytes ?? 0) / 1024) * 10) / 10, type: metric?.type ?? null };
  });

  expect(result.seen).toMatchObject({ type: 'call', pluginId: 'demo', action: 'seen', args: 'Song' });
  console.log(`Plugin host process with one plugin: ${result.privateMb} MB private (${result.type})`);
  expect(result.privateMb).toBeLessThan(60);
});
