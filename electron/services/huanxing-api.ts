/**
 * Huanxing API service.
 *
 * Bridges the renderer to the main-process Huanxing session: login, then a
 * combined "setup" fetch that returns the usable model list plus a `sk-` API
 * key the renderer can turn into provider accounts.
 */
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { HuanxingModelConfig, HuanxingModelEntry, HuanxingUser } from '@shared/host-api/contract';
import { safeStorage } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import { getClawXProviderStore } from './providers/store-instance';
import { huanxingSession } from '../utils/huanxing-session';
import {
  deleteHuanxingProvider,
  getHuanxingApiKey,
  readHuanxingModelConfig,
  writeHuanxingModelConfig,
} from '../utils/openclaw-auth';
import { testProviderModel } from './providers/provider-validation';
import { logger } from '../utils/logger';

type SavedHuanxingCredentials = {
  baseUrl: string;
  username: string;
  password: string;
};
type StoredHuanxingCredentials = {
  baseUrl: string;
  username: string;
  password?: string;
  encryptedPassword?: string;
};

const HUANXING_CREDENTIALS_KEY = 'huanxingCredentials';

function toContractUser(user: HuanxingUser): HuanxingUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    group: user.group,
  };
}

function encryptPassword(password: string): Pick<StoredHuanxingCredentials, 'password' | 'encryptedPassword'> {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      encryptedPassword: safeStorage.encryptString(password).toString('base64'),
    };
  }
  return { password };
}

function decryptPassword(value: StoredHuanxingCredentials): string {
  if (typeof value.encryptedPassword === 'string' && value.encryptedPassword) {
    try {
      return safeStorage.decryptString(Buffer.from(value.encryptedPassword, 'base64'));
    } catch (error) {
      logger.warn('huanxing.savedCredentials decrypt failed', error);
    }
  }
  return typeof value.password === 'string' ? value.password : '';
}

function normalizeCredentials(value: unknown): SavedHuanxingCredentials | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as StoredHuanxingCredentials;
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : '';
  const username = typeof record.username === 'string' ? record.username : '';
  const password = decryptPassword(record);
  if (!baseUrl || !username || !password) {
    return null;
  }
  return { baseUrl, username, password };
}

async function getSavedCredentials(): Promise<SavedHuanxingCredentials | null> {
  const store = await getClawXProviderStore();
  return normalizeCredentials(store.get(HUANXING_CREDENTIALS_KEY));
}

async function saveCredentials(credentials: SavedHuanxingCredentials): Promise<void> {
  const store = await getClawXProviderStore();
  store.set(HUANXING_CREDENTIALS_KEY, {
    baseUrl: credentials.baseUrl,
    username: credentials.username,
    ...encryptPassword(credentials.password),
  } satisfies StoredHuanxingCredentials);
}

/** Build the renderer-facing config shape from the stored openclaw.json entry. */
function toContractModelConfig(data: {
  baseUrl: string;
  models: HuanxingModelEntry[];
  primary: string | null;
}): HuanxingModelConfig {
  return { baseUrl: data.baseUrl, models: data.models, primary: data.primary };
}

/**
 * Resolve the base URL for the huanxing provider entry. Prefer the live session
 * (just-logged-in), then any previously-stored entry. The huanxing relay is
 * OpenAI-compatible, so the entry's baseUrl needs a `/v1` suffix.
 */
function resolveHuanxingBaseUrl(sessionBaseUrl: string | null, storedBaseUrl: string): string {
  const raw = (sessionBaseUrl || storedBaseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /\/v\d+$/.test(raw) ? raw : `${raw}/v1`;
}

export function createHuanXingApi(
  { gatewayManager }: { gatewayManager: GatewayManager },
): CompleteHostServiceRegistry['huanxing'] {
  return {
    login: async (payload) => {
      try {
        const user = await huanxingSession.login(
          payload.baseUrl,
          payload.username,
          payload.password,
        );
        await saveCredentials({
          baseUrl: payload.baseUrl,
          username: payload.username,
          password: payload.password,
        });
        return { success: true, user: toContractUser(user) };
      } catch (error) {
        logger.error('huanxing.login failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    fetchSetup: async () => {
      try {
        const user = huanxingSession.getUser();
        const baseUrl = huanxingSession.getBaseUrl();
        if (!user || !baseUrl) {
          return { success: false, error: '尚未登录' };
        }
        const models = await huanxingSession.fetchModels();
        const apiKey = await huanxingSession.ensureApiKey();
        return {
          success: true,
          user: toContractUser(user),
          baseUrl,
          models,
          apiKey,
        };
      } catch (error) {
        logger.error('huanxing.fetchSetup failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    savedCredentials: async () => {
      try {
        return { success: true, credentials: await getSavedCredentials() };
      } catch (error) {
        logger.error('huanxing.savedCredentials failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    getBalance: async () => {
      try {
        if (!huanxingSession.isLoggedIn()) {
          return { success: false, error: '尚未登录' };
        }
        const [{ quota, usedQuota }, status] = await Promise.all([
          huanxingSession.fetchSelfQuota(),
          huanxingSession.fetchStatus(),
        ]);
        const baseUrl = huanxingSession.getBaseUrl() ?? '';
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
        logger.error('huanxing.getBalance failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    logout: async () => {
      huanxingSession.logout();
      return { success: true };
    },

    getModelConfig: async () => {
      try {
        const config = await readHuanxingModelConfig();
        return { success: true, config: toContractModelConfig(config) };
      } catch (error) {
        logger.error('huanxing.getModelConfig failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    saveModelConfig: async (payload) => {
      try {
        // baseUrl + key come from the live session right after login; on a later
        // edit (no live session) we keep whatever the stored entry already holds.
        const stored = await readHuanxingModelConfig();
        const baseUrl = resolveHuanxingBaseUrl(huanxingSession.getBaseUrl(), stored.baseUrl);
        if (!baseUrl) {
          return { success: false, error: '缺少服务地址，请重新登录 Huanxing' };
        }
        let apiKey: string | undefined;
        if (huanxingSession.isLoggedIn()) {
          apiKey = await huanxingSession.ensureApiKey();
        }
        await writeHuanxingModelConfig({
          baseUrl,
          apiKey,
          models: payload.models,
          primaryModelId: payload.primaryModelId ?? null,
        });
        gatewayManager.debouncedReload();
        const config = await readHuanxingModelConfig();
        return { success: true, config: toContractModelConfig(config) };
      } catch (error) {
        logger.error('huanxing.saveModelConfig failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    setPrimaryModel: async (payload) => {
      try {
        const stored = await readHuanxingModelConfig();
        if (!stored.models.some((m) => m.id === payload.modelId)) {
          return { success: false, error: `模型不存在：${payload.modelId}` };
        }
        await writeHuanxingModelConfig({
          baseUrl: stored.baseUrl,
          models: stored.models,
          primaryModelId: payload.modelId,
        });
        gatewayManager.debouncedReload();
        const config = await readHuanxingModelConfig();
        return { success: true, config: toContractModelConfig(config) };
      } catch (error) {
        logger.error('huanxing.setPrimaryModel failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    deleteModel: async (payload) => {
      try {
        const stored = await readHuanxingModelConfig();
        const remaining = stored.models.filter((m) => m.id !== payload.modelId);
        if (remaining.length === 0) {
          // Last model removed → drop the whole provider entry.
          await deleteHuanxingProvider();
          gatewayManager.debouncedRestart();
          return { success: true, config: { baseUrl: '', models: [], primary: null } };
        }
        await writeHuanxingModelConfig({
          baseUrl: stored.baseUrl,
          models: remaining,
          // Keep the existing primary unless it was the deleted model.
          primaryModelId: stored.primary === `huanxing/${payload.modelId}`
            ? remaining[0].id
            : undefined,
        });
        gatewayManager.debouncedReload();
        const config = await readHuanxingModelConfig();
        return { success: true, config: toContractModelConfig(config) };
      } catch (error) {
        logger.error('huanxing.deleteModel failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    testModel: async (payload) => {
      try {
        const stored = await readHuanxingModelConfig();
        const baseUrl = resolveHuanxingBaseUrl(huanxingSession.getBaseUrl(), stored.baseUrl);
        if (!baseUrl) {
          return { success: false, error: '缺少服务地址，请重新登录 Huanxing' };
        }
        // Prefer the live session key; fall back to the inline key on the entry.
        const apiKey = huanxingSession.isLoggedIn()
          ? await huanxingSession.ensureApiKey()
          : (await getHuanxingApiKey()) ?? '';
        if (!apiKey) {
          return { success: false, error: '缺少 API 密钥，请重新登录 Huanxing' };
        }
        const result = await testProviderModel(baseUrl, apiKey, payload.modelId, 'openai-completions');
        if (!result.ok) {
          return { success: false, error: result.error || '测试失败' };
        }
        return { success: true, latencyMs: result.latencyMs, reply: result.reply };
      } catch (error) {
        logger.error('huanxing.testModel failed', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
