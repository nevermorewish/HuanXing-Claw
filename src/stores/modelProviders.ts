/**
 * Model Providers Store
 *
 * Drives the clawpanel-style Models page: reads every provider from
 * openclaw.json's `models.providers.*` (via the modelProviders IPC module) and
 * exposes actions to add/edit/delete providers and models, set the global
 * primary model, test a model, and fetch a provider's remote model list.
 *
 * Nothing is persisted client-side — openclaw.json is the source of truth, so
 * every mutation returns the fresh provider list which we cache here.
 */
import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';

export interface ModelProviderEntry {
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface ModelProviderDTO {
  key: string;
  baseUrl: string;
  api: string;
  hasKey: boolean;
  maskedKey: string | null;
  models: ModelProviderEntry[];
  primary: string | null;
}

export interface ModelTestResult {
  ok: boolean;
  latencyMs?: number;
  reply?: string;
  error?: string;
}

interface ModelProvidersState {
  providers: ModelProviderDTO[];
  /** Global default model ref (`provider/modelId`). */
  primary: string | null;
  fallbacks: string[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  saveProvider: (input: {
    key: string;
    baseUrl: string;
    api: string;
    apiKey?: string;
    models?: ModelProviderEntry[];
    primaryModelId?: string | null;
  }) => Promise<void>;
  deleteProvider: (key: string) => Promise<void>;
  setPrimary: (modelRef: string) => Promise<void>;
  addModels: (key: string, models: ModelProviderEntry[]) => Promise<void>;
  deleteModel: (key: string, modelId: string) => Promise<void>;
  editModel: (key: string, modelId: string, model: ModelProviderEntry) => Promise<void>;
  testModel: (key: string, modelId: string) => Promise<ModelTestResult>;
  fetchRemoteModels: (key: string) => Promise<{ models: ModelProviderEntry[]; notSupported?: boolean }>;
}

/** Apply a list-shaped IPC result to the store, or throw its error. */
function applyResult(
  set: (partial: Partial<ModelProvidersState>) => void,
  result: { success: boolean; error?: string; providers?: ModelProviderDTO[]; primary?: string | null; fallbacks?: string[] },
  fallbackError: string,
): void {
  if (!result.success) {
    throw new Error(result.error || fallbackError);
  }
  set({
    providers: result.providers ?? [],
    primary: result.primary ?? null,
    fallbacks: result.fallbacks ?? [],
  });
}

export const useModelProvidersStore = create<ModelProvidersState>()((set) => ({
  providers: [],
  primary: null,
  fallbacks: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApi.modelProviders.list();
      applyResult(set, result, '读取提供商配置失败');
    } catch (error) {
      // Don't surface a hard error for an empty/missing config — just leave it empty.
      console.error('Failed to load model providers', error);
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },

  saveProvider: async (input) => {
    const result = await hostApi.modelProviders.saveProvider({
      key: input.key,
      baseUrl: input.baseUrl,
      api: input.api,
      apiKey: input.apiKey,
      models: input.models ?? [],
      primaryModelId: input.primaryModelId ?? null,
    });
    applyResult(set, result, '保存提供商失败');
  },

  deleteProvider: async (key) => {
    const result = await hostApi.modelProviders.deleteProvider({ key });
    applyResult(set, result, '删除提供商失败');
  },

  setPrimary: async (modelRef) => {
    const result = await hostApi.modelProviders.setPrimary({ modelRef });
    applyResult(set, result, '设置主模型失败');
  },

  addModels: async (key, models) => {
    const result = await hostApi.modelProviders.addModels({ key, models });
    applyResult(set, result, '添加模型失败');
  },

  deleteModel: async (key, modelId) => {
    const result = await hostApi.modelProviders.deleteModel({ key, modelId });
    applyResult(set, result, '删除模型失败');
  },

  editModel: async (key, modelId, model) => {
    const result = await hostApi.modelProviders.editModel({ key, modelId, model });
    applyResult(set, result, '编辑模型失败');
  },

  testModel: async (key, modelId) => {
    const result = await hostApi.modelProviders.testModel({ key, modelId });
    if (!result.success) {
      return { ok: false, error: result.error || '测试失败' };
    }
    return { ok: true, latencyMs: result.latencyMs, reply: result.reply };
  },

  fetchRemoteModels: async (key) => {
    const result = await hostApi.modelProviders.fetchRemoteModels({ key });
    if (!result.success) {
      const err = new Error(result.error || '获取模型列表失败') as Error & { notSupported?: boolean };
      err.notSupported = result.notSupported;
      throw err;
    }
    return { models: result.models ?? [], notSupported: result.notSupported };
  },
}));
