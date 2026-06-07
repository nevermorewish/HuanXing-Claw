/**
 * Model provider presets (clawpanel-style).
 *
 * `API_TYPES` mirrors the OpenClaw-supported api protocols (a subset/superset of
 * clawpanel's list, kept in sync with electron/shared/providers/types.ts
 * OPENCLAW_API_PROTOCOLS so the gateway never rejects a written entry).
 * `PROVIDER_PRESETS` are quick-fill buttons for the Add Provider dialog.
 */

export interface ApiType {
  value: string;
  label: string;
}

/** Valid OpenClaw api protocols, ordered most-common-first. */
export const API_TYPES: ApiType[] = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions (最常用)' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'openai-codex-responses', label: 'OpenAI Codex Responses' },
  { value: 'google-generative-ai', label: 'Google Gemini' },
  { value: 'github-copilot', label: 'GitHub Copilot' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses' },
  { value: 'ollama', label: 'Ollama 本地模型' },
];

const API_TYPE_LABELS = new Map(API_TYPES.map((t) => [t.value, t.label]));

/** Human label for an api protocol value, falling back to the raw value. */
export function getApiTypeLabel(api: string | undefined): string {
  if (!api) return 'openai-completions';
  return API_TYPE_LABELS.get(api) ?? api;
}

export interface ProviderPreset {
  /** Provider key written into models.providers.<key>. */
  key: string;
  /** Display name on the quick-select button. */
  label: string;
  baseUrl: string;
  api: string;
  /** Optional badge (e.g. 推荐). */
  badge?: string;
  /** Site link shown in the preset detail panel. */
  site?: string;
  /** Short description shown when the preset is selected. */
  desc?: string;
}

/** Quick-select presets for the Add Provider dialog. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    api: 'openai-completions',
    site: 'https://cloud.siliconflow.cn/',
    desc: '高性价比推理平台，支持 DeepSeek、Qwen 等开源模型',
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
    site: 'https://platform.deepseek.com/',
    desc: 'DeepSeek 官方 API',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    site: 'https://platform.openai.com/',
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic-messages',
    site: 'https://console.anthropic.com/',
  },
  {
    key: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    api: 'google-generative-ai',
    site: 'https://aistudio.google.com/',
  },
  {
    key: 'moonshot',
    label: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    api: 'openai-completions',
    site: 'https://platform.moonshot.cn/',
  },
  {
    key: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions',
    site: 'https://open.bigmodel.cn/',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    site: 'https://openrouter.ai/',
    desc: '聚合多家模型的统一入口',
  },
];
