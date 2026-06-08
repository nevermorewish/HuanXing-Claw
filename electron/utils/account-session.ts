/**
 * Account API session.
 *
 * Runs the HTTP login + model/token fetch against a Account-api server
 * (Go/Gin, default http://localhost:3000) inside the Electron main process.
 *
 * The server authenticates browsers with an HttpOnly `session` cookie which a
 * renderer cross-origin fetch cannot hold, so we keep the cookie (and the
 * logged-in user id) in main-process memory here. Protected endpoints also
 * require a `New-Api-User: <id>` header that must match the session user id,
 * even when the cookie is present (see Account-api middleware/auth.go).
 *
 * Transport note: we use Node's built-in `node:http`/`node:https` rather than
 * Electron's `net.fetch`. `net.fetch` runs through Chromium's network stack,
 * which treats `Cookie` as a forbidden header name and silently strips it — so
 * a manually managed session cookie never reaches the server. The Node core
 * client sends headers verbatim (which cookie-based auth needs) and, unlike
 * undici, is always available in the packaged app without bundling a dependency.
 */
import http from 'node:http';
import https from 'node:https';
import { BRAND } from '@shared/brand';

export interface AccountUser {
  id: number;
  username: string;
  displayName: string;
  role: number;
  status: number;
  group: string;
}

interface ApiEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

/** A model entry from GET /api/pricing (new Account-api). */
interface PricingModel {
  model_name: string;
  enable_groups?: string[];
  supported_endpoint_types?: string[];
}

/** Full GET /api/pricing body (data + group gating live as siblings). */
interface PricingResponse extends ApiEnvelope<PricingModel[]> {
  usable_group?: Record<string, string>;
}

interface JsonResponse<T> {
  status: number;
  body: ApiEnvelope<T>;
  raw: string;
  setCookies: string[];
}

/** Strip a trailing slash so we can append `/api/...` paths uniformly. */
function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

/** Pull the `session=...` pair out of one or more Set-Cookie headers. */
function extractSessionCookie(setCookies: string[]): string | null {
  for (const cookie of setCookies) {
    const match = /(?:^|;\s*)?(session=[^;]+)/.exec(cookie);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/** Truncate a raw body for inclusion in error/log messages. */
function snippet(raw: string, max = 200): string {
  const trimmed = raw.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Ensure an API key carries the conventional `sk-` prefix.
 *
 * Account-api generations are inconsistent: some return the raw 48-char key
 * (frogclaw's GetTokenKey, and the inline key on token list/detail), others
 * prepend `sk-`. The relay's auth middleware trims `sk-` either way, but we
 * normalize to the prefixed form so callers always get a ready-to-use key.
 */
function ensureSkPrefix(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('sk-') ? trimmed : `sk-${trimmed}`;
}

/**
 * Whether a key embedded in a list/detail envelope is the full secret rather
 * than a masked preview. Some forks mask inline keys (e.g. `sk-abc…xyz`); those
 * are unusable and must be fetched through a dedicated key endpoint instead.
 */
function isFullKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && !/[*…]/.test(key) && !key.includes('...');
}

/** Issue a request via Node core http/https and parse a JSON envelope. */
function rawRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; raw: string; setCookies: string[] }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`无效的服务地址: ${url}`));
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = { ...init.headers };
    if (init.body != null && headers['Content-Length'] == null && headers['content-length'] == null) {
      headers['Content-Length'] = String(Buffer.byteLength(init.body));
    }

    const req = transport.request(
      url,
      { method: init.method ?? 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk as Buffer));
        res.on('end', () => {
          const setCookieHeader = res.headers['set-cookie'];
          const setCookies = Array.isArray(setCookieHeader)
            ? setCookieHeader
            : setCookieHeader
              ? [setCookieHeader]
              : [];
          resolve({
            status: res.statusCode ?? 0,
            raw: Buffer.concat(chunks).toString('utf-8'),
            setCookies,
          });
        });
      },
    );
    req.on('error', reject);
    if (init.body != null) {
      req.write(init.body);
    }
    req.end();
  });
}

export class AccountSession {
  private baseUrl: string | null = null;
  private sessionCookie: string | null = null;
  private user: AccountUser | null = null;

  isLoggedIn(): boolean {
    return Boolean(this.baseUrl && this.sessionCookie && this.user);
  }

  getUser(): AccountUser | null {
    return this.user;
  }

  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  logout(): void {
    this.baseUrl = null;
    this.sessionCookie = null;
    this.user = null;
  }

  /** Authenticated headers for protected endpoints (session cookie + user id). */
  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    if (!this.sessionCookie || !this.user) {
      throw new Error('尚未登录 Account');
    }
    return {
      Cookie: this.sessionCookie,
      'New-Api-User': String(this.user.id),
      ...extra,
    };
  }

  private url(path: string): string {
    if (!this.baseUrl) {
      throw new Error('Account 服务地址未设置');
    }
    return `${this.baseUrl}${path}`;
  }

  /** Issue a request and parse a JSON envelope, capturing status + raw body. */
  private async requestJson<T>(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<JsonResponse<T>> {
    const res = await rawRequest(url, init);
    let body: ApiEnvelope<T>;
    try {
      body = res.raw ? (JSON.parse(res.raw) as ApiEnvelope<T>) : {};
    } catch {
      throw new Error(`服务返回非 JSON 响应 (HTTP ${res.status}): ${snippet(res.raw)}`);
    }
    return { status: res.status, body, raw: res.raw, setCookies: res.setCookies };
  }

  /** Build an error from a failed envelope, preferring the server's message. */
  private envelopeError(action: string, res: JsonResponse<unknown>): Error {
    const serverMsg = res.body.message?.trim();
    if (serverMsg) {
      return new Error(serverMsg);
    }
    return new Error(`${action}失败 (HTTP ${res.status})${res.raw ? `: ${snippet(res.raw)}` : ''}`);
  }

  /** POST /api/user/login — stores the session cookie + user on success. */
  async login(baseUrl: string, username: string, password: string): Promise<AccountUser> {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) {
      throw new Error('服务地址不能为空');
    }

    const res = await this.requestJson<Record<string, unknown> & { require_2fa?: boolean }>(
      `${normalized}/api/user/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      },
    );

    if (!res.body.success) {
      throw this.envelopeError('登录', res);
    }
    if (res.body.data?.require_2fa) {
      throw new Error('该账号开启了两步验证，暂不支持，请使用未开启 2FA 的账号');
    }

    const cookie = extractSessionCookie(res.setCookies);
    if (!cookie) {
      throw new Error('登录失败：服务未返回会话凭证 (session cookie)');
    }

    const data = res.body.data ?? {};
    const id = Number(data.id);
    if (!Number.isFinite(id)) {
      throw new Error('登录失败：服务未返回用户信息');
    }

    this.baseUrl = normalized;
    this.sessionCookie = cookie;
    this.user = {
      id,
      username: String(data.username ?? username),
      displayName: String(data.display_name ?? data.username ?? username),
      role: Number(data.role ?? 0),
      status: Number(data.status ?? 0),
      group: String(data.group ?? 'default'),
    };
    return this.user;
  }

  /**
   * Fetch the model names usable by this account.
   *
   * Server generations expose the usable models differently, so we probe in
   * order and fall back so both new and old newapi servers work:
   *   1. GET /api/pricing — newer Account-api (new-api/frogclaw). Returns rich
   *      entries with `enable_groups`; we keep models enabled for one of the
   *      account's usable groups.
   *   2. GET /api/user/self/models (or /api/user/models) — older newapi. Returns
   *      a flat string array already filtered to the user's usable groups.
   *
   * Pricing is tried first because newer servers dropped the legacy endpoint
   * (it 404s via the OpenAI relay's catch-all). A successful-but-empty pricing
   * response is authoritative (no fallback); only a genuine failure (404 /
   * non-JSON / explicit error) drops through to the legacy endpoints.
   */
  async fetchModels(): Promise<string[]> {
    try {
      return await this.fetchModelsFromPricing();
    } catch (pricingError) {
      // Older newapi has no /api/pricing — fall back to the legacy flat list.
      try {
        return await this.fetchModelsLegacy();
      } catch {
        // Surface the modern-path error as the primary failure.
        throw pricingError;
      }
    }
  }

  /** GET /api/pricing — the newer Account-api model list, group-filtered. */
  private async fetchModelsFromPricing(): Promise<string[]> {
    const res = await this.requestJson<PricingModel[]>(this.url('/api/pricing'), {
      headers: this.authHeaders(),
    });
    const pricing = res.body as PricingResponse;
    // /api/pricing usually omits `success` on success; only treat an explicit
    // `success: false` as an error.
    if (pricing.success === false) {
      throw this.envelopeError('获取模型列表', res);
    }

    const models = Array.isArray(pricing.data) ? pricing.data : [];
    const usableGroups = new Set<string>(Object.keys(pricing.usable_group ?? {}));
    if (this.user?.group) {
      usableGroups.add(this.user.group);
    }

    const names = models
      .filter((m) => {
        if (!m || typeof m.model_name !== 'string' || !m.model_name) return false;
        const groups = m.enable_groups;
        // No group info, or no known usable groups → don't over-filter.
        if (!Array.isArray(groups) || groups.length === 0 || usableGroups.size === 0) {
          return true;
        }
        return groups.some((g) => usableGroups.has(g));
      })
      .map((m) => m.model_name);

    // De-duplicate while preserving order.
    return [...new Set(names)];
  }

  /**
   * GET /api/user/self/models — older newapi's usable-model list.
   *
   * The legacy endpoint returns a flat `data: string[]` already filtered to the
   * account's usable groups, so no client-side group gating is needed. The exact
   * path moved between versions, so we try the known variants in order.
   */
  private async fetchModelsLegacy(): Promise<string[]> {
    const paths = ['/api/user/self/models', '/api/user/models'];
    let lastError: Error | null = null;
    for (const path of paths) {
      try {
        const res = await this.requestJson<unknown[]>(this.url(path), {
          headers: this.authHeaders(),
        });
        if (res.body.success === false) {
          // Endpoint exists but rejected the request — record it, try the next.
          lastError = this.envelopeError('获取模型列表', res);
          continue;
        }
        const data = Array.isArray(res.body.data) ? res.body.data : [];
        const names = data.filter((m): m is string => typeof m === 'string' && m.length > 0);
        return [...new Set(names)];
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error('获取模型列表失败 (旧版接口不可用)');
  }

  /**
   * GET /api/user/self — the account's quota figures.
   *
   * New-API stores balances as integer "quota" units; dividing by the server's
   * `quota_per_unit` (see {@link fetchStatus}) converts to a currency amount.
   */
  async fetchSelfQuota(): Promise<{ quota: number; usedQuota: number }> {
    const res = await this.requestJson<Record<string, unknown>>(this.url('/api/user/self'), {
      headers: this.authHeaders(),
    });
    if (!res.body.success) {
      throw this.envelopeError('获取账户信息', res);
    }
    const data = res.body.data ?? {};
    return {
      quota: Number(data.quota ?? 0),
      usedQuota: Number(data.used_quota ?? 0),
    };
  }

  /**
   * GET /api/status — server display options needed to render the balance:
   * `quota_per_unit` (quota→currency divisor), whether to show a currency
   * amount vs. raw quota, and the top-up page link.
   *
   * This endpoint is public (no auth needed) and omits `success` on success,
   * mirroring /api/pricing, so only an explicit `success: false` is an error.
   */
  async fetchStatus(): Promise<{ quotaPerUnit: number; displayInCurrency: boolean; topUpLink: string }> {
    const res = await this.requestJson<Record<string, unknown>>(this.url('/api/status'), {
      headers: this.authHeaders(),
    });
    if (res.body.success === false) {
      throw this.envelopeError('获取服务状态', res);
    }
    const data = res.body.data ?? {};
    const quotaPerUnit = Number(data.quota_per_unit);
    return {
      quotaPerUnit: Number.isFinite(quotaPerUnit) && quotaPerUnit > 0 ? quotaPerUnit : 500000,
      displayInCurrency: data.display_in_currency !== false,
      topUpLink: typeof data.top_up_link === 'string' ? data.top_up_link : '',
    };
  }

  /**
   * Return a usable `sk-` API key, creating a token first if the account has
   * none.
   *
   * Account-api generations differ in how they expose the secret:
   *   - Newer frogclaw returns the full key inline on the token list/detail
   *     (the rows are never `.Clean()`-ed), so we use it directly when present.
   *   - Otherwise we fetch it through {@link fetchTokenKey}, which probes the
   *     POST `/key` endpoint and falls back to GET detail for older backends.
   */
  async ensureApiKey(): Promise<string> {
    let token = await this.findUsableToken();
    if (token == null) {
      await this.createToken();
      token = await this.findUsableToken();
    }
    if (token == null) {
      throw new Error('未找到可用的 API 令牌，且自动创建失败');
    }
    // Newer backends hand back the full key inline — no extra round-trip needed.
    if (isFullKey(token.key)) {
      return ensureSkPrefix(token.key);
    }
    return this.fetchTokenKey(token.id);
  }

  private async findUsableToken(): Promise<{ id: number; key?: string } | null> {
    const res = await this.requestJson<{ items?: Array<{ id: number; status: number; key?: string }> }>(
      this.url('/api/token/?p=0&size=100'),
      { headers: this.authHeaders() },
    );
    if (!res.body.success) {
      throw this.envelopeError('获取令牌列表', res);
    }
    const items = res.body.data?.items ?? [];
    const usable = items.find((t) => Number(t.status) === 1) ?? items[0];
    return usable ? { id: Number(usable.id), key: usable.key } : null;
  }

  private async createToken(): Promise<void> {
    const res = await this.requestJson<unknown>(this.url('/api/token/'), {
      method: 'POST',
      headers: this.authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: BRAND.appName,
        unlimited_quota: true,
        expired_time: -1,
        remain_quota: 0,
      }),
    });
    if (!res.body.success) {
      throw this.envelopeError('创建 API 令牌', res);
    }
  }

  /**
   * Fetch the full (unmasked) key for a token id.
   *
   * Backends disagree on where this lives, so we probe in order:
   *   1. POST /api/token/{id}/key — the dedicated endpoint on newer frogclaw.
   *      Added 2026-06-01; older builds 404 it through the OpenAI relay's
   *      catch-all (`{"error":{"type":"invalid_request_error", ...}}`), which
   *      is JSON but has no `success` field, so it drops to the fallback.
   *   2. GET /api/token/{id} — the token detail, which embeds the full key
   *      inline (this is the path frogclaw's own legacy frontend uses).
   *
   * The key is normalized to the `sk-` prefixed form regardless of which
   * shape the backend returned.
   */
  private async fetchTokenKey(tokenId: number): Promise<string> {
    const viaKeyEndpoint = await this.tryFetchTokenKeyViaPost(tokenId);
    if (viaKeyEndpoint != null) {
      return ensureSkPrefix(viaKeyEndpoint);
    }
    const viaDetail = await this.tryFetchTokenKeyViaDetail(tokenId);
    if (viaDetail != null) {
      return ensureSkPrefix(viaDetail);
    }
    throw new Error('获取令牌密钥失败：服务未提供可用的密钥接口');
  }

  /** POST /api/token/{id}/key — returns the raw key, or null if unsupported. */
  private async tryFetchTokenKeyViaPost(tokenId: number): Promise<string | null> {
    const res = await this.requestJson<{ key?: string }>(this.url(`/api/token/${tokenId}/key`), {
      method: 'POST',
      headers: this.authHeaders(),
    });
    // A relay catch-all 404 returns valid JSON without `success` — treat any
    // non-affirmative envelope as "endpoint unavailable" and fall back.
    if (res.body.success !== true) {
      return null;
    }
    return isFullKey(res.body.data?.key) ? (res.body.data!.key as string) : null;
  }

  /** GET /api/token/{id} — reads the full key embedded in the token detail. */
  private async tryFetchTokenKeyViaDetail(tokenId: number): Promise<string | null> {
    const res = await this.requestJson<{ key?: string }>(this.url(`/api/token/${tokenId}`), {
      headers: this.authHeaders(),
    });
    if (res.body.success !== true) {
      return null;
    }
    return isFullKey(res.body.data?.key) ? (res.body.data!.key as string) : null;
  }
}

/** Single shared session for the app lifetime. */
export const accountSession = new AccountSession();
