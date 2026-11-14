import { describe, expect, it } from 'vitest';
import { describeMatch, findDuplicates, fingerprint, similarTitles, titleKey } from '../src/shared/duplicates.ts';
import { genericName, titleFromText } from '../src/lib/ocr.ts';

/** testo casuale ma ripetibile (ogni seme dà un testo diverso) */
function words(n: number, seed = 1): string {
  let x = (seed * 2654435761) >>> 0 || 1;
  return Array.from({ length: n }, () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return `parola${x % 5000}`;
  }).join(' ');
}

const rec = (id: string, titolo: string, testo: string, extra: object = {}) => ({ id, titolo, testo, categoria: 'Normativa', ...extra });

describe('titoli', () => {
  it('normalizza data, estensione, accenti e punteggiatura', () => {
    expect(titleKey('2024-05-01_Procedura Attività.PDF')).toBe('procedura attivita');
  });
  it('titoli simili ma non con numeri o numeri romani diversi', () => {
    const f = (t: string) => fingerprint(rec('x', t, ''));
    expect(similarTitles(f('Procedura gestione emergenze'), f('Procedura per la gestione delle emergenze'))).toBe(true);
    expect(similarTitles(f('Valutazione dei rischi cantiere'), f('Valutazione rischi cantieri'))).toBe(true);
    expect(similarTitles(f('D.Lgs 81/2008'), f('D.Lgs 106/2009'))).toBe(false);
    expect(similarTitles(f('Allegato IV'), f('Allegato V'))).toBe(false);
    expect(similarTitles(f('Procedura ferie'), f('Manuale carrelli elevatori'))).toBe(false);
  });
});

describe('findDuplicates', () => {
  const base = words(400);
  const archive = [
    rec('normativa-dlgs81', 'Testo unico sicurezza', base, { fonte: 'dlgs81.pdf' }),
    rec('normativa-altro', 'Circolare caldo', words(300, 5))
  ];

  it('nessun doppione per un documento diverso', () => {
    expect(findDuplicates([rec('n1', 'Nuova procedura', words(300, 9))], archive)[0]).toEqual([]);
  });

  it('contenuto identico (anche con spazi, maiuscole e accenti diversi)', () => {
    const [m] = findDuplicates([rec('n1', 'Copia', base.toUpperCase().replace(/ /g, '  \n'))], archive)[0];
    expect(m.id).toBe('normativa-dlgs81');
    expect(m.kinds).toContain('contenuto-identico');
    expect(describeMatch(m)).toBe('«Testo unico sicurezza» (Normativa): contenuto identico.');
  });

  it('titolo uguale e stesso nome del file', () => {
    const r = findDuplicates([rec('n1', 'TESTO UNICO  sicurezza', words(200, 3)), rec('n2', 'Altro', words(200, 4), { fonte: 'dlgs81.pdf' })], archive);
    expect(r[0][0].kinds).toEqual(['titolo-uguale']);
    expect(r[1][0].kinds).toEqual(['nome-file-uguale']);
  });

  it('contenuto simile, incluso o che contiene', () => {
    const w = base.split(' ');
    const modified = [...w.slice(0, 300), ...words(40, 7).split(' '), ...w.slice(300)].join(' ');
    const sim = findDuplicates([rec('n1', 'Versione rivista', modified)], archive)[0][0];
    expect(sim.kinds).toEqual(['contenuto-simile']);
    expect(sim.somiglianza).toBeGreaterThan(0.7);

    const part = findDuplicates([rec('n2', 'Estratto', w.slice(50, 250).join(' '))], archive)[0][0];
    expect(part.kinds).toEqual(['contenuto-incluso']);

    const bigger = findDuplicates([rec('n3', 'Edizione ampliata', `${base} ${words(900, 11)}`)], archive)[0][0];
    expect(bigger.kinds).toEqual(['contiene']);
    expect(describeMatch(bigger)).toMatch(/forse una versione più ampia/);
  });

  it('stessa scheda (stesso file nella stessa categoria): sostituzione', () => {
    const [m] = findDuplicates([rec('normativa-dlgs81', 'Testo unico sicurezza', base)], archive)[0];
    expect(m.kinds[0]).toBe('stesso-id');
    expect(m.kinds).toContain('contenuto-identico');
  });

  it('doppioni tra i documenti caricati insieme', () => {
    const t = words(150, 21);
    const r = findDuplicates([rec('a', 'Uno', t), rec('b', 'Due', t)], []);
    expect(r[0]).toEqual([]);
    expect(r[1][0]).toMatchObject({ id: 'a', nuovo: true, kinds: ['contenuto-identico'] });
    expect(describeMatch(r[1][0])).toMatch(/tra quelli che stai caricando/);
  });

  it('testi brevi: solo identici, niente somiglianze casuali', () => {
    const r = findDuplicates([rec('n1', 'Nota', 'Indossare i guanti.')], [rec('x', 'Altro', 'Indossare il casco.')]);
    expect(r[0]).toEqual([]);
  });

  it('veloce anche con testi lunghi', () => {
    const big = rec('big', 'Grande', words(150000, 2));
    const t0 = Date.now();
    findDuplicates([rec('n', 'Nuovo', words(50000, 3))], [big, ...archive]);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('OCR: titoli delle foto', () => {
  it('riconosce i nomi generici', () => {
    for (const n of ['IMG_20261114_101010.jpg', 'PXL_20250101_123456789.jpg', 'WhatsApp Image 2026-11-14 at 10.30.12.jpeg', 'scan0001.pdf', 'Screenshot_20261114-101010.png', 'DSC01234.JPG', 'foto (2).jpg']) {
      expect(genericName(n), n).toBe(true);
    }
    for (const n of ['Procedura ferie.jpg', 'verbale cantiere.png']) expect(genericName(n), n).toBe(false);
  });
  it('prende la prima riga significativa', () => {
    expect(titleFromText('12\n—\nArticolo 19 - Obblighi del preposto\n1. In riferimento')).toBe('Articolo 19 - Obblighi del preposto');
  });
});
