// @vitest-environment node
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountSession } from '@electron/utils/account-session';
import { CcworkRelay, ccworkFrames } from '@electron/services/ccwork-relay';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(frames: string[], inspect?: (req: http.IncomingMessage, body: Record<string, unknown>) => void) {
  let hits = 0;
  const backend = http.createServer((req, res) => { void (async () => {
    hits++; const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    inspect?.(req, JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const frame of frames) res.write(frame);
    res.end();
  })(); });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { backend.closeAllConnections(); await new Promise<void>((resolve) => backend.close(() => resolve())); });
  const session = new AccountSession();
  session.restore({ baseUrl: `http://127.0.0.1:${(backend.address() as { port: number }).port}`,
    accessToken: 'private-jwt', refreshToken: 'private-refresh', expiresAt: Date.now() + 3600_000,
    organizationId: 'org-uuid', user: { id: 'user-uuid', username: 'demo', displayName: 'Demo', group: '', role: 1, status: 1 } });
  const relay = new CcworkRelay(session); cleanup.push(() => relay.stop());
  const config = await relay.start();
  const call = (stream = true, key = config.apiKey, headers = {}) => fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...headers },
    body: JSON.stringify({ model: 'model-uuid', stream, messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] }], tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }] }),
  });
  return { config, call, hits: () => hits, session, relay };
}
const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const delta = (value: unknown, finish_reason: string | null = null) => data({ id: 'backend-id', model: 'model-uuid', choices: [{ index: 0, delta: value, finish_reason }] });
const billing = (status = 'success') => `event: tabtin.billing\ndata: ${JSON.stringify({ charge_status: status, credits_charged: 0.125, error_category: status === 'failed' ? 'insufficient_balance' : undefined })}\n\n`;
const done = 'data: [DONE]\n\n';
describe('ccwork loopback relay', () => {
  it('routes streaming tools and images to ccwork with JWT and organization, hiding billing protocol frames', async () => {
    let request: Record<string, unknown> | undefined;
    const relay = await fixture([delta({ role: 'assistant', content: '你' }), delta({ tool_calls: [{ index: 0, id: 'tool-1', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] }), delta({}, 'tool_calls'), data({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }), billing(), done], (req, body) => {
      expect(req.url).toBe('/api/llm/proxy'); expect(req.headers.authorization).toBe('Bearer private-jwt');
      expect(req.headers['x-tabtin-organization-id']).toBe('org-uuid');
      expect(req.headers['x-tabtin-billing-idempotency-key']).toBeUndefined(); request = body;
    });
    const response = await relay.call(); const text = await response.text();
    expect(response.status).toBe(200); expect(text).toContain('你'); expect(text).toContain('tool_calls');
    expect(text).toContain('[DONE]'); expect(text).not.toContain('tabtin.billing'); expect(text).not.toContain('private-jwt');
    expect(request).toMatchObject({ model: 'model-uuid', stream: true, tools: [{ function: { name: 'lookup' } }] });
    expect(request?.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] }]);
    expect(relay.hits()).toBe(1);
  });
  it('collects non-stream completions, tool arguments, reasoning and usage only after settlement', async () => {
    const relay = await fixture([delta({ content: 'Hello', reasoning_content: 'Reason', tool_calls: [{ index: 0, id: 't1', function: { name: 'lookup', arguments: '{' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }), delta({}, 'tool_calls'), data({ choices: [], usage: { total_tokens: 14 } }), billing(), done]);
    const response = await relay.call(false);
    expect(await response.json()).toMatchObject({ object: 'chat.completion', usage: { total_tokens: 14 }, choices: [{ finish_reason: 'tool_calls', message: { content: 'Hello', reasoning_content: 'Reason', tool_calls: [{ id: 't1', function: { name: 'lookup', arguments: '{}' } }] } }] });
  });
  it('rejects billing precheck errors delivered in HTTP 200 SSE with actionable guidance', async () => {
    const relay = await fixture([data({ error: { user_message: '模型服务暂时不可用，请稍后重试', type: 'ccwork_error', error_category: 'organization_insufficient_credits', topup_reason: 'wallet_insufficient' } }), done]);
    const response = await relay.call();
    expect(response.status).toBe(502); expect(await response.text()).toContain('本月 LLM 代币已用完，请充值或开启自动补充后重试');
    expect(relay.hits()).toBe(1);
  });
  it.each([billing('failed'), ''])('does not report successful completion for missing or failed billing', async (tail) => {
    const relay = await fixture([delta({ content: 'Partial answer' }), delta({}, 'stop'), tail, done]);
    const response = await relay.call(); const text = await response.text();
    expect(text).toContain('Partial answer'); expect(text).toContain('"error"');
    expect(text).not.toContain('[DONE]'); expect(text).not.toContain('"finish_reason":"stop"');
  });
  it('requires the local runtime credential and rejects browser cross-origin requests before contacting ccwork', async () => {
    const relay = await fixture([billing(), done]);
    expect((await relay.call(true, 'wrong-key')).status).toBe(401);
    expect((await relay.call(true, relay.config.apiKey, { Origin: 'https://attacker.test' })).status).toBe(401);
    expect(relay.hits()).toBe(0);
    expect((await fetch(`${relay.config.baseUrl}/arbitrary`, { headers: { Authorization: `Bearer ${relay.config.apiKey}` } })).status).toBe(404);
  });
  it('handles fragmented UTF-8, CRLF and multi-line SSE', async () => {
    const bytes = new TextEncoder().encode('event: message\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\n');
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const value of bytes) controller.enqueue(new Uint8Array([value])); controller.close(); } });
    const frames = []; for await (const frame of ccworkFrames(stream)) frames.push(frame);
    expect(frames).toEqual([{ event: 'message', data: '{"text":\n"你好"}' }]);
  });
});
