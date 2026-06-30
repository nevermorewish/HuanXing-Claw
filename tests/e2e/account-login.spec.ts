import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test.describe('Account login', () => {
  test('prefills saved username and password when reopening the login dialog', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      hostApi: {
        '["account","savedCredentials",null]': {
          success: true,
          credentials: {
            username: 'demo-user',
            password: 'demo-password',
          },
        },
      },
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-account-login').click();

    await expect(page.locator('#hx-url')).toHaveValue('https://api.huanxing.ai/');
    await expect(page.locator('#hx-username')).toHaveValue('demo-user');
    await expect(page.locator('#hx-password')).toHaveValue('demo-password');
  });
});
