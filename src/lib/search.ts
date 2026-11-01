import type MiniSearch from 'minisearch';
import type { SearchResult } from 'minisearch';
import {
  buildIndex, candidates, detailedCandidates, EMPTY_DETAILED, INDEX_FORMAT, isDetailedEmpty, loadIndex, matchesDetailed,
  selectHits, toSearchDocs, type DetailedQuery, type Hit, type RetrieveOptions, type SearchDoc
} from '../shared/search.ts';
import type { Chunk, StoredRecord } from '../shared/types.ts';
import { db, getMeta, setMeta } from './db';

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
const MAX_TEXT_CHECK = 2000;

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
  const { results, parsed } = candidates(index, query, opts.categorie);
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
export async function searchDetailed(q: DetailedQuery, categorie?: string[], limit = 30): Promise<DetailedResult> {
  if (isDetailedEmpty(q)) return { results: [], totale: 0 };
  const index = await getIndex();
  const pool = detailedCandidates(index, q, categorie).slice(0, MAX_TEXT_CHECK);
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
