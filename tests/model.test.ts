import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanModelName, rankModels, type ModelInfo } from '../src/shared/gemini.ts';

const m = (id: string): ModelInfo => ({ id, displayName: id });

describe('scelta del modello', () => {
  it('Flash stabile più recente in testa; esclusi immagini, audio, embedding, gemma', () => {
    const ranked = rankModels([
      'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview',
      'gemini-flash-latest', 'gemini-2.5-flash-image', 'text-embedding-004', 'gemini-3.0-flash', 'gemma-3-27b-it',
      'gemini-2.5-flash-preview-tts', 'gemini-3.0-flash-lite', 'gemini-live-2.5-flash'
    ].map(m)).map((x) => x.id);
    expect(ranked[0]).toBe('gemini-3.0-flash');
    expect(ranked.indexOf('gemini-3.0-flash-lite')).toBeLessThan(ranked.indexOf('gemini-2.5-pro'));
    expect(ranked.indexOf('gemini-3-flash-preview')).toBeGreaterThan(ranked.indexOf('gemini-2.0-flash'));
    for (const no of ['gemini-2.5-flash-image', 'text-embedding-004', 'gemma-3-27b-it', 'gemini-2.5-flash-preview-tts', 'gemini-live-2.5-flash']) {
      expect(ranked).not.toContain(no);
    }
  });
  it('nomi con prefisso models/', () => {
    expect(cleanModelName('models/gemini-3.0-flash')).toBe('gemini-3.0-flash');
  });
});

describe('modello ritirato: scelta automatica e nuovo tentativo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('404 sul modello → elenco dei modelli → riprova con il consigliato e lo salva', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes(':streamGenerateContent')) {
        if (url.includes('gemini-2.5-flash:')) {
          return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'models/gemini-2.5-flash is not found for API version v1beta' } }), { status: 404 });
        }
        return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Risposta.' }] }, finishReason: 'STOP' }] })}\n\n`, { status: 200 });
      }
      return new Response(JSON.stringify({
        models: [
          { name: 'models/gemini-3.0-flash', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-3.0-pro', displayName: 'Gemini 3 Pro', supportedGenerationMethods: ['generateContent'] }
        ]
      }), { status: 200 });
    }));
    const { updateSettings, getSettings } = await import('../src/lib/settings');
    await updateSettings({ apiKey: 'AIzaK', model: 'gemini-2.5-flash' });
    const { askDatabase } = await import('../src/lib/ai');
    const res = await askDatabase('domanda', [], await getSettings(), new AbortController().signal);
    expect(res.status).toBe('done');
    expect(calls.map((u) => u.replace(/^https:\/\/[^/]+\/v1beta/, ''))).toEqual([
      '/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      '/models?pageSize=200',
      '/models/gemini-3.0-flash:streamGenerateContent?alt=sse'
    ]);
    expect((await getSettings()).model).toBe('gemini-3.0-flash');
  });

  it('altri errori (es. quota) non cambiano il modello', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), { status: 429 })));
    const { updateSettings, getSettings } = await import('../src/lib/settings');
    await updateSettings({ apiKey: 'AIzaK', model: 'gemini-2.5-flash' });
    const { askDatabase } = await import('../src/lib/ai');
    const res = await askDatabase('domanda', [], await getSettings(), new AbortController().signal);
    expect(res.status === 'error' && res.error.kind).toBe('quota');
    expect((await getSettings()).model).toBe('gemini-2.5-flash');
  });
});

describe('quota esaurita: altri modelli Gemini e Gemma con la stessa chiave', () => {
  afterEach(() => vi.unstubAllGlobals());

  const list = {
    models: ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemma-3-27b-it', 'gemma-3-1b-it', 'gemma-3n-e4b-it']
      .map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] }))
  };
  const daily = (model: string, limit: number) => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: String(limit), quotaDimensions: { model } }] }
  ] } }), { status: 429 });

  it('alias e modello reale hanno la stessa quota; poi il Flash-Lite, poi Gemma (richiesta adattata)', async () => {
    const { resetModelState } = await import('../src/lib/model');
    resetModelState();
    const calls: { model: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/models?')) return new Response(JSON.stringify(list), { status: 200 });
      const model = url.match(/models\/([^:]+):/)![1];
      calls.push({ model, body: JSON.parse(String(init!.body)) });
      if (model === 'gemini-flash-latest' || model === 'gemini-3.8-flash') return daily('gemini-3.8-flash', 20);
      if (model === 'gemini-3.8-flash-lite') return daily('gemini-3.8-flash-lite', 20);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `ok da ${model}` }] }, finishReason: 'STOP' }] }), { status: 200 });
    }));
    const { updateSettings, getSettings } = await import('../src/lib/settings');
    await updateSettings({ apiKey: 'AIzaK', model: 'gemini-flash-latest' });
    const { runAi } = await import('../src/lib/router');
    (await import('../src/lib/router')).resetRouter();
    const { buildDescribeRequest } = await import('../src/shared/vision.ts');
    const req = buildDescribeRequest([{ mimeType: 'image/jpeg', data: 'AAAA' }], 'ponteggio');
    const a = await runAi(await getSettings(), { request: req, timeoutMs: 5000, signal: new AbortController().signal, thinking: 'minimal' });
    expect(a.text).toBe('ok da gemma-3-27b-it');
    expect(a.modello).toBe('gemma-3-27b-it');
    // il modello reale dell'alias non viene riprovato
    expect(calls.map((c) => c.model)).toEqual(['gemini-flash-latest', 'gemini-3.8-flash-lite', 'gemma-3-27b-it']);
    // Gemma: niente istruzioni di sistema, schema JSON o ragionamento; istruzioni all'inizio del messaggio, foto incluse
    const g = calls[2].body as { systemInstruction?: unknown; generationConfig: Record<string, unknown>; contents: { parts: Record<string, unknown>[] }[] };
    expect(g.systemInstruction).toBeUndefined();
    expect(g.generationConfig.responseSchema).toBeUndefined();
    expect(g.generationConfig.thinkingConfig).toBeUndefined();
    expect(String(g.contents[0].parts[0].text)).toMatch(/^ISTRUZIONI:[\s\S]*SOLO con un oggetto JSON/);
    expect(g.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
    expect((await getSettings()).model).toBe('gemini-flash-latest'); // il modello impostato non cambia

    // la volta dopo si parte direttamente da un modello con quota disponibile
    calls.length = 0;
    await runAi(await getSettings(), { request: req, timeoutMs: 5000, signal: new AbortController().signal });
    expect(calls.map((c) => c.model)).toEqual(['gemma-3-27b-it']);
  });

  it('compito leggero: prima un modello leggero; azzeramento giornaliero alle 8:05 UTC', async () => {
    const { resetModelState, withModelFallback, nextDailyReset } = await import('../src/lib/model');
    resetModelState();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(list), { status: 200 })));
    const { getSettings, updateSettings } = await import('../src/lib/settings');
    await updateSettings({ apiKey: 'AIzaK2', model: 'gemini-flash-latest' });
    const used = await withModelFallback(await getSettings(), async (m) => m, { leggero: true });
    expect(used).toBe('gemini-3.8-flash-lite');
    expect(new Date(nextDailyReset(Date.UTC(2026, 10, 1, 7, 0))).toISOString()).toBe('2026-11-01T08:05:00.000Z');
    expect(new Date(nextDailyReset(Date.UTC(2026, 10, 1, 9, 0))).toISOString()).toBe('2026-11-02T08:05:00.000Z');
  });
});
