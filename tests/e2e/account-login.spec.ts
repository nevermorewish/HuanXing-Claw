import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';
import { BRAND } from '../../shared/brand';
const user = { id: 'ccwork-user', username: 'demo-user', displayName: 'Demo', role: 1, status: 1, group: '' };
const model = { id: 'model-uuid', name: 'CCWork Model', contextWindow: 128000 };
const setup = { success: true, user, baseUrl: 'https://ccwork.site', models: [model.id], modelEntries: [model] };
const config = { baseUrl: 'http://127.0.0.1:23456/v1', primary: `${BRAND.providerKey}/model-uuid`, models: [model] };
/** Main mints this; it must be replayed verbatim when the code is redeemed. */
const challengeKey = '3f6c1d6e-0f4b-4c57-9a09-6d6f0f5f1a2b';
const balance = { quota: 12.345678, usedQuota: 0, quotaPerUnit: 1, displayInCurrency: false, topUpUrl: 'https://ccwork.site' };
const transactions = { success: true, total: 1, transactions: [{ id: 'charge-id', description: 'CCWork model charge', amount_precise: '-0.123456', created_at: '2026-10-05T12:00:00Z', transaction_type: 'consume' }] };

test.describe('ccwork account', () => {
  test('restores the ccwork account after restart and clears account controls on logout', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","restore",null]': setup,
      '["account","logout",null]': { success: true },
      '["account","getBalance",null]': { success: true, balance },
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
    // Code login is the default entry point, so no password field is rendered at all.
    await expect(page.locator('#hx-password')).toHaveCount(0);
    await page.getByTestId('ccwork-use-password').click();
    await expect(page.locator('#hx-password')).toHaveValue('');
  });
  test('logs in with a password and displays backend credit consumption', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","login",{"baseUrl":"https://ccwork.site","password":"password","username":"demo-user"}]': { success: true, user },
      '["account","fetchSetup",null]': setup,
      '["account","getBalance",null]': { success: true, balance },
      '["account","transactions",{"limit":20,"offset":0}]': transactions,
    } });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await page.getByTestId('ccwork-use-password').click();
    await page.locator('#hx-username').fill('demo-user'); await page.locator('#hx-password').fill('password');
    await page.getByTestId('ccwork-submit').click();
    // No model picking step: logging in enables the whole ccwork catalog.
    await expect(page.getByTestId('sidebar-account-account')).toContainText('Demo');
    await page.getByTestId('sidebar-nav-usage').click();
    await expect(page.getByTestId('ccwork-consumption')).toContainText('CCWork model charge');
    await expect(page.getByTestId('ccwork-consumption')).toContainText('0.123456');
    await expect(page.getByTestId('ccwork-consumption')).toContainText('12.345678');
  });
  test('logs in with a verification code, replaying the challenge key Main issued', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","sendVerificationCode",{"baseUrl":"https://ccwork.site","codeType":"login","username":"demo@example.com"}]': { success: true, challengeKey },
      [`["account","loginWithVerificationCode",{"baseUrl":"https://ccwork.site","challengeKey":"${challengeKey}","username":"demo@example.com","verificationCode":"123456"}]`]: { success: true, user },
      '["account","fetchSetup",null]': setup,
      '["account","getBalance",null]': { success: true, balance },
    } });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await page.locator('#hx-username').fill('demo@example.com');
    // Submitting before a code is requested is refused locally, not by the server.
    await page.getByTestId('ccwork-submit').click();
    await expect(page.getByRole('alert')).toContainText('Send a verification code first');
    await page.getByTestId('ccwork-send-code').click();
    await expect(page.getByTestId('ccwork-send-code')).toBeDisabled();
    await page.locator('#ccwork-code').fill('123456'); await page.getByTestId('ccwork-submit').click();
    await expect(page.getByTestId('sidebar-account-account')).toContainText('Demo');
  });
  test('rejects a malformed identifier before calling ccwork', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {} });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await page.locator('#hx-username').fill('not-an-identifier');
    await page.getByTestId('ccwork-send-code').click();
    await expect(page.getByRole('alert')).toContainText('valid email address');
  });
  test('registers by email verification and enables all catalog models', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","sendVerificationCode",{"baseUrl":"https://ccwork.site","codeType":"register","username":"demo@example.com"}]': { success: true, challengeKey: '' },
      '["account","register",{"baseUrl":"https://ccwork.site","password":"Password123!","username":"demo@example.com","verificationCode":"123456"}]': { success: true, user },
      '["account","fetchSetup",null]': setup,
      '["account","getModelConfig",null]': { success: true, config: { ...config, models: [] } },
      '["account","getBalance",null]': { success: true, balance },
    } });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await page.getByTestId('ccwork-toggle-register').click();
    await page.locator('#hx-username').fill('demo@example.com'); await page.locator('#hx-password').fill('Password123!');
    await page.getByTestId('ccwork-send-code').click();
    await expect(page.getByTestId('ccwork-send-code')).toBeDisabled();
    await page.locator('#ccwork-code').fill('123456'); await page.getByTestId('ccwork-submit').click();
    await expect(page.getByTestId('sidebar-account-account')).toContainText('Demo');
  });
  test('shows server registration restrictions and keeps registration usable', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, { hostApi: {
      '["account","sendVerificationCode",{"baseUrl":"https://ccwork.site","codeType":"register","username":"demo@example.com"}]': { success: false, error: 'Self signup is disabled on this ccwork server' },
    } });
    await completeSetup(page); await page.getByTestId('sidebar-account-login').click();
    await page.getByTestId('ccwork-toggle-register').click(); await page.locator('#hx-username').fill('demo@example.com');
    await page.getByTestId('ccwork-send-code').click();
    await expect(page.getByRole('alert')).toContainText('Self signup is disabled');
    // A failed send must not start the cooldown, so the user can retry immediately.
    await expect(page.getByTestId('ccwork-send-code')).toBeEnabled();
  });
});
