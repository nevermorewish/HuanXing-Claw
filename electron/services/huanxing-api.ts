/**
 * Huanxing API service.
 *
 * Bridges the renderer to the main-process Huanxing session: login, then a
 * combined "setup" fetch that returns the usable model list plus a `sk-` API
 * key the renderer can turn into provider accounts.
 */
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { HuanxingUser } from '@shared/host-api/contract';
import { huanxingSession } from '../utils/huanxing-session';
import { logger } from '../utils/logger';

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

export function createHuanXingApi(): CompleteHostServiceRegistry['huanxing'] {
  return {
    login: async (payload) => {
      try {
        const user = await huanxingSession.login(
          payload.baseUrl,
          payload.username,
          payload.password,
        );
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

    logout: async () => {
      huanxingSession.logout();
      return { success: true };
    },
  };
}
