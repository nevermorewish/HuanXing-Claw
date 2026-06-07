/**
 * Huanxing API session.
 *
 * Runs the HTTP login + model/token fetch against a Huanxing-api server
 * (Go/Gin, default http://localhost:3000) inside the Electron main process.
 *
 * The server authenticates browsers with an HttpOnly `session` cookie which a
 * renderer cross-origin fetch cannot hold, so we keep the cookie (and the
 * logged-in user id) in main-process memory here. Protected endpoints also
 * require a `New-Api-User: <id>` header that must match the session user id,
 * even when the cookie is present (see Huanxing-api middleware/auth.go).
 *
 * Transport note: we use undici's low-level `request` rather than Electron's
 * `net.fetch`. `net.fetch` runs through Chromium's network stack, which treats
 * `Cookie` as a forbidden header name and silently strips it — so a manually
 * managed session cookie never reaches the server. `undici.request` sends
 * headers verbatim, which is exactly what cookie-based auth needs.
 */
import { request } from 'undici';

export interface HuanxingUser {
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

/** Normalize undici's set-cookie header (string | string[] | undefined). */
function collectSetCookies(header: string | string[] | undefined): string[] {
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
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

class HuanxingSession {
  private baseUrl: string | null = null;
  private sessionCookie: string | null = null;
  private user: HuanxingUser | null = null;

  isLoggedIn(): boolean {
    return Boolean(this.baseUrl && this.sessionCookie && this.user);
  }

  getUser(): HuanxingUser | null {
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
      throw new Error('尚未登录 Huanxing');
    }
    return {
      Cookie: this.sessionCookie,
      'New-Api-User': String(this.user.id),
      ...extra,
    };
  }

  private url(path: string): string {
    if (!this.baseUrl) {
      throw new Error('Huanxing 服务地址未设置');
    }
    return `${this.baseUrl}${path}`;
  }

  /** Issue a request and parse a JSON envelope, capturing status + raw body. */
  private async requestJson<T>(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<JsonResponse<T>> {
    const res = await request(url, {
      method: (init.method as 'GET' | 'POST') ?? 'GET',
      headers: init.headers,
      body: init.body,
    });
    const raw = await res.body.text();
    const setCookies = collectSetCookies(res.headers['set-cookie']);
    let body: ApiEnvelope<T>;
    try {
      body = raw ? (JSON.parse(raw) as ApiEnvelope<T>) : {};
    } catch {
      throw new Error(`服务返回非 JSON 响应 (HTTP ${res.statusCode}): ${snippet(raw)}`);
    }
    return { status: res.statusCode, body, raw, setCookies };
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
  async login(baseUrl: string, username: string, password: string): Promise<HuanxingUser> {
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

  /** GET /api/user/self/models — the model names usable by this account. */
  async fetchModels(): Promise<string[]> {
    const res = await this.requestJson<string[]>(this.url('/api/user/self/models'), {
      headers: this.authHeaders(),
    });
    if (!res.body.success) {
      throw this.envelopeError('获取模型列表', res);
    }
    return Array.isArray(res.body.data) ? res.body.data.filter((m) => typeof m === 'string') : [];
  }

  /**
   * Return a usable `sk-` API key, creating a token first if the account has
   * none. The token list returns masked keys, so the full key must be fetched
   * via GET /api/token/{id}/key.
   */
  async ensureApiKey(): Promise<string> {
    let tokenId = await this.findUsableTokenId();
    if (tokenId == null) {
      await this.createToken();
      tokenId = await this.findUsableTokenId();
    }
    if (tokenId == null) {
      throw new Error('未找到可用的 API 令牌，且自动创建失败');
    }
    return this.fetchTokenKey(tokenId);
  }

  private async findUsableTokenId(): Promise<number | null> {
    const res = await this.requestJson<{ items?: Array<{ id: number; status: number }> }>(
      this.url('/api/token/?p=0&size=100'),
      { headers: this.authHeaders() },
    );
    if (!res.body.success) {
      throw this.envelopeError('获取令牌列表', res);
    }
    const items = res.body.data?.items ?? [];
    const usable = items.find((t) => Number(t.status) === 1) ?? items[0];
    return usable ? Number(usable.id) : null;
  }

  private async createToken(): Promise<void> {
    const res = await this.requestJson<unknown>(this.url('/api/token/'), {
      method: 'POST',
      headers: this.authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'HuanXing-Claw',
        unlimited_quota: true,
        expired_time: -1,
        remain_quota: 0,
      }),
    });
    if (!res.body.success) {
      throw this.envelopeError('创建 API 令牌', res);
    }
  }

  private async fetchTokenKey(tokenId: number): Promise<string> {
    const res = await this.requestJson<{ key?: string }>(this.url(`/api/token/${tokenId}/key`), {
      headers: this.authHeaders(),
    });
    if (!res.body.success || !res.body.data?.key) {
      throw this.envelopeError('获取令牌密钥', res);
    }
    // GetFullKey() already returns the `sk-` prefixed value.
    return res.body.data.key;
  }
}

/** Single shared session for the app lifetime. */
export const huanxingSession = new HuanxingSession();
