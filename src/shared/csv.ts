import { normalizeRecord, type NormalizeResult } from './normalize.ts';

/**
 * Decodifica i byte di un file di testo: UTF-8 (con o senza BOM), altrimenti Windows-1252
 * (tipico dei CSV salvati da Excel in italiano).
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Individua il separatore contando ; , e tab nella prima riga (fuori dalle virgolette). */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  let best = ';';
  for (const d of [';', ',', '\t']) if (counts[d] > counts[best]) best = d;
  return best;
}

/** Parser CSV (RFC 4180): campi tra virgolette, "" come virgoletta, a capo dentro i campi. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // scarta righe completamente vuote
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Converte righe (prima riga = intestazioni) in oggetti. */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h, i) => h.trim() || `colonna ${i + 1}`);
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

/** CSV -> record normalizzati. */
export function csvToRecords(text: string): NormalizeResult[] {
  return rowsToObjects(parseCsv(text)).map((o) => normalizeRecord(o));
}
