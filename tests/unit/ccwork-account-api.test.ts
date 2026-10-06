// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(), encryption: true,
  config: { baseUrl: '', models: [] as Array<{ id: string; name: string }>, primary: null as string | null },
  writes: [] as unknown[], abort: vi.fn(), stop: vi.fn(),
}));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => state.encryption,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => { if (!value.toString().startsWith('encrypted:')) throw new Error('Cannot decrypt'); return value.toString().slice(10); },
} }));
vi.mock('@electron/services/providers/store-instance', () => ({ getDeepClawProviderStore: async () => ({
  get: (key: string) => state.values.get(key), set: (key: string, value: unknown) => state.values.set(key, value), delete: (key: string) => state.values.delete(key),
}) }));
vi.mock('@electron/utils/openclaw-auth', () => ({
  readAccountModelConfig: async () => state.config,
  deleteAccountProvider: async () => { state.config = { baseUrl: '', models: [], primary: null }; },
  writeAccountModelConfig: async (input: typeof state.config) => { state.writes.push(input); state.config = { ...state.config, ...input }; },
}));
vi.mock('@electron/services/ccwork-relay', () => ({ CcworkRelay: class {
  start = async () => ({ baseUrl: 'http://127.0.0.1:23456/v1', apiKey: 'local-runtime-key' });
  abortRequests = state.abort; stop = state.stop;
} }));
vi.mock('@electron/utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@electron/services/providers/provider-validation', () => ({ testProviderModel: vi.fn() }));

const user = { id: 'user-uuid', username: 'demo', displayName: 'Demo', status: 1, role: 1, group: '' };
const snapshot = { baseUrl: 'https://ccwork.site', user, organizationId: 'org-uuid', accessToken: 'private-access', refreshToken: 'private-refresh', expiresAt: Date.now() + 3600_000 };
beforeEach(() => {
  vi.resetModules(); state.values.clear(); state.encryption = true; state.writes = [];
  state.config = { baseUrl: '', models: [], primary: null }; state.abort.mockClear(); state.stop.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const data = url.endsWith('/api/auth/login') || url.endsWith('/api/auth/register')
      ? { access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, user: { id: 'user-uuid', username: 'demo' } }
      : url.includes('/api/context/') ? { organizations: [{ id: 'org-uuid', type: 'personal' }] }
      : url.endsWith('/models') ? { models: [{ id: 'model-uuid', name: 'Model', can_set_as_user_default: true, wave_status: 'ready', context_window_tokens: 128000, max_output_tokens: 16000, supports_vision: true }] }
      : {};
    return new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());
async function api() {
  const { createAccountApi } = await import('@electron/services/account-api');
  return createAccountApi({ gatewayManager: { debouncedRestart: vi.fn() } as never });
}
describe('ccwork account service credential ownership', () => {
  it('encrypts JWT sessions and returns neither passwords nor API tokens to Renderer', async () => {
    state.values.set('accountCredentials', { username: 'legacy', password: 'legacy-password' });
    const service = await api();
    expect((await service.login({ baseUrl: 'https://ccwork.site', username: 'demo', password: 'user-password' })).success).toBe(true);
    expect(state.values.has('accountCredentials')).toBe(false);
    const encrypted = state.values.get('ccworkSession') as string;
    expect(encrypted).not.toContain('private-access');
    const decoded = Buffer.from(encrypted, 'base64').toString();
    expect(decoded).toContain('private-refresh'); expect(decoded).not.toContain('user-password');
    expect(await service.savedCredentials()).toEqual({ success: true, credentials: { username: 'demo', password: '', baseUrl: 'https://ccwork.site' } });
    const setup = await service.fetchSetup();
    expect(setup).toMatchObject({ success: true, models: ['model-uuid'] });
    expect(JSON.stringify(setup)).not.toContain('private-access'); expect(setup.apiKey).toBeUndefined();
  });
  it('keeps sessions in memory when OS encryption is unavailable', async () => {
    state.encryption = false; const service = await api();
    await service.login({ baseUrl: 'https://ccwork.site', username: 'demo', password: 'password' });
    expect(state.values.has('ccworkSession')).toBe(false);
    expect((await service.fetchSetup()).success).toBe(true);
  });
  it('rebinds persisted models to the current loopback port before startup', async () => {
    state.values.set('ccworkSession', Buffer.from(`encrypted:${JSON.stringify(snapshot)}`).toString('base64'));
    state.config = { baseUrl: 'http://127.0.0.1:12345/v1', models: [{ id: 'model-uuid', name: 'Model' }], primary: 'huanxingclaw/model-uuid' };
    const { initializeCcworkAccount } = await import('@electron/services/account-api');
    await initializeCcworkAccount();
    expect(state.writes).toEqual([{ baseUrl: 'http://127.0.0.1:23456/v1', apiKey: 'local-runtime-key', models: [{ id: 'model-uuid', name: 'Model' }] }]);
  });
  it('rejects credentials that cannot be decrypted and removes direct legacy provider access', async () => {
    state.values.set('ccworkSession', 'invalid-ciphertext');
    state.config = { baseUrl: 'https://legacy.test/v1', models: [{ id: 'old', name: 'Old' }], primary: 'huanxingclaw/old' };
    const service = await api(); await service.getModelConfig();
    expect(state.values.has('ccworkSession')).toBe(false); expect(state.config.models).toEqual([]);
  });
  it('saves server-owned UUID capabilities and the local credential, never caller metadata or JWT', async () => {
    const service = await api(); await service.login({ baseUrl: 'https://ccwork.site', username: 'demo', password: 'password' });
    const result = await service.saveModelConfig({ models: [{ id: 'model-uuid', name: 'Wrong', contextWindow: 1 }], primaryModelId: 'model-uuid' });
    expect(result.success).toBe(true);
    expect(state.writes).toEqual([{ baseUrl: 'http://127.0.0.1:23456/v1', apiKey: 'local-runtime-key', primaryModelId: 'model-uuid', models: [{ id: 'model-uuid', name: 'Model', contextWindow: 128000, maxTokens: 16000, input: ['text', 'image'] }] }]);
    expect((await service.saveModelConfig({ models: [{ id: 'unavailable', name: 'Unknown' }] })).success).toBe(false);
  });
  it('logout aborts active calls, deletes stored JWT and removes the account provider', async () => {
    const service = await api(); await service.login({ baseUrl: 'https://ccwork.site', username: 'demo', password: 'password' });
    await service.saveModelConfig({ models: [{ id: 'model-uuid', name: 'Model' }] });
    expect((await service.logout()).success).toBe(true);
    expect(state.abort).toHaveBeenCalled(); expect(state.stop).toHaveBeenCalled();
    expect(state.values.has('ccworkSession')).toBe(false); expect(state.config.models).toEqual([]);
    expect((await service.fetchSetup()).success).toBe(false);
  });
});
