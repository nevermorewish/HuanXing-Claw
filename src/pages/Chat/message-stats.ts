/**
 * Per-message stats helpers — power the assistant reply footer
 * (`ctx: 12.3k/200k (6%) | deepseek-v4-flash | 5.0s`).
 *
 * Token counts and model come verbatim from the session transcript
 * (RawMessage.usage / RawMessage.model). The context window is resolved by
 * matching the message's model against the configured model providers /
 * account model list (both expose `contextWindow`). Duration is captured
 * during the live run and stored on `RawMessage._durationMs`.
 */
import type { RawMessage } from '@/stores/chat';
import type { ModelProviderDTO } from '@/stores/modelProviders';
import type { AccountModelEntry } from '@/stores/account';

export interface AssistantStats {
  tokens?: number;
  contextWindow?: number;
  pct?: number;
  model?: string;
  durationMs?: number;
}

/** `1234 → "1.2k"`, `512 → "512"`. Mirrors frogcode's card footer formatting. */
export function formatTokensK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

/** Context-window label, e.g. `200000 → "200k"`. */
export function formatCtxK(n: number): string {
  return `${Math.round(n / 1000)}k`;
}

/**
 * Resolve a model's context window from the configured providers, falling back
 * to the account model list. Matches the provider by key first (when known),
 * otherwise scans every provider's models by id.
 */
export function resolveContextWindow(
  model: string | undefined,
  provider: string | undefined,
  providers: ModelProviderDTO[],
  accountModels: AccountModelEntry[] = [],
): number | undefined {
  if (!model) return undefined;

  // 1. Preferred provider match, then model id within it.
  if (provider) {
    const matchedProvider = providers.find((p) => p.key === provider);
    const entry = matchedProvider?.models.find((m) => m.id === model);
    if (entry?.contextWindow) return entry.contextWindow;
  }

  // 2. Any provider that defines this model id.
  for (const p of providers) {
    const entry = p.models.find((m) => m.id === model);
    if (entry?.contextWindow) return entry.contextWindow;
  }

  // 3. Account model list fallback.
  const accountEntry = accountModels.find((m) => m.id === model);
  if (accountEntry?.contextWindow) return accountEntry.contextWindow;

  return undefined;
}

/** Total tokens for a message, preferring the explicit total. */
function resolveTokens(usage: RawMessage['usage']): number | undefined {
  if (!usage) return undefined;
  if (typeof usage.totalTokens === 'number') return usage.totalTokens;
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const sum = input + output + cacheRead + cacheWrite;
  return sum > 0 ? sum : undefined;
}

/** Build the footer stats for an assistant message, or null when nothing to show. */
export function buildAssistantStats(
  message: RawMessage,
  providers: ModelProviderDTO[],
  accountModels: AccountModelEntry[] = [],
): AssistantStats | null {
  const tokens = resolveTokens(message.usage);
  const model = message.model ? message.model.replace(/^claude-/, '') : undefined;
  const durationMs = typeof message._durationMs === 'number' ? message._durationMs : undefined;

  const contextWindow = resolveContextWindow(message.model, message.provider, providers, accountModels);
  const pct = tokens !== undefined && contextWindow
    ? Math.round((tokens / contextWindow) * 100)
    : undefined;

  if (tokens === undefined && !model && durationMs === undefined) return null;

  return { tokens, contextWindow, pct, model, durationMs };
}
