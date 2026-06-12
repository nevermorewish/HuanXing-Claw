import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getProviderConfig } from '../../utils/provider-registry';

type ValidationProfile =
  | 'openai-completions'
  | 'openai-responses'
  | 'google-query-key'
  | 'anthropic-header'
  | 'openrouter'
  | 'none';

type ValidationResult = { valid: boolean; error?: string; status?: number };
type ClassifiedValidationResult = ValidationResult & { authFailure?: boolean };

const AUTH_ERROR_PATTERN = /\b(unauthorized|forbidden|access denied|invalid api key|api key invalid|incorrect api key|api key incorrect|authentication failed|auth failed|invalid credential|credential invalid|invalid signature|signature invalid|invalid access token|access token invalid|invalid bearer token|bearer token invalid|access token expired)\b|鉴权失败|認証失敗|认证失败|無效密鑰|无效密钥|密钥无效|密鑰無效|憑證無效|凭证无效/i;
const AUTH_ERROR_CODE_PATTERN = /\b(unauthorized|forbidden|access[_-]?denied|invalid[_-]?api[_-]?key|api[_-]?key[_-]?invalid|incorrect[_-]?api[_-]?key|api[_-]?key[_-]?incorrect|authentication[_-]?failed|auth[_-]?failed|invalid[_-]?credential|credential[_-]?invalid|invalid[_-]?signature|signature[_-]?invalid|invalid[_-]?access[_-]?token|access[_-]?token[_-]?invalid|invalid[_-]?bearer[_-]?token|bearer[_-]?token[_-]?invalid|access[_-]?token[_-]?expired|invalid[_-]?token|token[_-]?invalid|token[_-]?expired)\b/i;

function logValidationStatus(provider: string, status: number): void {
  console.log(`[deepclaw-validate] ${provider} HTTP ${status}`);
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function sanitizeValidationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const key = url.searchParams.get('key');
    if (key) url.searchParams.set('key', maskSecret(key));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  if (next.Authorization?.startsWith('Bearer ')) {
    const token = next.Authorization.slice('Bearer '.length);
    next.Authorization = `Bearer ${maskSecret(token)}`;
  }
  if (next['x-api-key']) {
    next['x-api-key'] = maskSecret(next['x-api-key']);
  }
  return next;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models?limit=1`;
}

function resolveOpenAiProbeUrls(
  baseUrl: string,
  apiProtocol: 'openai-completions' | 'openai-responses',
): { modelsUrl: string; probeUrl: string } {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const endpointSuffixPattern = /(\/responses?|\/chat\/completions)$/;
  const rootBase = normalizedBase.replace(endpointSuffixPattern, '');
  const modelsUrl = buildOpenAiModelsUrl(rootBase);

  if (apiProtocol === 'openai-responses') {
    const probeUrl = /(\/responses?)$/.test(normalizedBase)
      ? normalizedBase
      : `${rootBase}/responses`;
    return { modelsUrl, probeUrl };
  }

  const probeUrl = /\/chat\/completions$/.test(normalizedBase)
    ? normalizedBase
    : `${rootBase}/chat/completions`;
  return { modelsUrl, probeUrl };
}

function logValidationRequest(
  provider: string,
  method: string,
  url: string,
  headers: Record<string, string>,
): void {
  console.log(
    `[deepclaw-validate] ${provider} request ${method} ${sanitizeValidationUrl(url)} headers=${JSON.stringify(sanitizeHeaders(headers))}`,
  );
}

function getValidationProfile(
  providerType: string,
  options?: { apiProtocol?: string }
): ValidationProfile {
  const providerApi = options?.apiProtocol || getProviderConfig(providerType)?.api;
  if (providerApi === 'anthropic-messages') {
    return 'anthropic-header';
  }
  if (providerApi === 'openai-responses') {
    return 'openai-responses';
  }
  if (providerApi === 'openai-completions') {
    return 'openai-completions';
  }

  switch (providerType) {
    case 'anthropic':
      return 'anthropic-header';
    case 'google':
      return 'google-query-key';
    case 'openrouter':
      return 'openrouter';
    case 'ollama':
      return 'none';
    default:
      return 'openai-completions';
  }
}

async function performProviderValidationRequest(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ClassifiedValidationResult> {
  try {
    logValidationRequest(providerLabel, 'GET', url, headers);
    const response = await proxyAwareFetch(url, { headers });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    const result = classifyAuthResponse(response.status, data);
    return { ...result, status: response.status };
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function classifyAuthResponse(
  status: number,
  data: unknown,
) : ClassifiedValidationResult {
  const obj = data as {
    error?: { message?: string; code?: string };
    message?: string;
    code?: string;
  } | null;
  const msg = obj?.error?.message || obj?.message || `API error: ${status}`;
  const code = obj?.error?.code || obj?.code;
  const hasAuthCode = typeof code === 'string' && AUTH_ERROR_CODE_PATTERN.test(code);

  if (status >= 200 && status < 300) return { valid: true };
  if (status === 429) return { valid: true };
  if (status === 401 || status === 403) {
    return { valid: false, error: 'Invalid API key', authFailure: true };
  }
  if (status === 400 && (AUTH_ERROR_PATTERN.test(msg) || hasAuthCode)) {
    const error = hasAuthCode && msg === `API error: ${status}`
      ? `Invalid API key (${code})`
      : msg || 'Invalid API key';
    return { valid: false, error, authFailure: true };
  }

  return { valid: false, error: msg };
}

function shouldFallbackFromModelsProbe(result: ClassifiedValidationResult): boolean {
  if (result.valid || result.status === undefined) return false;
  if (result.status === 401 || result.status === 403) return false;
  if (result.authFailure) return false;
  return true;
}

function classifyProbeResponse(
  status: number,
  data: unknown,
): ClassifiedValidationResult {
  const classified = classifyAuthResponse(status, data);

  if (status >= 200 && status < 300) {
    return { valid: true, status };
  }
  if (status === 429) {
    return { valid: true, status };
  }
  if (status === 400 && !classified.authFailure) {
    return { valid: true, status };
  }
  return { ...classified, status };
}

async function validateOpenAiCompatibleKey(
  providerType: string,
  apiKey: string,
  apiProtocol: 'openai-completions' | 'openai-responses',
  baseUrl?: string,
): Promise<ValidationResult> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return { valid: false, error: `Base URL is required for provider "${providerType}" validation` };
  }

  const headers = { Authorization: `Bearer ${apiKey}` };
  const { modelsUrl, probeUrl } = resolveOpenAiProbeUrls(trimmedBaseUrl, apiProtocol);
  const modelsResult = await performProviderValidationRequest(providerType, modelsUrl, headers);

  if (shouldFallbackFromModelsProbe(modelsResult)) {
    console.log(
      `[deepclaw-validate] ${providerType} /models returned ${modelsResult.status}, falling back to ${apiProtocol} probe`,
    );
    if (apiProtocol === 'openai-responses') {
      return await performResponsesProbe(providerType, probeUrl, headers);
    }
    return await performChatCompletionsProbe(providerType, probeUrl, headers);
  }

  return modelsResult;
}

async function performResponsesProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        input: 'hi',
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyProbeResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function performChatCompletionsProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyProbeResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function performAnthropicMessagesProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyProbeResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function validateGoogleQueryKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ValidationResult> {
  const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const url = `${base}/models?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  return await performProviderValidationRequest(providerType, url, {});
}

export type ModelTestResult = {
  ok: boolean;
  latencyMs?: number;
  reply?: string;
  error?: string;
};

/**
 * Send a real chat completion against a specific model and measure latency.
 *
 * Unlike {@link validateApiKeyWithProvider} (which probes a hardcoded
 * `validation-probe` model just to check the key), this exercises the EXACT
 * model id the user configured, mirroring clawpanel's `api.testModel`. A 429
 * (rate limited) is treated as a reachable success — the model exists and the
 * key works, the account is merely throttled.
 */
export async function testProviderModel(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  api: string = 'openai-completions',
): Promise<ModelTestResult> {
  const trimmedBaseUrl = baseUrl.trim();
  if (!trimmedBaseUrl) {
    return { ok: false, error: 'Base URL is required to test a model' };
  }
  if (!modelId.trim()) {
    return { ok: false, error: 'Model id is required' };
  }

  const isAnthropic = api === 'anthropic-messages';
  const url = isAnthropic
    ? `${normalizeBaseUrl(trimmedBaseUrl)}/messages`
    : `${normalizeBaseUrl(trimmedBaseUrl)}/chat/completions`;
  const headers: Record<string, string> = isAnthropic
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({
    model: modelId,
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 16,
  });

  const start = Date.now();
  try {
    logValidationRequest(`testModel:${modelId}`, 'POST', url, headers);
    const response = await proxyAwareFetch(url, { method: 'POST', headers, body });
    const latencyMs = Date.now() - start;
    logValidationStatus(`testModel:${modelId}`, response.status);
    const data = await response.json().catch(() => ({}));

    if (response.status === 429) {
      return { ok: true, latencyMs, reply: '⚠ 429 限流（模型可达，账号被限流）' };
    }
    if (response.status >= 200 && response.status < 300) {
      const reply = extractModelReply(data, isAnthropic);
      return { ok: true, latencyMs, reply };
    }

    const obj = data as { error?: { message?: string }; message?: string } | null;
    const msg = obj?.error?.message || obj?.message || `HTTP ${response.status}`;
    return { ok: false, latencyMs, error: msg };
  } catch (error) {
    return {
      ok: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Pull a short text reply out of an OpenAI- or Anthropic-shaped response. */
function extractModelReply(data: unknown, isAnthropic: boolean): string {
  const obj = data as Record<string, unknown> | null;
  if (!obj) return '';
  try {
    if (isAnthropic) {
      const content = obj.content as Array<{ text?: string }> | undefined;
      const text = content?.map((c) => c?.text ?? '').join('').trim();
      return (text ?? '').slice(0, 120);
    }
    const choices = obj.choices as Array<{ message?: { content?: string } }> | undefined;
    const text = choices?.[0]?.message?.content ?? '';
    return String(text).trim().slice(0, 120);
  } catch {
    return '';
  }
}

export type RemoteModelsResult =
  | { ok: true; models: Array<{ id: string; name?: string }> }
  | { ok: false; error: string; notSupported?: boolean };

/** Extract model ids from the various shapes a `/models` endpoint may return. */
function parseRemoteModelsBody(data: unknown): Array<{ id: string }> | null {
  // OpenAI shape: { data: [{ id }] }
  const obj = data as Record<string, unknown> | null;
  const list =
    obj && Array.isArray(obj.data) ? obj.data
    : obj && Array.isArray(obj.models) ? obj.models   // some relays use { models: [...] }
    : Array.isArray(data) ? data                       // bare array
    : null;
  if (!list) return null;
  const ids: Array<{ id: string }> = [];
  for (const item of list) {
    if (typeof item === 'string') {
      if (item.trim()) ids.push({ id: item });
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id
        : typeof rec.name === 'string' ? rec.name
        : '';
      if (id.trim()) ids.push({ id });
    }
  }
  return ids;
}

/**
 * Fetch the model list from a provider's `/models` endpoint (clawpanel-style).
 * Uses protocol-appropriate auth: Bearer for OpenAI-compatible, x-api-key for
 * Anthropic, `?key=` for Google. Returns `notSupported: true` when the endpoint
 * doesn't implement model listing (404/501, or 400 without a parseable body) so
 * the UI can guide the user to add models manually.
 */
export async function listRemoteModels(
  baseUrl: string,
  apiKey: string,
  api: string = 'openai-completions',
): Promise<RemoteModelsResult> {
  const trimmedBaseUrl = baseUrl.trim();
  if (!trimmedBaseUrl) {
    return { ok: false, error: 'Base URL is required to fetch models' };
  }

  const base = normalizeBaseUrl(trimmedBaseUrl);
  const isAnthropic = api === 'anthropic-messages';
  const isGoogle = api === 'google-generative-ai';

  let url: string;
  const headers: Record<string, string> = {};
  if (isAnthropic) {
    url = `${base}/models?limit=1000`;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (isGoogle) {
    url = `${base}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`;
  } else {
    url = `${base}/models`;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    logValidationRequest('listRemoteModels', 'GET', url, headers);
    const response = await proxyAwareFetch(url, { headers });
    logValidationStatus('listRemoteModels', response.status);
    const data = await response.json().catch(() => null);

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (response.status === 404 || response.status === 501) {
      return { ok: false, error: `HTTP ${response.status}`, notSupported: true };
    }
    if (response.status < 200 || response.status >= 300) {
      const obj = data as { error?: { message?: string }; message?: string } | null;
      const msg = obj?.error?.message || obj?.message || `HTTP ${response.status}`;
      return { ok: false, error: msg };
    }

    const parsed = parseRemoteModelsBody(data);
    if (!parsed) {
      return { ok: false, error: 'Unrecognized /models response', notSupported: true };
    }
    // De-dupe and sort descending (newest-ish first), like clawpanel.
    const seen = new Set<string>();
    const models = parsed
      .filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .map((m) => ({ id: m.id, name: m.id }))
      .sort((a, b) => b.id.localeCompare(a.id));
    return { ok: true, models };
  } catch (error) {
    return {
      ok: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function validateAnthropicHeaderKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ValidationResult> {
  const rawBase = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const base = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
  const url = `${base}/models?limit=1`;
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  const modelsResult = await performProviderValidationRequest(providerType, url, headers);

  // If the endpoint doesn't implement /models (like Minimax Anthropic compatibility), fallback to a /messages probe.
  if (
    modelsResult.status === 404 ||
    modelsResult.status === 400 ||
    modelsResult.error?.includes('API error: 404') ||
    modelsResult.error?.includes('API error: 400')
  ) {
    console.log(
      `[deepclaw-validate] ${providerType} /models returned error, falling back to /messages probe`,
    );
    const messagesUrl = `${base}/messages`;
    return await performAnthropicMessagesProbe(providerType, messagesUrl, headers);
  }

  return modelsResult;
}

async function validateOpenRouterKey(
  providerType: string,
  apiKey: string,
): Promise<ValidationResult> {
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const headers = { Authorization: `Bearer ${apiKey}` };
  return await performProviderValidationRequest(providerType, url, headers);
}

export async function validateApiKeyWithProvider(
  providerType: string,
  apiKey: string,
  options?: { baseUrl?: string; apiProtocol?: string },
): Promise<ValidationResult> {
  const profile = getValidationProfile(providerType, options);
  const resolvedBaseUrl = options?.baseUrl || getProviderConfig(providerType)?.baseUrl;

  if (profile === 'none') {
    return { valid: true };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    switch (profile) {
      case 'openai-completions':
        return await validateOpenAiCompatibleKey(
          providerType,
          trimmedKey,
          'openai-completions',
          resolvedBaseUrl,
        );
      case 'openai-responses':
        return await validateOpenAiCompatibleKey(
          providerType,
          trimmedKey,
          'openai-responses',
          resolvedBaseUrl,
        );
      case 'google-query-key':
        return await validateGoogleQueryKey(providerType, trimmedKey, resolvedBaseUrl);
      case 'anthropic-header':
        return await validateAnthropicHeaderKey(providerType, trimmedKey, resolvedBaseUrl);
      case 'openrouter':
        return await validateOpenRouterKey(providerType, trimmedKey);
      default:
        return { valid: false, error: `Unsupported validation profile for provider: ${providerType}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}
