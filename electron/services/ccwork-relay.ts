/** Loopback OpenAI compatibility transport for ccwork's billed proxy. */
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import type { AccountSession } from '../utils/account-session';

type Json = Record<string, unknown>;
type Chunk = { id?: string; model?: string; usage?: Json; error?: { message?: string; user_message?: string; type?: string }; choices?: Array<{ delta?: Json; finish_reason?: string | null }> };

/** Parse complete SSE frames even when UTF-8 / CRLF / multi-line data split across reads. */
export async function* ccworkFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, match.index);
        pending = pending.slice(match.index + match[0].length);
        const lines = frame.split(/\r?\n/);
        const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (data) yield { event: lines.find((l) => l.startsWith('event:'))?.slice(6).trim() ?? '', data };
      }
      if (pending.length > 8 * 1024 * 1024) throw new Error('ccwork SSE frame too large');
      if (done) {
        if (pending.trim()) throw new Error('Incomplete ccwork SSE frame');
        break;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class CcworkRelay {
  private server: http.Server | null = null;
  private starting: Promise<{ baseUrl: string; apiKey: string }> | null = null;
  private connection: { baseUrl: string; apiKey: string } | null = null;
  private active = new Set<AbortController>();
  constructor(private session: AccountSession) {}

  async start(): Promise<{ baseUrl: string; apiKey: string }> {
    if (this.connection) return this.connection;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const apiKey = randomBytes(32).toString('hex');
      const server = http.createServer((req, res) => { void this.handle(req, res, apiKey); });
      server.requestTimeout = 60_000;
      server.headersTimeout = 15_000;
      this.server = server;
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      server.unref();
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('ccwork relay unavailable');
      this.connection = { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey };
      return this.connection;
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }
  abortRequests(): void { for (const controller of this.active) controller.abort(); }
  async stop(): Promise<void> {
    this.abortRequests();
    const server = this.server;
    this.connection = null; this.server = null;
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, apiKey: string): Promise<void> {
    const errorResponse = (status: number, message: string) => {
      const error = { error: { message, type: 'ccwork_error' } };
      if (res.headersSent) { res.end(`data: ${JSON.stringify(error)}\n\n`); }
      else { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(error)); }
    };
    const key = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    const expected = Buffer.from(apiKey);
    if (req.headers.origin || key.length !== expected.length || !timingSafeEqual(key, expected) || !this.session.isLoggedIn()) {
      errorResponse(401, 'Please log in to ccwork'); return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { errorResponse(404, 'Unknown ccwork relay route'); return; }
    const controller = new AbortController();
    this.active.add(controller);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
    try {
      const buffers: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 16 * 1024 * 1024) { errorResponse(413, 'Model request too large'); return; }
        buffers.push(chunk);
      }
      const request = JSON.parse(Buffer.concat(buffers).toString('utf8')) as Json;
      if (typeof request.model !== 'string' || !Array.isArray(request.messages)) { errorResponse(400, 'Invalid model request'); return; }
      const streaming = request.stream === true;
      const response = await this.session.authorizedFetch('/api/llm/proxy', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-TabTin-Request-Source': 'claw', 'X-TabTin-Session-Id': `claw-${randomUUID()}` },
        body: JSON.stringify({ ...request, stream: true, stream_options: { include_usage: true } }),
      });
      if (!response.ok) { await response.body?.cancel(); errorResponse(response.status, `ccwork HTTP ${response.status}`); return; }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Invalid ccwork proxy response');
      let done = false;
      let settled = false;
      let id = `chatcmpl-${randomUUID()}`;
      let model = request.model;
      let content = '';
      let reasoning = '';
      let finishReason = 'stop';
      let usage: Json | undefined;
      const tools = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>();
      const terminal: string[] = [];
      const send = async (data: string) => {
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (!res.write(`data: ${data}\n\n`)) await once(res, 'drain', { signal: controller.signal });
      };
      for await (const frame of ccworkFrames(response.body)) {
        if (frame.data === '[DONE]') { done = true; continue; }
        const chunk = JSON.parse(frame.data) as Chunk & { charge_status?: string; error_category?: string; usage?: Json };
        if (frame.event === 'tabtin.billing') {
          if (chunk.charge_status === 'failed') throw new Error(`ccwork billing failed: ${chunk.error_category || 'billing_charge_failed'}`);
          if (!['success', 'byok_exempt'].includes(chunk.charge_status ?? '')) throw new Error('Invalid ccwork billing result');
          settled = true;
          continue;
        }
        if (chunk.error) throw new Error(chunk.error.user_message || chunk.error.message || 'ccwork model request failed');
        // Ignore informational custom events, including capability downgrades.
        if (frame.event && frame.event !== 'message') continue;
        if (!chunk.choices && !chunk.usage) continue;
        id = chunk.id ?? id; model = chunk.model ?? model;
        if (chunk.usage) usage = chunk.usage;
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta ?? {};
          content += typeof delta.content === 'string' ? delta.content : '';
          reasoning += typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
          if (choice.finish_reason) finishReason = choice.finish_reason;
          for (const item of (delta.tool_calls ?? []) as Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>) {
            const tool = tools.get(item.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (item.id) tool.id = item.id;
            tool.function.name += item.function?.name ?? '';
            tool.function.arguments += item.function?.arguments ?? '';
            tools.set(item.index, tool);
          }
        }
        if (streaming) {
          // Delay terminal chunks until the backend has completed settlement.
          if (chunk.usage || chunk.choices?.some((c) => c.finish_reason)) terminal.push(frame.data);
          else await send(frame.data);
        }
      }
      if (!done || !settled) throw new Error('ccwork stream ended before billing settlement');
      if (streaming) {
        for (const frame of terminal) await send(frame);
        await send('[DONE]'); res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, model, object: 'chat.completion', created: Math.floor(Date.now() / 1000), usage,
          choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content: content || null,
            ...(reasoning ? { reasoning_content: reasoning } : {}), ...(tools.size ? { tool_calls: [...tools.values()] } : {}) } }] }));
      }
    } catch (error) {
      if (!res.destroyed) errorResponse(502, error instanceof Error ? error.message : 'ccwork relay failed');
    } finally { clearTimeout(timeout); this.active.delete(controller); res.off('close', disconnect); }
  }
}
