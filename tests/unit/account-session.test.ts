// @vitest-environment node
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSession, normalizeCcworkUrl, type SessionSnapshot } from '@electron/utils/account-session';

const servers: http.Server[] = [];
async function server(handler: http.RequestListener): Promise<string> {
  const instance = http.createServer(handler); servers.push(instance);
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(instance.address() as { port: number }).port}`;
}
const json = (res: http.ServerResponse, data: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
function snapshot(baseUrl: string, expiresAt = Date.now() + 3600_000): SessionSnapshot {
  return { baseUrl, accessToken: 'access', refreshToken: 'refresh', expiresAt,
    user: { id: 'user-uuid', username: 'demo', displayName: 'Demo', role: 1, status: 1, group: '' }, organizationId: 'personal-org' };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((instance) => new Promise<void>((resolve) => { instance.closeAllConnections(); instance.close(() => resolve()); })));
});
describe('ccwork account session', () => {
  it('logs in with the ccwork envelope and resolves only the personal organization', async () => {
    const seen: unknown[] = [];
    const baseUrl = await server((req, res) => { void (async () => {
      seen.push([req.url, req.headers.authorization]);
      if (req.url === '/api/auth/login') {
        seen.push(await body(req));
        json(res, { success: true, data: { access_token: 'access', refresh_token: 'refresh', expires_in: 86400, user: { id: 'user-uuid', username: 'demo', nickname: 'Demo' } } });
      } else json(res, { success: true, data: { organizations: [{ id: 'personal-org', type: 'personal' }] } });
    })(); });
    const session = new AccountSession(); const persist = vi.fn(); session.onChange = persist;
    await expect(session.login(`${baseUrl}/api/`, 'demo', 'password')).resolves.toMatchObject({ id: 'user-uuid', displayName: 'Demo' });
    expect(seen).toEqual([['/api/auth/login', undefined], { username: 'demo', password: 'password', remember_me: true }, ['/api/context/organizations?type=personal', 'Bearer access']]);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ refreshToken: 'refresh', organizationId: 'personal-org' }));
  });
  it.each(['demo@example.com', '13800138000'])('registers %s with a register verification code', async (identifier) => {
    const calls: unknown[] = [];
    const baseUrl = await server((req, res) => { void (async () => {
      if (req.url?.startsWith('/api/auth/')) calls.push([req.url, await body(req)]);
      if (req.url === '/api/auth/register') json(res, { success: true, data: { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u' } } });
      else if (req.url?.startsWith('/api/context')) json(res, { success: true, data: { organizations: [{ id: 'org', type: 'personal' }] } });
      else json(res, { success: true });
    })(); });
    const session = new AccountSession(); await session.sendVerificationCode(baseUrl, identifier);
    await session.register(baseUrl, identifier, 'Password123!', '123456');
    expect(calls).toEqual([
      ['/api/auth/send-verification-code', { username: identifier, code_type: 'register' }],
      ['/api/auth/register', { ...(identifier.includes('@') ? { email: identifier } : { phone: identifier }), password: 'Password123!', verification_code: '123456' }],
    ]);
  });
  it('uses UUID model identifiers and filters disabled/non-chat entries, preserving capabilities', async () => {
    const baseUrl = await server((req, res) => {
      expect(req.url).toBe('/api/services/llm/organizations/personal-org/models');
      expect(req.headers['x-tabtin-organization-id']).toBe('personal-org');
      json(res, { success: true, data: { models: [
        { id: 'model-uuid', name: 'same-model', display_name: 'Model A', can_set_as_user_default: true, wave_status: 'ready', supports_vision: true, context_window_tokens: 128000, max_output_tokens: 16000 },
        { id: 'disabled', can_set_as_user_default: true, wave_status: 'ready', routing_enabled: false },
        { id: 'inactive', can_set_as_user_default: true, wave_status: 'draft' },
        { id: 'image', can_set_as_user_default: false, wave_status: 'ready' },
      ] } });
    });
    const session = new AccountSession(); session.restore(snapshot(baseUrl));
    expect(await session.fetchModelEntries()).toEqual([{ id: 'model-uuid', name: 'Model A', contextWindow: 128000, maxTokens: 16000, input: ['text', 'image'] }]);
  });
  it('serializes concurrent refreshes and saves both rotated tokens', async () => {
    let refreshes = 0; const keys: string[] = [];
    const baseUrl = await server((req, res) => {
      if (req.url === '/api/auth/refresh-token') { refreshes++; json(res, { success: true, data: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 } }); }
      else { keys.push(req.headers.authorization!); json(res, { success: true, data: {} }); }
    });
    const session = new AccountSession(); session.restore(snapshot(baseUrl, 0)); const persist = vi.fn(); session.onChange = persist;
    await Promise.all([session.request('/api/wallet/a'), session.request('/api/wallet/b')]);
    expect(refreshes).toBe(1); expect(keys).toEqual(['Bearer new-access', 'Bearer new-access']);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'new-access', refreshToken: 'new-refresh' }));
  });
  it('refreshes after 401 without retrying a billed request for other errors', async () => {
    let proxies = 0;
    const baseUrl = await server((req, res) => {
      if (req.url === '/api/auth/refresh-token') json(res, { success: true, data: { access_token: 'rotated', refresh_token: 'rotated-refresh', expires_in: 3600 } });
      else { proxies++; json(res, {}, proxies === 1 ? 401 : 402); }
    });
    const session = new AccountSession(); session.restore(snapshot(baseUrl));
    expect((await session.authorizedFetch('/api/llm/proxy', { method: 'POST', body: '{}' })).status).toBe(402);
    expect(proxies).toBe(2);
  });
  it.each([429, 500, 401])('handles refresh status %i without treating transient failures as logout', async (status) => {
    const baseUrl = await server((_req, res) => json(res, { success: false, message: 'Refresh refused' }, status));
    const session = new AccountSession(); session.restore(snapshot(baseUrl, 0));
    await expect(session.request('/api/wallet/test')).rejects.toThrow('Refresh refused');
    expect(session.isLoggedIn()).toBe(status !== 401);
  });
  it('cannot resurrect a session when a refresh completes after logout', async () => {
    let finish!: () => void;
    const baseUrl = await server((req, res) => {
      if (req.url === '/api/auth/refresh-token') finish = () => json(res, { success: true, data: { access_token: 'late', refresh_token: 'late', expires_in: 3600 } });
      else json(res, { success: true });
    });
    const session = new AccountSession(); session.restore(snapshot(baseUrl, 0));
    const pending = session.request('/api/wallet/test'); const rejection = expect(pending).rejects.toThrow('Account session changed');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await session.logout(); finish(); await rejection;
    expect(session.isLoggedIn()).toBe(false);
  });
  it('reads wallet precision and organization consumption records', async () => {
    const urls: string[] = [];
    const baseUrl = await server((req, res) => { urls.push(req.url!); json(res, { success: true, data: req.url?.endsWith('/wallet') ? { available_credits_precise: '9.123456', credits_frozen_precise: '0.01' } : { total: 1, transactions: [{ id: 'charge', amount_precise: '-0.123456' }] } }); });
    const session = new AccountSession(); session.restore(snapshot(baseUrl));
    expect((await session.fetchWallet()).available_credits_precise).toBe('9.123456');
    expect((await session.fetchTransactions(20, 20)).total).toBe(1);
    expect(urls).toEqual(['/api/wallet/organizations/personal-org/wallet', '/api/wallet/organizations/personal-org/transactions?transaction_type=consume&limit=20&offset=20']);
  });
  it('rejects unsafe server URLs', () => {
    for (const url of ['file:///tmp/a', 'https://user:secret@ccwork.site', 'https://ccwork.site/?token=a', 'http://public.example']) expect(() => normalizeCcworkUrl(url)).toThrow();
    expect(normalizeCcworkUrl('https://ccwork.site/api/')).toBe('https://ccwork.site');
  });
});
