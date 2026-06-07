/**
 * Account Connection Store
 *
 * Drives the "connect to Account-api" flow: log in (handled in the main
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

export const DEFAULT_ACCOUNT_URL = 'http://localhost:3000';

export interface AccountUser {
  id: number;
  username: string;
  displayName: string;
  role: number;
  status: number;
  group: string;
}

export interface AccountModelEntry {
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface AccountModelConfig {
  baseUrl: string;
  models: AccountModelEntry[];
  primary: string | null;
}

export interface AccountTestResult {
  ok: boolean;
  latencyMs?: number;
  reply?: string;
  error?: string;
}

export interface AccountBalance {
  quota: number;
  usedQuota: number;
  quotaPerUnit: number;
  displayInCurrency: boolean;
  topUpUrl: string;
}

interface AccountState {
  serverUrl: string;
  lastUsername: string;
  loggedIn: boolean;
  user: AccountUser | null;
  /** Models fetched after login, awaiting selection. Not persisted. */
  models: string[];
  /** The sk- key obtained for the account. Held only in memory. */
  apiKey: string | null;
  /** The account provider config read from openclaw.json. Not persisted. */
  modelConfig: AccountModelConfig | null;
  /** Account balance, fetched after login. Not persisted. */
  balance: AccountBalance | null;
  loading: boolean;
  error: string | null;

  setServerUrl: (url: string) => void;
  savedCredentials: () => Promise<{ baseUrl: string; username: string; password: string } | null>;
  /** Log in and fetch models + key. Returns the model list on success. */
  login: (username: string, password: string) => Promise<string[]>;
  /** Refresh the account balance. Safe to call when logged out (no-op). */
  fetchBalance: () => Promise<void>;
  /** Open the server's recharge / top-up page in the external browser. */
  openRecharge: () => Promise<void>;
  /** Write the selected models as the single account provider. Returns count. */
  saveModels: (models: AccountModelEntry[], primaryModelId?: string | null) => Promise<number>;
  /** Read the account provider config from openclaw.json. */
  loadModelConfig: () => Promise<AccountModelConfig | null>;
  setPrimaryModel: (modelId: string) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
  testModel: (modelId: string) => Promise<AccountTestResult>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      serverUrl: DEFAULT_ACCOUNT_URL,
      lastUsername: '',
      loggedIn: false,
      user: null,
      models: [],
      apiKey: null,
      modelConfig: null,
      balance: null,
      loading: false,
      error: null,

      setServerUrl: (url) => set({ serverUrl: url }),
      clearError: () => set({ error: null }),

      savedCredentials: async () => {
        const result = await hostApi.account.savedCredentials();
        if (!result.success) {
          throw new Error(result.error || '读取已保存凭据失败');
        }
        return result.credentials ?? null;
      },

      fetchBalance: async () => {
        if (!get().loggedIn) return;
        try {
          const result = await hostApi.account.getBalance();
          if (result.success) {
            set({ balance: result.balance ?? null });
          }
        } catch (error) {
          // Balance is non-critical; don't surface a hard error.
          console.error('Failed to load Account balance', error);
        }
      },

      openRecharge: async () => {
        const serverUrl = get().serverUrl.trim().replace(/\/+$/, '');
        if (!serverUrl) return;
        await hostApi.shell.openExternal(`${serverUrl}/wallet`);
      },

      login: async (username, password) => {
        const baseUrl = get().serverUrl.trim() || DEFAULT_ACCOUNT_URL;
        set({ loading: true, error: null });
        try {
          const loginResult = await hostApi.account.login({ baseUrl, username, password });
          if (!loginResult.success) {
            throw new Error(loginResult.error || '登录失败');
          }

          const setup = await hostApi.account.fetchSetup();
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
          // Fetch balance in the background — don't block the login flow.
          void get().fetchBalance();
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
        const result = await hostApi.account.saveModelConfig({
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
          const result = await hostApi.account.getModelConfig();
          if (!result.success) {
            throw new Error(result.error || '读取模型配置失败');
          }
          const config = result.config ?? null;
          set({ modelConfig: config });
          return config;
        } catch (error) {
          // Don't surface a hard error for a missing config — just leave it empty.
          console.error('Failed to load Account model config', error);
          return null;
        }
      },

      setPrimaryModel: async (modelId) => {
        const result = await hostApi.account.setPrimaryModel({ modelId });
        if (!result.success) {
          throw new Error(result.error || '设置主模型失败');
        }
        set({ modelConfig: result.config ?? null });
      },

      deleteModel: async (modelId) => {
        const result = await hostApi.account.deleteModel({ modelId });
        if (!result.success) {
          throw new Error(result.error || '删除模型失败');
        }
        set({ modelConfig: result.config ?? null });
      },

      testModel: async (modelId) => {
        const result = await hostApi.account.testModel({ modelId });
        if (!result.success) {
          return { ok: false, error: result.error || '测试失败' };
        }
        return { ok: true, latencyMs: result.latencyMs, reply: result.reply };
      },

      logout: async () => {
        try {
          await hostApi.account.logout();
        } catch {
          // ignore — clearing local state is enough
        }
        set({ loggedIn: false, user: null, models: [], apiKey: null, balance: null });
      },
    }),
    {
      name: 'account-connection',
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        lastUsername: state.lastUsername,
      }),
    },
  ),
);
