import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error modulo JavaScript senza tipi
import { splitFaq } from '../scripts/build-db.mjs';

describe('build-db', () => {
  it('splitFaq divide domande e risposte', () => {
    const pairs = splitFaq('Intro\n\nD: Come si fa?\nR: Così.\n\n2. Quando?\nSubito.\nAnche dopo.');
    expect(pairs).toEqual([
      { q: 'Come si fa?', a: 'Così.' },
      { q: 'Quando?', a: 'Subito.\nAnche dopo.' }
    ]);
  });

  it('converte la cartella di esempio in un db.json valido', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dbtest-'));
    const out = path.join(dir, 'db.json');
    try {
      execFileSync('node', ['scripts/build-db.mjs', 'sorgenti-esempio', '--out', out, '--versione', '1'], { stdio: 'pipe' });
      const db = JSON.parse(readFileSync(out, 'utf8'));
      expect(db.versione).toBe('1');
      const ids = db.records.map((r: { id: string }) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      // almeno un record da ogni formato di esempio
      for (const id of [
        'normativa-regolamento-veicoli-aziendali', // .docx
        'procedure-richiesta-ferie', // .pdf
        'formazione-antincendio-punti-chiave', // .pptx
        'schede-tecniche-stampante-multifunzione-mf200', // .html
        'procedure-gestione-rifiuti-ufficio', // .md
        'faq-badge-e-accessi-posso-far-entrare-un-ospite', // .txt (FAQ divisa)
        'schede-tecniche-registro-dispositivi-sicurezza' // .xlsx tabella generica
      ]) {
        expect(ids).toContain(id);
      }
      expect(ids).toHaveLength(14);
      const ferie = db.records.find((r: { id: string }) => r.id === 'procedure-richiesta-ferie');
      expect(ferie).toMatchObject({ categoria: 'Procedure', data_aggiornamento: '2026-09-15', titolo: 'Richiesta di ferie e permessi' });
      expect(ferie.testo).toContain('almeno 5 giorni lavorativi');
      // FAQ Excel: un record per riga, tag dalla colonna Tag
      const vpn = db.records.find((r: { titolo: string }) => r.titolo === 'Come mi collego alla VPN da casa?');
      expect(vpn).toMatchObject({ categoria: 'FAQ', tag: ['vpn', 'smart working'] });
      // HTML: menu e piè di pagina rimossi
      const mf = db.records.find((r: { id: string }) => r.id.includes('mf200'));
      expect(mf.testo).not.toMatch(/Cookie|Contatti/);
      expect(mf.testo).toContain('24 ore');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
