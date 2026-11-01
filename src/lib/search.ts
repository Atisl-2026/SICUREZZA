import type MiniSearch from 'minisearch';
import {
  buildIndex, INDEX_FORMAT, loadIndex, retrieve, toSearchDocs, type Hit, type SearchDoc
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
}

/** Ricerca locale: i 6–8 blocchi più pertinenti, con il record padre. */
export async function searchLocal(query: string): Promise<LocalResult[]> {
  const index = await getIndex();
  const hits = retrieve(index, query);
  if (!hits.length) return [];
  const [chunks, records] = await Promise.all([
    db.chunks.bulkGet(hits.map((h) => h.chunkId)),
    db.records.bulkGet([...new Set(hits.map((h) => h.recordId))])
  ]);
  const recMap = new Map(records.filter((r): r is StoredRecord => !!r).map((r) => [r.id, r]));
  return hits.flatMap((h, i) => {
    const chunk = chunks[i];
    const record = recMap.get(h.recordId);
    return chunk && record ? [{ ...h, chunk, record }] : [];
  });
}

/** Prepara l'indice quando il dispositivo è libero, così la prima ricerca è immediata. */
export function warmUpIndex() {
  const run = () => getIndex().catch((e) => console.warn('[indice]', e));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500); // Safari iOS
}
