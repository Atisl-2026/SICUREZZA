import Dexie, { type Table } from 'dexie';
import { chunksForRecord } from '../shared/chunk.ts';
import { pickSchema } from '../shared/normalize.ts';
import type { Chunk, StoredRecord } from '../shared/types.ts';

export interface MetaRow {
  key: string;
  value: unknown;
}

class ConsultaDB extends Dexie {
  records!: Table<StoredRecord, string>;
  chunks!: Table<Chunk, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('consulta');
    this.version(1).stores({
      records: 'id, categoria, *tag, origine, data_aggiornamento',
      chunks: 'id, recordId',
      meta: 'key'
    });
  }
}

export const db = new ConsultaDB();

// ---------- meta (versione db, revisione dati, impostazioni) ----------

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export function setMeta(key: string, value: unknown) {
  return db.meta.put({ key, value });
}

/**
 * Contatore incrementato a ogni modifica dei dati:
 * l'indice di ricerca (fase 3) lo usa per sapere quando ricostruirsi.
 */
async function bumpRevision() {
  const rev = await getMeta<number>('revisione', 0);
  await setMeta('revisione', rev + 1);
}

// ---------- scritture (record + blocchi sempre insieme, in transazione) ----------

/** Salva record e rigenera i loro blocchi. */
export async function putRecords(records: StoredRecord[]) {
  if (!records.length) return;
  await db.transaction('rw', db.records, db.chunks, db.meta, async () => {
    const ids = records.map((r) => r.id);
    await db.chunks.where('recordId').anyOf(ids).delete();
    await db.records.bulkPut(records);
    await db.chunks.bulkPut(records.flatMap((r) => chunksForRecord(r.id, r.testo || r.titolo)));
    await bumpRevision();
  });
}

export async function deleteRecords(ids: string[]) {
  if (!ids.length) return;
  await db.transaction('rw', db.records, db.chunks, db.meta, async () => {
    await db.chunks.where('recordId').anyOf(ids).delete();
    await db.records.bulkDelete(ids);
    await bumpRevision();
  });
}

export async function clearAll() {
  await db.transaction('rw', db.records, db.chunks, db.meta, async () => {
    await db.records.clear();
    await db.chunks.clear();
    await db.meta.delete('versione');
    await db.meta.delete('aggiornato_il');
    await bumpRevision();
  });
}

// ---------- backup ----------

export interface Backup {
  formato: 'consulta-backup';
  esportato: string;
  versione?: string;
  records: (ReturnType<typeof pickSchema> & { origine: string; modificato?: boolean })[];
}

export async function buildBackup(): Promise<Backup> {
  const records = await db.records.orderBy('id').toArray();
  return {
    formato: 'consulta-backup',
    esportato: new Date().toISOString(),
    versione: await getMeta<string | undefined>('versione', undefined),
    records: records.map((r) => ({
      ...pickSchema(r),
      origine: r.origine,
      ...(r.modificato ? { modificato: true } : {})
    }))
  };
}

// ---------- archiviazione persistente ----------

/**
 * Chiede al browser di non cancellare i dati in caso di poco spazio.
 * Su iOS aiuta soprattutto quando l'app è aggiunta alla schermata Home.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
