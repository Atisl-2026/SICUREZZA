import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { buildDbRequest } from '../src/shared/gemini.ts';
import { buildDescribeRequest } from '../src/shared/vision.ts';
import { toChatBody } from '../src/shared/providers.ts';
import { callClaude, toClaudeParams } from '../src/lib/claude';
import type { Settings } from '../src/lib/settings';

const dbReq = buildDbRequest('Chi è il preposto?', [
  { recordId: 'tu', titolo: 'Testo unico', categoria: 'Normativa', fonte: '', data_aggiornamento: '', testo: 'Il preposto sovrintende.' }
]);
const img = { mimeType: 'image/jpeg', data: 'AAAA' };

/** Risposta in tempo reale nel formato della Messages API. */
function claudeSse(pieces: string[], stop = 'end_turn', model = 'claude-opus-5-5') {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const body = [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ...pieces.map((t) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } })),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }),
    ev('message_stop', {})
  ].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Claude (a pagamento)', () => {
  it('richiesta: istruzioni come system, foto come immagini, ragionamento ridotto, ripiego in caso di rifiuto', () => {
    const p = toClaudeParams(buildDescribeRequest([img], 'ponteggio'), 'claude-opus-5-5', 'minimal');
    expect(p.system).toMatch(/SOLO con un oggetto JSON/);
    expect((p.messages[0].content as { type: string }[])[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(p.output_config).toEqual({ effort: 'low' });
    expect(p).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect('temperature' in p).toBe(false);
    expect('thinking' in p).toBe(false);
    // Haiku: niente ripiego lato server
    expect('fallbacks' in toClaudeParams(dbReq, 'claude-haiku-5-5')).toBe(false);
    expect(toClaudeParams(dbReq, 'claude-opus-5-5').output_config).toEqual({ effort: 'medium' });
  });

  it('testo in tempo reale, modello che ha risposto', async () => {
    const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return claudeSse(['Il preposto ', 'sovrintende [tu].']);
    });
    const seen: string[] = [];
    const a = await callClaude(dbReq, { apiKey: ' sk-ant-x ', model: 'claude-opus-5-5', fetchImpl: fetchImpl as unknown as typeof fetch, onText: (t) => seen.push(t) });
    expect(a).toMatchObject({ text: 'Il preposto sovrintende [tu].', servizio: 'Claude', modello: 'claude-opus-5-5', truncated: false });
    expect(seen.at(-1)).toBe('Il preposto sovrintende [tu].');
    expect(calls[0].url).toMatch(/api\.anthropic\.com\/v1\/messages/);
    expect(calls[0].headers.get('authorization') ?? calls[0].headers.get('x-api-key')).toMatch(/sk-ant-x$/);
    expect(calls[0].headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(calls[0].headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(calls[0].body).toMatchObject({ stream: true, fallbacks: 'default', model: 'claude-opus-5-5' });
  });

  it('rifiuto, chiave errata, credito esaurito, sovraccarico', async () => {
    const run = (r: () => Response) => callClaude(dbReq, { apiKey: 'k', model: 'claude-opus-5-5', fetchImpl: (async () => r()) as unknown as typeof fetch });
    await expect(run(() => claudeSse([], 'refusal'))).rejects.toMatchObject({ kind: 'bloccata' });
    await expect(run(() => json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }))).rejects.toMatchObject({ kind: 'chiave' });
    await expect(run(() => json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } })))
      .rejects.toMatchObject({ kind: 'quota', message: expect.stringMatching(/credito esaurito/) });
    await expect(run(() => json(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }))).rejects.toMatchObject({ kind: 'sovraccarico' });
  }, 20000);
});

describe('ChatGPT (a pagamento)', () => {
  it('parametri adatti ai modelli recenti di OpenAI', () => {
    const b = toChatBody(dbReq, 'gpt-5', true, 'openai');
    expect(b.max_completion_tokens).toBeGreaterThanOrEqual(16000);
    expect(b.max_tokens).toBeUndefined();
    expect(b.temperature).toBeUndefined();
    expect(b.stream).toBe(true);
  });
});

describe('quando usare le AI a pagamento', () => {
  const s = (over: Partial<Settings>): Settings => ({
    autoCheck: true, webCheck: false, categorie: [], documento: '', apiKey: 'AIza', model: 'gemini-flash-latest',
    riserve: { groq: { apiKey: 'g' }, anthropic: { apiKey: 'sk-ant' }, openai: { apiKey: 'sk' } },
    usoPagamento: 'riserva', condividiPagamento: false, ...over
  });
  it('per default dopo le gratuite; «sempre per prime» le mette in testa', async () => {
    const { availableAi } = await import('../src/lib/router');
    expect(availableAi(s({}))).toEqual(['gemini', 'groq', 'anthropic', 'openai']);
    expect(availableAi(s({ usoPagamento: 'prima' }))).toEqual(['anthropic', 'openai', 'gemini', 'groq']);
  });

  it('Gemini al limite → risponde Claude (con il modello scelto)', async () => {
    const { runAi, resetRouter } = await import('../src/lib/router');
    const { resetModelState } = await import('../src/lib/model');
    resetRouter();
    resetModelState();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('generativelanguage')) {
        return json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] }] } });
      }
      if (String(url).includes('anthropic.com')) return claudeSse(['Risposta di Claude.'], 'end_turn', 'claude-sonnet-5-5');
      return json(500, {});
    }));
    const a = await runAi(s({ riserve: { anthropic: { apiKey: 'sk-ant', model: 'claude-sonnet-5-5' } } }), { request: dbReq, timeoutMs: 5000, signal: new AbortController().signal });
    expect(a).toMatchObject({ fornitore: 'anthropic', servizio: 'Claude', modello: 'claude-sonnet-5-5', text: 'Risposta di Claude.' });
    vi.unstubAllGlobals();
  }, 20000);
});
