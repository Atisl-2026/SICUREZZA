import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveKey } from '../src/shared/crypto.ts';
import { buildPublication, openSoci, serializeDemo, serializeSoci } from '../src/shared/publish.ts';
import type { StoredRecord } from '../src/shared/types.ts';

const rec = (id: string, categoria: string, origine: 'remoto' | 'locale' = 'remoto'): StoredRecord => ({
  id, titolo: `Scheda ${id}`, testo: `Testo ${id}`, categoria, tag: [], fonte: '', data_aggiornamento: '2026-11-01', origine, salvato_il: 0
});

describe('gestione delle categorie', () => {
  beforeEach(async () => {
    const { logout } = await import('../src/lib/access');
    await logout();
    const { putRecords, setMeta } = await import('../src/lib/db');
    await setMeta('eliminateDaPubblicare', []);
    await putRecords([rec('a', 'Procedure'), rec('b', 'procedure'), rec('c', 'FAQ'), rec('d', 'Vecchia categoria', 'locale')]);
  });

  it('elenco standard di partenza + categorie usate dalle schede, con i conteggi', async () => {
    const { categoriesWithCounts } = await import('../src/lib/categories');
    const cats = await categoriesWithCounts();
    expect(cats.map((c) => c.nome)).toEqual(['Normativa', 'FAQ', 'Formazione', 'Generale', 'Procedure', 'Schede tecniche', 'Vecchia categoria']);
    expect(cats.find((c) => c.nome === 'Procedure')!.schede).toBe(2); // "procedure" minuscolo conta insieme
    expect(cats.at(-1)).toMatchObject({ inElenco: false, schede: 1 });
  });

  it('aggiunta senza doppioni; segnata da pubblicare', async () => {
    const { addCategory, getCategoryList } = await import('../src/lib/categories');
    const { getPending } = await import('../src/lib/publisher');
    expect(await addCategory('  Cantieri   edili ')).toBe('Cantieri edili');
    await expect(addCategory('faq')).rejects.toThrow(/esiste già/);
    await expect(addCategory('   ')).rejects.toThrow(/nome/);
    expect((await getCategoryList()).at(-1)).toBe('Cantieri edili');
    expect(await getPending()).toMatchObject({ categorie: true, nuove: 1, totale: 2 }); // la scheda «d» è nuova
  });

  it('rinomina: aggiorna le schede (anche scritte diversamente) e il filtro "Cerca in"', async () => {
    const { renameCategory, getCategoryList } = await import('../src/lib/categories');
    const { db } = await import('../src/lib/db');
    const { updateSettings, getSettings } = await import('../src/lib/settings');
    const { getPending } = await import('../src/lib/publisher');
    await updateSettings({ categorie: ['procedure', 'faq'] });
    expect(await renameCategory('Procedure', 'Procedure operative')).toBe(2);
    expect((await db.records.get('a'))).toMatchObject({ categoria: 'Procedure operative', modificato: true });
    expect((await db.records.get('b'))!.categoria).toBe('Procedure operative');
    expect(await getCategoryList()).toContain('Procedure operative');
    expect(await getCategoryList()).not.toContain('Procedure');
    expect((await getSettings()).categorie.sort()).toEqual(['faq', 'procedure operative']);
    expect(await getPending()).toMatchObject({ modificate: 2, categorie: true });
    await expect(renameCategory('FAQ', 'procedure OPERATIVE')).rejects.toThrow(/Esiste già/);
  });

  it('eliminazione: se ha schede vanno spostate; la ricerca le trova nella nuova categoria', async () => {
    const { deleteCategory, getCategoryList } = await import('../src/lib/categories');
    const { db } = await import('../src/lib/db');
    const { retrieve } = await import('../src/shared/search.ts');
    const { getIndex } = await import('../src/lib/search');
    await expect(deleteCategory('FAQ')).rejects.toThrow(/scegli dove spostarle/);
    expect(await deleteCategory('FAQ', 'Generale')).toBe(1);
    expect((await db.records.get('c'))!.categoria).toBe('Generale');
    expect(await getCategoryList()).not.toContain('FAQ');
    expect(await deleteCategory('Formazione')).toBe(0); // vuota
    const hits = retrieve(await getIndex(), 'Testo c', { categorie: ['Generale'] });
    expect(hits.map((h) => h.recordId)).toContain('c');
  });

  it('ordine', async () => {
    const { moveCategory, getCategoryList } = await import('../src/lib/categories');
    await moveCategory('FAQ', -1);
    expect((await getCategoryList()).slice(0, 2)).toEqual(['FAQ', 'Normativa']);
    await moveCategory('FAQ', -1); // già in cima: nessun effetto
    expect((await getCategoryList())[0]).toBe('FAQ');
  });

  it('elenco ricevuto con i contenuti: non sovrascrive modifiche non pubblicate', async () => {
    const { receiveCategories, getCategoryList, addCategory } = await import('../src/lib/categories');
    await receiveCategories(['A', 'B']);
    expect(await getCategoryList()).toEqual(['A', 'B']);
    await addCategory('Mia');
    await receiveCategories(['X']);
    expect(await getCategoryList()).toEqual(['A', 'B', 'Mia']);
  });
});

describe('pubblicazione e ricezione dell\'elenco', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('i soci ricevono l\'elenco pubblicato (cifrato insieme alle schede)', async () => {
    const key = await deriveKey('password-soci', undefined, 1000);
    const pub = await buildPublication([rec('a', 'Cantieri')], key, { versione: '2026.01', categorie: ['Cantieri', 'DPI'] });
    expect(serializeSoci(pub.soci)).not.toContain('DPI');
    expect((await openSoci(pub.soci, key)).categorie).toEqual(['Cantieri', 'DPI']);

    const files: Record<string, string> = { 'demo.json': serializeDemo(pub.demo), 'soci.json': serializeSoci(pub.soci) };
    vi.stubGlobal('location', { origin: 'https://x.github.io', href: 'https://x.github.io/SICUREZZA/' });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const name = String(url).match(/data\/([\w.]+)\?/)?.[1];
      return name && files[name] ? new Response(files[name], { status: 200 }) : new Response('{}', { status: 404 });
    }));
    const { logout, loginSocio } = await import('../src/lib/access');
    const { categoriesWithCounts } = await import('../src/lib/categories');
    await logout();
    await loginSocio('password-soci');
    expect((await categoriesWithCounts()).map((c) => c.nome)).toEqual(['Cantieri', 'DPI']);
  });
});
