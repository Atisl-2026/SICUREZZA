import { ensureUniqueIds, compareVersions, parseDbJson } from '../shared/normalize.ts';
import { planRemote, type RemotePlan } from '../shared/merge.ts';
import type { DbRecord } from '../shared/types.ts';
import { db, deleteRecords, getMeta, putRecords, setMeta } from './db';
import { defaultRemoteUrl, getSettings } from './settings';

export type RemoteCheck =
  | { stato: 'disponibile'; versione: string; versioneLocale?: string; records: DbRecord[]; scartati: number }
  | { stato: 'aggiornato'; versione: string }
  | { stato: 'errore'; messaggio: string };

const TIMEOUT_MS = 20000;

/** Scarica il db.json remoto e confronta la versione con quella locale. Non modifica nulla. */
export async function checkRemote(): Promise<RemoteCheck> {
  if (!navigator.onLine) return { stato: 'errore', messaggio: 'Sei offline.' };
  const { remoteUrl } = await getSettings();
  const url = new URL(remoteUrl.trim() || defaultRemoteUrl());
  url.searchParams.set('_', String(Date.now())); // evita cache intermedie (iOS, CDN di GitHub)

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let data: unknown;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (res.status === 404) return { stato: 'errore', messaggio: 'File del database remoto non trovato (404). Controlla l\'URL nelle Impostazioni.' };
    if (!res.ok) return { stato: 'errore', messaggio: `Il server ha risposto con errore ${res.status}.` };
    data = await res.json();
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { stato: 'errore', messaggio: 'Tempo scaduto durante il download del database.' };
    if (e instanceof SyntaxError) return { stato: 'errore', messaggio: 'Il file remoto non è un JSON valido.' };
    return { stato: 'errore', messaggio: 'Impossibile raggiungere il database remoto.' };
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try {
    parsed = parseDbJson(data);
  } catch (e) {
    return { stato: 'errore', messaggio: (e as Error).message };
  }
  if (!parsed.versione) return { stato: 'errore', messaggio: 'Il file remoto non ha il campo "versione".' };

  const versioneLocale = await getMeta<string | undefined>('versione', undefined);
  if (versioneLocale && compareVersions(parsed.versione, versioneLocale) <= 0) {
    return { stato: 'aggiornato', versione: versioneLocale };
  }
  const records = parsed.items.flatMap((i) => (i.record ? [i.record] : []));
  ensureUniqueIds(records);
  return {
    stato: 'disponibile',
    versione: parsed.versione,
    versioneLocale,
    records,
    scartati: parsed.items.length - records.length
  };
}

/** Applica l'aggiornamento remoto (dopo conferma dell'utente). */
export async function applyRemote(versione: string, records: DbRecord[]): Promise<RemotePlan> {
  const existing = await db.records.toArray();
  const plan = planRemote(existing, records);
  await putRecords(plan.toPut);
  await deleteRecords(plan.toDelete);
  await setMeta('versione', versione);
  await setMeta('aggiornato_il', new Date().toISOString());
  return plan;
}
