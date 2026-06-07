import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test.describe('Huanxing login', () => {
  test('prefills saved username and password when reopening the login dialog', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      hostApi: {
        '["huanxing","savedCredentials",null]': {
          success: true,
          credentials: {
            baseUrl: 'http://localhost:3000',
            username: 'demo-user',
            password: 'demo-password',
          },
        },
      },
    });

    await completeSetup(page);
    await page.getByRole('button', { name: /连接 Huanxing|Connect Huanxing/i }).click();

    await expect(page.getByLabel('用户名')).toHaveValue('demo-user');
    await expect(page.getByLabel('密码')).toHaveValue('demo-password');
  });
});
