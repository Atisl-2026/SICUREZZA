import type MiniSearch from 'minisearch';
import type { SearchResult } from 'minisearch';
import {
  buildIndex, candidates, countOccurrences, detailedCandidates, EMPTY_DETAILED, INDEX_FORMAT, isDetailedEmpty, loadIndex,
  formsOf, matchesDetailed, NORMATIVA, normCategory, planTerms, processTerm, selectHits, toSearchDocs, wordsOf, type DetailedQuery, type Hit,
  type RetrieveOptions, type SearchDoc
} from '../shared/search.ts';
import type { Chunk, StoredRecord } from '../shared/types.ts';
import { db, getMeta, setMeta } from './db';
import { getSettings } from './settings';

interface SavedIndex {
  formato: number;
  revisione: number;
  json: string;
}

let current: { revisione: number; index: MiniSearch<SearchDoc> } | null = null;
let pending: { revisione: number; promise: Promise<MiniSearch<SearchDoc>> } | null = null;

/**
 * Indice MiniSearch dei blocchi.
 * - In memoria finché i dati non cambiano (contatore "revisione" del database).
 * - Salvato in IndexedDB: alla riapertura dell'app non va ricostruito.
 */
export async function getIndex(): Promise<MiniSearch<SearchDoc>> {
  const revisione = await getMeta<number>('revisione', 0);
  if (current?.revisione === revisione) return current.index;
  if (pending?.revisione === revisione) return pending.promise;

  const promise = (async () => {
    const saved = await getMeta<SavedIndex | null>('indice', null);
    let index: MiniSearch<SearchDoc> | null = null;
    if (saved && saved.formato === INDEX_FORMAT && saved.revisione === revisione) {
      try {
        index = loadIndex(saved.json);
      } catch {
        index = null; // indice salvato corrotto: si ricostruisce
      }
    }
    if (!index) {
      const [chunks, records] = await Promise.all([db.chunks.toArray(), db.records.toArray()]);
      index = buildIndex(toSearchDocs(chunks, new Map(records.map((r) => [r.id, r]))));
      // salvataggio in background: non blocca la prima ricerca.
      // Si salva solo se nel frattempo i dati non sono cambiati (es. uscita dall'accesso: niente indice residuo).
      const json = JSON.stringify(index);
      db.transaction('rw', db.meta, async () => {
        if ((await getMeta<number>('revisione', 0)) === revisione) {
          await setMeta('indice', { formato: INDEX_FORMAT, revisione, json } satisfies SavedIndex);
        }
      }).catch(() => {});
    }
    current = { revisione, index };
    return index;
  })();
  pending = { revisione, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = null;
  }
}

export interface LocalResult extends Hit {
  chunk: Chunk;
  record: StoredRecord;
  /** frasi esatte cercate: l'estratto parte da lì */
  phrases?: string[];
}

/** Quanti candidati leggere al massimo per i controlli sul testo (frasi, esclusioni, parole esatte). */
const MAX_TEXT_CHECK = 6000;

async function loadTexts(ids: string[]) {
  const chunks = await db.chunks.bulkGet(ids);
  const recIds = [...new Set(chunks.filter((c): c is Chunk => !!c).map((c) => c.recordId))];
  const records = await db.records.bulkGet(recIds);
  return {
    chunks: new Map(chunks.filter((c): c is Chunk => !!c).map((c) => [c.id, c])),
    records: new Map(records.filter((r): r is StoredRecord => !!r).map((r) => [r.id, r]))
  };
}

function attach(hits: Hit[], data: Awaited<ReturnType<typeof loadTexts>>, phrases?: string[]): LocalResult[] {
  return hits.flatMap((h) => {
    const chunk = data.chunks.get(h.chunkId);
    const record = data.records.get(h.recordId);
    return chunk && record ? [{ ...h, chunk, record, ...(phrases?.length ? { phrases } : {}) }] : [];
  });
}

/**
 * Ricerca locale: i 6–8 blocchi più pertinenti, con il record padre.
 * Nella casella si possono usare "frasi tra virgolette" e -parole da escludere.
 */
export async function searchLocal(query: string, opts: Partial<RetrieveOptions> = {}): Promise<LocalResult[]> {
  const index = await getIndex();
  const { results, parsed } = candidates(index, query, opts.categorie, opts.documento);
  if (!results.length) return [];

  if (!parsed.phrases.length && !parsed.exclude.length) {
    const hits = selectHits(results, opts);
    return attach(hits, await loadTexts(hits.map((h) => h.chunkId)));
  }
  // frasi ed esclusioni: controllo sul testo dei candidati
  const pool = results.slice(0, MAX_TEXT_CHECK);
  const data = await loadTexts(pool.map((r) => String(r.id)));
  const accept = (r: SearchResult) => {
    const chunk = data.chunks.get(String(r.id));
    const record = chunk && data.records.get(chunk.recordId);
    if (!chunk || !record) return false;
    return matchesDetailed(chunk.testo, record.titolo, record.testo, {
      ...EMPTY_DETAILED, phrases: parsed.phrases, none: parsed.exclude.join(' ')
    });
  };
  return attach(selectHits(pool, opts, accept), data, parsed.phrases);
}

export interface DetailedResult {
  results: LocalResult[];
  /** blocchi che soddisfano la ricerca (prima del limite) */
  totale: number;
}

/**
 * Ricerca dettagliata: tutte le parole, frasi esatte, almeno una parola, esclusioni, parole esatte.
 * Restituisce i passaggi che soddisfano tutte le condizioni, in ordine di pertinenza.
 */
export async function searchDetailed(q: DetailedQuery, categorie?: string[], limit = 30, documento?: string): Promise<DetailedResult> {
  if (isDetailedEmpty(q)) return { results: [], totale: 0 };
  const index = await getIndex();
  const pool = detailedCandidates(index, q, categorie, documento).slice(0, MAX_TEXT_CHECK);
  if (!pool.length) return { results: [], totale: 0 };
  const data = await loadTexts(pool.map((r) => String(r.id)));
  const ok = pool.filter((r) => {
    const chunk = data.chunks.get(String(r.id));
    const record = chunk && data.records.get(chunk.recordId);
    return !!chunk && !!record && matchesDetailed(chunk.testo, record.titolo, record.testo, q);
  });
  // tutti i passaggi validi, al massimo 3 per scheda, senza soglia di punteggio
  const hits = selectHits(ok, { limit, maxPerRecord: 3, minResults: limit, minRelativeScore: 0 });
  return { results: attach(hits, data, q.phrases), totale: ok.length };
}

// ============================================================ tutti i risultati

export interface DocMatches {
  recordId: string;
  titolo: string;
  categoria: string;
  /** passaggi del documento che corrispondono, nell'ordine del testo */
  passaggi: Hit[];
  /** quante volte compaiono le parole (o le frasi) cercate nel documento intero */
  occorrenze: number;
  /** occorrenze per forma della parola (preposto, preposti…), dalla più frequente */
  forme: [string, number][];
}

export interface AllMatches {
  documenti: DocMatches[];
  passaggi: number;
  occorrenze: number;
  /** occorrenze per forma della parola in tutto l'archivio */
  forme: [string, number][];
  /** parole non presenti nell'archivio, cercate come parole simili */
  simili: string[];
  /** frasi esatte cercate (per l'evidenziazione) */
  phrases: string[];
  /** true se mostra i passaggi con TUTTE le parole; false se solo con alcune */
  conTutte: boolean;
}

const EMPTY_ALL: AllMatches = { documenti: [], passaggi: 0, occorrenze: 0, forme: [], simili: [], phrases: [], conTutte: true };

/** Raggruppa per documento (prima i più pertinenti) e conta le occorrenze nel testo completo. */
async function groupByDocument(
  results: SearchResult[],
  phrases: string[],
  countTerms?: Set<string>,
  countPhrases: string[] = phrases
): Promise<Omit<AllMatches, 'simili' | 'conTutte'>> {
  const docs = new Map<string, { hits: Hit[]; terms: Set<string> }>();
  for (const r of results) {
    const recordId = String(r.recordId);
    const d = docs.get(recordId) ?? { hits: [], terms: new Set<string>() };
    d.hits.push({ chunkId: String(r.id), recordId, n: r.n as number, score: r.score, terms: r.terms });
    r.terms.forEach((t) => d.terms.add(t));
    docs.set(recordId, d);
  }
  const records = await db.records.bulkGet([...docs.keys()]);
  const documenti: DocMatches[] = [];
  for (const rec of records) {
    if (!rec) continue;
    const d = docs.get(rec.id)!;
    const forme = countPhrases.length ? new Map<string, number>() : formsOf(rec.testo, countTerms ?? d.terms);
    documenti.push({
      recordId: rec.id,
      titolo: rec.titolo,
      categoria: rec.categoria,
      passaggi: d.hits.sort((a, b) => a.n - b.n),
      occorrenze: countPhrases.length ? countOccurrences(rec.testo, [], countPhrases) : [...forme.values()].reduce((a, b) => a + b, 0),
      forme: [...forme].sort((a, b) => b[1] - a[1])
    });
  }
  const totForme = new Map<string, number>();
  for (const d of documenti) for (const [f, n] of d.forme) totForme.set(f, (totForme.get(f) ?? 0) + n);
  // prima i documenti dove le parole compaiono di più
  documenti.sort((a, b) => b.occorrenze - a.occorrenze || b.passaggi.length - a.passaggi.length);
  return {
    documenti,
    passaggi: documenti.reduce((n, d) => n + d.passaggi.length, 0),
    occorrenze: documenti.reduce((n, d) => n + d.occorrenze, 0),
    forme: [...totForme].sort((a, b) => b[1] - a[1]),
    phrases
  };
}

/**
 * Tutti i passaggi che contengono le parole cercate (non solo i più pertinenti per l'AI):
 * se ci sono passaggi con tutte le parole si mostrano quelli, altrimenti quelli con almeno una.
 */
export async function allMatches(query: string, categorie?: string[], documento?: string): Promise<AllMatches> {
  const index = await getIndex();
  const c = candidates(index, query, categorie, documento);
  if (!c.results.length) return { ...EMPTY_ALL, simili: c.simili };
  const conTutte = c.conTutte > 0;
  let pool = conTutte ? c.results.slice(0, c.conTutte) : c.results;
  const { phrases, exclude } = c.parsed;
  if (phrases.length || exclude.length) {
    pool = pool.slice(0, MAX_TEXT_CHECK);
    const data = await loadTexts(pool.map((r) => String(r.id)));
    pool = pool.filter((r) => {
      const chunk = data.chunks.get(String(r.id));
      const record = chunk && data.records.get(chunk.recordId);
      return !!chunk && !!record && matchesDetailed(chunk.testo, record.titolo, record.testo, {
        ...EMPTY_DETAILED, phrases, none: exclude.join(' ')
      });
    });
  }
  // occorrenze: le parole cercate così come esistono nell'archivio (per le parole simili, quelle trovate)
  const plan = planTerms(index, [c.parsed.text, ...phrases].join(' '));
  const countTerms = plan.simili.length ? undefined : plan.exact;
  return { ...(await groupByDocument(pool, phrases, countTerms)), simili: c.simili, conTutte };
}

/** Tutti i passaggi della ricerca dettagliata, raggruppati per documento. */
export async function allDetailedMatches(q: DetailedQuery, categorie?: string[], documento?: string): Promise<AllMatches> {
  if (isDetailedEmpty(q)) return EMPTY_ALL;
  const index = await getIndex();
  const pool = detailedCandidates(index, q, categorie, documento).slice(0, MAX_TEXT_CHECK);
  const plan = planTerms(index, [q.all, ...q.phrases, q.any].join(' '));
  const simili = q.exact ? [] : plan.simili;
  if (!pool.length) return { ...EMPTY_ALL, simili };
  const data = await loadTexts(pool.map((r) => String(r.id)));
  const ok = pool.filter((r) => {
    const chunk = data.chunks.get(String(r.id));
    const record = chunk && data.records.get(chunk.recordId);
    return !!chunk && !!record && matchesDetailed(chunk.testo, record.titolo, record.testo, q);
  });
  const words = wordsOf([q.all, q.any].join(' '));
  // parole esatte: si contano solo le parole scritte esattamente così (come frasi di una parola)
  const countPhrases = q.phrases.length ? q.phrases : q.exact ? words : [];
  const countTerms = new Set(words.map((w) => processTerm(w)!).filter((t) => plan.exact.has(t)));
  const out = await groupByDocument(ok, q.phrases, countTerms.size ? countTerms : undefined, countPhrases);
  return { ...out, simili, conTutte: true };
}

/** Testi dei passaggi da mostrare (caricati a pagine). */
export async function loadMatches(hits: Hit[], phrases: string[] = []): Promise<LocalResult[]> {
  return attach(hits, await loadTexts(hits.map((h) => h.chunkId)), phrases);
}

// ============================================================ dove cercare

/** Documenti della categoria Normativa (per il menu a tendina), in ordine alfabetico. */
export async function normativaDocs(): Promise<{ id: string; titolo: string }[]> {
  const keys = (await db.records.orderBy('categoria').uniqueKeys()).filter((k) => normCategory(String(k)) === NORMATIVA);
  if (!keys.length) return [];
  const out: { id: string; titolo: string }[] = [];
  await db.records.where('categoria').anyOf(keys as string[]).each((r) => out.push({ id: r.id, titolo: r.titolo }));
  return out.sort((a, b) => a.titolo.localeCompare(b.titolo, 'it', { numeric: true }));
}

/** Argomenti scelti e documento di Normativa scelto (ignorato se non esiste più o se la Normativa è esclusa). */
export async function searchScope(): Promise<{ categorie: string[]; documento?: string }> {
  const { categorie, documento } = await getSettings();
  if (!documento) return { categorie };
  if (categorie.length && !categorie.map(normCategory).includes(NORMATIVA)) return { categorie };
  const r = await db.records.get(documento);
  return r && normCategory(r.categoria) === NORMATIVA ? { categorie, documento } : { categorie };
}

/** Argomenti presenti nell'archivio, con il numero di schede. */
export async function categoryCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await db.records.each((r) => counts.set(r.categoria, (counts.get(r.categoria) ?? 0) + 1));
  return counts;
}

/** Prepara l'indice quando il dispositivo è libero, così la prima ricerca è immediata. */
export function warmUpIndex() {
  const run = () => getIndex().catch((e) => console.warn('[indice]', e));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500); // Safari iOS
}
