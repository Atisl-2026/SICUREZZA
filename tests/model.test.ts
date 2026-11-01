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
      if (url.includes(':generateContent')) {
        if (url.includes('gemini-2.5-flash:')) {
          return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'models/gemini-2.5-flash is not found for API version v1beta' } }), { status: 404 });
        }
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Risposta.' }] }, finishReason: 'STOP' }] }), { status: 200 });
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
      '/models/gemini-2.5-flash:generateContent',
      '/models?pageSize=200',
      '/models/gemini-3.0-flash:generateContent'
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
