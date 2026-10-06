/** ccwork JWT session. Tokens never leave Main except to the selected backend. */
import { randomUUID } from 'node:crypto';
import type { AccountModelEntry, AccountUser } from '@shared/host-api/contract';
export type { AccountUser } from '@shared/host-api/contract';
export type SessionSnapshot = {
  baseUrl: string; accessToken: string; refreshToken: string; expiresAt: number;
  user: AccountUser; organizationId: string;
};
/** ccwork `code_type` values the account dialog can request. */
export type AccountCodeType = 'login' | 'register';
export type SendCodeResult = { challengeKey: string };
type AuthResponse = {
  access_token: string; refresh_token: string; expires_in: number;
  user?: { id: string; username?: string; email?: string; phone?: string; nickname?: string; is_staff?: boolean };
};
type CatalogModel = {
  id: string; name: string; display_name?: string; context_window_tokens?: number;
  max_output_tokens?: number; supports_vision?: boolean;
  runtime_profile?: { thinking?: { supported?: boolean } };
  wave_status?: string; routing_enabled?: boolean; can_set_as_user_default?: boolean;
};
export function normalizeCcworkUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid ccwork service URL');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('ccwork requires HTTPS except on localhost');
  return url.href.replace(/\/+$/, '').replace(/\/api$/, '');
}
export class AccountSession {
  private state: SessionSnapshot | null = null;
  private refreshFlight: Promise<void> | null = null;
  private generation = 0;
  onChange: (state: SessionSnapshot | null) => Promise<void> = async () => {};
  isLoggedIn(): boolean { return !!this.state; }
  getUser(): AccountUser | null { return this.state?.user ?? null; }
  getBaseUrl(): string | null { return this.state?.baseUrl ?? null; }
  getOrganizationId(): string | null { return this.state?.organizationId ?? null; }
  restore(state: SessionSnapshot): void {
    this.generation++;
    this.state = { ...state, baseUrl: normalizeCcworkUrl(state.baseUrl) };
  }
  private async json<T>(baseUrl: string, path: string, body?: unknown, token?: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await response.json() as { success?: boolean; data?: T; message?: string; detail?: string };
    if (!response.ok || envelope.success === false) throw Object.assign(new Error(envelope.message || envelope.detail || `ccwork HTTP ${response.status}`), { status: response.status });
    return (envelope.data ?? envelope) as T;
  }
  private async authenticate(baseUrl: string, path: string, body: unknown): Promise<AccountUser> {
    const generation = ++this.generation;
    this.state = null;
    await this.onChange(null);
    const normalized = normalizeCcworkUrl(baseUrl);
    const data = await this.json<AuthResponse>(normalized, path, body);
    if (!data.access_token || !data.refresh_token || !data.user?.id) throw new Error('Invalid ccwork login response');
    const user: AccountUser = {
      id: data.user.id, username: data.user.username || data.user.email || data.user.phone || '',
      displayName: data.user.nickname || data.user.username || '', role: data.user.is_staff ? 10 : 1, status: 1, group: '',
    };
    const organizations = await this.json<{ organizations: Array<{ id: string; type: string }> }>(
      normalized, '/api/context/organizations?type=personal', undefined, data.access_token,
    );
    const personal = organizations.organizations.find((o) => o.type === 'personal');
    if (!personal) throw new Error('ccwork personal organization is unavailable');
    if (generation !== this.generation) throw new Error('Account session changed');
    this.state = { baseUrl: normalized, accessToken: data.access_token, refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000, user, organizationId: personal.id };
    await this.onChange(this.state);
    return user;
  }
  login(baseUrl: string, username: string, password: string): Promise<AccountUser> {
    return this.authenticate(baseUrl, '/api/auth/login', { username, password, remember_me: true });
  }
  /**
   * Verification-code login. ccwork issues the code for `code_type: 'login'` and
   * registers the identifier on first use, so no password is required.
   */
  loginWithVerificationCode(baseUrl: string, username: string, verificationCode: string, challengeKey: string): Promise<AccountUser> {
    return this.authenticate(baseUrl, '/api/auth/login/verification-code', {
      username, verification_code: verificationCode, challenge_key: challengeKey, remember_me: true,
    });
  }
  register(baseUrl: string, identifier: string, password: string, verificationCode: string): Promise<AccountUser> {
    return this.authenticate(baseUrl, '/api/auth/register', {
      ...(identifier.includes('@') ? { email: identifier } : { phone: identifier }), password, verification_code: verificationCode,
    });
  }
  /**
   * ccwork scopes a code by its `code_type`, and a `login` code is additionally
   * bound to a client-generated `challenge_key` that must be replayed when the
   * code is redeemed. Neither may be substituted: a `register` code is refused
   * for an identifier that already exists, and a challenge-less code cannot be
   * redeemed by `/login/verification-code`. Main generates the key so the
   * renderer can only ever echo back what the server was actually given.
   */
  async sendVerificationCode(baseUrl: string, username: string, codeType: AccountCodeType = 'login'): Promise<SendCodeResult> {
    const challengeKey = codeType === 'login' ? randomUUID() : undefined;
    await this.json(normalizeCcworkUrl(baseUrl), '/api/auth/send-verification-code', {
      username, code_type: codeType, ...(challengeKey ? { challenge_key: challengeKey } : {}),
    });
    return { challengeKey: challengeKey ?? '' };
  }
  private async refresh(): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight;
    const state = this.state;
    const generation = this.generation;
    if (!state) throw new Error('Please log in to ccwork');
    const flight = (async () => {
      try {
        const data = await this.json<AuthResponse>(state.baseUrl, '/api/auth/refresh-token', { refresh_token: state.refreshToken });
        if (!data.access_token || !data.refresh_token) throw new Error('Invalid ccwork refresh response');
        if (generation !== this.generation) throw new Error('Account session changed');
        this.state = { ...state, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
        await this.onChange(this.state);
      } catch (error) {
        if ([401, 403, 404].includes((error as { status?: number }).status ?? 0) && generation === this.generation) {
          this.state = null; await this.onChange(null);
        }
        throw error;
      }
    })();
    this.refreshFlight = flight;
    try { await flight; } finally { if (this.refreshFlight === flight) this.refreshFlight = null; }
  }
  async authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith('/api/')) throw new Error('Invalid ccwork API path');
    if (!this.state) throw new Error('Please log in to ccwork');
    if (this.state.expiresAt <= Date.now() + 60_000) await this.refresh();
    const state = this.state;
    const generation = this.generation;
    if (!state) throw new Error('Please log in to ccwork');
    const request = (token: string) => fetch(`${state.baseUrl}${path}`, {
      ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000),
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${token}`, 'X-TabTin-Organization-Id': state.organizationId },
    });
    let response = await request(state.accessToken);
    if (response.status === 401) {
      await response.body?.cancel();
      if (this.state?.accessToken === state.accessToken) await this.refresh();
      if (!this.state || generation !== this.generation) throw new Error('Account session changed');
      response = await request(this.state.accessToken);
    }
    return response;
  }
  async request<T>(path: string): Promise<T> {
    const response = await this.authorizedFetch(path);
    const data = await response.json() as { success?: boolean; data?: T; message?: string };
    if (!response.ok || data.success === false) throw new Error(data.message || `ccwork HTTP ${response.status}`);
    return (data.data ?? data) as T;
  }
  async fetchModelEntries(): Promise<AccountModelEntry[]> {
    const data = await this.request<{ models: CatalogModel[] }>(`/api/services/llm/organizations/${this.state?.organizationId}/models`);
    return data.models.filter((m) => m.can_set_as_user_default === true && m.routing_enabled !== false && m.wave_status === 'ready').map((m) => ({
      id: m.id, name: m.display_name || m.name, contextWindow: m.context_window_tokens,
      maxTokens: m.max_output_tokens, input: m.supports_vision ? ['text', 'image'] : ['text'],
      ...(m.runtime_profile?.thinking?.supported !== undefined ? { reasoning: m.runtime_profile.thinking.supported } : {}),
    }));
  }
  async fetchModels(): Promise<string[]> { return (await this.fetchModelEntries()).map((m) => m.id); }
  async fetchWallet(): Promise<{ available_credits_precise: string; credits_frozen_precise: string }> {
    return this.request(`/api/wallet/organizations/${this.state?.organizationId}/wallet`);
  }
  async fetchTransactions(limit = 20, offset = 0): Promise<{ total: number; transactions: Array<{ id: string; description: string; amount_precise: string; created_at: string; transaction_type: string }> }> {
    return this.request(`/api/wallet/organizations/${this.state?.organizationId}/transactions?transaction_type=consume&limit=${limit}&offset=${offset}`);
  }
  async logout(): Promise<void> {
    const state = this.state;
    this.generation++; this.state = null;
    await this.onChange(null);
    if (state) await this.json(state.baseUrl, '/api/auth/logout', {}, state.accessToken).catch(() => {});
  }
}
export const accountSession = new AccountSession();
