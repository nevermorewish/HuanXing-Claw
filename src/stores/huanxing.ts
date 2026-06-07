/**
 * Huanxing Connection Store
 *
 * Drives the "connect to Huanxing-api" flow: log in (handled in the main
 * process so the HttpOnly session cookie can be held), fetch the usable model
 * list + a `sk-` API key, then turn the user-selected models into custom
 * provider accounts via the existing provider store.
 *
 * Only the server URL and last username are persisted. The session cookie and
 * API key never leave the main process / provider secure storage.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { hostApi } from '@/lib/host-api';

export const DEFAULT_HUANXING_URL = 'http://localhost:3000';

export interface HuanxingUser {
  id: number;
  username: string;
  displayName: string;
  role: number;
  status: number;
  group: string;
}

export interface HuanxingModelEntry {
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface HuanxingModelConfig {
  baseUrl: string;
  models: HuanxingModelEntry[];
  primary: string | null;
}

export interface HuanxingTestResult {
  ok: boolean;
  latencyMs?: number;
  reply?: string;
  error?: string;
}

interface HuanxingState {
  serverUrl: string;
  lastUsername: string;
  loggedIn: boolean;
  user: HuanxingUser | null;
  /** Models fetched after login, awaiting selection. Not persisted. */
  models: string[];
  /** The sk- key obtained for the account. Held only in memory. */
  apiKey: string | null;
  /** The huanxing provider config read from openclaw.json. Not persisted. */
  modelConfig: HuanxingModelConfig | null;
  loading: boolean;
  error: string | null;

  setServerUrl: (url: string) => void;
  savedCredentials: () => Promise<{ baseUrl: string; username: string; password: string } | null>;
  /** Log in and fetch models + key. Returns the model list on success. */
  login: (username: string, password: string) => Promise<string[]>;
  /** Write the selected models as the single huanxing provider. Returns count. */
  saveModels: (models: HuanxingModelEntry[], primaryModelId?: string | null) => Promise<number>;
  /** Read the huanxing provider config from openclaw.json. */
  loadModelConfig: () => Promise<HuanxingModelConfig | null>;
  setPrimaryModel: (modelId: string) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
  testModel: (modelId: string) => Promise<HuanxingTestResult>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useHuanxingStore = create<HuanxingState>()(
  persist(
    (set, get) => ({
      serverUrl: DEFAULT_HUANXING_URL,
      lastUsername: '',
      loggedIn: false,
      user: null,
      models: [],
      apiKey: null,
      modelConfig: null,
      loading: false,
      error: null,

      setServerUrl: (url) => set({ serverUrl: url }),
      clearError: () => set({ error: null }),

      savedCredentials: async () => {
        const result = await hostApi.huanxing.savedCredentials();
        if (!result.success) {
          throw new Error(result.error || '读取已保存凭据失败');
        }
        return result.credentials ?? null;
      },

      login: async (username, password) => {
        const baseUrl = get().serverUrl.trim() || DEFAULT_HUANXING_URL;
        set({ loading: true, error: null });
        try {
          const loginResult = await hostApi.huanxing.login({ baseUrl, username, password });
          if (!loginResult.success) {
            throw new Error(loginResult.error || '登录失败');
          }

          const setup = await hostApi.huanxing.fetchSetup();
          if (!setup.success) {
            throw new Error(setup.error || '获取模型列表失败');
          }

          const models = setup.models ?? [];
          set({
            loggedIn: true,
            user: setup.user
              ? {
                  id: setup.user.id,
                  username: setup.user.username,
                  displayName: setup.user.displayName,
                  role: setup.user.role,
                  status: setup.user.status,
                  group: setup.user.group,
                }
              : null,
            models,
            apiKey: setup.apiKey ?? null,
            lastUsername: username,
            serverUrl: baseUrl,
            loading: false,
          });
          return models;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set({ loading: false, error: message, loggedIn: false });
          throw error;
        }
      },

      saveModels: async (models, primaryModelId) => {
        const clean = models.filter((m) => m.id.trim());
        if (clean.length === 0) {
          return 0;
        }
        const result = await hostApi.huanxing.saveModelConfig({
          models: clean,
          primaryModelId: primaryModelId ?? null,
        });
        if (!result.success) {
          throw new Error(result.error || '保存模型配置失败');
        }
        set({ modelConfig: result.config ?? null });
        return clean.length;
      },

      loadModelConfig: async () => {
        try {
          const result = await hostApi.huanxing.getModelConfig();
          if (!result.success) {
            throw new Error(result.error || '读取模型配置失败');
          }
          const config = result.config ?? null;
          set({ modelConfig: config });
          return config;
        } catch (error) {
          // Don't surface a hard error for a missing config — just leave it empty.
          console.error('Failed to load Huanxing model config', error);
          return null;
        }
      },

      setPrimaryModel: async (modelId) => {
        const result = await hostApi.huanxing.setPrimaryModel({ modelId });
        if (!result.success) {
          throw new Error(result.error || '设置主模型失败');
        }
        set({ modelConfig: result.config ?? null });
      },

      deleteModel: async (modelId) => {
        const result = await hostApi.huanxing.deleteModel({ modelId });
        if (!result.success) {
          throw new Error(result.error || '删除模型失败');
        }
        set({ modelConfig: result.config ?? null });
      },

      testModel: async (modelId) => {
        const result = await hostApi.huanxing.testModel({ modelId });
        if (!result.success) {
          return { ok: false, error: result.error || '测试失败' };
        }
        return { ok: true, latencyMs: result.latencyMs, reply: result.reply };
      },

      logout: async () => {
        try {
          await hostApi.huanxing.logout();
        } catch {
          // ignore — clearing local state is enough
        }
        set({ loggedIn: false, user: null, models: [], apiKey: null });
      },
    }),
    {
      name: 'huanxing-connection',
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        lastUsername: state.lastUsername,
      }),
    },
  ),
);
