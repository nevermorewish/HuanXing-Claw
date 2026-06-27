import { describe, expect, it } from 'vitest';
import { groupAccountModels, defaultSelectedModels, RECOMMENDED_GROUP_KEY } from '@/lib/account-models';

describe('groupAccountModels', () => {
  it('pins present recommended models into a top group, in configured order', () => {
    const models = ['gpt-5.5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'deepseek-v4-pro'];
    const recommended = ['claude-opus-4-8', 'gpt-5.5', 'gemini-3.1-pro-preview'];
    const groups = groupAccountModels(models, recommended);

    expect(groups[0].key).toBe(RECOMMENDED_GROUP_KEY);
    // gemini-3.1-pro-preview is not in the fetched list, so it's dropped.
    expect(groups[0].models).toEqual(['claude-opus-4-8', 'gpt-5.5']);
  });

  it('groups the remaining models by family and omits the recommended ones from family groups', () => {
    const models = ['gpt-5.5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'deepseek-v4-pro'];
    const recommended = ['claude-opus-4-8'];
    const groups = groupAccountModels(models, recommended);

    const claude = groups.find((g) => g.key === 'claude');
    expect(claude?.models).toEqual(['claude-sonnet-4-6']); // opus pinned in 推荐, not duplicated
    const gpt = groups.find((g) => g.key === 'gpt');
    expect(gpt?.models).toEqual(['gpt-5.5']);
    const deepseek = groups.find((g) => g.key === 'deepseek');
    expect(deepseek?.models).toEqual(['deepseek-v4-pro']);
  });

  it('classifies provider-prefixed ids and falls back to 其他', () => {
    const groups = groupAccountModels(['anthropic/claude-3', 'qwen-max', 'some-random-model']);
    expect(groups.find((g) => g.key === 'claude')?.models).toEqual(['anthropic/claude-3']);
    expect(groups.find((g) => g.key === 'qwen')?.models).toEqual(['qwen-max']);
    expect(groups.find((g) => g.key === 'other')?.models).toEqual(['some-random-model']);
  });

  it('drops the recommended group entirely when none are present', () => {
    const groups = groupAccountModels(['gpt-5.5'], ['claude-opus-4-8']);
    expect(groups.some((g) => g.key === RECOMMENDED_GROUP_KEY)).toBe(false);
  });
});

describe('defaultSelectedModels', () => {
  it('selects only recommended models the gateway returned', () => {
    const selected = defaultSelectedModels(
      ['gpt-5.5', 'claude-opus-4-8', 'deepseek-v4-pro'],
      ['claude-opus-4-8', 'gemini-3.1-pro-preview'],
    );
    expect([...selected]).toEqual(['claude-opus-4-8']);
  });

  it('returns an empty set when none match (no select-all fallback)', () => {
    expect(defaultSelectedModels(['gpt-5.5'], ['claude-opus-4-8']).size).toBe(0);
    expect(defaultSelectedModels(['gpt-5.5'], []).size).toBe(0);
  });
});
