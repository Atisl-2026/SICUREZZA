import { describe, expect, it } from 'vitest';
import { chunkText, chunksForRecord } from '../src/shared/chunk.ts';
import { csvToRecords, decodeText, detectDelimiter, parseCsv } from '../src/shared/csv.ts';
import { planImport, planRemote } from '../src/shared/merge.ts';
import {
  compareVersions, ensureUniqueIds, normalizeRecord, parseDate, parseDbJson, parseTags, slugify
} from '../src/shared/normalize.ts';
import type { DbRecord, StoredRecord } from '../src/shared/types.ts';

const rec = (id: string, extra: Partial<DbRecord> = {}): DbRecord => ({
  id, titolo: `Titolo ${id}`, testo: `Testo ${id}`, categoria: 'Generale', tag: [], fonte: '', data_aggiornamento: '2025-01-01', ...extra
});
const stored = (id: string, extra: Partial<StoredRecord> = {}): StoredRecord => ({
  ...rec(id), origine: 'remoto', salvato_il: 0, ...extra
});

describe('normalize', () => {
  it('slugify toglie accenti e simboli', () => {
    expect(slugify('Perché è così? Scheda n° 12')).toBe('perche-e-cosi-scheda-n-12');
  });

  it('parseDate accetta formati italiani e ISO', () => {
    expect(parseDate('2025-03-12')).toBe('2025-03-12');
    expect(parseDate('2025-03-12T10:00:00Z')).toBe('2025-03-12');
    expect(parseDate('12/03/2025')).toBe('2025-03-12');
    expect(parseDate('5.3.25')).toBe('2025-03-05');
    expect(parseDate('31/02/2025')).toBe('');
    expect(parseDate('ieri')).toBe('');
  });

  it('parseTags gestisce separatori diversi e duplicati', () => {
    expect(parseTags('a | b | A')).toEqual(['a', 'b']);
    expect(parseTags('uno; due')).toEqual(['uno', 'due']);
    expect(parseTags('x, #y')).toEqual(['x', 'y']);
    expect(parseTags(['k', ' ', 'k'])).toEqual(['k']);
  });

  it('normalizeRecord riconosce alias di colonna e conserva le colonne extra nel testo', () => {
    const { record } = normalizeRecord({ Domanda: 'Come si fa?', Risposta: 'Così.', Tags: 'a|b', Data: '01/02/2024', Reparto: 'IT' });
    expect(record).toMatchObject({
      id: 'come-si-fa', titolo: 'Come si fa?', categoria: 'Generale', tag: ['a', 'b'], data_aggiornamento: '2024-02-01'
    });
    expect(record!.testo).toBe('Così.\n\nReparto: IT');
  });

  it('normalizeRecord rifiuta record vuoti', () => {
    expect(normalizeRecord({ foo: '' }).error).toBeTruthy();
    expect(normalizeRecord('stringa').error).toBeTruthy();
  });

  it('parseDbJson accetta array, oggetto con versione e backup', () => {
    expect(parseDbJson([rec('a')]).items).toHaveLength(1);
    const p = parseDbJson({ versione: '3', records: [rec('a'), { ...rec('b'), origine: 'locale' }] });
    expect(p.versione).toBe('3');
    expect(p.items[1].origine).toBe('locale');
  });

  it('ensureUniqueIds rinomina i duplicati', () => {
    const list = [rec('x'), rec('x'), rec('x')];
    ensureUniqueIds(list);
    expect(list.map((r) => r.id)).toEqual(['x', 'x-2', 'x-3']);
  });

  it('compareVersions confronta in modo numerico', () => {
    expect(compareVersions('2025.10.12', '2025.10.3')).toBeGreaterThan(0);
    expect(compareVersions('10', '9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0')).toBe(0);
  });
});

describe('csv', () => {
  it('rileva il separatore', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b\n1,2')).toBe(',');
    expect(detectDelimiter('"a;b",c,d\n')).toBe(',');
  });

  it('gestisce virgolette, a capo nei campi e BOM', () => {
    const rows = parseCsv('﻿titolo;testo\r\n"Uno; due";"riga 1\nriga 2 con ""virgolette"""\r\n\r\n');
    expect(rows).toEqual([['titolo', 'testo'], ['Uno; due', 'riga 1\nriga 2 con "virgolette"']]);
  });

  it('decodifica UTF-8 e Windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('perché'))).toBe('perché');
    expect(decodeText(new Uint8Array([0x70, 0x65, 0x72, 0x63, 0x68, 0xe9]))).toBe('perché');
  });

  it('csvToRecords produce record normalizzati', () => {
    const res = csvToRecords('id;titolo;testo;tag\nA1;Primo;Testo primo;x|y\n;;;\nA2;;Solo testo;');
    expect(res.map((r) => r.record?.id)).toEqual(['A1', 'A2']);
    expect(res[0].record!.tag).toEqual(['x', 'y']);
    expect(res[1].record!.titolo).toBe('Solo testo');
  });
});

describe('chunk', () => {
  const para = (n: number) => `Paragrafo ${n}. ` + 'Questa è una frase di prova sul regolamento aziendale. '.repeat(6);
  const long = Array.from({ length: 12 }, (_, i) => para(i + 1)).join('\n\n');

  it('non divide i testi brevi', () => {
    expect(chunkText('breve')).toEqual(['breve']);
    expect(chunkText('   ')).toEqual([]);
  });

  it('blocchi di 800–1200 caratteri con sovrapposizione', () => {
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(2);
    chunks.slice(0, -1).forEach((c) => {
      expect(c.length).toBeGreaterThanOrEqual(780);
      expect(c.length).toBeLessThanOrEqual(1200);
    });
    // sovrapposizione: l'inizio di ogni blocco compare alla fine del precedente
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1]).toContain(chunks[i].slice(0, 40));
    }
    // nessuna parola tagliata all'inizio dei blocchi
    chunks.forEach((c) => expect(c).toMatch(/^\S/));
  });

  it('copre tutto il testo', () => {
    const chunks = chunkText(long);
    expect(chunks.at(-1)!.endsWith(long.trim().slice(-30))).toBe(true);
  });

  it('collega i blocchi al record padre', () => {
    const cs = chunksForRecord('rec-1', long);
    expect(cs[0]).toMatchObject({ id: 'rec-1#0', recordId: 'rec-1', n: 0 });
  });

  it('funziona anche senza spazi (testo patologico)', () => {
    const chunks = chunkText('x'.repeat(5000));
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(1200));
  });
});

describe('merge', () => {
  it('import manuale: aggiunge, aggiorna, salta se il locale è più recente', () => {
    const existing = new Map([
      ['a', stored('a', { data_aggiornamento: '2025-06-01' })],
      ['b', stored('b', { origine: 'locale' })],
      ['c', stored('c')]
    ]);
    const plan = planImport(existing, [
      { record: rec('a', { testo: 'vecchio', data_aggiornamento: '2025-01-01' }) },
      { record: rec('b', { testo: 'nuovo', data_aggiornamento: '2025-02-01' }) },
      { record: rec('c') },
      { record: rec('d') }
    ]);
    expect(plan.stats).toEqual({ aggiunti: 1, aggiornati: 1, invariati: 1, saltati: 1 });
    expect(plan.saltati).toEqual(['a']);
    expect(plan.toPut.find((r) => r.id === 'd')!.origine).toBe('locale');
  });

  it('import manuale su record remoto lo marca come modificato', () => {
    const plan = planImport(new Map([['a', stored('a')]]), [{ record: rec('a', { testo: 'diverso' }) }]);
    expect(plan.toPut[0]).toMatchObject({ origine: 'remoto', modificato: true });
  });

  it('aggiornamento remoto: non tocca record locali o modificati', () => {
    const existing = [
      stored('remoto-uguale'),
      stored('remoto-cambiato'),
      stored('remoto-rimosso'),
      stored('modificato', { modificato: true, testo: 'mia versione' }),
      stored('mio', { origine: 'locale' })
    ];
    const plan = planRemote(existing, [
      rec('remoto-uguale'),
      rec('remoto-cambiato', { testo: 'nuovo testo' }),
      rec('modificato', { testo: 'versione remota' }),
      rec('nuovo')
    ]);
    expect(plan.stats).toEqual({ aggiunti: 1, aggiornati: 1, rimossi: 1, invariati: 1, conservati: 1 });
    expect(plan.toDelete).toEqual(['remoto-rimosso']);
    expect(plan.toPut.map((r) => r.id).sort()).toEqual(['nuovo', 'remoto-cambiato']);
    expect(plan.conservati).toEqual(['modificato']);
  });
});
