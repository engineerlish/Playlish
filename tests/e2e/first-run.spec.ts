import { expect, test } from './fixtures';
import { REFRESH_TOKEN, TEST_CLIENT_ID, logEntries, waitForPlayerReady } from './harness';

test.describe('first run', () => {
  test('a new profile opens the setup wizard instead of the app', async ({ start }) => {
    const { ui } = await start();

    await expect(ui.locator('#setupProgress')).toHaveText('Step 1 of 6');
    await expect(ui.locator('.sidebar')).toHaveCount(0);
  });

  test('shows the exact Redirect URI and opens the dashboard without leaving the machine', async ({ start }) => {
    const { ui, userDataDir } = await start();

    await ui.click('#setupNext');
    await expect(ui.locator('#redirectUri')).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    await ui.click('#openDashboard');
    await expect.poll(() => logEntries(userDataDir, 'E2E_OPEN_EXTERNAL').length).toBe(1);
    expect(logEntries(userDataDir, 'E2E_OPEN_EXTERNAL')[0]).toMatchObject({ context: { host: 'developer.spotify.com' } });
  });

  test('rejects a malformed Client ID and accepts a valid one', async ({ start }) => {
    const { ui } = await start();
    await ui.click('#setupNext');
    await ui.click('#setupNext');

    await ui.fill('#clientIdInput', 'not-a-client-id');
    await ui.click('#setupNext');
    await expect(ui.locator('#setupErrorText')).toContainText('32 characters');

    await ui.fill('#clientIdInput', TEST_CLIENT_ID);
    await expect(ui.locator('#clientIdState')).toHaveText('Looks right.');
    await ui.click('#setupNext');
    await expect(ui.locator('[data-step="login"]')).toBeVisible();
  });

  test('completes setup with a mocked login and player check', async ({ start, fake }) => {
    const { app, ui } = await start();
    await ui.click('#setupNext');
    await ui.click('#setupNext');
    await ui.fill('#clientIdInput', TEST_CLIENT_ID);
    await ui.click('#setupNext');

    await ui.click('#setupLogin');
    await expect(ui.locator('[data-step="done"]')).toBeVisible({ timeout: 20_000 });
    await waitForPlayerReady(app);

    // PKCE: the token request carried the verifier and the Client ID, and never a secret.
    const [tokenRequest] = fake.requestsFor('POST', '/api/token');
    const form = new URLSearchParams(String(tokenRequest?.body));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_id')).toBe(TEST_CLIENT_ID);
    expect(form.get('code_verifier')).toBeTruthy();
    expect(form.has('client_secret')).toBe(false);

    await ui.click('#setupFinish');
    await expect(ui.locator('.sidebar')).toBeVisible();
  });

  test('the login survives a restart', async ({ start, fake }) => {
    const first = await start({ clientId: TEST_CLIENT_ID });
    await first.ui.click('#login');
    await waitForPlayerReady(first.app);
    await first.app.close();

    const second = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir });
    await waitForPlayerReady(second.app);

    await expect(second.ui.locator('#login')).toHaveCount(0);
    // Restored from the stored refresh token, not a second browser login.
    expect(fake.requestsFor('GET', '/authorize')).toHaveLength(1);
    const refresh = fake.requestsFor('POST', '/api/token').map((r) => new URLSearchParams(String(r.body)));
    expect(refresh.some((f) => f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === REFRESH_TOKEN)).toBe(true);
  });
});
