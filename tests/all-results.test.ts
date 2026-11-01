import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { StoredRecord } from '../src/shared/types.ts';

// testo lungo tipo D.Lgs. 81/08: «preposto» (e preposti/preposta) compare 346 volte, «proposta» 5 volte
const forme = ['preposto', 'preposti', 'Preposto', 'preposta'];
const paragrafi: string[] = [];
let attese = 0;
let esatte = 0; // scritte proprio «preposto» (maiuscole a parte)
for (let i = 0; i < 173; i++) {
  const a = forme[i % forme.length];
  if (a.toLowerCase() === 'preposto') esatte += 2;
  paragrafi.push(`Art. ${i + 1}\nIl datore di lavoro e il ${a} vigilano sull'osservanza degli obblighi di sicurezza; il ${a} segnala le deficienze dei mezzi e delle attrezzature di lavoro.`);
  attese += 2;
}
for (let i = 0; i < 5; i++) paragrafi.splice(i * 30 + 7, 0, `La proposta di modifica del documento di valutazione dei rischi è presentata al datore di lavoro.`);
const testo = paragrafi.join('\n\n');

const rec = (id: string, titolo: string, t: string, categoria = 'Normativa'): StoredRecord => ({
  id, titolo, testo: t, categoria, tag: [], fonte: '', data_aggiornamento: '2026-11-01', origine: 'remoto', salvato_il: 0
});

describe('tutti i risultati (come "Trova" nel documento)', () => {
  beforeAll(async () => {
    const { clearAll, putRecords } = await import('../src/lib/db');
    await clearAll();
    await putRecords([
      rec('dlgs-81-08', 'D.Lgs. 81/2008 – Testo unico', testo),
      rec('faq-preposto', 'FAQ: chi è il preposto', 'Il preposto sovrintende alle attività lavorative.', 'FAQ'),
      rec('verbale', 'Verbale riunione', 'Approvata la proposta del responsabile. Nessun riferimento ad altri ruoli.', 'Generale')
    ]);
  });

  it('«preposto»: tutte le occorrenze, niente «proposta»', async () => {
    const { allMatches } = await import('../src/lib/search');
    const r = await allMatches('preposto');
    expect(r.simili).toEqual([]);
    expect(r.documenti.map((d) => d.recordId)).toEqual(['dlgs-81-08', 'faq-preposto'].sort((a, b) =>
      r.documenti.findIndex((d) => d.recordId === a) - r.documenti.findIndex((d) => d.recordId === b)));
    expect(r.documenti.map((d) => d.recordId)).not.toContain('verbale');
    const dlgs = r.documenti.find((d) => d.recordId === 'dlgs-81-08')!;
    expect(dlgs.occorrenze).toBe(attese); // 346
    expect(r.occorrenze).toBe(attese + 1);
    // dettaglio per forma, come il conteggio di "Trova" sulla parola esatta
    expect(Object.fromEntries(dlgs.forme)).toEqual({ preposto: esatte, preposti: (attese - esatte) / 2, preposta: (attese - esatte) / 2 });
    expect(r.forme[0]).toEqual(['preposto', esatte + 1]);
    // tutti i passaggi del documento che contengono la parola, nell'ordine del testo
    const { db } = await import('../src/lib/db');
    const chunks = (await db.chunks.where('recordId').equals('dlgs-81-08').toArray()).filter((c) => /prepost/i.test(c.testo));
    expect(dlgs.passaggi).toHaveLength(chunks.length);
    expect(dlgs.passaggi.map((h) => h.n)).toEqual([...dlgs.passaggi.map((h) => h.n)].sort((a, b) => a - b));
    expect(chunks.length).toBeGreaterThan(20);
  });

  it('i passaggi più pertinenti per l\'AI non contengono «proposta»', async () => {
    const { searchLocal } = await import('../src/lib/search');
    const top = await searchLocal('preposto');
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((r) => /prepost/i.test(r.chunk.testo))).toBe(true);
  });

  it('errore di battitura: «prepsto» non esiste → parole simili, e lo dice', async () => {
    const { allMatches } = await import('../src/lib/search');
    const r = await allMatches('prepsto');
    expect(r.simili).toEqual(['prepsto']);
    expect(r.passaggi).toBeGreaterThan(20);
  });

  it('frase esatta: conteggio della frase', async () => {
    const { allMatches } = await import('../src/lib/search');
    const r = await allMatches('"proposta di modifica"');
    expect(r.occorrenze).toBe(5);
    expect(r.documenti.map((d) => d.recordId)).toEqual(['dlgs-81-08']);
  });

  it('ricerca dettagliata: tutti i passaggi, non più 3 per scheda', async () => {
    const { allDetailedMatches, loadMatches } = await import('../src/lib/search');
    const { EMPTY_DETAILED } = await import('../src/shared/search.ts');
    const r = await allDetailedMatches({ ...EMPTY_DETAILED, all: 'preposto deficienze' });
    const dlgs = r.documenti.find((d) => d.recordId === 'dlgs-81-08')!;
    expect(dlgs.passaggi.length).toBeGreaterThan(20);
    const page = await loadMatches(dlgs.passaggi.slice(0, 10));
    expect(page).toHaveLength(10);
    expect(page.every((p) => /deficienze/.test(p.chunk.testo))).toBe(true);
    const exact = await allDetailedMatches({ ...EMPTY_DETAILED, all: 'preposto', exact: true });
    // solo la parola scritta così («Preposto» con la maiuscola vale, «preposti» no)
    expect(exact.documenti.find((d) => d.recordId === 'dlgs-81-08')!.occorrenze).toBe(esatte);
  });
});

describe('lettere e cifre attaccate (indici dei PDF, «art.18»)', () => {
  it('«preposto253» e «art.18» si trovano e si contano', async () => {
    const { clearAll, putRecords } = await import('../src/lib/db');
    await clearAll();
    await putRecords([rec('indice', 'Indice del testo unico', 'Sanzioni per il preposto253\n• Art. 56 Sanzioni per il preposto255\nVedi art.18 comma 1 e l’art. 18, comma 2.\nFirma del preposto3………')]);
    const { allMatches } = await import('../src/lib/search');
    const r = await allMatches('preposto');
    expect(r.occorrenze).toBe(3);
    expect((await allMatches('"art 18"')).occorrenze).toBe(2);
    const { normalizeForMatch, containsPhrase, highlight } = await import('../src/shared/search.ts');
    expect(containsPhrase(normalizeForMatch('il preposto253 vigila'), 'preposto')).toBe(true);
    expect(highlight('per il preposto253.', ['prepost']).filter((x) => x.mark).map((x) => x.text)).toEqual(['preposto']);
  });
});
