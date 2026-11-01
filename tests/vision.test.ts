import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeminiRequest } from '../src/shared/gemini.ts';
import {
  buildAnalysisRequest, buildDescribeRequest, parseDescription, photoSearchQuery, SYSTEM_PHOTO_ANALYSIS, type PhotoDescription
} from '../src/shared/vision.ts';
import type { DbFile, StoredRecord } from '../src/shared/types.ts';

const img = { mimeType: 'image/jpeg', data: 'AAAA' };
const desc: PhotoDescription = {
  descrizione: 'Ponteggio metallico su facciata, un impalcato senza parapetto.',
  tipo_opera: 'ponteggio metallico fisso',
  elementi: ['impalcato', 'parapetto mancante'],
  parole_chiave: ['ponteggio', 'parapetto', 'tavola fermapiede', 'Ponteggio'],
  limiti: 'Ancoraggi non visibili.'
};
const partsOf = (r: GeminiRequest) => r.contents[0].parts;
const textOf = (r: GeminiRequest) => (partsOf(r).find((p) => 'text' in p) as { text: string }).text;

describe('richieste per le foto', () => {
  it('passo 1: immagini, nota e risposta JSON strutturata', () => {
    const r = buildDescribeRequest([img, img], ' ponteggio facciata nord ');
    expect(partsOf(r).slice(0, 2)).toEqual([{ inlineData: img }, { inlineData: img }]);
    expect(textOf(r)).toContain('Nota dell\'ispettore: ponteggio facciata nord');
    expect(r.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    expect((r.generationConfig!.responseSchema as { required: string[] }).required).toContain('parole_chiave');
    expect(r.generationConfig!.maxOutputTokens).toBeLessThanOrEqual(2048); // risposta breve = più veloce
  });

  it('passo 2: immagini + brani con id + regole (solo fonti dell\'archivio)', () => {
    const r = buildAnalysisRequest([img], 'ponteggio', desc, [
      { recordId: 'normativa-ponteggi', titolo: 'Ponteggi', categoria: 'Normativa', fonte: '', data_aggiornamento: '', testo: 'Gli impalcati devono avere parapetto.' }
    ]);
    expect(partsOf(r)[0]).toEqual({ inlineData: img });
    expect(textOf(r)).toContain('id: normativa-ponteggi');
    expect(textOf(r)).toContain('LIMITI GIÀ RILEVATI: Ancoraggi non visibili.');
    const sys = r.systemInstruction!.parts[0].text;
    expect(sys).toBe(SYSTEM_PHOTO_ANALYSIS);
    expect(sys).toMatch(/non presente nell'archivio/);
    expect(sys).toMatch(/NON citare articoli/);
    expect(sys).toMatch(/### Possibili non conformità/);
  });

  it('passo 2 senza brani: chiede di non citare riferimenti', () => {
    expect(textOf(buildAnalysisRequest([img], '', desc, []))).toMatch(/nessun brano pertinente trovato/);
  });
});

describe('lettura della descrizione', () => {
  const json = JSON.stringify(desc);
  it('JSON pulito, tra ``` o con testo attorno', () => {
    expect(parseDescription(json).tipo_opera).toBe('ponteggio metallico fisso');
    expect(parseDescription('```json\n' + json + '\n```').parole_chiave).toContain('parapetto');
    expect(parseDescription('Ecco il risultato: ' + json + ' Fine.').elementi).toEqual(['impalcato', 'parapetto mancante']);
  });
  it('risposta non strutturata: diventa la descrizione', () => {
    const d = parseDescription('Si vede un ponteggio senza parapetti.');
    expect(d.descrizione).toBe('Si vede un ponteggio senza parapetti.');
    expect(d.parole_chiave).toEqual([]);
  });
  it('campi mancanti o sbagliati non rompono nulla', () => {
    expect(parseDescription('{"descrizione": "x", "parole_chiave": "non una lista"}')).toEqual({
      descrizione: 'x', tipo_opera: '', elementi: [], parole_chiave: [], criticita: [], limiti: ''
    });
  });
  it('query di ricerca: nota, tipo di opera e parole chiave senza doppioni', () => {
    expect(photoSearchQuery(desc, 'facciata nord')).toBe(
      'facciata nord, ponteggio metallico fisso, ponteggio, parapetto, tavola fermapiede, impalcato, parapetto mancante'
    );
  });
});

describe('analisi completa (Gemini simulato, archivio di esempio)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('descrive, cerca nell\'archivio e analizza con i brani trovati', async () => {
    const sample: DbFile = JSON.parse(readFileSync('tests/fixtures/esempio.json', 'utf8'));
    const { clearAll, putRecords } = await import('../src/lib/db');
    await clearAll();
    await putRecords(sample.records.map((r): StoredRecord => ({ ...r, origine: 'remoto', salvato_il: 0 })));

    const bodies: GeminiRequest[] = [];
    const urls: string[] = [];
    const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 });
    const sse = (...texts: string[]) => new Response(
      texts.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`).join(''),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
    (await import('../src/lib/model')).resetModelState();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('/models?')) {
        return new Response(JSON.stringify({ models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }
        ] }), { status: 200 });
      }
      urls.push(url);
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1
        ? reply(JSON.stringify({ descrizione: 'Corridoio con estintore a polvere a parete.', tipo_opera: 'ufficio', elementi: ['estintore'], parole_chiave: ['estintore', 'antincendio'], limiti: '' }))
        : sse('### Cosa si vede\nUn estintore.\n\n', '### Possibili non conformità\n1. **Cartello mancante** — … *Riferimento*: [formazione-antincendio-punti-chiave]');
    }));

    const { analyzePhotos } = await import('../src/lib/photo');
    const steps: string[] = [];
    const partial: string[] = [];
    const photo = { ...img, small: { mimeType: 'image/jpeg', data: 'BBBB' } };
    const r = await analyzePhotos(
      [photo], 'corridoio piano terra', { apiKey: 'k', model: 'gemini-2.5-flash', autoCheck: true, webCheck: false, categorie: [], documento: '', riserve: {} },
      new AbortController().signal, (s) => steps.push(s), (t, results) => partial.push(`${results.length}:${t}`)
    );

    expect(steps).toEqual(['descrizione', 'ricerca', 'analisi']);
    expect(bodies).toHaveLength(2);
    // passo 1: foto piccola, ragionamento minimo, chiamata normale; passo 2: foto intera, in tempo reale
    expect(bodies[0].contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } });
    expect(bodies[0].generationConfig).toMatchObject({ thinkingConfig: { thinkingBudget: 0 } });
    expect(urls[0]).toMatch(/gemini-2\.5-flash-lite:generateContent$/); // passo 1 con un modello leggero
    expect(urls[1]).toMatch(/gemini-2\.5-flash:streamGenerateContent/); // analisi con il modello principale
    expect(bodies[1].contents[0].parts[0]).toEqual({ inlineData: img });
    expect(bodies[1].generationConfig).toMatchObject({ thinkingConfig: { thinkingBudget: 512 } });
    expect(urls[1]).toMatch(/:streamGenerateContent\?alt=sse$/);
    const ids = r.results.map((x) => x.record.id);
    expect(ids).toContain('schede-tecniche-registro-dispositivi-sicurezza');
    expect(ids).toContain('formazione-antincendio-punti-chiave');
    expect(textOf(bodies[1])).toContain('id: formazione-antincendio-punti-chiave');
    expect(r.answer.text).toContain('[formazione-antincendio-punti-chiave]');
    expect(partial).toHaveLength(2);
    expect(partial[0]).toBe(`${r.results.length}:### Cosa si vede\nUn estintore.\n\n`);
  });

  it('lettura rapida non riuscita (sovraccarico) → l\'analisi prosegue con la nota', async () => {
    const bodies: GeminiRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('/models?')) {
        return new Response(JSON.stringify({ models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }
        ] }), { status: 200 });
      }
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) return new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }), { status: 503 });
      return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '### Cosa si vede\nUn estintore.' }] }, finishReason: 'STOP' }] })}\n\n`, { status: 200 });
    }));
    const { analyzePhotos } = await import('../src/lib/photo');
    const r = await analyzePhotos([img], 'estintore', { apiKey: 'k', model: 'gemini-2.5-flash', autoCheck: true, webCheck: false, categorie: [], documento: '', riserve: {} }, new AbortController().signal);
    expect(bodies).toHaveLength(2);
    expect(r.query).toBe('estintore');
    expect(textOf(bodies[1])).not.toContain('DESCRIZIONE PRELIMINARE');
    expect(r.answer.text).toContain('Un estintore');
  });

  it('quota esaurita al primo passo → errore chiaro, nessuna seconda chiamata', async () => {
    (await import('../src/lib/model')).resetModelState();
    (await import('../src/lib/router')).resetRouter();
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }));
    vi.stubGlobal('fetch', f);
    const { analyzePhotos } = await import('../src/lib/photo');
    await expect(analyzePhotos([img], '', { apiKey: 'k', model: 'm', autoCheck: true, webCheck: false, categorie: [], documento: '', riserve: {} }, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'quota' });
    // una sola richiesta di generazione (più l'elenco dei modelli, per provarne uno con quota propria)
    expect(f.mock.calls.filter((c) => /generateContent/i.test(String((c as unknown[])[0])))).toHaveLength(1);
  });
});

describe('criticità: ricerca per singola criticità e riferimenti suggeriti', () => {
  const risposta = `### Cosa si vede
Ponteggio metallico.

### Possibili non conformità
1. **Assenza o incompletezza dei parapetti di protezione sul ponteggio** — Gli impalcati sembrano privi di parapetti completi. *Gravità*: alta. *Riferimento*: non presente nell'archivio.
2. **Mancanza di mantovana parasassi** — Non si vedono mantovane. *Gravità*: media. *Riferimento*: Art. 129 – «Testo unico» [tu81]
3. **Materiali depositati sull'impalcato** — Carriola e materiali sul ponte. *Gravità*: media. *Riferimento*: "non presente nell'archivio"

### Non valutabile dalle immagini
- Ancoraggi`;

  it('legge le criticità della risposta e quelle senza riferimento', async () => {
    const { findingsOf } = await import('../src/shared/vision.ts');
    const f = findingsOf(risposta);
    expect(f.map((x) => x.titolo)).toEqual([
      'Assenza o incompletezza dei parapetti di protezione sul ponteggio', 'Mancanza di mantovana parasassi', 'Materiali depositati sull\'impalcato'
    ]);
    expect(f.map((x) => x.senzaRiferimento)).toEqual([true, false, true]);
    expect(f[0].query).toMatch(/parapetti.*ponteggio.*impalcati/);
    expect(f[0].query).not.toMatch(/Gravit/);
  });

  it('l\'archivio viene cercato criticità per criticità; i riferimenti mancanti vengono suggeriti', async () => {
    const { clearAll, putRecords } = await import('../src/lib/db');
    await clearAll();
    const lungo = (x: string) => `${x} `.repeat(12).trim();
    const testo = [
      `Articolo 122 - Ponteggi ed opere provvisionali\n1. ${lungo('Nei lavori in quota devono essere adottate adeguate impalcature o ponteggi.')}`,
      `Articolo 124 - Deposito di materiali sulle impalcature\n1. ${lungo('Sopra i ponti di servizio e sulle impalcature è vietato qualsiasi deposito, eccettuato quello temporaneo dei materiali ed attrezzi necessari ai lavori.')}`,
      `Articolo 126 - Parapetti\n1. ${lungo('Gli impalcati e ponti di servizio posti ad altezza maggiore di 2 metri devono essere provvisti di parapetto e tavola fermapiede.')}`,
      `Articolo 129 - Impalcature nelle costruzioni\n1. ${lungo('Il ponteggio deve essere munito di mantovana parasassi a protezione contro la caduta di materiali.')}`
    ].join('\n\n');
    await putRecords([{ id: 'tu81', titolo: 'D.lgs. 81/08', testo, categoria: 'Normativa', tag: [], fonte: 'TU-81-08.pdf', data_aggiornamento: '', origine: 'remoto', salvato_il: 0 }]);
    const { photoRetrieval, suggestReferences } = await import('../src/lib/photo');
    const { passageInfo } = await import('../src/lib/articles');
    const { results, query } = await photoRetrieval({
      descrizione: 'Ponteggio su facciata', tipo_opera: 'cantiere edile', elementi: ['carriola'], parole_chiave: ['ponteggio'], limiti: '',
      criticita: ['parapetto mancante sul ponteggio', 'deposito di materiali sull\'impalcato', 'mantovana parasassi assente']
    }, '');
    expect(query).toMatch(/parapetto mancante.*·.*mantovana/);
    const labels = new Set(results.flatMap((r) => passageInfo(r).articoli.filter((a) => a.conParola).map((a) => a.section.label)));
    for (const l of ['Art. 124', 'Art. 126', 'Art. 129']) expect(labels).toContain(l);

    const sugg = await suggestReferences(risposta);
    expect(sugg.map((x) => x.titolo)).toEqual(['Assenza o incompletezza dei parapetti di protezione sul ponteggio', 'Materiali depositati sull\'impalcato']);
    const art = (i: number) => sugg[i].results.flatMap((r) => passageInfo(r).articoli.map((a) => a.section.label));
    expect(art(0)).toContain('Art. 126');
    expect(art(1)).toContain('Art. 124');
  });
});
