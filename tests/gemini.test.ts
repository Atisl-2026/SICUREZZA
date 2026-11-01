import { describe, expect, it, vi } from 'vitest';
import {
  buildDbRequest, buildWebRequest, callGemini, checkModel, citedIds, classifyHttpError, cleanModelName,
  GEMINI_ENDPOINT, GeminiError, parseGeminiResponse, splitCitations, type ContextBlock
} from '../src/shared/gemini.ts';
import { parseInline, parseMarkdown } from '../src/shared/markdown.ts';
import { shouldDisableWeb } from '../src/lib/ai';

const blocks: ContextBlock[] = [
  { recordId: 'procedure-richiesta-ferie', titolo: 'Richiesta di ferie', categoria: 'Procedure', fonte: 'ferie.pdf', data_aggiornamento: '2026-09-15', testo: 'Le ferie si richiedono con 5 giorni di anticipo.' },
  { recordId: 'faq-rol', titolo: 'Permessi ROL', categoria: 'FAQ', fonte: '', data_aggiornamento: '', testo: 'I ROL si chiedono 24 ore prima.' }
];
const ids = new Set(blocks.map((b) => b.recordId));

// Risposta reale di esempio (struttura dell'API v1beta generateContent)
const dbResponse = {
  candidates: [{
    content: { role: 'model', parts: [{ text: 'Le ferie vanno chieste con **5 giorni** di anticipo [procedure-richiesta-ferie].\n\n- I ROL: 24 ore prima [faq-rol]' }] },
    finishReason: 'STOP',
    index: 0
  }],
  usageMetadata: { promptTokenCount: 420, candidatesTokenCount: 40, totalTokenCount: 460 },
  modelVersion: 'gemini-2.5-flash'
};

const webResponse = {
  candidates: [{
    content: { role: 'model', parts: [{ text: 'Secondo il sito ufficiale, il termine è il 30 giugno.' }] },
    finishReason: 'STOP',
    groundingMetadata: {
      webSearchQueries: ['termine ferie non godute 30 giugno'],
      searchEntryPoint: { renderedContent: '<style>.chip{}</style><div class="chip"><a href="https://www.google.com/search?q=x">x</a></div>' },
      groundingChunks: [
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: 'lavoro.gov.it' } },
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB', title: 'inps.it' } },
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: 'lavoro.gov.it' } }
      ],
      groundingSupports: [{ segment: { startIndex: 0, endIndex: 50, text: '…' }, groundingChunkIndices: [0, 1] }]
    }
  }]
};

describe('richieste', () => {
  it('Dal database: istruzioni di sistema, blocchi con id e poi la domanda, nessuno strumento', () => {
    const req = buildDbRequest('  Come chiedo le ferie? ', blocks);
    const sys = req.systemInstruction!.parts[0].text;
    expect(sys).toMatch(/in italiano/);
    expect(sys).toMatch(/SOLO le informazioni contenute nei BLOCCHI/);
    expect(sys).toMatch(/dillo chiaramente/);
    expect(sys).toMatch(/id del record/);
    expect(sys).toMatch(/non inventare/i);
    const text = (req.contents[0].parts[0] as { text: string }).text;
    expect(text).toContain('id: procedure-richiesta-ferie');
    expect(text).toContain('id: faq-rol');
    expect(text).toContain('aggiornato: 2026-09-15');
    expect(text.indexOf('Le ferie si richiedono')).toBeLessThan(text.indexOf('DOMANDA: Come chiedo le ferie?'));
    expect(text.endsWith('DOMANDA: Come chiedo le ferie?')).toBe(true);
    expect(req.tools).toBeUndefined();
  });

  it('Dal web: strumento google_search', () => {
    const req = buildWebRequest('Termine ferie non godute?');
    expect(req.tools).toEqual([{ google_search: {} }]);
    expect((req.contents[0].parts[0] as { text: string }).text).toBe('Termine ferie non godute?');
  });

  it('cleanModelName', () => {
    expect(cleanModelName(' models/gemini-2.5-pro ')).toBe('gemini-2.5-pro');
    expect(cleanModelName('')).toBe('gemini-flash-latest');
  });
});

describe('parsing delle risposte', () => {
  it('estrae il testo', () => {
    const a = parseGeminiResponse(dbResponse);
    expect(a.text).toMatch(/^Le ferie vanno chieste/);
    expect(a.truncated).toBe(false);
    expect(a.sources).toEqual([]);
  });

  it('unisce più parti e ignora quelle di "ragionamento"', () => {
    const a = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'pensiero interno', thought: true }, { text: 'Prima ' }, { text: 'parte.' }] }, finishReason: 'STOP' }]
    });
    expect(a.text).toBe('Prima parte.');
  });

  it('segnala le risposte troncate', () => {
    const a = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'Testo parz' }] }, finishReason: 'MAX_TOKENS' }] });
    expect(a.truncated).toBe(true);
  });

  it('grounding: fonti web senza duplicati, query e suggerimenti di ricerca', () => {
    const a = parseGeminiResponse(webResponse);
    expect(a.sources).toEqual([
      { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: 'lavoro.gov.it' },
      { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB', title: 'inps.it' }
    ]);
    expect(a.searchQueries).toEqual(['termine ferie non godute 30 giugno']);
    expect(a.searchEntryPoint).toContain('google.com/search');
  });

  it('fonte senza titolo: usa il dominio', () => {
    const a = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'x' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.esempio.it/pagina' } }] } }] });
    expect(a.sources[0].title).toBe('www.esempio.it');
  });

  it('errori: richiesta bloccata, risposta vuota, filtri di sicurezza', () => {
    const kind = (j: unknown) => { try { parseGeminiResponse(j); return 'ok'; } catch (e) { return (e as GeminiError).kind; } };
    expect(kind({ promptFeedback: { blockReason: 'SAFETY' } })).toBe('bloccata');
    expect(kind({})).toBe('vuota');
    expect(kind(null)).toBe('vuota');
    expect(kind({ candidates: [{ finishReason: 'SAFETY' }] })).toBe('bloccata');
    expect(kind({ candidates: [{ content: { parts: [] }, finishReason: 'RECITATION' }] })).toBe('bloccata');
    expect(kind({ candidates: [{ content: { parts: [{ text: '   ' }] }, finishReason: 'STOP' }] })).toBe('vuota');
  });
});

describe('citazioni', () => {
  it('riconosce solo gli id noti', () => {
    const parts = splitCitations('Vero [procedure-richiesta-ferie]. Falso [record-inventato]. Nota [1].', ids);
    expect(parts).toEqual([
      { type: 'text', text: 'Vero ' },
      { type: 'cite', ids: ['procedure-richiesta-ferie'] },
      { type: 'text', text: '. Falso [record-inventato]. Nota [1].' }
    ]);
  });

  it('accetta varianti: più id, prefisso "id:", citazioni consecutive', () => {
    expect(citedIds('A [id: faq-rol, procedure-richiesta-ferie]', ids)).toEqual(['faq-rol', 'procedure-richiesta-ferie']);
    expect(splitCitations('B [faq-rol][procedure-richiesta-ferie].', ids)).toEqual([
      { type: 'text', text: 'B ' },
      { type: 'cite', ids: ['faq-rol', 'procedure-richiesta-ferie'] },
      { type: 'text', text: '.' }
    ]);
    expect(citedIds('C [`faq-rol`; procedure-richiesta-ferie]', ids)).toEqual(['faq-rol', 'procedure-richiesta-ferie']);
  });

  it('non scambia i link markdown per citazioni', () => {
    expect(citedIds('[faq-rol](https://x.it)', ids)).toEqual([]);
  });

  it('elenca gli id citati in ordine di comparsa, senza doppioni', () => {
    expect(citedIds(dbResponse.candidates[0].content.parts[0].text + ' ancora [procedure-richiesta-ferie]', ids))
      .toEqual(['procedure-richiesta-ferie', 'faq-rol']);
  });
});

describe('markdown delle risposte', () => {
  it('paragrafi, elenchi, titoli', () => {
    const b = parseMarkdown('## Requisiti\nRiga uno\nriga due\n\n- primo\n- secondo\n  continua\n\n3. terzo\n4. quarto', ids);
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol']);
    expect(b[1].t === 'p' && b[1].lines.length).toBe(2);
    expect(b[2].t === 'ul' && b[2].items[1]).toEqual([{ t: 'text', v: 'secondo continua' }]);
    expect(b[3].t === 'ol' && b[3].start).toBe(3);
  });

  it('grassetto, corsivo, codice, link e citazioni (anche dentro il grassetto)', () => {
    expect(parseInline('**5 giorni [faq-rol]** e *subito* `cod` [sito](https://a.it) https://b.it/x.', ids)).toEqual([
      { t: 'strong', c: [{ t: 'text', v: '5 giorni ' }, { t: 'cite', ids: ['faq-rol'] }] },
      { t: 'text', v: ' e ' },
      { t: 'em', c: [{ t: 'text', v: 'subito' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'cod' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://a.it', c: [{ t: 'text', v: 'sito' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://b.it/x', c: [{ t: 'text', v: 'https://b.it/x' }] },
      { t: 'text', v: '.' }
    ]);
  });

  it('non tratta come corsivo asterischi dentro le parole o moltiplicazioni', () => {
    expect(parseInline('2*3*4 e a*b*c')).toEqual([{ t: 'text', v: '2*3*4 e a*b*c' }]);
  });

  it('non accetta link pericolosi', () => {
    const r = parseInline('[clic](javascript:alert(1))');
    expect(r.some((n) => n.t === 'link')).toBe(false);
  });
});

describe('errori HTTP', () => {
  // corpo reale restituito dall'API con una chiave non valida
  const invalidKey = {
    error: {
      code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }]
    }
  };

  it.each([
    [400, invalidKey, 'chiave'],
    [429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota' } }, 'quota'],
    [404, { error: { code: 404, status: 'NOT_FOUND', message: 'models/gemini-9 is not found for API version v1beta' } }, 'modello'],
    [403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Method doesn\'t allow unregistered callers' } }, 'chiave'],
    [400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } }, 'regione'],
    [400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Search Grounding is not supported.' } }, 'non-supportato'],
    [400, { error: { code: 400, message: 'google_search tool is not enabled for this model' } }, 'non-supportato'],
    [503, { error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' } }, 'sovraccarico'],
    [500, null, 'sovraccarico'],
    [418, null, 'sconosciuto']
  ])('HTTP %i → %s', (status, body, kind) => {
    const e = classifyHttpError(status as number, body);
    expect(e.kind).toBe(kind);
    expect(e.message).toBeTruthy();
  });

  it('il messaggio di quota spiega cosa fare', () => {
    expect(classifyHttpError(429, {}).message).toMatch(/riprova tra un minuto/i);
    expect(classifyHttpError(429, {}).message).toMatch(/separato da quello dell'app Gemini/);
  });

  // forma reale del 429 dell'API Gemini (QuotaFailure + RetryInfo)
  const quota429 = (quotaId: string, value: string, delay = '39s') => ({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: `You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ${value}, model: gemini-2.5-flash\nPlease retry in 39.6s.`,
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId, quotaDimensions: { location: 'global', model: 'gemini-2.5-flash' }, quotaValue: value }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }
      ]
    }
  });

  it('limite al minuto: quale modello, quante richieste, quanto aspettare', () => {
    const e = classifyHttpError(429, quota429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '10'));
    expect(e.kind).toBe('quota');
    expect(e.quota).toEqual({ periodo: 'minuto', limite: 10, modello: 'gemini-2.5-flash', attesaS: 39 });
    expect(e.message).toMatch(/troppe richieste in un minuto.*gemini-2\.5-flash.*massimo 10 al minuto.*Riprova tra 39 secondi/);
  });

  it('limite giornaliero e modello escluso dal piano gratuito', () => {
    const day = classifyHttpError(429, quota429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '250'));
    expect(day.quota).toMatchObject({ periodo: 'giorno', limite: 250 });
    expect(day.message).toMatch(/limite giornaliero gratuito.*250 richieste al giorno.*9 del mattino/);
    const zero = classifyHttpError(429, quota429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '0'));
    expect(zero.message).toMatch(/non è incluso nel piano gratuito/);
  });

  it('disattiva la verifica web per quota e modello/strumento non supportato, non per errori temporanei', () => {
    expect(shouldDisableWeb(new GeminiError('quota', ''))).toBe(true);
    expect(shouldDisableWeb(new GeminiError('non-supportato', ''))).toBe(true);
    expect(shouldDisableWeb(new GeminiError('modello', ''))).toBe(true);
    expect(shouldDisableWeb(new GeminiError('rete', ''))).toBe(false);
    expect(shouldDisableWeb(new GeminiError('sovraccarico', '', 503))).toBe(false);
  });
});

describe('chiamata HTTP (fetch simulato)', () => {
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('POST all\'endpoint corretto con la chiave nell\'intestazione (non nell\'URL)', async () => {
    const fetchImpl = vi.fn(() => json(200, dbResponse));
    const a = await callGemini(buildDbRequest('q', blocks), { apiKey: ' AIzaTEST ', model: 'models/gemini-2.5-flash', fetchImpl });
    expect(a.text).toContain('5 giorni');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GEMINI_ENDPOINT}/models/gemini-2.5-flash:generateContent`);
    expect(url).not.toContain('AIza');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaTEST');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).systemInstruction).toBeTruthy();
  });

  it('429 → GeminiError quota', async () => {
    const fetchImpl = vi.fn(() => json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }));
    await expect(callGemini(buildWebRequest('q'), { apiKey: 'k', model: 'm', fetchImpl })).rejects.toMatchObject({ kind: 'quota' });
  });

  it('chiave mancante: errore senza chiamare la rete', async () => {
    const fetchImpl = vi.fn();
    await expect(callGemini(buildWebRequest('q'), { apiKey: '  ', model: 'm', fetchImpl })).rejects.toMatchObject({ kind: 'chiave' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rete assente → rete', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(callGemini(buildWebRequest('q'), { apiKey: 'k', model: 'm', fetchImpl })).rejects.toMatchObject({ kind: 'rete' });
  });

  it('timeout → timeout', async () => {
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    await expect(callGemini(buildWebRequest('q'), { apiKey: 'k', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 }))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  it('annullata dall\'utente (nuova domanda) → annullata', async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const p = callGemini(buildWebRequest('q'), { apiKey: 'k', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'annullata' });
  });

  it('checkModel usa GET sul modello', async () => {
    const fetchImpl = vi.fn(() => json(200, { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }));
    const info = await checkModel({ apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl });
    expect(info.displayName).toBe('Gemini 2.5 Flash');
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('GET');
  });
});
