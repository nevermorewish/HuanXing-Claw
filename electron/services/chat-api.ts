import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createAcpChatService } from './acp-chat-service';
import type { AcpSessionAccessRegistry } from './acp-session-access-registry';
import { accountSession } from '../utils/account-session';
import { readAccountModelConfig } from '../utils/openclaw-auth';

export function createChatApi({
  gatewayManager,
  mainWindow,
  acpSessionAccessRegistry,
}: {
  gatewayManager: GatewayManager;
  mainWindow: BrowserWindow;
  acpSessionAccessRegistry: AcpSessionAccessRegistry;
}): CompleteHostServiceRegistry['chat'] {
  const acpChat = createAcpChatService(mainWindow, acpSessionAccessRegistry, gatewayManager);

  return {
    getAcpSessionFamily: (payload) => acpChat.getSessionFamily(payload),
    loadAcpSession: (payload) => acpChat.loadSession(payload),
    sendAcpPrompt: async (payload) => {
      if (!accountSession.isLoggedIn()) return { success: false, error: 'Please log in to ccwork before sending a message' };
      if (!(await readAccountModelConfig()).models.length) return { success: false, error: 'Select an available ccwork model before sending a message' };
      return acpChat.sendPrompt(payload);
    },
    cancelAcpSession: (payload) => acpChat.cancelSession(payload),
    respondAcpPermission: (payload) => acpChat.respondPermission(payload),
  };
}
