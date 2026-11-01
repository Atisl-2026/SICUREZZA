import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { chunksForRecord } from '../src/shared/chunk.ts';
import {
  buildIndex, highlight, loadIndex, processTerm, queryTerms, retrieve, snippet, stemIt, tokenize, toSearchDocs
} from '../src/shared/search.ts';
import type { DbFile, DbRecord } from '../src/shared/types.ts';

const marked = (segs: { text: string; mark: boolean }[]) => segs.filter((s) => s.mark).map((s) => s.text);

describe('analisi del testo italiano', () => {
  it('tokenize separa su punteggiatura e apostrofi, tiene le cifre', () => {
    expect(tokenize("L'estintore n°12 (D.Lgs. 81/2008) è qui")).toEqual(['L', 'estintore', 'n', '12', 'D', 'Lgs', '81', '2008', 'è', 'qui']);
  });

  it('processTerm: minuscole, accenti, stopword', () => {
    expect(processTerm('Perché')).toBeNull();
    expect(processTerm('della')).toBeNull();
    expect(processTerm("l")).toBeNull();
    expect(processTerm('È')).toBeNull();
    expect(processTerm('Città')).toBe('citt');
    expect(processTerm('2008')).toBe('2008');
  });

  it('stemIt unifica singolare/plurale e maschile/femminile', () => {
    expect(stemIt('veicolo')).toBe(stemIt('veicoli'));
    expect(stemIt('estintore')).toBe(stemIt('estintori'));
    expect(stemIt('banca')).toBe(stemIt('banche'));
    expect(stemIt('elettrico')).toBe(stemIt('elettriche'));
    expect(stemIt('ponteggio')).toBe(stemIt('ponteggi'));
    expect(stemIt('rischio')).toBe(stemIt('rischi'));
    expect(stemIt('obbligo')).toBe(stemIt('obblighi'));
    expect(stemIt('ufficio')).toBe(stemIt('uffici'));
    expect(stemIt('principio')).toBe(stemIt('principi'));
    expect(stemIt('preposto')).toBe(stemIt('preposti'));
    expect(stemIt('ponteggio')).not.toBe(stemIt('ponte'));
    expect(stemIt('sport')).toBe('sport');
    expect(stemIt('mf200')).toBe('mf200');
  });

  it('queryTerms mostra solo le parole significative', () => {
    expect(queryTerms('Come posso chiedere le ferie?')).toEqual(['chiedere', 'ferie']);
  });
});

describe('ricerca sui contenuti di esempio', () => {
  let records: DbRecord[];
  let index: ReturnType<typeof buildIndex>;
  const top = (q: string) => retrieve(index, q)[0]?.recordId;

  beforeAll(() => {
    const db: DbFile = JSON.parse(readFileSync('tests/fixtures/esempio.json', 'utf8'));
    records = db.records;
    const chunks = records.flatMap((r) => chunksForRecord(r.id, r.testo));
    index = buildIndex(toSearchDocs(chunks, new Map(records.map((r) => [r.id, r]))));
  });

  it('trova il documento giusto per domande in linguaggio naturale', () => {
    expect(top('Come chiedo le ferie?')).toBe('procedure-richiesta-ferie');
    expect(top('cosa fare in caso di incendio')).toBe('formazione-antincendio-punti-chiave');
    expect(top("ho preso una multa con l'auto aziendale")).toBe('normativa-regolamento-veicoli-aziendali');
    expect(top('il badge non apre la porta')).toBe('faq-badge-e-accessi-il-badge-non-apre-la-porta-del-mio-piano-perche');
    expect(top('quanti estintori ci sono a Milano')).toBe('schede-tecniche-registro-dispositivi-sicurezza');
  });

  it('ignora gli accenti nella domanda', () => {
    expect(top('perche il badge non apre')).toBe(top('perché il badge non apre'));
    expect(top('citta')).toBe(top('città'));
  });

  it('tollera errori di battitura (fuzzy)', () => {
    expect(top('pasword dimenticata')).toBe('faq-helpdesk-come-reimposto-la-password-del-computer');
    expect(top('regolamnto veicoli')).toBe('normativa-regolamento-veicoli-aziendali');
  });

  it('trova parole incomplete (prefisso sull\'ultima parola)', () => {
    const ids = retrieve(index, 'stamp').map((h) => h.recordId);
    expect(ids).toContain('schede-tecniche-stampante-multifunzione-mf200');
  });

  it('singolare e plurale trovano gli stessi documenti', () => {
    expect(top('estintore')).toBe(top('estintori'));
    expect(top('veicolo elettrico')).toBe(top('veicoli elettrici'));
  });

  it('nessun risultato per termini assenti o solo stopword', () => {
    expect(retrieve(index, 'zzzz qwerty')).toEqual([]);
    expect(retrieve(index, 'come di il la')).toEqual([]);
    expect(retrieve(index, '   ')).toEqual([]);
  });

  it('restituisce al massimo 8 blocchi e al massimo 3 per record', () => {
    const hits = retrieve(index, 'azienda esempio ufficio servizi generali sede badge toner veicolo');
    expect(hits.length).toBeLessThanOrEqual(8);
    const perRecord = new Map<string, number>();
    hits.forEach((h) => perRecord.set(h.recordId, (perRecord.get(h.recordId) ?? 0) + 1));
    expect(Math.max(...perRecord.values())).toBeLessThanOrEqual(3);
  });

  it('tiene anche fonti secondarie pertinenti (almeno 6 se disponibili)', () => {
    const ids = retrieve(index, 'dove butto il toner esaurito').map((h) => h.recordId);
    expect(ids[0]).toBe('schede-tecniche-stampante-multifunzione-mf200');
    expect(ids).toContain('procedure-gestione-rifiuti-ufficio');
  });

  it('il titolo pesa più del testo', () => {
    const hits = retrieve(index, 'formazione antincendio');
    expect(hits[0].recordId).toBe('formazione-antincendio-punti-chiave');
  });

  it("l'indice serializzato e ricaricato dà gli stessi risultati", () => {
    const reloaded = loadIndex(JSON.stringify(index));
    for (const q of ['ferie', 'pasword', 'stamp', 'veicoli elettrici']) {
      expect(retrieve(reloaded, q)).toEqual(retrieve(index, q));
    }
  });
});

describe('evidenziazione', () => {
  const text = "Le ferie si richiedono dal portale. La richiesta di ferie va approvata dal responsabile. Perché? Per l'organizzazione.";

  it('evidenzia le parole nelle loro forme flesse e accentate', () => {
    const terms = ['feri', 'richiest', 'perch'];
    expect(marked(highlight(text, terms))).toEqual(['ferie', 'richiesta', 'ferie']);
    expect(marked(highlight('Il veicolo e i veicoli', ['veicol']))).toEqual(['veicolo', 'veicoli']);
  });

  it('highlight ricompone esattamente il testo originale', () => {
    expect(highlight(text, ['feri']).map((s) => s.text).join('')).toBe(text);
  });

  it('snippet centra la zona con più corrispondenze e aggiunge i puntini', () => {
    const long = 'Introduzione generica. '.repeat(30) + 'Qui si parla di toner esaurito e di toner nuovo. ' + 'Conclusione generica. '.repeat(30);
    const segs = snippet(long, ['toner', 'esaurit'], 200);
    const joined = segs.map((s) => s.text).join('');
    expect(joined.startsWith('… ')).toBe(true);
    expect(joined.endsWith(' …')).toBe(true);
    expect(marked(segs)).toEqual(['toner', 'esaurito', 'toner']);
    expect(joined.length).toBeLessThanOrEqual(210);
  });

  it('snippet restituisce il testo intero se è corto', () => {
    expect(snippet('Breve testo sul toner', ['toner']).map((s) => s.text).join('')).toBe('Breve testo sul toner');
  });
});

describe('ricerca nell\'app (IndexedDB)', () => {
  it('searchLocal unisce blocchi e record, e si aggiorna quando i dati cambiano', async () => {
    const { putRecords, deleteRecords, clearAll } = await import('../src/lib/db');
    const { searchLocal } = await import('../src/lib/search');
    await clearAll();
    const base = { categoria: 'Test', tag: [], fonte: 'prova', data_aggiornamento: '2025-01-01', origine: 'locale' as const, salvato_il: 0 };
    await putRecords([{ ...base, id: 'a', titolo: 'Mensa', testo: 'La mensa apre alle 12.' }]);
    let res = await searchLocal('orari mensa');
    expect(res.map((r) => r.record.id)).toEqual(['a']);
    expect(res[0].chunk.testo).toContain('12');

    await putRecords([{ ...base, id: 'b', titolo: 'Parcheggio', testo: 'Il parcheggio è riservato ai dipendenti.' }]);
    res = await searchLocal('parcheggio');
    expect(res[0].record.id).toBe('b'); // l'indice è stato ricostruito

    await deleteRecords(['b']);
    expect(await searchLocal('parcheggio')).toEqual([]);
  });
});

describe('snippet: preferisce l\'inizio del testo', () => {
  it('parte dall\'inizio se lì ci sono quasi tante corrispondenze quante altrove', () => {
    const text = 'Le ferie si chiedono online. ' + 'Testo neutro di riempimento. '.repeat(20) + 'ferie e ancora ferie.';
    const joined = snippet(text, ['feri'], 200).map((s) => s.text).join('');
    expect(joined.startsWith('Le ferie')).toBe(true);
  });

  it('va nella zona centrale se è molto più ricca di corrispondenze', () => {
    const text = 'Le ferie si chiedono online. ' + 'Testo neutro di riempimento. '.repeat(20) + 'ferie, ferie e ancora ferie.';
    const joined = snippet(text, ['feri'], 200).map((s) => s.text).join('');
    expect(joined.startsWith('… ')).toBe(true);
  });
});
