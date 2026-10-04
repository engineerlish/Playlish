import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, logEntries } from './harness';

/*
 * The daily update check (#80). In test mode Playlish asks the fake server instead of api.github.com.
 */
const LATEST = '/repos/engineerlish/Playlish/releases/latest';

test.describe('update check', () => {
  test('a newer release shows a banner whose link opens the release page', async ({ start, fake }) => {
    fake.on('GET', LATEST, { status: 200, body: { tag_name: 'v9.9.9', html_url: 'https://github.com/engineerlish/Playlish/releases/tag/v9.9.9' } });
    const { ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });

    await expect(ui.locator('#updateBanner')).toHaveText(/Playlish 9\.9\.9 is available/);
    const [request] = fake.requestsFor('GET', LATEST);
    expect(request?.headers.authorization).toBeUndefined();
    await ui.click('#openUpdate');
    await expect.poll(() => logEntries(userDataDir, 'E2E_OPEN_EXTERNAL').map((e) => (e['context'] as { host: string }).host)).toContain('github.com');
  });

  test('checks at most once a day, and not at all when turned off', async ({ start, fake }) => {
    fake.on('GET', LATEST, { status: 200, body: { tag_name: 'v0.0.0', html_url: 'https://github.com/engineerlish/Playlish/releases/tag/v0.0.0' } });
    const first = await start({ clientId: TEST_CLIENT_ID });
    await expect.poll(() => fake.requestsFor('GET', LATEST).length).toBe(1);
    await expect(first.ui.locator('#updateBanner')).toHaveCount(0);
    await first.ui.click('#nav-settings');
    await first.ui.uncheck('#prefCheckForUpdates');
    await first.app.close();

    // The same day again (and now turned off): no second request.
    const second = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir });
    await second.ui.waitForTimeout(1500);
    expect(fake.requestsFor('GET', LATEST)).toHaveLength(1);
  });

  test('a link outside the project release pages is never offered', async ({ start, fake }) => {
    fake.on('GET', LATEST, { status: 200, body: { tag_name: 'v9.9.9', html_url: 'https://evil.example/playlish.exe' } });
    const { ui } = await start({ clientId: TEST_CLIENT_ID });

    await expect.poll(() => fake.requestsFor('GET', LATEST).length).toBe(1);
    await ui.waitForTimeout(500);
    await expect(ui.locator('#updateBanner')).toHaveCount(0);
  });
});
