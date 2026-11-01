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

export const INDEX_FORMAT = 2; // 2: categoria tra i campi memorizzati (filtro per argomento)

export const SEARCH_OPTIONS: Options<SearchDoc> = {
  fields: ['titolo', 'testo', 'tag', 'categoria'],
  storeFields: ['recordId', 'n', 'categoria'],
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
  /** Argomenti (categorie) in cui cercare; vuoto o assente = tutti. */
  categorie?: string[];
}

export const DEFAULT_RETRIEVE: RetrieveOptions = { limit: 8, maxPerRecord: 3, minResults: 6, minRelativeScore: 0.1 };

/** "Schede Tecniche " → "schede tecniche" (confronto delle categorie). */
export const normCategory = (c: string) => stripAccents(c).toLowerCase().replace(/\s+/g, ' ').trim();

function categoryFilter(categorie?: string[]): ((r: SearchResult) => boolean) | undefined {
  if (!categorie?.length) return undefined;
  const set = new Set(categorie.map(normCategory));
  return (r) => set.has(normCategory(String(r.categoria ?? '')));
}

// ---------- confronti esatti (frasi, parole esatte, esclusioni)

/** Testo per i confronti esatti: minuscole, senza accenti e punteggiatura, con spazi ai bordi. */
export function normalizeForMatch(s: string): string {
  const t = stripAccents(s.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return ` ${t} `;
}

/** La frase (o la parola) compare intera nel testo già normalizzato con normalizeForMatch? */
export function containsPhrase(normText: string, phrase: string): boolean {
  const p = normalizeForMatch(phrase).trim();
  return !p || normText.includes(` ${p} `);
}

/** La parola compare in qualche sua forma (singolare/plurale, maschile/femminile)? */
export function containsWordForm(text: string, word: string): boolean {
  const target = processTerm(word);
  if (!target) return false;
  return tokenize(text).some((t) => processTerm(t) === target);
}

/** Parole di un campo ("ponteggio, parapetto" → ["ponteggio", "parapetto"]), senza stopword. */
export function wordsOf(s: string): string[] {
  return tokenize(s).filter((t) => processTerm(t) != null);
}

// ---------- ricerca semplice: anche "frasi tra virgolette" e -esclusioni

export interface ParsedQuery {
  /** testo libero (senza frasi ed esclusioni) */
  text: string;
  phrases: string[];
  exclude: string[];
}

/** Riconosce "frase esatta", «frase esatta», -parola e -"frase" nella casella di ricerca. */
export function parseSimpleQuery(q: string): ParsedQuery {
  const phrases: string[] = [];
  const exclude: string[] = [];
  let rest = q.replace(/(^|\s)-["“«]([^"”»]+)["”»]/g, (_, sp, ph) => { exclude.push(ph.trim()); return sp; });
  rest = rest.replace(/["“«]([^"”»]+)["”»]/g, (_, ph) => { phrases.push(ph.trim()); return ' '; });
  rest = rest.replace(/(^|\s)-([\p{L}\p{N}][\p{L}\p{N}'’-]*)/gu, (_, sp, w) => { exclude.push(w); return sp; });
  return { text: rest.replace(/\s+/g, ' ').trim(), phrases: phrases.filter(Boolean), exclude: exclude.filter(Boolean) };
}

/**
 * Candidati della ricerca semplice: prima i blocchi che contengono TUTTE le parole significative,
 * poi quelli che ne contengono almeno una (in ordine di pertinenza).
 */
export function candidates(index: MiniSearch<SearchDoc>, query: string, categorie?: string[]): { results: SearchResult[]; parsed: ParsedQuery } {
  const parsed = parseSimpleQuery(query);
  const text = [parsed.text, ...parsed.phrases].join(' ').trim();
  if (!text || !wordsOf(text).length) return { results: [], parsed };
  const filter = categoryFilter(categorie);
  const all = index.search(text, { combineWith: 'AND', filter });
  const any = index.search(text, { combineWith: 'OR', filter });
  const seen = new Set(all.map((r) => r.id));
  // i blocchi con tutte le parole vengono prima; il punteggio "OR" resta per il taglio relativo
  return { results: [...all, ...any.filter((r) => !seen.has(r.id))], parsed };
}

/** Sceglie i blocchi da mostrare: massimo per record, limite, soglia relativa. */
export function selectHits(results: SearchResult[], opts: Partial<RetrieveOptions> = {}, accept: (r: SearchResult) => boolean = () => true): Hit[] {
  const o = { ...DEFAULT_RETRIEVE, ...opts };
  if (!results.length) return [];
  const top = Math.max(...results.map((r) => r.score));
  const perRecord = new Map<string, number>();
  const hits: Hit[] = [];
  for (const r of results) {
    if (hits.length >= o.minResults && r.score < top * o.minRelativeScore) continue;
    if (!accept(r)) continue;
    const recordId = r.recordId as string;
    const count = perRecord.get(recordId) ?? 0;
    if (count >= o.maxPerRecord) continue;
    perRecord.set(recordId, count + 1);
    hits.push({ chunkId: String(r.id), recordId, n: r.n as number, score: r.score, terms: r.terms });
    if (hits.length >= o.limit) break;
  }
  return hits;
}

/** Recupera i blocchi più pertinenti per una domanda (senza i controlli sul testo di frasi ed esclusioni). */
export function retrieve(index: MiniSearch<SearchDoc>, query: string, opts: Partial<RetrieveOptions> = {}): Hit[] {
  if (!query.trim()) return [];
  return selectHits(candidates(index, query, opts.categorie).results, opts);
}

// ---------- ricerca dettagliata

export interface DetailedQuery {
  /** Tutte queste parole */
  all: string;
  /** Frasi esatte */
  phrases: string[];
  /** Almeno una di queste parole */
  any: string;
  /** Nessuna di queste parole */
  none: string;
  /** Solo parole esatte: niente plurali, varianti o errori di battitura */
  exact: boolean;
}

export const EMPTY_DETAILED: DetailedQuery = { all: '', phrases: [], any: '', none: '', exact: false };

export function isDetailedEmpty(q: DetailedQuery): boolean {
  return !wordsOf(q.all).length && !q.phrases.some((p) => wordsOf(p).length) && !wordsOf(q.any).length;
}

/** Candidati della ricerca dettagliata (i controlli esatti si fanno poi sul testo con matchesDetailed). */
export function detailedCandidates(index: MiniSearch<SearchDoc>, q: DetailedQuery, categorie?: string[]): SearchResult[] {
  const required = [q.all, ...q.phrases].join(' ').trim();
  const any = q.any.trim();
  const base = {
    prefix: false,
    fuzzy: q.exact ? false : (term: string) => (term.length >= 6 ? 1 : false),
    filter: categoryFilter(categorie)
  };
  const hasReq = wordsOf(required).length > 0;
  const hasAny = wordsOf(any).length > 0;
  if (hasReq && hasAny) {
    return index.search({ combineWith: 'AND', queries: [required, { combineWith: 'OR', queries: [any] }] }, base);
  }
  if (hasReq) return index.search(required, { ...base, combineWith: 'AND' });
  if (hasAny) return index.search(any, { ...base, combineWith: 'OR' });
  return [];
}

/**
 * Controllo finale su un blocco: frasi esatte presenti, parole esatte (se richiesto),
 * nessuna parola esclusa nella scheda (titolo + testo completo).
 */
export function matchesDetailed(chunkText: string, titolo: string, recordText: string, q: DetailedQuery): boolean {
  const norm = normalizeForMatch(`${titolo} ${chunkText}`);
  if (!q.phrases.every((ph) => containsPhrase(norm, ph))) return false;
  if (q.exact) {
    if (!wordsOf(q.all).every((w) => containsPhrase(norm, w))) return false;
    const anyWords = wordsOf(q.any);
    if (anyWords.length && !anyWords.some((w) => containsPhrase(norm, w))) return false;
  }
  const excluded = wordsOf(q.none);
  if (excluded.length) {
    const whole = `${titolo} ${recordText}`;
    const wholeNorm = normalizeForMatch(whole);
    if (excluded.some((w) => (q.exact ? containsPhrase(wholeNorm, w) : containsWordForm(whole, w) || containsPhrase(wholeNorm, w)))) return false;
  }
  return true;
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
export function snippet(text: string, terms: string[], size = 320, phrases: string[] = []): Segment[] {
  const ranges = matchRanges(text, terms);
  if (text.length <= size) return toSegments(text, ranges);

  // ricerca di una frase esatta: l'estratto parte da dove compare la frase
  const at = phraseIndex(text, phrases);
  if (at >= 0) return windowAt(text, ranges, Math.max(0, Math.min(at - Math.floor(size / 4), text.length - size)), size);

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
  const start = fromTop > 0 && fromTop >= bestCount - 1
    ? 0
    : Math.max(0, Math.min(bestStart - Math.floor(size / 4), text.length - size));
  return windowAt(text, ranges, start, size);
}

/** Posizione della prima frase cercata nel testo (maiuscole e punteggiatura ignorate), o -1. */
export function phraseIndex(text: string, phrases: string[]): number {
  let best = -1;
  for (const ph of phrases) {
    const words = tokenize(ph).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) continue;
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${words.join('[^\\p{L}\\p{N}]+')})(?![\\p{L}\\p{N}])`, 'iu').exec(text);
    if (m && (best < 0 || m.index + m[1].length < best)) best = m.index + m[1].length;
  }
  return best;
}

function windowAt(text: string, ranges: [number, number][], from: number, size: number): Segment[] {
  let start = from;
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
