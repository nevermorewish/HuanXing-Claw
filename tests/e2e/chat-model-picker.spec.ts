import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { BRAND } from '../../shared/brand';

test.describe('ccwork chat model picker', () => {
  test('offers ccwork model labels while routing UUIDs and excludes legacy direct providers', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await app.evaluate(async ({ app: _app }, providerKey) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const original = (ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers?.get('host:invoke');
        let current = `${providerKey}/uuid-alpha`;
        const requests: string[] = [];
        const workspace = '/tmp/ccwork-model-picker';
        const snapshot = () => ({ success: true, agents: [{ id: 'main', name: 'Main', isDefault: true,
          modelRef: current, overrideModelRef: current, modelDisplay: current, inheritedModel: false,
          workspace, agentDir: '~/.openclaw/agents/main/agent', mainSessionKey: 'agent:main:main', channelTypes: [] }],
          defaultAgentId: 'main', defaultModelRef: `${providerKey}/uuid-alpha`, configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {} });
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event, request) => {
          requests.push(`${request.module}:${request.action}`);
          const respond = (data: unknown) => ({ id: request.id, ok: true, data });
          if (request.module === 'agents' && request.action === 'list') return respond(snapshot());
          if (request.module === 'agents' && request.action === 'updateModel') { current = request.payload.modelRef; return respond(snapshot()); }
          if (request.module === 'modelProviders' && request.action === 'list') return respond({ success: true, primary: current, fallbacks: [], providers: [
            { key: providerKey, baseUrl: 'http://127.0.0.1:23456/v1', api: 'openai-completions', hasKey: true, models: [{ id: 'uuid-alpha', name: 'CCWork Alpha' }, { id: 'uuid-beta', name: 'CCWork Beta' }], primary: current },
            { key: 'legacy', baseUrl: 'https://legacy.test/v1', api: 'openai-completions', hasKey: true, models: [{ id: 'old', name: 'Legacy Direct Model' }] },
          ] });
          if (request.module === 'account' && request.action === 'getModelConfig') return respond({ success: true, config: { baseUrl: 'http://127.0.0.1:23456/v1', primary: current, models: [{ id: 'uuid-alpha', name: 'CCWork Alpha' }, { id: 'uuid-beta', name: 'CCWork Beta' }] } });
          if (request.module === 'providers' && ['accounts', 'accountKeyInfo', 'vendors'].includes(request.action)) return respond([]);
          if (request.module === 'providers' && request.action === 'getDefaultAccount') return respond({ accountId: null });
          if (request.module === 'gateway' && request.action === 'status') return respond({ state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          if (request.module === 'settings' && request.action === 'getAll') return respond({ language: 'en', setupComplete: true, chatWorkspacePath: workspace, recentWorkspacePaths: [workspace] });
          if (request.module === 'files' && request.action === 'resolveWorkspaceContext') return respond({ ok: true, workspaceRoot: workspace, executionCwd: workspace });
          if (request.module === 'chat' && request.action === 'loadAcpSession') return respond({ success: true, generation: 1 });
          if (request.module === 'gateway' && request.action === 'rpc') return respond({ success: true, result: request.payload.method === 'sessions.list' ? { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } : {} });
          return original?.(event, request) ?? respond({});
        });
        (globalThis as unknown as { __ccworkPicker: { requests: string[]; model: () => string } }).__ccworkPicker = { requests, model: () => current };
      }, BRAND.providerKey);
      const page = await getStableWindow(app); await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('CCWork Alpha');
      await page.getByTestId('chat-model-picker-button').click();
      await expect(page.getByTestId('chat-model-picker-menu')).toContainText('CCWork Beta');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('Legacy');
      await page.getByTestId('chat-model-picker-menu').getByRole('button', { name: /CCWork Beta/ }).click();
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('CCWork Beta');
      const result = await app.evaluate(() => {
        const state = (globalThis as unknown as { __ccworkPicker: { requests: string[]; model: () => string } }).__ccworkPicker;
        return { requests: state.requests, model: state.model() };
      });
      expect(result.model).toBe(`${BRAND.providerKey}/uuid-beta`);
      expect(result.requests).not.toContain('gateway:restart');
      await page.getByTestId('sidebar-nav-agents').click();
      await page.getByTestId('agent-card-main').getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: /^Model / }).click();
      await expect(page.locator('#agent-model-id')).toBeVisible();
      await expect(page.locator('#agent-model-id option')).toHaveCount(3);
      await expect(page.locator('#agent-model-id')).toContainText('CCWork Alpha');
      await expect(page.locator('#agent-model-provider')).not.toContainText('Legacy');
    } finally { await closeElectronApp(app); }
  });
});
