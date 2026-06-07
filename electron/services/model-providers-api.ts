/**
 * Model Providers API service.
 *
 * Generic, clawpanel-style provider management over openclaw.json's
 * `models.providers.*`. Lists every provider with its nested models, and lets
 * the renderer add/edit/delete providers and models, set the global primary
 * model, test a model, and fetch a provider's remote model list.
 *
 * API keys never leave the main process: `list` returns only `hasKey` +
 * `maskedKey`; test/fetch resolve the real inline key here via getProviderApiKey.
 */
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import {
  getProviderApiKey,
  listAllProvidersConfig,
  readProviderModelConfig,
  removeModelFromProvider,
  removeProviderFromOpenClaw,
  setPrimaryModelRef,
  writeProviderModelConfig,
  type ProviderModelEntry,
} from '../utils/openclaw-auth';
import { OPENCLAW_API_PROTOCOLS, type OpenClawApiProtocol } from '../shared/providers/types';
import { listRemoteModels, testProviderModel } from './providers/provider-validation';
import { logger } from '../utils/logger';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Narrow a renderer-supplied api string to a valid protocol (throws if invalid). */
function toApiProtocol(api: string): OpenClawApiProtocol {
  if ((OPENCLAW_API_PROTOCOLS as readonly string[]).includes(api)) {
    return api as OpenClawApiProtocol;
  }
  throw new Error(`不支持的 API 协议: ${api}`);
}

export function createModelProvidersApi(
  { gatewayManager }: { gatewayManager: GatewayManager },
): CompleteHostServiceRegistry['modelProviders'] {
  /** Read the full provider list — the common success payload for mutations. */
  const snapshot = async () => {
    const { providers, primary, fallbacks } = await listAllProvidersConfig();
    return { success: true as const, providers, primary, fallbacks };
  };

  return {
    list: async () => {
      try {
        return await snapshot();
      } catch (error) {
        logger.error('modelProviders.list failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },

    saveProvider: async (payload) => {
      try {
        if (!payload.key?.trim()) {
          return { success: false, error: '提供商标识不能为空' };
        }
        await writeProviderModelConfig(payload.key.trim(), {
          baseUrl: payload.baseUrl,
          api: toApiProtocol(payload.api),
          apiKey: payload.apiKey,
          models: payload.models,
          primaryModelId: payload.primaryModelId ?? null,
        });
        gatewayManager.debouncedReload();
        return await snapshot();
      } catch (error) {
        logger.error('modelProviders.saveProvider failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },

    deleteProvider: async (payload) => {
      try {
        await removeProviderFromOpenClaw(payload.key);
        gatewayManager.debouncedRestart();
        return await snapshot();
      } catch (error) {
        logger.error('modelProviders.deleteProvider failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },

    setPrimary: async (payload) => {
      try {
        await setPrimaryModelRef(payload.modelRef);
        gatewayManager.debouncedReload();
        return await snapshot();
      } catch (error) {
        logger.error('modelProviders.setPrimary failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },

    addModels: async (payload) => {
      try {
        const current = await readProviderModelConfig(payload.key);
        // Merge new models, de-duping by id (existing entries win, preserving names).
        const byId = new Map<string, ProviderModelEntry>();
        for (const m of current.models) byId.set(m.id, m);
        for (const m of payload.models) {
          if (!byId.has(m.id)) byId.set(m.id, m);
        }
        await writeProviderModelConfig(payload.key, {
          baseUrl: current.baseUrl,
          api: current.api,
          models: [...byId.values()],
        });
        gatewayManager.debouncedReload();
        return await snapshot();
      } catch (error) {
        logger.error('modelProviders.addModels failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },

    deleteModel: async (payload) => {
      try {
        const current = await readProviderModelConfig(payload.key);
        const remaining = current.models.filter((m) => m.id !== payload.modelId);
        if (remaining.length === 0) {
          // Last model removed → drop the whole provider entry.
          await removeProviderFromOpenClaw(payload.key);
          gatewayManager.debouncedRestart();
        } else {
          await removeModelFromProvider(payload.key, payload.modelId);
          gatewayManager.debouncedReload();
        }
        return await snapshot();
      } catch (error) {
        logger.error('modelProviders.deleteModel failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },

    editModel: async (payload) => {
      try {
        const current = await readProviderModelConfig(payload.key);
        const next = current.models.map((m) => (m.id === payload.modelId ? payload.model : m));
        // If the edited id changed, the primary may need to follow it.
        const primaryId = current.primary === `${payload.key}/${payload.modelId}`
          ? payload.model.id
          : undefined;
        await writeProviderModelConfig(payload.key, {
          baseUrl: current.baseUrl,
          api: current.api,
          models: next,
          primaryModelId: primaryId,
        });
        gatewayManager.debouncedReload();
        return await snapshot();
      } catch (error) {
        logger.error('modelProviders.editModel failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },

    testModel: async (payload) => {
      try {
        const config = await readProviderModelConfig(payload.key);
        if (!config.baseUrl) {
          return { success: false, error: '缺少服务地址' };
        }
        const apiKey = (await getProviderApiKey(payload.key)) ?? '';
        const result = await testProviderModel(config.baseUrl, apiKey, payload.modelId, config.api);
        if (!result.ok) {
          return { success: false, error: result.error || '测试失败' };
        }
        return { success: true, latencyMs: result.latencyMs, reply: result.reply };
      } catch (error) {
        logger.error('modelProviders.testModel failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },

    fetchRemoteModels: async (payload) => {
      try {
        const config = await readProviderModelConfig(payload.key);
        if (!config.baseUrl) {
          return { success: false, error: '缺少服务地址' };
        }
        const apiKey = (await getProviderApiKey(payload.key)) ?? '';
        const result = await listRemoteModels(config.baseUrl, apiKey, config.api);
        if (!result.ok) {
          return { success: false, error: result.error, notSupported: result.notSupported };
        }
        return {
          success: true,
          models: result.models.map((m) => ({ id: m.id, name: m.name ?? m.id })),
        };
      } catch (error) {
        logger.error('modelProviders.fetchRemoteModels failed', error);
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}
