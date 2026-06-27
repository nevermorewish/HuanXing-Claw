/**
 * Grouping + default-selection helpers for the post-login model picker.
 *
 * The account API hands back a flat list of model-id strings with no vendor
 * metadata, so we classify each id into a model "family" by prefix and render
 * the picker grouped by family. Brand-configured recommended models float into
 * a dedicated "推荐" group at the top and are the only models pre-selected by
 * default (see brands/<id>.json → recommendedModels).
 */

export interface ModelGroup {
  /** Stable group key (family id, or the special recommended key). */
  key: string;
  /** Human-facing group header. */
  label: string;
  /** Model ids in this group, already ordered for display. */
  models: string[];
}

/** Key of the pinned top group holding the brand's recommended models. */
export const RECOMMENDED_GROUP_KEY = '__recommended__';
const RECOMMENDED_GROUP_LABEL = '⭐ 推荐';

interface FamilyRule {
  key: string;
  label: string;
  order: number;
  match: RegExp;
}

// Ordered family rules; first match wins. The id may be bare ("claude-opus-4-6")
// or provider-prefixed ("anthropic/claude-..."), so each pattern allows a
// leading "<segment>/". Anything unmatched falls into the 其他 bucket.
const FAMILY_RULES: FamilyRule[] = [
  { key: 'claude', label: 'Claude', order: 1, match: /(^|\/)(claude|anthropic)/i },
  { key: 'gpt', label: 'OpenAI GPT', order: 2, match: /(^|\/)(gpt|o[1-4](-|$)|chatgpt|openai)/i },
  { key: 'gemini', label: 'Gemini', order: 3, match: /(^|\/)(gemini|google)/i },
  { key: 'deepseek', label: 'DeepSeek', order: 4, match: /(^|\/)deepseek/i },
  { key: 'qwen', label: '通义千问 Qwen', order: 5, match: /(^|\/)(qwen|qwq|tongyi)/i },
  { key: 'glm', label: '智谱 GLM', order: 6, match: /(^|\/)(glm|chatglm|zhipu)/i },
  { key: 'kimi', label: 'Kimi 月之暗面', order: 7, match: /(^|\/)(kimi|moonshot)/i },
  { key: 'doubao', label: '豆包 Doubao', order: 8, match: /(^|\/)(doubao|volc|ark(-|$))/i },
  { key: 'grok', label: 'Grok', order: 9, match: /(^|\/)grok/i },
  { key: 'ernie', label: '文心 ERNIE', order: 10, match: /(^|\/)(ernie|wenxin)/i },
  { key: 'minimax', label: 'MiniMax', order: 11, match: /(^|\/)(minimax|abab)/i },
];

const OTHER_FAMILY = { key: 'other', label: '其他', order: 999 } as const;

function familyOf(modelId: string): { key: string; label: string; order: number } {
  for (const rule of FAMILY_RULES) {
    if (rule.match.test(modelId)) return { key: rule.key, label: rule.label, order: rule.order };
  }
  return OTHER_FAMILY;
}

/** Stable, case-insensitive sort by id for predictable in-group ordering. */
function sortModels(models: string[]): string[] {
  return [...models].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

/**
 * Group fetched model ids for display. Recommended models that the gateway
 * actually returned go into a single pinned "推荐" group at the top, in the
 * brand-configured order; every other model is grouped by family and sorted
 * within its family.
 */
export function groupAccountModels(
  models: string[],
  recommended: readonly string[] = [],
): ModelGroup[] {
  const present = new Set(models);
  // Preserve the brand-configured order, keeping only recommended ids the
  // gateway actually returned, and de-duped.
  const recommendedSeen = new Set<string>();
  const recommendedPresent: string[] = [];
  for (const id of recommended) {
    if (!present.has(id) || recommendedSeen.has(id)) continue;
    recommendedSeen.add(id);
    recommendedPresent.push(id);
  }

  const groups: ModelGroup[] = [];
  if (recommendedPresent.length > 0) {
    groups.push({ key: RECOMMENDED_GROUP_KEY, label: RECOMMENDED_GROUP_LABEL, models: recommendedPresent });
  }

  // Bucket the remaining models by family.
  const buckets = new Map<string, { label: string; order: number; models: string[] }>();
  for (const id of models) {
    if (recommendedSeen.has(id)) continue; // already pinned in 推荐
    const fam = familyOf(id);
    const bucket = buckets.get(fam.key) ?? { label: fam.label, order: fam.order, models: [] };
    bucket.models.push(id);
    buckets.set(fam.key, bucket);
  }

  const familyGroups = [...buckets.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label, 'zh-Hans-CN'))
    .map(([key, b]) => ({ key, label: b.label, models: sortModels(b.models) }));

  return [...groups, ...familyGroups];
}

/**
 * Models selected by default after login: the brand's recommended models that
 * the gateway actually returned. Returns an empty set when none match — we
 * intentionally do NOT fall back to selecting everything.
 */
export function defaultSelectedModels(
  models: string[],
  recommended: readonly string[] = [],
): Set<string> {
  const present = new Set(models);
  return new Set(recommended.filter((id) => present.has(id)));
}
