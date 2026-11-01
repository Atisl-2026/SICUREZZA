import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { chunksForRecord } from '../src/shared/chunk.ts';
import {
  buildIndex, candidates, containsPhrase, containsWordForm, EMPTY_DETAILED, normalizeForMatch, parseSimpleQuery,
  retrieve, toSearchDocs, type DetailedQuery
} from '../src/shared/search.ts';
import type { DbFile, StoredRecord } from '../src/shared/types.ts';

const sample: DbFile = JSON.parse(readFileSync('tests/fixtures/esempio.json', 'utf8'));
const catOf = new Map(sample.records.map((r) => [r.id, r.categoria]));

describe('sintassi nella casella di ricerca', () => {
  it('frasi tra virgolette (anche «») ed esclusioni', () => {
    expect(parseSimpleQuery('toner "stampa sicura" -cestini')).toEqual({ text: 'toner', phrases: ['stampa sicura'], exclude: ['cestini'] });
    expect(parseSimpleQuery('«messa a terra» impianto -"quadro elettrico"')).toEqual({ text: 'impianto', phrases: ['messa a terra'], exclude: ['quadro elettrico'] });
    expect(parseSimpleQuery('D.Lgs. 81-2008 anti-incendio')).toEqual({ text: 'D.Lgs. 81-2008 anti-incendio', phrases: [], exclude: [] });
  });
});

describe('confronti esatti', () => {
  it('frase: senza maiuscole, accenti e punteggiatura, ma a parole intere', () => {
    const t = normalizeForMatch('La stampa sicura: le stampe NON ritirate… Perché?');
    expect(containsPhrase(t, 'stampa  Sicura')).toBe(true);
    expect(containsPhrase(t, 'perche')).toBe(true);
    expect(containsPhrase(t, 'stamp')).toBe(false);
    expect(containsPhrase(t, 'sicura le stampe')).toBe(true);
  });
  it('parola in qualsiasi forma (singolare/plurale)', () => {
    expect(containsWordForm('Classi di fuoco ed estintori', 'estintore')).toBe(true);
    expect(containsWordForm('Classi di fuoco ed estintori', 'idrante')).toBe(false);
  });
});

describe('ricerca semplice più precisa e per argomento', () => {
  let index: ReturnType<typeof buildIndex>;
  beforeAll(() => {
    const chunks = sample.records.flatMap((r) => chunksForRecord(r.id, r.testo));
    index = buildIndex(toSearchDocs(chunks, new Map(sample.records.map((r) => [r.id, r]))));
  });

  it('prima i blocchi con tutte le parole', () => {
    const { results } = candidates(index, 'toner stampante');
    expect(results[0].id).toBe('schede-tecniche-stampante-multifunzione-mf200#0');
  });

  it('filtro per argomento (anche con maiuscole/accenti diversi)', () => {
    const faq = retrieve(index, 'stampante password badge', { categorie: ['faq'] });
    expect(faq.length).toBeGreaterThan(0);
    expect(faq.every((h) => catOf.get(h.recordId) === 'FAQ')).toBe(true);
    const proc = retrieve(index, 'toner', { categorie: ['Procedure'] });
    expect(proc.map((h) => h.recordId)).toEqual(['procedure-gestione-rifiuti-ufficio']);
    expect(retrieve(index, 'toner', { categorie: [] }).length).toBe(2);
  });
});

describe('nell\'app (IndexedDB): frasi, esclusioni, ricerca dettagliata', () => {
  beforeAll(async () => {
    const { clearAll, putRecords } = await import('../src/lib/db');
    await clearAll();
    await putRecords(sample.records.map((r): StoredRecord => ({ ...r, origine: 'remoto', salvato_il: 0 })));
  });
  const q = (p: Partial<DetailedQuery>): DetailedQuery => ({ ...EMPTY_DETAILED, ...p });
  const ids = (r: { results: { record: { id: string } }[] }) => [...new Set(r.results.map((x) => x.record.id))];

  it('casella semplice: "frase esatta" e -esclusione', async () => {
    const { searchLocal } = await import('../src/lib/search');
    expect((await searchLocal('"stampa sicura"')).map((r) => r.record.id)).toEqual(['schede-tecniche-stampante-multifunzione-mf200']);
    expect((await searchLocal('"stampa insicura"'))).toEqual([]);
    const senzaCestini = (await searchLocal('toner -cestini')).map((r) => r.record.id);
    expect(senzaCestini).toEqual(['schede-tecniche-stampante-multifunzione-mf200']);
  });

  it('tutte queste parole (nello stesso passaggio)', async () => {
    const { searchDetailed } = await import('../src/lib/search');
    expect(ids(await searchDetailed(q({ all: 'toner ricambio' })))).toEqual(['schede-tecniche-stampante-multifunzione-mf200']);
    expect((await searchDetailed(q({ all: 'toner veicolo' }))).totale).toBe(0);
  });

  it('frasi esatte multiple', async () => {
    const { searchDetailed } = await import('../src/lib/search');
    const r = await searchDetailed(q({ phrases: ['stampa sicura', 'toner in esaurimento'] }));
    expect(ids(r)).toEqual(['schede-tecniche-stampante-multifunzione-mf200']);
    expect((await searchDetailed(q({ phrases: ['stampa sicura', 'carta carburante'] }))).totale).toBe(0);
  });

  it('almeno una di queste + escludi', async () => {
    const { searchDetailed } = await import('../src/lib/search');
    const r = await searchDetailed(q({ any: 'badge ospite', none: 'smarrimento' }));
    const found = ids(r);
    expect(found).toContain('faq-badge-e-accessi-posso-far-entrare-un-ospite');
    expect(found).not.toContain('faq-badge-e-accessi-cosa-faccio-se-perdo-il-badge'); // contiene "smarrimento"
  });

  it('solo parole esatte: niente plurali né varianti', async () => {
    const { searchDetailed } = await import('../src/lib/search');
    const forme = ids(await searchDetailed(q({ all: 'estintori' })));
    expect(forme).toContain('schede-tecniche-registro-dispositivi-sicurezza'); // "Estintore a polvere"
    expect(forme).toContain('formazione-antincendio-punti-chiave');
    const esatte = ids(await searchDetailed(q({ all: 'estintori', exact: true })));
    expect(esatte).toEqual(['formazione-antincendio-punti-chiave']); // solo "estintori"
  });

  it('per argomento e campi vuoti', async () => {
    const { searchDetailed } = await import('../src/lib/search');
    expect(ids(await searchDetailed(q({ all: 'estintore' }), ['Formazione']))).toEqual(['formazione-antincendio-punti-chiave']);
    expect(await searchDetailed(q({ none: 'toner' }))).toEqual({ results: [], totale: 0 });
    expect(await searchDetailed(q({ all: 'il di la' }))).toEqual({ results: [], totale: 0 });
  });

  it('conteggio degli argomenti', async () => {
    const { categoryCounts } = await import('../src/lib/search');
    const c = await categoryCounts();
    expect(c.get('FAQ')).toBe(8);
    expect(c.get('Procedure')).toBe(2);
  });
});

describe('estratto centrato sulla frase cercata', () => {
  it('parte dalla frase esatta anche se altrove ci sono più parole singole', async () => {
    const { snippet, phraseIndex } = await import('../src/shared/search.ts');
    const text = 'Stampa a colori. Stampa veloce. Stampa fronte retro. '.repeat(8) + 'Le stampe restano in coda: è la Stampa  sicura del reparto. ' + 'Fine del testo. '.repeat(20);
    expect(phraseIndex(text, ['stampa sicura'])).toBe(text.indexOf('Stampa  sicura'));
    expect(phraseIndex(text, ['stampa sicur'])).toBe(-1); // parole intere
    const joined = snippet(text, ['stamp', 'sicur'], 200, ['stampa sicura']).map((s) => s.text).join('');
    expect(joined).toContain('Stampa  sicura');
  });
});
