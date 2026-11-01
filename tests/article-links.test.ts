import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARTICLE_REF, findHeadings, isDlgs81, onlineArticleUrl, refLabel, sectionsOf } from '../src/shared/articles.ts';
import { highlight } from '../src/shared/search.ts';
import type { StoredRecord } from '../src/shared/types.ts';

const lungo = (s: string) => `${s} `.repeat(30).trim();
const testo = [
  'Indice\n• Art. 19 Obblighi del preposto pag. 12',
  `Articolo 18 - Obblighi del datore di lavoro e del dirigente\n1. ${lungo('Il datore di lavoro designa i lavoratori incaricati.')}`,
  `Articolo 19 - Obblighi del preposto\n1. In riferimento alle attività indicate, i preposti devono: a) sovrintendere e vigilare. ${lungo('Il preposto interrompe l’attività in caso di deficienze.')}`,
  `Articolo 20 - Obblighi dei lavoratori\n1. ${lungo('Ogni lavoratore deve prendersi cura della propria salute.')}`,
  `ALLEGATO I\nGRAVI VIOLAZIONI\n${lungo('Violazioni che espongono a rischi gravi.')}`,
  `Art. 19 - Temperature elevate La prescrizione di cui all’articolo 240 del decreto del Presidente della Repubblica n. 547 si applica.`
].join('\n\n');

const rec = (id: string, titolo: string, t: string, categoria: string, fonte = ''): StoredRecord => ({
  id, titolo, testo: t, categoria, tag: [], fonte, data_aggiornamento: '2026-11-01', origine: 'remoto', salvato_il: 0
});

describe('collegamenti agli articoli', () => {
  it('Normattiva: D.Lgs. 81/2008 riconosciuto, Fonte con indirizzo o con {art}; mai per gli articoli dopo gli allegati', () => {
    const s = sectionsOf(testo);
    const a19 = s.filter((x) => x.label === 'Art. 19');
    expect(a19).toHaveLength(2); // quello del Testo unico e quello del decreto in appendice
    const r81 = { titolo: 'D.lgs. 81/08 - Ottobre 2026', fonte: 'TU-81-08-Ed.-Ottobre-2026.pdf' };
    expect(isDlgs81(r81)).toBe(true);
    expect(onlineArticleUrl(r81, a19[0], s)).toBe('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2008-04-09;81~art19');
    expect(onlineArticleUrl(r81, a19[1], s)).toBeUndefined();
    const norm = { titolo: 'D.Lgs. 152/2006', fonte: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2006-04-03;152~art5!vig=' };
    expect(onlineArticleUrl(norm, a19[0], s)).toBe('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2006-04-03;152~art19');
    expect(onlineArticleUrl({ titolo: 'X', fonte: 'https://esempio.it/legge#art{art}' }, { label: 'Art. 136-bis', pos: a19[0].pos }, s))
      .toBe('https://esempio.it/legge#art136bis');
    expect(onlineArticleUrl({ titolo: 'Procedura interna', fonte: 'manuale.pdf' }, a19[0], s)).toBeUndefined();
  });

  it('riferimenti scritti dall\'AI', () => {
    const t = 'Il preposto (Art. 19, comma 1, lettera a)) e l\'articolo 18 comma 2; vedi Allegato XVIII e art. 136-bis. Parte prima.';
    expect([...t.matchAll(ARTICLE_REF)].map(refLabel)).toEqual(['Art. 19', 'Art. 18', 'Allegato XVIII', 'Art. 136-bis']);
  });

  it('evidenziazione: intestazione in verde, parola in giallo (anche dentro l\'intestazione)', () => {
    const h = 'Articolo 19 - Obblighi del preposto\n1. Il preposto vigila.';
    const segs = highlight(h, ['prepost'], [[0, 35]]);
    expect(segs.filter((x) => x.art).map((x) => x.text).join('')).toBe('Articolo 19 - Obblighi del preposto');
    expect(segs.filter((x) => x.mark).map((x) => [x.text, !!x.art])).toEqual([['preposto', true], ['preposto', false]]);
  });
});

describe('articoli dei passaggi e documento di Normativa', () => {
  beforeAll(async () => {
    const { clearAll, putRecords } = await import('../src/lib/db');
    await clearAll();
    await putRecords([
      rec('tu81', 'D.lgs. 81/08 - Ottobre 2026', testo, 'Normativa', 'TU-81-08-Ed.-Ottobre-2026.pdf'),
      rec('dpr177', 'DPR 177/2011 spazi confinati', 'Art. 3\nIl preposto verifica gli spazi confinati.', 'Normativa'),
      rec('faq', 'FAQ preposto', 'Chi nomina il preposto? Il datore di lavoro.', 'FAQ')
    ]);
  });

  it('il passaggio indica l\'articolo dove compare la parola, con i collegamenti', async () => {
    const { allMatches, loadMatches } = await import('../src/lib/search');
    const { passageInfo, articleHref } = await import('../src/lib/articles');
    const all = await allMatches('preposto');
    const tu = all.documenti.find((d) => d.recordId === 'tu81')!;
    const [p] = await loadMatches(tu.passaggi.filter((h) => h.n > 0).slice(0, 1));
    const info = passageInfo(p);
    const conParola = info.articoli.filter((a) => a.conParola);
    expect(conParola.map((a) => a.section.label)).toContain('Art. 19');
    expect(conParola.map((a) => a.section.label)).not.toContain('Art. 20');
    const a19 = conParola.find((a) => a.section.label === 'Art. 19')!;
    expect(a19.online).toMatch(/~art19$/);
    expect(articleHref('tu81', a19.section.pos, p.terms)).toBe(`#database/record/tu81/art/${a19.section.pos}/q/prepost`);
  });

  it('per l\'AI: prima il passaggio con la rubrica dell\'articolo; con un solo documento, più di 3 passaggi', async () => {
    const { searchLocal } = await import('../src/lib/search');
    const res = await searchLocal('obblighi del preposto', { categorie: ['normativa'], documento: 'tu81' });
    const { passageInfo } = await import('../src/lib/articles');
    expect(passageInfo(res[0]).articoli.map((a) => a.section.label)).toContain('Art. 19');
    const { db } = await import('../src/lib/db');
    const conParola = (await db.chunks.where('recordId').equals('tu81').toArray()).filter((c) => /\bprepost[oaie]\b/i.test(c.testo)).length;
    expect(conParola).toBeGreaterThan(3);
    const tutti = await searchLocal('preposto', { categorie: ['normativa'], documento: 'tu81' });
    expect(tutti.length).toBe(Math.min(8, conParola));
  });

  it('risposta AI: «Art. 19» accanto alla citazione porta all\'articolo del Testo unico, non a quello in appendice', async () => {
    const { searchLocal } = await import('../src/lib/search');
    const { resolveArticle } = await import('../src/lib/articles');
    const res = await searchLocal('preposto');
    const href = resolveArticle(res, 'Art. 19', ['tu81'], ['prepost'])!;
    const pos = Number(href.match(/\/art\/(\d+)/)![1]);
    expect(testo.slice(pos, pos + 35)).toBe('Articolo 19 - Obblighi del preposto');
  });

  it('documento scelto: nella Normativa solo quello, le altre categorie restano', async () => {
    const { allMatches, normativaDocs, searchScope } = await import('../src/lib/search');
    const { updateSettings } = await import('../src/lib/settings');
    expect((await normativaDocs()).map((d) => d.titolo)).toEqual(['D.lgs. 81/08 - Ottobre 2026', 'DPR 177/2011 spazi confinati']);
    const tutto = await allMatches('preposto');
    expect(tutto.documenti.map((d) => d.recordId).sort()).toEqual(['dpr177', 'faq', 'tu81']);
    const solo = await allMatches('preposto', [], 'tu81');
    expect(solo.documenti.map((d) => d.recordId).sort()).toEqual(['faq', 'tu81']);
    const soloNorm = await allMatches('preposto', ['normativa'], 'dpr177');
    expect(soloNorm.documenti.map((d) => d.recordId)).toEqual(['dpr177']);
    // documento ignorato se la Normativa non è tra gli argomenti scelti
    await updateSettings({ categorie: ['faq'], documento: 'tu81' });
    expect(await searchScope()).toEqual({ categorie: ['faq'] });
    await updateSettings({ categorie: [], documento: 'non-esiste' });
    expect(await searchScope()).toEqual({ categorie: [] });
    await updateSettings({ categorie: [], documento: 'tu81' });
    expect(await searchScope()).toEqual({ categorie: [], documento: 'tu81' });
    expect(findHeadings('x').length).toBe(0);
  });
});

describe('intestazioni nei PDF reali', () => {
  it('rimandi e voci d\'indice esclusi; nota attaccata al numero; intestazione in coda ai rimandi', () => {
    const t = [
      'Articolo 1 - Finalità ............................ 12',
      'Articolo 205 - Disposizioni\n1. Testo.',
      '- Art. 2, co. 1, lett. a) - Art. 3, co. 3-bis',
      'Art. 65 del d.lgs. n. 81/2008, modificato dal decreto.',
      'Articolo 206234 - Campo di applicazione\n1. Il presente capo.',
      '- Art. 46, co. 6 - Art. 206, co. 4 Articolo 207 - Definizioni\n1. Ai fini del presente capo.'
    ].join('\n');
    expect(findHeadings(t).map((h) => `${h.label}|${h.titolo}`)).toEqual([
      'Art. 205|Disposizioni',
      'Art. 206|Campo di applicazione',
      'Art. 207|Definizioni'
    ]);
  });
});
