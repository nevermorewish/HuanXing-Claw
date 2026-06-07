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
import type { ProviderAccount } from '@/lib/providers';
import { hostApi } from '@/lib/host-api';
import { useProviderStore } from '@/stores/providers';

export const DEFAULT_HUANXING_URL = 'http://localhost:3000';

export interface HuanxingUser {
  id: number;
  username: string;
  displayName: string;
  role: number;
  status: number;
  group: string;
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
  loading: boolean;
  error: string | null;

  setServerUrl: (url: string) => void;
  /** Log in and fetch models + key. Returns the model list on success. */
  login: (username: string, password: string) => Promise<string[]>;
  /** Create one custom provider account per selected model. Returns count. */
  createAccounts: (selectedModels: string[]) => Promise<number>;
  logout: () => Promise<void>;
  clearError: () => void;
}

/** Make a model id safe for use inside an account id. */
function slugifyModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
      loading: false,
      error: null,

      setServerUrl: (url) => set({ serverUrl: url }),
      clearError: () => set({ error: null }),

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

      createAccounts: async (selectedModels) => {
        const { apiKey, serverUrl } = get();
        if (!apiKey) {
          throw new Error('缺少 API 密钥，请重新登录');
        }
        const models = selectedModels.filter((m) => m.trim());
        if (models.length === 0) {
          return 0;
        }

        const createAccount = useProviderStore.getState().createAccount;
        const now = new Date().toISOString();
        let created = 0;

        for (const model of models) {
          // One custom account per model so each shows up as a selectable
          // model in chat (an account exposes exactly one `model`).
          const account: ProviderAccount = {
            id: `custom-huanxing-${slugifyModel(model)}`,
            vendorId: 'custom',
            label: `Huanxing/${model}`,
            authMode: 'api_key',
            baseUrl: serverUrl,
            apiProtocol: 'openai-completions',
            model,
            enabled: true,
            isDefault: false,
            metadata: { resourceUrl: serverUrl },
            createdAt: now,
            updatedAt: now,
          };
          try {
            await createAccount(account, apiKey);
            created += 1;
          } catch (error) {
            console.error(`Failed to create Huanxing account for ${model}`, error);
          }
        }

        // Promote the first new model to default when none is set yet.
        const providerState = useProviderStore.getState();
        if (created > 0 && !providerState.defaultAccountId) {
          const firstId = `custom-huanxing-${slugifyModel(models[0])}`;
          await providerState.setDefaultAccount(firstId).catch(() => {});
        }

        return created;
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
