import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { cleanPdfText, pageOffsets } from '../src/shared/extract.ts';
import { pageAt } from '../src/shared/articles.ts';
import { normalizeRecord, pickSchema, sameContent } from '../src/shared/normalize.ts';
import { photoContext } from '../src/shared/vision.ts';
import type { StoredRecord } from '../src/shared/types.ts';

describe('pagine dei PDF', () => {
  const pages = [
    'TESTO UNICO\nD.lgs. 9 aprile 2008, n. 81\n',
    'Articolo 122 - Ponteggi ed opere\nprovvisionali\n1. Nei lavori in quota de-\nvono essere adottate impalcature.',
    '',
    'Articolo 126 - Parapetti\n1. Gli impalcati e ponti di servizio devono essere provvisti di parapetto.'
  ];
  it('ritrova l\'inizio di ogni pagina nel testo ricomposto (a capo e trattini cambiati)', () => {
    const text = cleanPdfText(pages);
    const off = pageOffsets(text, pages);
    expect(off).toHaveLength(4);
    expect(text.slice(off[1], off[1] + 12)).toBe('Articolo 122');
    expect(text.slice(off[3], off[3] + 12)).toBe('Articolo 126');
    expect(off[2]).toBeLessThanOrEqual(off[3]); // pagina vuota: tra la precedente e la successiva
    expect(pageAt(off, text.indexOf('impalcature'))).toBe(2);
    expect(pageAt(off, text.indexOf('parapetto'))).toBe(4);
    expect(pageAt(undefined, 10)).toBeUndefined();
  });

  it('le pagine si conservano in pubblicazione e importazione; scartate se non valide', () => {
    const r = normalizeRecord({ id: 'x', titolo: 'T', testo: 'abcdefghij', pagine: [0, 4, 8] }).record!;
    expect(r.pagine).toEqual([0, 4, 8]);
    expect(pickSchema(r).pagine).toEqual([0, 4, 8]);
    expect(normalizeRecord({ id: 'x', titolo: 'T', testo: 'abc', pagine: [0, 40] }).record!.pagine).toBeUndefined();
    expect(normalizeRecord({ id: 'x', titolo: 'T', testo: 'abc', pagine: [2, 1] }).record!.pagine).toBeUndefined();
    expect(sameContent(r, { ...r, pagine: [0, 5, 8] })).toBe(false);
  });
});

describe('contesto della foto', () => {
  const desc = {
    descrizione: 'Edificio in ristrutturazione con ponteggio metallico', tipo_opera: 'ristrutturazione con ponteggio', elementi: ['carriola'],
    parole_chiave: ['ponteggio', 'parapetto'], limiti: '', criticita: ['parapetto mancante sul ponteggio']
  };
  it('ponteggio riconosciuto: ricerche di base sugli articoli generali, parole del contesto', () => {
    const c = photoContext(desc, '');
    expect(c.ricerche).toEqual(expect.arrayContaining(['ponteggi ed opere provvisionali', 'idoneità delle opere provvisionali']));
    expect(c.termini).toContain('impalcato');
    expect(c.termini).not.toContain('cantiere'); // il contesto generico non basta se c'è quello specifico
  });

  it('i parapetti delle navi e le funi non entrano in un\'analisi di ponteggi', async () => {
    const rec = (id: string, titolo: string, testo: string, categoria = 'Normativa'): StoredRecord =>
      ({ id, titolo, testo, categoria, tag: [], fonte: '', data_aggiornamento: '', origine: 'remoto', salvato_il: 0 });
    const lungo = (x: string) => `${x} `.repeat(30).trim(); // articoli in brani separati
    const { clearAll, putRecords } = await import('../src/lib/db');
    await clearAll();
    await putRecords([
      rec('tu', 'Testo unico', [
        `Articolo 112 - Idoneità delle opere provvisionali\n1. ${lungo('Le opere provvisionali devono essere allestite con buon materiale.')}`,
        `Articolo 122 - Ponteggi ed opere provvisionali\n1. ${lungo('Nei lavori in quota devono essere adottate impalcature o ponteggi.')}`,
        `Articolo 126 - Parapetti\n1. ${lungo('Gli impalcati e ponti di servizio devono essere provvisti di parapetto e tavola fermapiede.')}`,
        `Articolo 40 - Parapetti dei bacini galleggianti\n1. ${lungo('Le scale fisse poste all\'interno dei bacini siano fornite di parapetto.')}`
      ].join('\n\n')),
      rec('funi', 'Circolare lavori su funi', lungo('L\'ancoraggio delle funi di lavoro e di sicurezza con parapetto e fermapiede.'), 'Circolari')
    ]);
    const { photoRetrieval } = await import('../src/lib/photo');
    const { passageInfo } = await import('../src/lib/articles');
    const { results } = await photoRetrieval(desc, '');
    const labels = results.flatMap((r) => passageInfo(r).articoli.filter((a) => a.conParola).map((a) => a.section.label));
    expect(labels).toEqual(expect.arrayContaining(['Art. 112', 'Art. 122', 'Art. 126']));
    expect(labels).not.toContain('Art. 40');
    expect(results.map((r) => r.record.id)).not.toContain('funi');
  });
});
