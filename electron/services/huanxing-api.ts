/**
 * Huanxing API service.
 *
 * Bridges the renderer to the main-process Huanxing session: login, then a
 * combined "setup" fetch that returns the usable model list plus a `sk-` API
 * key the renderer can turn into provider accounts.
 */
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { HuanxingUser } from '@shared/host-api/contract';
import { safeStorage } from 'electron';
import { getClawXProviderStore } from './providers/store-instance';
import { huanxingSession } from '../utils/huanxing-session';
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

export function createHuanXingApi(): CompleteHostServiceRegistry['huanxing'] {
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

    logout: async () => {
      huanxingSession.logout();
      return { success: true };
    },
  };
}
