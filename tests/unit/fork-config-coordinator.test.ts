// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));
vi.mock('@electron/utils/paths', async (original) => ({
  ...await original<typeof import('@electron/utils/paths')>(),
  getOpenClawConfigDir: () => state.dir,
  resolveOpenClawStateDir: () => state.dir,
  resolveOpenClawConfigPath: () => join(state.dir, 'openclaw.json'),
}));
vi.mock('@electron/utils/store', () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock('@electron/utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { resetOpenClawConfigCoordinatorForTests } from '@electron/gateway/config-delivery';
import { readProviderModelConfig, setPrimaryModelRef, writeProviderModelConfig } from '@electron/utils/openclaw-auth';
import { createConfigApi } from '@electron/services/config-api';

const readConfig = async () => JSON.parse(await readFile(join(state.dir, 'openclaw.json'), 'utf8'));

beforeEach(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'deepclaw-fork-config-'));
  resetOpenClawConfigCoordinatorForTests();
});
afterEach(async () => {
  resetOpenClawConfigCoordinatorForTests();
  await rm(state.dir, { recursive: true, force: true });
});

describe('fork integration with upstream config coordination', () => {
  it('serializes model edits with primary selection and preserves inline credentials and unrelated config', async () => {
    await writeFile(join(state.dir, 'openclaw.json'), JSON.stringify({
      channels: { telegram: { enabled: true } },
      models: { providers: { custom: { apiKey: 'sk-private-token', headers: { 'X-App': 'fork' } } } },
    }));
    await Promise.all([
      writeProviderModelConfig('custom', {
        baseUrl: 'https://example.test/v1', api: 'openai-completions',
        models: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second', contextWindow: 200000 }],
      }),
      setPrimaryModelRef('custom/second'),
    ]);
    const config = await readConfig();
    expect(config.channels.telegram.enabled).toBe(true);
    expect(config.models.providers.custom).toMatchObject({ apiKey: 'sk-private-token', headers: { 'X-App': 'fork' } });
    expect(config.agents.defaults.model.primary).toBe('custom/second');
    const visible = await readProviderModelConfig('custom');
    expect(visible.maskedKey).not.toContain('sk-private-token');
    expect(visible.models).toHaveLength(2);
  });

  it('keeps the existing config intact when an unsupported provider protocol is rejected', async () => {
    const original = JSON.stringify({ channels: { telegram: { enabled: true } } });
    await writeFile(join(state.dir, 'openclaw.json'), original);
    await expect(writeProviderModelConfig('custom', {
      baseUrl: 'https://example.test', api: 'invalid' as never, models: [],
    })).rejects.toThrow();
    expect(await readFile(join(state.dir, 'openclaw.json'), 'utf8')).toBe(original);
  });

  it('accepts upstream JSON5 config edits through the coordinator and backs up the previous config', async () => {
    await writeFile(join(state.dir, 'openclaw.json'), JSON.stringify({ commands: { restart: true } }));
    const api = createConfigApi({ gatewayManager: {} as never });
    await expect(api.write({ content: '{ // imported config\n channels: { telegram: { enabled: true, }, }, }' })).resolves.toEqual({ success: true });
    expect((await readConfig()).channels.telegram.enabled).toBe(true);
    const result = await api.listBackups();
    expect(result.backups).toHaveLength(1);
  });
});
