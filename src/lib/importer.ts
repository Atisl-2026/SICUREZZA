import { csvToRecords, decodeText } from '../shared/csv.ts';
import { planImport, type ImportPlan, type IncomingRecord } from '../shared/merge.ts';
import { ensureUniqueIds, parseDbJson, type NormalizeResult } from '../shared/normalize.ts';
import { db, putRecords } from './db';

export interface ImportResult extends ImportPlan {
  file: string;
  errori: string[];
}

/** Legge un file JSON o CSV scelto dall'utente e lo unisce al database locale. */
export async function importFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));

  let items: NormalizeResult[];
  if (name.endsWith('.json') || file.type === 'application/json') {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Il file non è un JSON valido.');
    }
    items = parseDbJson(data).items;
  } else if (name.endsWith('.csv') || name.endsWith('.tsv') || file.type.includes('csv')) {
    items = csvToRecords(text);
  } else {
    throw new Error('Formato non supportato: usa un file .json o .csv.');
  }

  const errori: string[] = [];
  const incoming: IncomingRecord[] = [];
  items.forEach((it, i) => {
    if (it.record) incoming.push({ record: it.record, origine: it.origine, modificato: it.modificato });
    else errori.push(`Elemento ${i + 1}: ${it.error}`);
  });
  for (const r of ensureUniqueIds(incoming.map((x) => x.record))) errori.push(`Id duplicato rinominato: ${r}`);

  const existing = new Map((await db.records.bulkGet(incoming.map((x) => x.record.id)))
    .filter((r) => !!r)
    .map((r) => [r!.id, r!]));
  const plan = planImport(existing, incoming);
  await putRecords(plan.toPut);
  return { ...plan, file: file.name, errori };
}
