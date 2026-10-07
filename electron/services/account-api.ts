import { safeStorage } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { AccountModelEntry } from '@shared/host-api/contract';
import type { GatewayManager } from '../gateway/manager';
import { BRAND } from '@shared/brand';
import { getDeepClawProviderStore } from './providers/store-instance';
import { accountSession, type SessionSnapshot } from '../utils/account-session';
import { deleteAccountProvider, readAccountModelConfig, writeAccountModelConfig } from '../utils/openclaw-auth';
import { testProviderModel } from './providers/provider-validation';
import { CcworkRelay } from './ccwork-relay';
import { logger } from '../utils/logger';

const SESSION_KEY = 'ccworkSession';
const relay = new CcworkRelay(accountSession);
let initialized: Promise<void> | null = null;

/** Runs before Gateway startup so saved provider URLs point to the current relay port. */
export function initializeCcworkAccount(): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    const store = await getDeepClawProviderStore();
    // Remove legacy password storage. ccwork sessions use encrypted rotating JWT pairs.
    store.delete('accountCredentials');
    accountSession.onChange = async (state) => {
      if (!state) {
        relay.abortRequests(); store.delete(SESSION_KEY); return;
      }
      if (safeStorage.isEncryptionAvailable()) {
        store.set(SESSION_KEY, safeStorage.encryptString(JSON.stringify(state)).toString('base64'));
      } else {
        store.delete(SESSION_KEY); // Memory-only if OS encryption is unavailable.
      }
    };
    const encrypted = store.get(SESSION_KEY);
    if (typeof encrypted === 'string' && safeStorage.isEncryptionAvailable()) {
      try {
        const state = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as SessionSnapshot;
        if (!state.accessToken || !state.refreshToken || !state.user?.id || !state.organizationId || !Number.isFinite(state.expiresAt)) throw new Error('Invalid saved ccwork session');
        accountSession.restore(state);
      } catch { store.delete(SESSION_KEY); }
    }
    const stored = await readAccountModelConfig();
    if (accountSession.isLoggedIn() && stored.models.length) {
      // The relay port is process-local and changes on every launch. Rewrite
      // the existing provider entry so an old port can never be reused.
      await writeAccountModelConfig({ ...await relay.start(), models: stored.models });
    } else if (accountSession.isLoggedIn()) {
      // An empty config can occur after a brand/data-dir migration. Rebuild it
      // from the server catalog before Gateway startup instead of allowing the
      // Gateway to launch with no relay-backed provider.
      const catalog = await accountSession.fetchModelEntries();
      if (catalog.length) {
        await writeAccountModelConfig({ ...await relay.start(), models: catalog, primaryModelId: catalog[0].id });
      }
    } else if (stored.models.length) {
      // Old direct provider keys must never bypass ccwork after migration/logout.
      await deleteAccountProvider();
    }
  })();
  return initialized;
}

export function createAccountApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['account'] {
  const failure = (error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : String(error) });
  const setup = async () => {
    await initializeCcworkAccount();
    if (!accountSession.isLoggedIn()) return { success: false, error: 'Please log in to ccwork' };
    const modelEntries = await accountSession.fetchModelEntries();
    return { success: true, user: accountSession.getUser()!, baseUrl: accountSession.getBaseUrl()!,
      models: modelEntries.map((m) => m.id), modelEntries };
  };
  /**
   * ccwork grants the whole catalog, so logging in turns every routable model on
   * instead of asking the user to pick. The previously chosen primary is kept
   * when it is still in the catalog, otherwise the first entry becomes primary.
   * Runs on every successful sign-in so a catalog change lands without the user
   * having to re-open settings.
   */
  const applyAllAccountModels = async (): Promise<AccountModelEntry[]> => {
    const catalog = await accountSession.fetchModelEntries();
    if (!catalog.length) { await deleteAccountProvider(); return []; }
    const previous = await readAccountModelConfig();
    const primary = catalog.find((m) => `${BRAND.providerKey}/${m.id}` === previous.primary)?.id ?? catalog[0].id;
    await writeAccountModelConfig({ ...await relay.start(), models: catalog, primaryModelId: primary });
    return catalog;
  };
  const save = async (models: AccountModelEntry[], primaryModelId?: string | null) => {
    if (!accountSession.isLoggedIn()) throw new Error('Please log in to ccwork');
    const catalog = await accountSession.fetchModelEntries();
    const selected = models.map((m) => {
      const entry = catalog.find((candidate) => candidate.id === m.id);
      if (!entry) throw new Error(`ccwork model unavailable: ${m.id}`);
      return entry;
    });
    if (primaryModelId && !selected.some((m) => m.id === primaryModelId)) throw new Error('Primary model is unavailable');
    await writeAccountModelConfig({ ...await relay.start(), models: selected, primaryModelId });
    return { success: true, config: await readAccountModelConfig() };
  };
  return {
    login: async (payload) => {
      try {
        await initializeCcworkAccount();
        await deleteAccountProvider();
        const user = await accountSession.login(payload.baseUrl, payload.username, payload.password);
        await applyAllAccountModels();
        return { success: true, user };
      } catch (error) { return failure(error); }
    },
    loginWithVerificationCode: async (payload) => {
      try {
        await initializeCcworkAccount();
        await deleteAccountProvider();
        const user = await accountSession.loginWithVerificationCode(
          payload.baseUrl, payload.username, payload.verificationCode, payload.challengeKey);
        await applyAllAccountModels();
        return { success: true, user };
      } catch (error) { return failure(error); }
    },
    register: async (payload) => {
      try {
        await initializeCcworkAccount();
        await deleteAccountProvider();
        const user = await accountSession.register(payload.baseUrl, payload.username, payload.password, payload.verificationCode);
        await applyAllAccountModels();
        return { success: true, user };
      } catch (error) { return failure(error); }
    },
    sendVerificationCode: async (payload) => {
      try { return { success: true, ...await accountSession.sendVerificationCode(payload.baseUrl, payload.username, payload.codeType) }; }
      catch (error) { return failure(error); }
    },
    fetchSetup: async () => { try { return await setup(); } catch (error) { return failure(error); } },
    restore: async () => { try { return await setup(); } catch (error) { return failure(error); } },
    savedCredentials: async () => {
      await initializeCcworkAccount();
      return { success: true, credentials: accountSession.isLoggedIn() ? {
        username: accountSession.getUser()!.username, password: '', baseUrl: accountSession.getBaseUrl()!,
      } : null };
    },
    getBalance: async () => {
      try {
        await initializeCcworkAccount();
        const wallet = await accountSession.fetchWallet();
        return { success: true, balance: { quota: Number(wallet.available_credits_precise), usedQuota: 0,
          quotaPerUnit: 1, displayInCurrency: false, topUpUrl: accountSession.getBaseUrl() || BRAND.serviceUrl } };
      } catch (error) { return { ...failure(error), sessionExpired: !accountSession.isLoggedIn() }; }
    },
    transactions: async (payload) => {
      try {
        await initializeCcworkAccount();
        const limit = Math.max(1, Math.min(100, Math.floor(payload.limit || 20)));
        const offset = Math.max(0, Math.floor(payload.offset || 0));
        return { success: true, ...await accountSession.fetchTransactions(limit, offset) };
      } catch (error) { return failure(error); }
    },
    creditPackages: async () => {
      try { await initializeCcworkAccount(); return { success: true, packages: await accountSession.creditPackages() }; }
      catch (error) { return failure(error); }
    },
    createRecharge: async (payload) => {
      try { await initializeCcworkAccount(); return { success: true, payment: await accountSession.createRecharge(payload.packageId, payload.paymentMethod) }; }
      catch (error) { return failure(error); }
    },
    rechargeStatus: async (payload) => {
      try { await initializeCcworkAccount(); return { success: true, order: await accountSession.rechargeStatus(payload.orderNo) }; }
      catch (error) { return failure(error); }
    },
    cancelRecharge: async (payload) => {
      try { await initializeCcworkAccount(); await accountSession.cancelRecharge(payload.orderNo); return { success: true }; }
      catch (error) { return failure(error); }
    },
    // Retained for older renderer callers; ccwork model calls use the JWT session.
    listTokens: async () => ({ success: true, tokens: [] }),
    logout: async () => {
      try {
        await initializeCcworkAccount();
        await accountSession.logout();
        await relay.stop();
        await deleteAccountProvider();
        gatewayManager.debouncedRestart();
        return { success: true };
      } catch (error) { return failure(error); }
    },
    getModelConfig: async () => {
      try { await initializeCcworkAccount(); return { success: true, config: await readAccountModelConfig() }; }
      catch (error) { return failure(error); }
    },
    saveModelConfig: async (payload) => {
      try { await initializeCcworkAccount(); return await save(payload.models, payload.primaryModelId); }
      catch (error) { return failure(error); }
    },
    setPrimaryModel: async (payload) => {
      try { await initializeCcworkAccount(); return await save((await readAccountModelConfig()).models, payload.modelId); }
      catch (error) { return failure(error); }
    },
    deleteModel: async (payload) => {
      try {
        await initializeCcworkAccount();
        const stored = await readAccountModelConfig();
        const models = stored.models.filter((m) => m.id !== payload.modelId);
        if (!models.length) { await deleteAccountProvider(); return { success: true, config: await readAccountModelConfig() }; }
        return await save(models, stored.primary === `${BRAND.providerKey}/${payload.modelId}` ? models[0].id : undefined);
      } catch (error) { return failure(error); }
    },
    testModel: async (payload) => {
      try {
        await initializeCcworkAccount();
        if (!accountSession.isLoggedIn()) throw new Error('Please log in to ccwork');
        const catalog = await accountSession.fetchModels();
        if (!catalog.includes(payload.modelId)) throw new Error('ccwork model unavailable');
        const connection = await relay.start();
        const result = await testProviderModel(connection.baseUrl, connection.apiKey, payload.modelId, 'openai-completions');
        return result.ok ? { success: true, latencyMs: result.latencyMs, reply: result.reply } : failure(result.error || 'ccwork model test failed');
      } catch (error) { logger.warn('ccwork model test failed'); return failure(error); }
    },
  };
}
