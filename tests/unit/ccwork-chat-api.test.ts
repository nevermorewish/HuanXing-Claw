import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ loggedIn: false, models: [] as unknown[], sendPrompt: vi.fn() }));
vi.mock('@electron/utils/account-session', () => ({ accountSession: { isLoggedIn: () => state.loggedIn } }));
vi.mock('@electron/utils/openclaw-auth', () => ({ readAccountModelConfig: async () => ({ models: state.models }) }));
vi.mock('@electron/services/acp-chat-service', () => ({ createAcpChatService: () => ({ sendPrompt: state.sendPrompt }) }));
import { createChatApi } from '@electron/services/chat-api';
const api = () => createChatApi({ gatewayManager: {} as never, mainWindow: {} as never, acpSessionAccessRegistry: {} as never });
beforeEach(() => { state.loggedIn = false; state.models = []; state.sendPrompt.mockReset(); });
describe('ccwork chat authorization', () => {
  it('prevents logged-out chats from using legacy configured providers', async () => {
    expect(await api().sendAcpPrompt({ sessionKey: 'agent:main:main' } as never)).toMatchObject({ success: false, error: expect.stringContaining('log in') });
    expect(state.sendPrompt).not.toHaveBeenCalled();
  });
  it('requires a selected ccwork model even for an authenticated user', async () => {
    state.loggedIn = true;
    expect(await api().sendAcpPrompt({} as never)).toMatchObject({ success: false });
    expect(state.sendPrompt).not.toHaveBeenCalled();
  });
  it('uses the existing ACP path after account and model selection', async () => {
    state.loggedIn = true; state.models = [{ id: 'model-uuid' }]; state.sendPrompt.mockResolvedValue({ success: true });
    const payload = { sessionKey: 'agent:main:main' } as never;
    expect(await api().sendAcpPrompt(payload)).toEqual({ success: true });
    expect(state.sendPrompt).toHaveBeenCalledWith(payload);
  });
});
