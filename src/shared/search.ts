import MiniSearch, { type Options, type SearchResult } from 'minisearch';
import { stripAccents } from './normalize.ts';
import type { Chunk, DbRecord } from './types.ts';

// ============================================================ analisi del testo in italiano

/** Stopword italiane (senza accenti, come vengono confrontate). */
export const STOPWORDS = new Set(`
a ad al allo ai agli all alla alle con col coi da dal dallo dai dagli dall dalla dalle di del dello dei degli dell
della delle in nel nello nei negli nell nella nelle su sul sullo sui sugli sull sulla sulle per tra fra
il lo la i gli l le un uno una e ed o od ma se che chi cui non come dove quando perche quale quali quanto quanta
quanti quante cosa cose mi ti ci vi si ne me te se io tu lui lei noi voi loro esso essa essi esse
mio mia miei mie tuo tua tuoi tue suo sua suoi sue nostro nostra nostri nostre vostro vostra vostri vostre
questo questa questi queste quello quella quelli quelle quel quei codesto
sono sei siamo siete era erano ero eri fu furono sara saranno sia siano essere stato stata stati state
ho hai ha abbiamo avete hanno avere avuto aveva avevano abbia
fare fa faccio fanno fatto puo posso possono potere devo deve devono dovere voglio vuole
anche piu meno molto poco gia ancora solo sempre mai tutto tutti tutta tutte altro altra altri altre
ogni qualche nessuno nessuna allora quindi pero oppure invece mentre dopo prima poi cioe ossia ovvero ecc
caso casi modo volta bisogna occorre serve servono vorrei sapere dire dimmi spiegami
c d n s v
`.trim().split(/\s+/));

/** Parole (lettere e cifre) con posizione nel testo originale. */
const WORD = /[\p{L}\p{N}]+/gu;

export function tokenize(text: string): string[] {
  return text.match(WORD) ?? [];
}

/**
 * Stemmer "leggero" per l'italiano: unifica singolare/plurale e maschile/femminile
 * togliendo la vocale finale (veicolo/veicoli → veicol, banca/banche → banc).
 * Volutamente semplice: niente regole aggressive che confondono parole diverse.
 */
export function stemIt(t: string): string {
  if (t.length < 4 || /\d/.test(t)) return t;
  if (/[cg]h[ei]$/.test(t)) return t.slice(0, -2);
  if (/[aeiou]$/.test(t)) return t.slice(0, -1);
  return t;
}

/** Normalizzazione di ogni termine (indice e domande): minuscole, senza accenti, senza stopword, stem. */
export function processTerm(term: string): string | null {
  const t = stripAccents(term.toLowerCase());
  if (t.length < 2 && !/\d/.test(t)) return null;
  if (STOPWORDS.has(t)) return null;
  return stemIt(t);
}

// ============================================================ indice

/** Documento indicizzato: un blocco con i dati del record padre. */
export interface SearchDoc {
  id: string;
  recordId: string;
  n: number;
  titolo: string;
  testo: string;
  tag: string;
  categoria: string;
}

export const INDEX_FORMAT = 1;

export const SEARCH_OPTIONS: Options<SearchDoc> = {
  fields: ['titolo', 'testo', 'tag', 'categoria'],
  storeFields: ['recordId', 'n'],
  tokenize,
  processTerm,
  searchOptions: {
    boost: { titolo: 2, tag: 1.5, testo: 1, categoria: 0.5 },
    // prefisso solo sull'ultima parola, quella che si sta ancora scrivendo ("stamp" → stampante):
    // sulle altre parole porterebbe rumore (auto → autorità)
    prefix: (term, i, terms) => i === terms.length - 1 && term.length >= 3,
    // tolleranza agli errori di battitura: 1 errore dai 5 caratteri, 2 dai 9
    fuzzy: (term) => (term.length >= 9 ? 2 : term.length >= 5 ? 1 : false),
    maxFuzzy: 2,
    combineWith: 'OR'
  }
};

export function toSearchDocs(chunks: Chunk[], records: Map<string, Pick<DbRecord, 'titolo' | 'tag' | 'categoria'>>): SearchDoc[] {
  return chunks.flatMap((c) => {
    const r = records.get(c.recordId);
    if (!r) return [];
    return [{ id: c.id, recordId: c.recordId, n: c.n, titolo: r.titolo, testo: c.testo, tag: r.tag.join(' '), categoria: r.categoria }];
  });
}

export function buildIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
  ms.addAll(docs);
  return ms;
}

export function loadIndex(json: string): MiniSearch<SearchDoc> {
  return MiniSearch.loadJSON<SearchDoc>(json, SEARCH_OPTIONS);
}

// ============================================================ ricerca

export interface Hit {
  chunkId: string;
  recordId: string;
  n: number;
  score: number;
  /** Termini del documento che hanno trovato corrispondenza (già normalizzati). */
  terms: string[];
}

export interface RetrieveOptions {
  /** Numero massimo di blocchi restituiti. */
  limit: number;
  /** Massimo di blocchi dallo stesso record, per dare spazio a fonti diverse. */
  maxPerRecord: number;
  /** I primi `minResults` blocchi con almeno un termine in comune vengono sempre tenuti… */
  minResults: number;
  /** …gli altri solo se hanno almeno questa frazione del punteggio migliore. */
  minRelativeScore: number;
}

export const DEFAULT_RETRIEVE: RetrieveOptions = { limit: 8, maxPerRecord: 3, minResults: 6, minRelativeScore: 0.1 };

/** Recupera i blocchi più pertinenti per una domanda in linguaggio naturale. */
export function retrieve(index: MiniSearch<SearchDoc>, query: string, opts: Partial<RetrieveOptions> = {}): Hit[] {
  const o = { ...DEFAULT_RETRIEVE, ...opts };
  if (!query.trim()) return [];
  const results: SearchResult[] = index.search(query);
  if (!results.length) return [];

  const top = results[0].score;
  const perRecord = new Map<string, number>();
  const hits: Hit[] = [];
  for (const r of results) {
    if (hits.length >= o.minResults && r.score < top * o.minRelativeScore) break;
    const recordId = r.recordId as string;
    const count = perRecord.get(recordId) ?? 0;
    if (count >= o.maxPerRecord) continue;
    perRecord.set(recordId, count + 1);
    hits.push({ chunkId: String(r.id), recordId, n: r.n as number, score: r.score, terms: r.terms });
    if (hits.length >= o.limit) break;
  }
  return hits;
}

/** Termini significativi della domanda (per mostrare all'utente cosa è stato cercato). */
export function queryTerms(query: string): string[] {
  return tokenize(query).filter((t) => processTerm(t) != null);
}

// ============================================================ evidenziazione

export interface Segment {
  text: string;
  mark: boolean;
}

/** Posizioni [inizio, fine) delle parole del testo che corrispondono ai termini trovati. */
export function matchRanges(text: string, terms: string[]): [number, number][] {
  const set = new Set(terms);
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(WORD)) {
    const p = processTerm(m[0]);
    if (p && set.has(p)) ranges.push([m.index!, m.index! + m[0].length]);
  }
  return ranges;
}

function toSegments(text: string, ranges: [number, number][], offset = 0): Segment[] {
  const out: Segment[] = [];
  let pos = offset;
  const end = offset + text.length;
  for (const [a, b] of ranges) {
    if (b <= offset || a >= end) continue;
    const s = Math.max(a, offset);
    const e = Math.min(b, end);
    if (s > pos) out.push({ text: text.slice(pos - offset, s - offset), mark: false });
    out.push({ text: text.slice(s - offset, e - offset), mark: true });
    pos = e;
  }
  if (pos < end) out.push({ text: text.slice(pos - offset), mark: false });
  return out;
}

/** Testo intero diviso in parti evidenziate e non. */
export function highlight(text: string, terms: string[]): Segment[] {
  return toSegments(text, matchRanges(text, terms));
}

/**
 * Estratto di ~`size` caratteri centrato sulla zona con più termini trovati,
 * tagliato a inizio/fine parola, con "…" se il testo continua.
 */
export function snippet(text: string, terms: string[], size = 320): Segment[] {
  const ranges = matchRanges(text, terms);
  if (text.length <= size) return toSegments(text, ranges);

  // finestra con il maggior numero di corrispondenze
  let bestStart = 0;
  let bestCount = -1;
  let j = 0;
  for (let i = 0; i < ranges.length; i++) {
    while (j < ranges.length && ranges[j][1] <= ranges[i][0] + size) j++;
    if (j - i > bestCount) { bestCount = j - i; bestStart = ranges[i][0]; }
  }
  // se l'inizio del testo è quasi altrettanto ricco di corrispondenze, partire dall'inizio è più naturale
  const fromTop = ranges.filter(([, b]) => b <= size).length;
  // altrimenti, un po' di contesto prima della prima corrispondenza
  let start = fromTop > 0 && fromTop >= bestCount - 1
    ? 0
    : Math.max(0, Math.min(bestStart - Math.floor(size / 4), text.length - size));
  let end = Math.min(text.length, start + size);
  if (start > 0) {
    const ws = text.slice(start, start + 40).search(/\s/);
    if (ws >= 0) start += ws + 1;
  }
  if (end < text.length) {
    const back = text.slice(end - 40, end).search(/\s\S*$/);
    if (back >= 0) end = end - 40 + back;
  }
  const segs = toSegments(text.slice(start, end), ranges, start);
  if (start > 0) segs.unshift({ text: '… ', mark: false });
  if (end < text.length) segs.push({ text: ' …', mark: false });
  return segs;
}
