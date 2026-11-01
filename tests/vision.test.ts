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
      descrizione: 'x', tipo_opera: '', elementi: [], parole_chiave: [], limiti: ''
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
    const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1
        ? reply(JSON.stringify({ descrizione: 'Corridoio con estintore a polvere a parete.', tipo_opera: 'ufficio', elementi: ['estintore'], parole_chiave: ['estintore', 'antincendio'], limiti: '' }))
        : reply('### Cosa si vede\nUn estintore.\n\n### Possibili non conformità\n1. **Cartello mancante** — … *Riferimento*: [formazione-antincendio-punti-chiave]');
    }));

    const { analyzePhotos } = await import('../src/lib/photo');
    const steps: string[] = [];
    const r = await analyzePhotos([img], 'corridoio piano terra', { apiKey: 'k', model: 'gemini-2.5-flash', autoCheck: true, webCheck: false, categorie: [] }, new AbortController().signal, (s) => steps.push(s));

    expect(steps).toEqual(['descrizione', 'ricerca', 'analisi']);
    expect(bodies).toHaveLength(2);
    expect(bodies.every((b) => 'inlineData' in b.contents[0].parts[0])).toBe(true);
    const ids = r.results.map((x) => x.record.id);
    expect(ids).toContain('schede-tecniche-registro-dispositivi-sicurezza');
    expect(ids).toContain('formazione-antincendio-punti-chiave');
    expect(textOf(bodies[1])).toContain('id: formazione-antincendio-punti-chiave');
    expect(r.answer.text).toContain('[formazione-antincendio-punti-chiave]');
  });

  it('quota esaurita al primo passo → errore chiaro, nessuna seconda chiamata', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }));
    vi.stubGlobal('fetch', f);
    const { analyzePhotos } = await import('../src/lib/photo');
    await expect(analyzePhotos([img], '', { apiKey: 'k', model: 'm', autoCheck: true, webCheck: false, categorie: [] }, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'quota' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
