import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { AccountSession } from '@electron/utils/account-session';

const servers: http.Server[] = [];

function listen(server: http.Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('server address unavailable'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function writeJson(
  res: http.ServerResponse,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  res.writeHead(200, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

describe('AccountSession', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve());
    })));
  });

  it('fetches the full token key with POST after login', async () => {
    const keyMethods: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/api/user/login' && req.method === 'POST') {
        writeJson(
          res,
          {
            success: true,
            data: {
              id: 7,
              username: 'demo',
              display_name: 'Demo',
              role: 1,
              status: 1,
              group: 'default',
            },
          },
          { 'set-cookie': ['session=test-session; Path=/; HttpOnly'] },
        );
        return;
      }
      if (req.url === '/api/token/?p=0&size=100' && req.method === 'GET') {
        writeJson(res, { success: true, data: { items: [{ id: 3, status: 1 }] } });
        return;
      }
      if (req.url === '/api/token/3/key') {
        keyMethods.push(req.method ?? '');
        writeJson(res, { success: true, data: { key: 'sk-test-token' } });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: `not found: ${req.method} ${req.url}` }));
    });
    const baseUrl = await listen(server);

    const session = new AccountSession();
    await session.login(baseUrl, 'demo', 'password');

    await expect(session.ensureApiKey()).resolves.toBe('sk-test-token');
    expect(keyMethods).toEqual(['POST']);
  });
});
