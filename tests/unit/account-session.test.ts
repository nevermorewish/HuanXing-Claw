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

  function loginHandler(res: http.ServerResponse): void {
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
  }

  it('uses the full key returned inline on the token list', async () => {
    // Newer frogclaw returns the unmasked key on the list itself — no /key call.
    const keyEndpointHits: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/api/user/login' && req.method === 'POST') {
        loginHandler(res);
        return;
      }
      if (req.url === '/api/token/?p=0&size=100' && req.method === 'GET') {
        writeJson(res, { success: true, data: { items: [{ id: 3, status: 1, key: 'inline-token' }] } });
        return;
      }
      keyEndpointHits.push(`${req.method} ${req.url}`);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: `not found: ${req.method} ${req.url}` }));
    });
    const baseUrl = await listen(server);

    const session = new AccountSession();
    await session.login(baseUrl, 'demo', 'password');

    await expect(session.ensureApiKey()).resolves.toBe('sk-inline-token');
    expect(keyEndpointHits).toEqual([]);
  });

  it('fetches the full token key with POST when the list key is absent', async () => {
    const keyMethods: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/api/user/login' && req.method === 'POST') {
        loginHandler(res);
        return;
      }
      if (req.url === '/api/token/?p=0&size=100' && req.method === 'GET') {
        writeJson(res, { success: true, data: { items: [{ id: 3, status: 1 }] } });
        return;
      }
      if (req.url === '/api/token/3/key') {
        keyMethods.push(req.method ?? '');
        // frogclaw's GetTokenKey returns the raw key without the sk- prefix.
        writeJson(res, { success: true, data: { key: 'test-token' } });
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

  it('falls back to GET token detail when POST /key 404s via the relay', async () => {
    // Older backends lack POST /:id/key; the OpenAI relay catch-all answers
    // with a JSON error envelope that has no `success` field.
    const paths: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/api/user/login' && req.method === 'POST') {
        loginHandler(res);
        return;
      }
      if (req.url === '/api/token/?p=0&size=100' && req.method === 'GET') {
        writeJson(res, { success: true, data: { items: [{ id: 9, status: 1 }] } });
        return;
      }
      if (req.url === '/api/token/9/key' && req.method === 'POST') {
        paths.push('POST /key');
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Invalid URL (POST /api/token/9/key)', type: 'invalid_request_error', param: '', code: '' },
          }),
        );
        return;
      }
      if (req.url === '/api/token/9' && req.method === 'GET') {
        paths.push('GET detail');
        writeJson(res, { success: true, data: { id: 9, status: 1, key: 'detail-token' } });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: `not found: ${req.method} ${req.url}` }));
    });
    const baseUrl = await listen(server);

    const session = new AccountSession();
    await session.login(baseUrl, 'demo', 'password');

    await expect(session.ensureApiKey()).resolves.toBe('sk-detail-token');
    expect(paths).toEqual(['POST /key', 'GET detail']);
  });
});
