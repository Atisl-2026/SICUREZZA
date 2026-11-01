import { describe, expect, it, vi } from 'vitest';
import {
  buildDbRequest, callGemini, classifyHttpError, streamGemini, thinkingConfigFor, type GeminiRequest
} from '../src/shared/gemini.ts';

const req = buildDbRequest('Come si chiedono le ferie?', [
  { recordId: 'ferie', titolo: 'Ferie', categoria: 'Procedure', fonte: '', data_aggiornamento: '', testo: 'Con 5 giorni di anticipo.' }
]);

const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join('');
const part = (text: string, extra: Record<string, unknown> = {}) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, ...extra }] });

/** Corpo che arriva a pezzi arbitrari (anche spezzando un evento a metà). */
function streamBody(text: string, pieces = 7, delayMs = 0) {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil(bytes.length / pieces);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (i >= bytes.length) return ctrl.close();
      ctrl.enqueue(bytes.slice(i, i + size));
      i += size;
    }
  });
}
const sseResponse = (body: string | ReadableStream<Uint8Array>) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

describe('risposta in tempo reale (streaming)', () => {
  it('unisce i pezzi, ignora il ragionamento e avvisa a ogni pezzo', async () => {
    const body = sse([
      { candidates: [{ content: { parts: [{ text: 'sto pensando…', thought: true }] } }] },
      part('Le ferie si chiedono '),
      part('con 5 giorni di anticipo '),
      part('[ferie].', { finishReason: 'STOP' })
    ]);
    const fetchImpl = vi.fn(async () => sseResponse(streamBody(body)));
    const seen: string[] = [];
    const a = await streamGemini(req, { apiKey: ' k ', model: 'models/gemini-2.5-flash', fetchImpl, onText: (t) => seen.push(t) });
    expect(a.text).toBe('Le ferie si chiedono con 5 giorni di anticipo [ferie].');
    expect(a.truncated).toBe(false);
    expect(seen.at(-1)).toBe(a.text);
    expect(seen.some((t) => t === 'Le ferie si chiedono ')).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(url).not.toContain('key=');
  });

  it('errore HTTP prima dello stream → errore classificato', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }));
    await expect(streamGemini(req, { apiKey: 'k', model: 'm', fetchImpl })).rejects.toMatchObject({ kind: 'quota' });
  });

  it('errore dentro lo stream → errore classificato', async () => {
    const body = sse([{ error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' } }]);
    const fetchImpl = vi.fn(async () => sseResponse(body));
    await expect(streamGemini(req, { apiKey: 'k', model: 'm', fetchImpl })).rejects.toMatchObject({ kind: 'sovraccarico' });
  });

  it('il tempo massimo vale per il silenzio: una risposta lunga ma continua non scade', async () => {
    const body = sse(Array.from({ length: 8 }, (_, i) => part(`pezzo ${i} `)));
    const fetchImpl = vi.fn(async () => sseResponse(streamBody(body, 8, 15)));
    const a = await streamGemini(req, { apiKey: 'k', model: 'm', fetchImpl, timeoutMs: 60 }); // ~120 ms in tutto
    expect(a.text).toContain('pezzo 7');
  });

  it('nessuna risposta entro il tempo → timeout', async () => {
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    await expect(streamGemini(req, { apiKey: 'k', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 }))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  it('connessione interrotta a metà: il testo già arrivato resta, segnato come troncato', async () => {
    let n = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (n++ === 0) ctrl.enqueue(new TextEncoder().encode(sse([part('Prima parte della risposta')])));
        else ctrl.error(new TypeError('network error'));
      }
    });
    const a = await streamGemini(req, { apiKey: 'k', model: 'm', fetchImpl: vi.fn(async () => sseResponse(body)) });
    expect(a.text).toBe('Prima parte della risposta');
    expect(a.truncated).toBe(true);
  });

  it('annullata dall\'utente', async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const p = streamGemini(req, { apiKey: 'k', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'annullata' });
  });
});

describe('ragionamento ridotto (risposte più rapide)', () => {
  it('parametro adatto a ogni famiglia di modelli', () => {
    expect(thinkingConfigFor('gemini-2.5-flash', 'minimal')).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor('models/gemini-2.5-flash-lite', 'low')).toEqual({ thinkingBudget: 512 });
    expect(thinkingConfigFor('gemini-2.5-pro', 'minimal')).toEqual({ thinkingBudget: 128 });
    expect(thinkingConfigFor('gemini-2.0-flash', 'low')).toBeUndefined();
    expect(thinkingConfigFor('gemini-1.5-flash', 'low')).toBeUndefined();
    expect(thinkingConfigFor('gemini-3-flash-preview', 'minimal')).toEqual({ thinkingLevel: 'minimal' });
    expect(thinkingConfigFor('gemini-flash-latest', 'low')).toEqual({ thinkingLevel: 'low' });
    expect(thinkingConfigFor('gemini-3-pro-preview', 'minimal')).toEqual({ thinkingLevel: 'low' });
  });

  it('inviato nella richiesta solo se chiesto', async () => {
    const bodies: GeminiRequest[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify(part('ok', { finishReason: 'STOP' })), { status: 200 });
    });
    await callGemini(req, { apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl, thinking: 'minimal' });
    await callGemini(req, { apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl });
    expect(bodies[0].generationConfig).toMatchObject({ thinkingConfig: { thinkingBudget: 0 } });
    expect(bodies[0].generationConfig).toMatchObject(req.generationConfig ?? {}); // le altre impostazioni restano
    expect(bodies[1].generationConfig?.thinkingConfig).toBeUndefined();
  });

  it('modello che rifiuta il parametro: riprova senza e lo ricorda', async () => {
    const bodies: GeminiRequest[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as GeminiRequest;
      bodies.push(b);
      return b.generationConfig?.thinkingConfig
        ? new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Thinking level is not supported for this model.' } }), { status: 400 })
        : new Response(JSON.stringify(part('ok', { finishReason: 'STOP' })), { status: 200 });
    });
    const opts = { apiKey: 'k', model: 'gemini-9-sperimentale', fetchImpl, thinking: 'low' as const };
    expect((await callGemini(req, opts)).text).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect((await callGemini(req, opts)).text).toBe('ok');
    expect(bodies).toHaveLength(3); // la seconda volta va diretto
  });

  it('un errore sul ragionamento non viene scambiato per "modello non trovato"', () => {
    const e = classifyHttpError(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Thinking budget is not supported by model gemini-x.' } });
    expect(e.kind).not.toBe('modello');
  });
});
