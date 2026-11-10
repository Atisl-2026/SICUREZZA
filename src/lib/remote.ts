import { decryptJson, keyMatches } from '../shared/crypto.ts';
import { planRemote, type RemotePlan } from '../shared/merge.ts';
import { compareVersions, ensureUniqueIds } from '../shared/normalize.ts';
import { openSoci, type PlusShare, type SociFile } from '../shared/publish.ts';
import type { Envelope } from '../shared/crypto.ts';
import type { DbRecord } from '../shared/types.ts';
import { fetchDemo, fetchSoci, getAccess, NotPublishedError, refreshAiShare, refreshPlus, reenterSociPassword, setAccess } from './access';
import { db, deleteRecords, getMeta, putRecords, setMeta } from './db';
import { receiveCategories } from './categories';

export type RemoteCheck =
  | { stato: 'disponibile'; versione: string; versioneLocale?: string; records: DbRecord[]; ai?: Envelope; categorie?: string[]; plus?: Envelope }
  | { stato: 'aggiornato'; versione: string }
  | { stato: 'password-cambiata'; file: SociFile }
  | { stato: 'nessun-accesso' }
  | { stato: 'errore'; messaggio: string };

/** Scarica i contenuti del proprio accesso e confronta la versione con quella locale. Non modifica nulla. */
export async function checkRemote(): Promise<RemoteCheck> {
  const a = await getAccess();
  if (!a) return { stato: 'nessun-accesso' };
  if (!navigator.onLine) return { stato: 'errore', messaggio: 'Sei offline.' };
  const versioneLocale = await getMeta<string | undefined>('versione', undefined);
  const isNewer = (v: string) => !versioneLocale || compareVersions(v, versioneLocale) > 0;

  try {
    if (a.ruolo === 'demo') {
      const demo = await fetchDemo();
      if (!isNewer(demo.versione)) return { stato: 'aggiornato', versione: versioneLocale! };
      ensureUniqueIds(demo.records);
      return { stato: 'disponibile', versione: demo.versione, versioneLocale, records: demo.records };
    }
    const file = await fetchSoci();
    if (!isNewer(file.versione)) return { stato: 'aggiornato', versione: versioneLocale! };
    let sociKey = a.sociKey;
    if (!keyMatches(sociKey, file.cifrato)) {
      // Socio plus: la nuova chiave dei soci arriva con l'accesso Socio plus, senza chiedere nulla
      if (a.ruolo === 'plus' && file.plus && keyMatches(a.plusKey, file.plus)) {
        try {
          const share = await decryptJson<PlusShare>(file.plus, a.plusKey!);
          sociKey = share.sociKey;
          await setAccess({ ...a, sociKey, github: share.github });
        } catch {
          return { stato: 'password-cambiata', file };
        }
      } else {
        return { stato: 'password-cambiata', file };
      }
    }
    const payload = await openSoci(file, sociKey!);
    return {
      stato: 'disponibile', versione: file.versione, versioneLocale, records: payload.records, ai: payload.ai,
      categorie: payload.categorie, plus: file.plus
    };
  } catch (e) {
    if (e instanceof NotPublishedError) return { stato: 'errore', messaggio: 'Contenuti non ancora pubblicati.' };
    return { stato: 'errore', messaggio: (e as Error).message };
  }
}

export interface ApplyResult {
  plan: RemotePlan;
  /** Avviso sulle risposte AI (password AI cambiata o AI non più condivisa). */
  avvisoAi: string | null;
}

/** Applica l'aggiornamento (dopo conferma dell'utente). Le modifiche locali del programmatore non vengono toccate. */
export async function applyRemote(versione: string, records: DbRecord[], ai?: Envelope, categorie?: string[], plus?: Envelope): Promise<ApplyResult> {
  const existing = await db.records.toArray();
  const plan = planRemote(existing, records);
  await putRecords(plan.toPut);
  await deleteRecords(plan.toDelete);
  await setMeta('versione', versione);
  await setMeta('aggiornato_il', new Date().toISOString());
  await receiveCategories(categorie);
  const a = await getAccess();
  const avvisi = a && a.ruolo !== 'demo'
    ? [await refreshAiShare(a, ai), await refreshPlus((await getAccess())!, plus)].filter(Boolean)
    : [];
  return { plan, avvisoAi: avvisi.length ? avvisi.join(' ') : null };
}

/** Password soci cambiata: con la nuova password si sblocca e si applica l'aggiornamento. */
export async function applyWithNewPassword(password: string, file: SociFile): Promise<ApplyResult> {
  const payload = await reenterSociPassword(password, file);
  return applyRemote(file.versione, payload.records, payload.ai, payload.categorie, file.plus);
}
