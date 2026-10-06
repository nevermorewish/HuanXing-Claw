import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';
import { BRAND } from '../../shared/brand';
const user = { id: 'ccwork-user', username: 'demo-user', displayName: 'Demo', role: 1, status: 1, group: '' };
const model = { id: 'model-uuid', name: 'CCWork Model', contextWindow: 128000 };
const setup = { success: true, user, baseUrl: 'https://ccwork.site', models: [model.id], modelEntries: [model] };
const config = { baseUrl: 'http://127.0.0.1:23456/v1', primary: `${BRAND.providerKey}/model-uuid`, models: [model] };

test.describe('ccwork account', () => {
  test('restores the ccwork account after restart and clears account controls on logout', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","restore",null]': setup,
      '["account","logout",null]': { success: true },
      '["account","getBalance",null]': { success: true, balance: { quota: 10.123456, usedQuota: 0, quotaPerUnit: 1, displayInCurrency: false, topUpUrl: 'https://ccwork.site' } },
    } });
    await completeSetup(page);
    await expect(page.getByTestId('sidebar-account-account')).toContainText('Demo');
    await page.getByTestId('sidebar-account-logout').click();
    await expect(page.getByTestId('sidebar-account-login')).toBeVisible();
    await expect(page.getByTestId('sidebar-account-account')).toHaveCount(0);
  });
  test('uses ccwork.site and restores only the account identifier without exposing passwords', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","savedCredentials",null]': { success: true, credentials: { username: 'demo-user', password: '', baseUrl: 'https://ccwork.site' } },
    } });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await expect(page.locator('#hx-url')).toHaveValue('https://ccwork.site');
    await expect(page.locator('#hx-username')).toHaveValue('demo-user');
    await expect(page.locator('#hx-password')).toHaveValue('');
  });
  test('logs in, selects server catalog models, and displays backend credit consumption', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","login",{"baseUrl":"https://ccwork.site","password":"password","username":"demo-user"}]': { success: true, user },
      '["account","fetchSetup",null]': setup,
      '["account","getModelConfig",null]': { success: true, config: { ...config, models: [] } },
      '["account","saveModelConfig",{"models":[{"contextWindow":128000,"id":"model-uuid","name":"CCWork Model"}],"primaryModelId":"model-uuid","tokenId":null}]': { success: true, config },
      '["account","getBalance",null]': { success: true, balance: { quota: 12.345678, usedQuota: 0, quotaPerUnit: 1, displayInCurrency: false, topUpUrl: 'https://ccwork.site' } },
      '["account","transactions",{"limit":20,"offset":0}]': { success: true, total: 1, transactions: [{ id: 'charge-id', description: 'CCWork model charge', amount_precise: '-0.123456', created_at: '2026-10-05T12:00:00Z', transaction_type: 'consume' }] },
    } });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await page.locator('#hx-username').fill('demo-user'); await page.locator('#hx-password').fill('password');
    await page.getByTestId('ccwork-submit').click();
    await expect(page.getByRole('checkbox', { name: /CCWork Model/ })).toBeChecked();
    await page.getByRole('button', { name: 'Save selected models' }).click();
    await expect(page.getByTestId('sidebar-account-account')).toContainText('Demo');
    await page.getByTestId('sidebar-nav-usage').click();
    await expect(page.getByTestId('ccwork-consumption')).toContainText('CCWork model charge');
    await expect(page.getByTestId('ccwork-consumption')).toContainText('0.123456');
    await expect(page.getByTestId('ccwork-consumption')).toContainText('12.345678');
  });
  test('registers by email verification and auto-loads ccwork models', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","sendVerificationCode",{"baseUrl":"https://ccwork.site","username":"demo@example.com"}]': { success: true },
      '["account","register",{"baseUrl":"https://ccwork.site","password":"Password123!","username":"demo@example.com","verificationCode":"123456"}]': { success: true, user },
      '["account","fetchSetup",null]': setup,
      '["account","getModelConfig",null]': { success: true, config: { ...config, models: [] } },
    } });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await page.getByTestId('ccwork-toggle-register').click();
    await page.locator('#hx-username').fill('demo@example.com'); await page.locator('#hx-password').fill('Password123!');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('button', { name: /Resend in/ })).toBeDisabled();
    await page.locator('#ccwork-code').fill('123456'); await page.getByTestId('ccwork-submit').click();
    await expect(page.getByRole('checkbox', { name: /CCWork Model/ })).toBeVisible();
  });
  test('shows server registration restrictions and keeps registration usable', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","sendVerificationCode",{"baseUrl":"https://ccwork.site","username":"demo@example.com"}]': { success: false, error: 'Self signup is disabled on this ccwork server' },
    } });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await page.getByTestId('ccwork-toggle-register').click(); await page.locator('#hx-username').fill('demo@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('alert')).toContainText('Self signup is disabled');
    await expect(page.getByRole('button', { name: 'Send code' })).toBeEnabled();
  });
});
