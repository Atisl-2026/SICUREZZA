import MiniSearch, { type Options, type SearchResult } from 'minisearch';
import { stripAccents } from './normalize.ts';
import type { Chunk, DbRecord } from './types.ts';
import { findHeadings, headingText } from './articles.ts';

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

/**
 * Parole: sequenze di lettere oppure di cifre. Lettere e cifre attaccate si separano:
 * «preposto253» (numero di pagina nell'indice di un PDF) → «preposto», «253»; «art.18» → «art», «18».
 */
const WORD = /\p{L}+|\p{N}+/gu;

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isNum = (w: string) => /^\p{N}/u.test(w);

/**
 * Espressione che trova una frase (o una parola) intera: maiuscole e punteggiatura ignorate,
 * lettere e cifre attaccate ammesse («art.18», «preposto253»).
 * Il gruppo 1 è il carattere che precede (niente "lookbehind": non funziona su Safari iOS 15/16.3);
 * la frase inizia a m.index + m[1].length.
 */
export function phraseRegex(phrase: string, flags = 'iu'): RegExp | null {
  const words = tokenize(phrase);
  if (!words.length) return null;
  let body = escapeRe(words[0]);
  for (let i = 1; i < words.length; i++) {
    // tra lettere e cifre lo spazio può mancare; tra due parole dello stesso tipo serve un separatore
    const sep = isNum(words[i - 1]) !== isNum(words[i]) ? '[^\\p{L}\\p{N}]*' : '[^\\p{L}\\p{N}]+';
    body += sep + escapeRe(words[i]);
  }
  const before = isNum(words[0]) ? '(^|[^\\p{N}])' : '(^|[^\\p{L}])';
  const after = isNum(words[words.length - 1]) ? '(?!\\p{N})' : '(?!\\p{L})';
  return new RegExp(`${before}${body}${after}`, flags);
}

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
  let s = t;
  // ponteggio/ponteggi, rischio/rischi, ufficio/uffici: «-io» e «-i» danno la stessa radice
  if (/io$/.test(s) && s.length > 4) s = s.slice(0, -2);
  else if (/[aeiou]$/.test(s)) s = s.slice(0, -1);
  // banca/banche, rischio/rischi, obbligo/obblighi: la «h» del plurale non conta
  if (/[cg]h$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Normalizzazione di ogni termine (indice e domande): minuscole, senza accenti, senza stopword, stem. */
export function processTerm(term: string): string | null {
  const t = stripAccents(term.toLowerCase());
  if (t.length < 2 && !/\d/.test(t)) return null;
  if (STOPWORDS.has(t)) return null;
  return stemIt(t);
}

// ============================================================ sinonimi tecnici

/**
 * Sinonimi della sicurezza nei cantieri: la normativa usa spesso parole diverse da quelle che usa
 * chi descrive una foto («impalcato» / «impalcature», «mantovana» / «parasassi»). Usati per cercare
 * le norme a partire dalle criticità di una foto.
 */
const SINONIMI: string[][] = [
  ['impalcato', 'impalcatura', 'ponte di servizio'],
  ['mantovana', 'parasassi'],
  ['parapetto', 'parapetti'],
  ['fermapiede', 'tavola fermapiede'],
  ['casco', 'elmetto', 'copricapo', 'dispositivi di protezione individuale'],
  ['imbracatura', 'cintura di sicurezza', 'dispositivo anticaduta'],
  ['ancoraggio', 'ancorato'],
  ['trabattello', 'ponte su ruote'],
  ['scala', 'scala portatile'],
  ['scavo', 'parete dello scavo', 'armatura'],
  ['carriola', 'materiale', 'deposito'],
  ['materiale', 'deposito'],
  ['dpi', 'dispositivi di protezione individuale'],
  ['guanto', 'dispositivi di protezione individuale'],
  ['estintore', 'antincendio'],
  ['recinzione', 'delimitazione'],
  ['segnaletica', 'cartello'],
  ['cavo', 'impianto elettrico'],
  ['quadro elettrico', 'impianto elettrico']
];

/** Aggiunge alla ricerca i sinonimi tecnici delle parole presenti. */
export function expandSynonyms(q: string): string {
  const stems = new Set(tokenize(q).map((w) => processTerm(w)).filter(Boolean) as string[]);
  const extra = new Set<string>();
  for (const group of SINONIMI) {
    const hit = group.some((g) => tokenize(g).every((w) => { const p = processTerm(w); return !p || stems.has(p); }));
    if (hit) for (const g of group) extra.add(g);
  }
  return extra.size ? `${q} ${[...extra].join(' ')}` : q;
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
  /** rubriche degli articoli del blocco («Art. 19 – Obblighi del preposto»): pesano più del testo */
  rubrica?: string;
}

// 2: categoria tra i campi memorizzati; 3: lettere e cifre attaccate separate; 4: rubriche degli articoli;
export const INDEX_FORMAT = 5; // 5: radici «-io/-i» unificate (ponteggio/ponteggi)

export const SEARCH_OPTIONS: Options<SearchDoc> = {
  fields: ['titolo', 'testo', 'tag', 'categoria', 'rubrica'],
  storeFields: ['recordId', 'n', 'categoria'],
  tokenize,
  processTerm,
  searchOptions: {
    boost: { titolo: 2, rubrica: 2.5, tag: 1.5, testo: 1, categoria: 0.5 },
    // prefisso solo sull'ultima parola, quella che si sta ancora scrivendo ("stamp" → stampante):
    // sulle altre parole porterebbe rumore (auto → autorità)
    prefix: (term, i, terms) => i === terms.length - 1 && term.length >= 3,
    // tolleranza agli errori di battitura: 1 errore dai 5 caratteri, 2 dai 9
    fuzzy: (term) => (term.length >= 9 ? 2 : term.length >= 5 ? 1 : false),
    maxFuzzy: 2,
    combineWith: 'OR'
  }
};

type IndexedRecord = Pick<DbRecord, 'titolo' | 'tag' | 'categoria'> & { testo?: string };

/** Rubrica degli articoli toccati da ogni blocco (quello in cui inizia e quelli che contiene). */
function rubriche(text: string, chunks: Chunk[]): Map<string, string> {
  const out = new Map<string, string>();
  const sections = findHeadings(text);
  if (!sections.length) return out;
  let from = 0;
  let k = 0;
  for (const c of [...chunks].sort((a, b) => a.n - b.n)) {
    // i blocchi sono in ordine: si cerca a partire dal precedente (niente ricerche sull'intero testo)
    let start = text.indexOf(c.testo.slice(0, 120), Math.max(0, from - 2000));
    if (start < 0) start = text.indexOf(c.testo.slice(0, 120));
    if (start < 0) continue;
    from = start;
    const end = start + c.testo.length;
    while (k + 1 < sections.length && sections[k + 1].pos <= start) k++;
    const parts: string[] = [];
    if (sections[k] && sections[k].pos <= start) parts.push(headingText(sections[k]));
    for (let j = k + 1; j < sections.length && sections[j].pos < end; j++) parts.push(headingText(sections[j]));
    if (parts.length) out.set(c.id, parts.join(' · '));
  }
  return out;
}

export function toSearchDocs(chunks: Chunk[], records: Map<string, IndexedRecord>): SearchDoc[] {
  const byRecord = new Map<string, Chunk[]>();
  for (const c of chunks) byRecord.set(c.recordId, [...(byRecord.get(c.recordId) ?? []), c]);
  const rub = new Map<string, string>();
  for (const [id, list] of byRecord) {
    const t = records.get(id)?.testo;
    if (t) for (const [cid, v] of rubriche(t, list)) rub.set(cid, v);
  }
  return chunks.flatMap((c) => {
    const r = records.get(c.recordId);
    if (!r) return [];
    const doc: SearchDoc = { id: c.id, recordId: c.recordId, n: c.n, titolo: r.titolo, testo: c.testo, tag: r.tag.join(' '), categoria: r.categoria };
    const rb = rub.get(c.id);
    if (rb) doc.rubrica = rb;
    return [doc];
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
  /** Solo nella Normativa: documento scelto (id della scheda); le altre categorie restano intere. */
  documento?: string;
}

export const DEFAULT_RETRIEVE: RetrieveOptions = { limit: 8, maxPerRecord: 3, minResults: 6, minRelativeScore: 0.1 };

/** "Schede Tecniche " → "schede tecniche" (confronto delle categorie). */
export const normCategory = (c: string) => stripAccents(c).toLowerCase().replace(/\s+/g, ' ').trim();

export const NORMATIVA = 'normativa';

/**
 * Dove cercare: argomenti scelti (vuoto = tutti) e, solo per la Normativa, un documento preciso.
 * Con un documento scelto, della Normativa si cerca solo in quello; gli altri argomenti restano interi.
 */
function categoryFilter(categorie?: string[], documento?: string): ((r: SearchResult) => boolean) | undefined {
  if (!categorie?.length && !documento) return undefined;
  const set = categorie?.length ? new Set(categorie.map(normCategory)) : null;
  return (r) => {
    const c = normCategory(String(r.categoria ?? ''));
    if (set && !set.has(c)) return false;
    return !documento || c !== NORMATIVA || r.recordId === documento;
  };
}

// ---------- confronti esatti (frasi, parole esatte, esclusioni)

/** Testo per i confronti esatti: minuscole, senza accenti e punteggiatura, con spazi ai bordi. */
export function normalizeForMatch(s: string): string {
  const t = stripAccents(s.toLowerCase())
    .replace(/(\p{L})(?=\p{N})|(\p{N})(?=\p{L})/gu, '$1$2 ') // «preposto253» → «preposto 253»
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
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
 * Tolleranza agli errori e completamento della parola SOLO per le parole che non esistono
 * nell'archivio: «preposto» trova preposto/preposti/preposta, non «proposta»;
 * «prepsto» (errore di battitura) trova comunque «preposto».
 */
export interface TermPlan {
  /** termini (normalizzati) presenti esattamente nell'archivio */
  exact: Set<string>;
  /** parole cercate che non esistono nell'archivio: si cercano parole simili */
  simili: string[];
  fuzzy: (term: string) => number | false;
  prefix: (term: string, i: number, terms: string[]) => boolean;
}

export function planTerms(index: MiniSearch<SearchDoc>, text: string): TermPlan {
  const exact = new Set<string>();
  const simili: string[] = [];
  const seen = new Set<string>();
  for (const w of wordsOf(text)) {
    const p = processTerm(w);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (index.search(w, { fuzzy: false, prefix: false }).length) exact.add(p);
    else simili.push(w);
  }
  return {
    exact,
    simili,
    fuzzy: (term) => (exact.has(term) ? false : term.length >= 9 ? 2 : term.length >= 5 ? 1 : false),
    // ultima parola ancora da finire di scrivere ("stamp" → stampante), solo se non esiste così com'è
    prefix: (term, i, terms) => !exact.has(term) && i === terms.length - 1 && term.length >= 3
  };
}

export interface Candidates {
  /** prima i blocchi con TUTTE le parole, poi quelli con almeno una */
  results: SearchResult[];
  /** quanti dei primi risultati contengono tutte le parole */
  conTutte: number;
  parsed: ParsedQuery;
  /** parole non presenti nell'archivio, cercate come parole simili */
  simili: string[];
}

/**
 * Candidati della ricerca semplice: prima i blocchi che contengono TUTTE le parole significative,
 * poi quelli che ne contengono almeno una (in ordine di pertinenza).
 */
export function candidates(index: MiniSearch<SearchDoc>, query: string, categorie?: string[], documento?: string): Candidates {
  const parsed = parseSimpleQuery(query);
  const text = [parsed.text, ...parsed.phrases].join(' ').trim();
  if (!text || !wordsOf(text).length) return { results: [], conTutte: 0, parsed, simili: [] };
  const plan = planTerms(index, text);
  const base = { filter: categoryFilter(categorie, documento), fuzzy: plan.fuzzy, prefix: plan.prefix };
  const all = index.search(text, { ...base, combineWith: 'AND' });
  const any = index.search(text, { ...base, combineWith: 'OR' });
  const seen = new Set(all.map((r) => r.id));
  // i blocchi con tutte le parole vengono prima; il punteggio "OR" resta per il taglio relativo
  return { results: [...all, ...any.filter((r) => !seen.has(r.id))], conTutte: all.length, parsed, simili: plan.simili };
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
  // posti rimasti liberi (pochi documenti pertinenti, es. un solo testo unico): si riempiono con
  // altri blocchi degli stessi documenti, senza il limite per documento
  if (hits.length < o.limit && hits.length < results.length) {
    const taken = new Set(hits.map((h) => h.chunkId));
    for (const r of results) {
      if (hits.length >= o.limit) break;
      if (taken.has(String(r.id)) || r.score < top * o.minRelativeScore || !accept(r)) continue;
      hits.push({ chunkId: String(r.id), recordId: r.recordId as string, n: r.n as number, score: r.score, terms: r.terms });
    }
    hits.sort((a, b) => b.score - a.score);
  }
  return hits;
}

/** Recupera i blocchi più pertinenti per una domanda (senza i controlli sul testo di frasi ed esclusioni). */
export function retrieve(index: MiniSearch<SearchDoc>, query: string, opts: Partial<RetrieveOptions> = {}): Hit[] {
  if (!query.trim()) return [];
  return selectHits(candidates(index, query, opts.categorie, opts.documento).results, opts);
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
export function detailedCandidates(index: MiniSearch<SearchDoc>, q: DetailedQuery, categorie?: string[], documento?: string): SearchResult[] {
  const required = [q.all, ...q.phrases].join(' ').trim();
  const any = q.any.trim();
  const plan = planTerms(index, [required, any].join(' '));
  const base = {
    prefix: false,
    // parole simili solo per le parole che non esistono nell'archivio
    fuzzy: q.exact ? false : (term: string) => (plan.exact.has(term) ? false : term.length >= 6 ? 1 : false),
    filter: categoryFilter(categorie, documento)
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

/** Quante volte compaiono nel testo le parole trovate (in ogni forma) o le frasi esatte. */
export function countOccurrences(text: string, terms: Iterable<string>, phrases: string[] = []): number {
  if (phrases.length) {
    const plain = stripAccents(text);
    let n = 0;
    for (const ph of phrases) {
      const re = phraseRegex(stripAccents(ph), 'giu');
      if (re) n += [...plain.matchAll(re)].length;
    }
    return n;
  }
  let n = 0;
  for (const c of formsOf(text, terms).values()) n += c;
  return n;
}

/** Quante volte compare ogni forma delle parole cercate (es. preposto 347, preposti 344). */
export function formsOf(text: string, terms: Iterable<string>): Map<string, number> {
  const set = new Set(terms);
  const out = new Map<string, number>();
  if (!set.size) return out;
  // prima un filtro veloce sulle parole che iniziano come i termini cercati, poi il controllo esatto
  const plain = stripAccents(text.toLowerCase());
  const byLength = [...set].sort((a, b) => b.length - a.length);
  const words = byLength.filter((t) => !isNum(t)).map(escapeRe);
  const nums = byLength.filter(isNum).map(escapeRe);
  // parole che iniziano come i termini cercati (gruppo 2), poi il controllo esatto; niente "lookbehind" (Safari iOS)
  const res = [
    words.length && new RegExp(`(^|[^\\p{L}])((?:${words.join('|')})\\p{L}*)`, 'gu'),
    nums.length && new RegExp(`(^|[^\\p{N}])(${nums.join('|')})(?!\\p{N})`, 'gu')
  ].filter((r): r is RegExp => !!r);
  for (const re of res) {
    for (const m of plain.matchAll(re)) {
      if (set.has(processTerm(m[2]) ?? '')) out.set(m[2], (out.get(m[2]) ?? 0) + 1);
    }
  }
  return out;
}

/** Termini significativi della domanda (per mostrare all'utente cosa è stato cercato). */
export function queryTerms(query: string): string[] {
  return tokenize(query).filter((t) => processTerm(t) != null);
}

// ============================================================ evidenziazione

export interface Segment {
  text: string;
  /** parola cercata (giallo) */
  mark: boolean;
  /** intestazione di un articolo (verde chiaro) */
  art?: boolean;
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

function toSegments(text: string, ranges: [number, number][], offset = 0, artRanges: [number, number][] = []): Segment[] {
  const end = offset + text.length;
  const inside = (list: [number, number][], p: number) => list.some(([a, b]) => p >= a && p < b);
  const cuts = new Set<number>([offset, end]);
  for (const [a, b] of [...ranges, ...artRanges]) {
    if (b <= offset || a >= end) continue;
    cuts.add(Math.max(a, offset));
    cuts.add(Math.min(b, end));
  }
  const points = [...cuts].sort((x, y) => x - y);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (a === b) continue;
    const seg: Segment = { text: text.slice(a - offset, b - offset), mark: inside(ranges, a) };
    if (artRanges.length && inside(artRanges, a)) seg.art = true;
    const prev = out[out.length - 1];
    if (prev && prev.mark === seg.mark && !!prev.art === !!seg.art) prev.text += seg.text;
    else out.push(seg);
  }
  return out;
}

/** Testo intero diviso in parti evidenziate e non. */
export function highlight(text: string, terms: string[], artRanges: [number, number][] = []): Segment[] {
  return toSegments(text, matchRanges(text, terms), 0, artRanges);
}

/**
 * Estratto di ~`size` caratteri centrato sulla zona con più termini trovati,
 * tagliato a inizio/fine parola, con "…" se il testo continua.
 */
export function snippet(text: string, terms: string[], size = 320, phrases: string[] = [], artRanges: [number, number][] = []): Segment[] {
  const ranges = matchRanges(text, terms);
  if (text.length <= size) return toSegments(text, ranges, 0, artRanges);

  // ricerca di una frase esatta: l'estratto parte da dove compare la frase
  const at = phraseIndex(text, phrases);
  if (at >= 0) return windowAt(text, ranges, Math.max(0, Math.min(at - Math.floor(size / 4), text.length - size)), size, artRanges);

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
  return windowAt(text, ranges, start, size, artRanges);
}

/** Posizione della prima frase cercata nel testo (maiuscole e punteggiatura ignorate), o -1. */
export function phraseIndex(text: string, phrases: string[]): number {
  let best = -1;
  for (const ph of phrases) {
    const m = phraseRegex(ph)?.exec(text);
    if (m && (best < 0 || m.index + m[1].length < best)) best = m.index + m[1].length;
  }
  return best;
}

function windowAt(text: string, ranges: [number, number][], from: number, size: number, artRanges: [number, number][] = []): Segment[] {
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
  const segs = toSegments(text.slice(start, end), ranges, start, artRanges);
  if (start > 0) segs.unshift({ text: '… ', mark: false });
  if (end < text.length) segs.push({ text: ' …', mark: false });
  return segs;
}
