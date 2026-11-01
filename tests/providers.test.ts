import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDbRequest, type GeminiRequest } from '../src/shared/gemini.ts';
import { buildDescribeRequest } from '../src/shared/vision.ts';
import {
  callChat, classifyChatError, listChatModels, pickModel, toChatBody, type ChatModel
} from '../src/shared/providers.ts';
import type { Settings } from '../src/lib/settings';

const img = { mimeType: 'image/jpeg', data: 'AAAA' };
const dbReq = buildDbRequest('Come si chiedono le ferie?', [
  { recordId: 'ferie', titolo: 'Ferie', categoria: 'Procedure', fonte: '', data_aggiornamento: '', testo: 'Con 5 giorni di anticipo.' }
]);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (lines: string[]) => new Response(lines.join('\n') + '\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const delta = (t: string, finish?: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: finish ?? null }] })}\n`;

describe('richieste nel formato "chat completions"', () => {
  it('istruzioni → messaggio di sistema; testo semplice per le domande', () => {
    const b = toChatBody(dbReq, 'llama-x', false);
    expect(b.model).toBe('llama-x');
    expect(b.messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('archivio') });
    expect(b.messages[1]).toMatchObject({ role: 'user', content: expect.stringContaining('id: ferie') });
    expect(b.temperature).toBe(0.2);
    expect(b.stream).toBeUndefined();
  });

  it('foto come immagini "data:" e risposta JSON chiesta nel testo (con i campi dello schema)', () => {
    const b = toChatBody(buildDescribeRequest([img], 'ponteggio'), 'm', true);
    const content = b.messages[1].content as { type: string; image_url?: { url: string } }[];
    expect(content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
    expect(content.at(-1)).toMatchObject({ type: 'text' });
    expect(b.messages[0].content).toMatch(/SOLO con un oggetto JSON/);
    expect(b.messages[0].content).toMatch(/"parole_chiave" \(elenco di testi\)/);
    expect(b.max_tokens).toBe(2048);
    expect(b.stream).toBe(true);
  });
});

describe('chiamata ai servizi di riserva (fetch simulato)', () => {
  it('risposta normale', async () => {
    const fetchImpl = vi.fn(async () => json(200, { choices: [{ message: { content: ' Con 5 giorni [ferie]. ' }, finish_reason: 'stop' }] }));
    const a = await callChat('groq', dbReq, { apiKey: ' gsk_x ', model: 'llama-x', fetchImpl });
    expect(a.text).toBe('Con 5 giorni [ferie].');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_x');
  });

  it('in tempo reale: unisce i pezzi, ignora i commenti, [DONE] e risposta troncata', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async () => sse([': OPENROUTER PROCESSING', '', delta('Con 5 '), delta('giorni'), delta('', 'length'), 'data: [DONE]']));
    const a = await callChat('openrouter', dbReq, { apiKey: 'k', model: 'x:free', fetchImpl, onText: (t) => seen.push(t) });
    expect(a.text).toBe('Con 5 giorni');
    expect(a.truncated).toBe(true);
    expect(seen).toEqual(['Con 5 ', 'Con 5 giorni']);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).stream).toBe(true);
  });

  it('errori: chiave, limite (formato Groq), modello, servizio bloccato dal browser', async () => {
    expect(classifyChatError('groq', 401, { error: { message: 'Invalid API Key' } }).kind).toBe('chiave');
    const q = classifyChatError('groq', 429, { error: { message: 'Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` on requests per minute (RPM): Limit 30, Used 30, Requested 1. Please try again in 2s.' } });
    expect(q.kind).toBe('quota');
    expect(q.quota).toMatchObject({ periodo: 'minuto', limite: 30, modello: 'llama-3.3-70b-versatile', attesaS: 2 });
    expect(q.message).toMatch(/^Groq: troppe richieste in un minuto/);
    expect(classifyChatError('mistral', 400, { message: 'Invalid model: mistral-xyz' }).kind).toBe('modello');
    expect(classifyChatError('openrouter', 402, { error: { message: 'Insufficient credits' } }).kind).toBe('quota');
    const blocked = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(callChat('mistral', dbReq, { apiKey: 'k', model: 'm', fetchImpl: blocked })).rejects.toMatchObject({ kind: 'rete', message: expect.stringMatching(/Mistral.*richieste dirette/) });
  });
});

describe('scelta automatica del modello', () => {
  it('Groq: preferisce i modelli grandi; per le foto solo quelli che leggono immagini', async () => {
    const f = vi.fn(async () => json(200, { data: [
      { id: 'whisper-large-v3', active: true }, { id: 'llama-3.1-8b-instant', active: true },
      { id: 'llama-3.3-70b-versatile', active: true }, { id: 'meta-llama/llama-4-scout-17b-16e-instruct', active: true }
    ] }));
    const list = await listChatModels('groq', 'k', f as unknown as typeof fetch);
    expect(list.map((m) => m.id)).not.toContain('whisper-large-v3');
    expect(pickModel('groq', list, false)).toBe('meta-llama/llama-4-scout-17b-16e-instruct');
    expect(pickModel('groq', list.filter((m) => !/llama-4/.test(m.id)), true)).toBeUndefined();
  });

  it('Mistral: capacità dichiarate; OpenRouter: solo modelli gratuiti', async () => {
    const mistral: ChatModel[] = await listChatModels('mistral', 'k', (async () => json(200, { data: [
      { id: 'mistral-large-latest', capabilities: { completion_chat: true, vision: false } },
      { id: 'mistral-medium-latest', capabilities: { completion_chat: true, vision: true } },
      { id: 'mistral-embed', capabilities: { completion_chat: false } }
    ] })) as unknown as typeof fetch);
    expect(pickModel('mistral', mistral, false)).toBe('mistral-medium-latest');
    expect(pickModel('mistral', mistral.filter((m) => m.id !== 'mistral-medium-latest'), true)).toBeUndefined();
    const or = await listChatModels('openrouter', 'k', (async () => json(200, { data: [
      { id: 'openai/gpt-x', pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: { input_modalities: ['text', 'image'] } },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'] }, context_length: 131072 },
      { id: 'google/gemma-3-27b-it:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'] }, context_length: 96000 }
    ] })) as unknown as typeof fetch);
    expect(pickModel('openrouter', or, true)).toBe('google/gemma-3-27b-it:free');
    expect(pickModel('openrouter', or, false)).toBe('google/gemma-3-27b-it:free');
    expect(or.find((m) => m.id === 'openai/gpt-x')!.free).toBe(false);
  });
});

describe('passaggio automatico tra le AI', () => {
  const base = (over: Partial<Settings> = {}): Settings => ({
    autoCheck: true, webCheck: false, categorie: [], documento: '', apiKey: 'AIza', model: 'gemini-2.5-flash',
    riserve: { groq: { apiKey: 'gsk' }, openrouter: { apiKey: 'sk-or' } }, ...over
  });
  const gemini429 = () => json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] }
  ] } });
  let calls: string[];

  beforeEach(async () => {
    calls = [];
    (await import('../src/lib/router')).resetRouter();
    (await import('../src/lib/model')).resetModelState();
  });
  afterEach(() => vi.unstubAllGlobals());

  function stub(handler: (url: string, body: GeminiRequest & { model?: string }) => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url.replace(/^https:\/\/[^/]+/, '').replace(/\?.*$/, ''));
      return handler(url, init?.body ? JSON.parse(String(init.body)) : ({} as GeminiRequest));
    }));
  }

  it('Gemini al limite giornaliero (anche l\'altro modello) → risponde Groq; la volta dopo si parte da Groq', async () => {
    stub((url) => {
      if (url.includes('generativelanguage') && url.includes('/models?')) {
        return json(200, { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] });
      }
      if (url.includes('generativelanguage')) return gemini429();
      if (url.endsWith('/models')) return json(200, { data: [{ id: 'llama-3.3-70b-versatile' }] });
      return json(200, { choices: [{ message: { content: 'Risposta di Groq.' }, finish_reason: 'stop' }] });
    });
    const { runAi } = await import('../src/lib/router');
    const notices: string[] = [];
    const a = await runAi(base(), { request: dbReq, timeoutMs: 5000, signal: new AbortController().signal, onNotice: (m) => notices.push(m) });
    expect(a).toMatchObject({ text: 'Risposta di Groq.', fornitore: 'groq', servizio: 'Groq', modello: 'llama-3.3-70b-versatile' });
    expect(notices[0]).toMatch(/Gemini: limite gratuito raggiunto su tutti i modelli provati \(gemini-2\.5-flash, gemini-2\.5-flash-lite\).*Provo con Groq/);
    expect(calls.filter((c) => c.includes(':generateContent'))).toHaveLength(2); // due modelli Gemini, quote separate

    calls = [];
    await runAi(base(), { request: dbReq, timeoutMs: 5000, signal: new AbortController().signal });
    expect(calls[0]).toBe('/openai/v1/chat/completions'); // Gemini saltato finché il limite non si azzera
  });

  it('foto: Groq senza modelli che leggono immagini → OpenRouter con un modello gratuito "vision"', async () => {
    stub((url, body) => {
      if (url.includes('generativelanguage')) return json(503, { error: { code: 503, status: 'UNAVAILABLE' } });
      if (url.includes('groq') && url.endsWith('/models')) return json(200, { data: [{ id: 'llama-3.3-70b-versatile' }] });
      if (url.includes('openrouter') && url.endsWith('/models')) {
        return json(200, { data: [{ id: 'google/gemma-3-27b-it:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'] } }] });
      }
      return json(200, { choices: [{ message: { content: `ok da ${body.model}` }, finish_reason: 'stop' }] });
    });
    const { runAi } = await import('../src/lib/router');
    const a = await runAi(base(), { request: buildDescribeRequest([img], ''), timeoutMs: 5000, signal: new AbortController().signal });
    expect(a).toMatchObject({ fornitore: 'openrouter', text: 'ok da google/gemma-3-27b-it:free' });
    expect(calls.filter((c) => c.includes('chat/completions'))).toEqual(['/api/v1/chat/completions']);
  });

  it('nessuna AI risponde → un solo messaggio con il motivo di ciascuna', async () => {
    stub((url) => url.includes('generativelanguage')
      ? json(503, { error: { code: 503 } })
      : url.endsWith('/models') ? json(200, { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'x:free', pricing: { prompt: '0', completion: '0' } }] })
        : json(401, { error: { message: 'Invalid API Key' } }));
    const { runAi } = await import('../src/lib/router');
    const err = await runAi(base(), { request: dbReq, timeoutMs: 5000, signal: new AbortController().signal }).catch((e) => e);
    expect(err.kind).toBe('sovraccarico');
    expect(err.message.split('\n')).toEqual([
      'Nessuna AI ha risposto:',
      expect.stringMatching(/^• Gemini: .*sovraccarico/i),
      expect.stringMatching(/^• Groq: chiave non valida/),
      expect.stringMatching(/^• OpenRouter: chiave non valida/)
    ]);
  });

  it('senza nessuna chiave: errore chiaro', async () => {
    const { runAi } = await import('../src/lib/router');
    await expect(runAi(base({ apiKey: '', riserve: {} }), { request: dbReq, timeoutMs: 5000, signal: new AbortController().signal }))
      .rejects.toMatchObject({ kind: 'chiave', message: expect.stringMatching(/Nessuna AI configurata/) });
  });
});

describe('OpenRouter con limite di spesa a 0 $', () => {
  it('messaggio con la soluzione, trattato come quota (il servizio viene messo in pausa)', () => {
    const e = classifyChatError('openrouter', 403, { error: { message: 'Key limit exceeded (total limit). Manage it using https://openrouter.ai/… $0.00 of $0.00 used; does not reset.', code: 403 } });
    expect(e.kind).toBe('quota');
    expect(e.message).toMatch(/limite di spesa a 0 \$.*Credit limit/);
  });
});
