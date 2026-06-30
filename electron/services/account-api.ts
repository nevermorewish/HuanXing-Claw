/**
 * Account API service.
 *
 * Bridges the renderer to the main-process Account session: login, then a
 * combined "setup" fetch that returns the usable model list plus a `sk-` API
 * key the renderer can turn into provider accounts.
 */
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { AccountModelConfig, AccountModelEntry, AccountToken, AccountUser } from '@shared/host-api/contract';
import { safeStorage } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import { getDeepClawProviderStore } from './providers/store-instance';
import { accountSession } from '../utils/account-session';
import {
  deleteAccountProvider,
  getAccountApiKey,
  readAccountModelConfig,
  writeAccountModelConfig,
} from '../utils/openclaw-auth';
import { testProviderModel } from './providers/provider-validation';
import { logger } from '../utils/logger';

type SavedAccountCredentials = {
  username: string;
  password: string;
};
type StoredAccountCredentials = {
  baseUrl?: string;
  username: string;
  password?: string;
  encryptedPassword?: string;
};

const ACCOUNT_CREDENTIALS_KEY = 'accountCredentials';

function toContractUser(user: AccountUser): AccountUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    group: user.group,
  };
}

function encryptPassword(password: string): Pick<StoredAccountCredentials, 'password' | 'encryptedPassword'> {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      encryptedPassword: safeStorage.encryptString(password).toString('base64'),
    };
  }
  return { password };
}

function decryptPassword(value: StoredAccountCredentials): string {
  if (typeof value.encryptedPassword === 'string' && value.encryptedPassword) {
    try {
      return safeStorage.decryptString(Buffer.from(value.encryptedPassword, 'base64'));
    } catch (error) {
      logger.warn('account.savedCredentials decrypt failed', error);
    }
  }
  return typeof value.password === 'string' ? value.password : '';
}

function normalizeCredentials(value: unknown): SavedAccountCredentials | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as StoredAccountCredentials;
  const username = typeof record.username === 'string' ? record.username : '';
  const password = decryptPassword(record);
  if (!username || !password) {
    return null;
  }
  return { username, password };
}

async function getSavedCredentials(): Promise<SavedAccountCredentials | null> {
  const store = await getDeepClawProviderStore();
  return normalizeCredentials(store.get(ACCOUNT_CREDENTIALS_KEY));
}

async function saveCredentials(credentials: SavedAccountCredentials): Promise<void> {
  const store = await getDeepClawProviderStore();
  store.set(ACCOUNT_CREDENTIALS_KEY, {
    username: credentials.username,
    ...encryptPassword(credentials.password),
  } satisfies StoredAccountCredentials);
}

/** Build the renderer-facing config shape from the stored openclaw.json entry. */
function toContractModelConfig(data: {
  baseUrl: string;
  models: AccountModelEntry[];
  primary: string | null;
}): AccountModelConfig {
  return { baseUrl: data.baseUrl, models: data.models, primary: data.primary };
}

/**
 * Resolve the base URL for the account provider entry. Prefer the live session
 * (just-logged-in), then any previously-stored entry. The account relay is
 * OpenAI-compatible, so the entry's baseUrl needs a `/v1` suffix.
 */
function resolveAccountBaseUrl(sessionBaseUrl: string | null, storedBaseUrl: string): string {
  const raw = (sessionBaseUrl || storedBaseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /\/v\d+$/.test(raw) ? raw : `${raw}/v1`;
}

export function createAccountApi(
  { gatewayManager }: { gatewayManager: GatewayManager },
): CompleteHostServiceRegistry['account'] {
  return {
    login: async (payload) => {
      try {
        const user = await accountSession.login(
          payload.baseUrl,
          payload.username,
          payload.password,
        );
        await saveCredentials({
          username: payload.username,
          password: payload.password,
        });
        return { success: true, user: toContractUser(user) };
      } catch (error) {
        logger.error('account.login failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    fetchSetup: async () => {
      try {
        const user = accountSession.getUser();
        const baseUrl = accountSession.getBaseUrl();
        if (!user || !baseUrl) {
          return { success: false, error: '尚未登录' };
        }
        const models = await accountSession.fetchModels();
        const apiKey = await accountSession.ensureApiKey();
        return {
          success: true,
          user: toContractUser(user),
          baseUrl,
          models,
          apiKey,
        };
      } catch (error) {
        logger.error('account.fetchSetup failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    savedCredentials: async () => {
      try {
        return { success: true, credentials: await getSavedCredentials() };
      } catch (error) {
        logger.error('account.savedCredentials failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    getBalance: async () => {
      try {
        if (!accountSession.isLoggedIn()) {
          return { success: false, error: '尚未登录' };
        }
        const [{ quota, usedQuota }, status] = await Promise.all([
          accountSession.fetchSelfQuota(),
          accountSession.fetchStatus(),
        ]);
        const baseUrl = accountSession.getBaseUrl() ?? '';
        // New-API top_up_link may be absolute or a path; resolve against baseUrl.
        let topUpUrl = '';
        if (status.topUpLink) {
          topUpUrl = /^https?:\/\//i.test(status.topUpLink)
            ? status.topUpLink
            : `${baseUrl.replace(/\/+$/, '')}/${status.topUpLink.replace(/^\/+/, '')}`;
        } else if (baseUrl) {
          topUpUrl = `${baseUrl.replace(/\/+$/, '')}/topup`;
        }
        return {
          success: true,
          balance: {
            quota,
            usedQuota,
            quotaPerUnit: status.quotaPerUnit,
            displayInCurrency: status.displayInCurrency,
            topUpUrl,
          },
        };
      } catch (error) {
        logger.error('account.getBalance failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    listTokens: async () => {
      try {
        if (!accountSession.isLoggedIn()) {
          return { success: false, error: '尚未登录' };
        }
        const tokens = await accountSession.listTokens();
        return { success: true, tokens: tokens.map((t): AccountToken => ({
          id: t.id,
          name: t.name,
          group: t.group,
          status: t.status,
        })) };
      } catch (error) {
        logger.error('account.listTokens failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    logout: async () => {
      accountSession.logout();
      return { success: true };
    },

    getModelConfig: async () => {
      try {
        const config = await readAccountModelConfig();
        return { success: true, config: toContractModelConfig(config) };
      } catch (error) {
        logger.error('account.getModelConfig failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    saveModelConfig: async (payload) => {
      try {
        // baseUrl + key come from the live session right after login; on a later
        // edit (no live session) we keep whatever the stored entry already holds.
        const stored = await readAccountModelConfig();
        const baseUrl = resolveAccountBaseUrl(accountSession.getBaseUrl(), stored.baseUrl);
        if (!baseUrl) {
          return { success: false, error: '缺少服务地址，请重新登录 Account' };
        }
        let apiKey: string | undefined;
        if (accountSession.isLoggedIn()) {
          apiKey = await accountSession.ensureApiKey(payload.tokenId ?? undefined);
        }
        await writeAccountModelConfig({
          baseUrl,
          apiKey,
          models: payload.models,
          primaryModelId: payload.primaryModelId ?? null,
        });
        gatewayManager.debouncedReload();
        const config = await readAccountModelConfig();
        return { success: true, config: toContractModelConfig(config) };
      } catch (error) {
        logger.error('account.saveModelConfig failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    setPrimaryModel: async (payload) => {
      try {
        const stored = await readAccountModelConfig();
        if (!stored.models.some((m) => m.id === payload.modelId)) {
          return { success: false, error: `模型不存在：${payload.modelId}` };
        }
        await writeAccountModelConfig({
          baseUrl: stored.baseUrl,
          models: stored.models,
          primaryModelId: payload.modelId,
        });
        gatewayManager.debouncedReload();
        const config = await readAccountModelConfig();
        return { success: true, config: toContractModelConfig(config) };
      } catch (error) {
        logger.error('account.setPrimaryModel failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    deleteModel: async (payload) => {
      try {
        const stored = await readAccountModelConfig();
        const remaining = stored.models.filter((m) => m.id !== payload.modelId);
        if (remaining.length === 0) {
          // Last model removed → drop the whole provider entry.
          await deleteAccountProvider();
          gatewayManager.debouncedRestart();
          return { success: true, config: { baseUrl: '', models: [], primary: null } };
        }
        await writeAccountModelConfig({
          baseUrl: stored.baseUrl,
          models: remaining,
          // Keep the existing primary unless it was the deleted model.
          primaryModelId: stored.primary === `account/${payload.modelId}`
            ? remaining[0].id
            : undefined,
        });
        gatewayManager.debouncedReload();
        const config = await readAccountModelConfig();
        return { success: true, config: toContractModelConfig(config) };
      } catch (error) {
        logger.error('account.deleteModel failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    testModel: async (payload) => {
      try {
        const stored = await readAccountModelConfig();
        const baseUrl = resolveAccountBaseUrl(accountSession.getBaseUrl(), stored.baseUrl);
        if (!baseUrl) {
          return { success: false, error: '缺少服务地址，请重新登录 Account' };
        }
        // Prefer the live session key; fall back to the inline key on the entry.
        const apiKey = accountSession.isLoggedIn()
          ? await accountSession.ensureApiKey()
          : (await getAccountApiKey()) ?? '';
        if (!apiKey) {
          return { success: false, error: '缺少 API 密钥，请重新登录 Account' };
        }
        const result = await testProviderModel(baseUrl, apiKey, payload.modelId, 'openai-completions');
        if (!result.ok) {
          return { success: false, error: result.error || '测试失败' };
        }
        return { success: true, latencyMs: result.latencyMs, reply: result.reply };
      } catch (error) {
        logger.error('account.testModel failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
