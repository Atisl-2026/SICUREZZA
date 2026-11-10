import { decryptJson, deriveKey, deriveKeyFor, keyMatches, type DerivedKey, type Envelope } from '../shared/crypto.ts';
import { normalizeRepo, repoFromPagesUrl, verifyToken } from '../shared/github.ts';
import { parseDbJson } from '../shared/normalize.ts';
import { DEMO_FILE, isSociFile, openSoci, SOCI_FILE, type AiShare, type PlusShare, type SociFile } from '../shared/publish.ts';
import type { DbRecord, StoredRecord } from '../shared/types.ts';
import { clearAll, db, getMeta, putRecords, setMeta } from './db';
import { useLiveQuery } from './live';
import { updateSettings } from './settings';
import { forgetCategories, receiveCategories } from './categories';

export type Ruolo = 'demo' | 'socio' | 'plus' | 'admin';

export const RUOLO_LABEL: Record<Ruolo, string> = { demo: 'Demo', socio: 'Socio', plus: 'Socio plus', admin: 'Programmatore' };

/** Socio o Socio plus: stessi diritti di lettura, stessa AI con la password AI, stessi limiti. */
export const isSocio = (a: Accesso | null | undefined) => a?.ruolo === 'socio' || a?.ruolo === 'plus';

/** Chi può caricare documenti e pubblicare: il programmatore e il Socio plus. */
export const canPublish = (a: Accesso | null | undefined) => a?.ruolo === 'admin' || a?.ruolo === 'plus';

export interface Accesso {
  ruolo: Ruolo;
  /** Chiave derivata dalla password soci (socio e programmatore). */
  sociKey?: DerivedKey;
  /** Chiave derivata dalla password AI (soci abilitati all'AI). */
  aiKey?: DerivedKey;
  /** Programmatore e Socio plus (codice per pubblicare). */
  github?: { token: string; repo: string; branch: string };
  /**
   * Chiave derivata dalla password Socio plus: il Socio plus la usa per riaprire l'accesso quando
   * cambia la password soci; il programmatore per aggiornare l'accesso Socio plus quando la cambia lui.
   */
  plusKey?: DerivedKey;
}

const KEY = 'accesso';

export function getAccess(): Promise<Accesso | null> {
  return getMeta<Accesso | null>(KEY, null);
}

export function setAccess(a: Accesso) {
  return setMeta(KEY, a);
}

/** undefined = in caricamento, null = nessun accesso (schermata iniziale). */
export function useAccess(): Accesso | null | undefined {
  return useLiveQuery(getAccess);
}

/** Chi può usare le risposte AI: il programmatore e i soci con la password AI. */
export function aiAllowed(a: Accesso | null | undefined): boolean {
  return a?.ruolo === 'admin' || (isSocio(a) && !!a!.aiKey);
}

// ------------------------------------------------------------------ download dei dati

export function dataUrl(file: string): string {
  const u = new URL(`${import.meta.env.BASE_URL}${file}`, location.origin);
  u.searchParams.set('_', String(Date.now())); // niente cache intermedie (iOS, CDN di GitHub)
  return u.href;
}

export class NotPublishedError extends Error {}

export async function fetchData(file: string): Promise<unknown> {
  if (!navigator.onLine) throw new Error('Serve la connessione a internet.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(dataUrl(file), { cache: 'no-store', signal: ctrl.signal });
    if (res.status === 404) throw new NotPublishedError('Contenuti non ancora pubblicati.');
    if (!res.ok) throw new Error(`Il server ha risposto con errore ${res.status}.`);
    return await res.json();
  } catch (e) {
    if (e instanceof NotPublishedError) throw e;
    if ((e as Error).name === 'AbortError') throw new Error('Tempo scaduto durante il download dei contenuti.');
    if (e instanceof SyntaxError) throw new Error('Il file dei contenuti non è valido.');
    if ((e as Error).message?.startsWith('Il server')) throw e;
    throw new Error('Impossibile scaricare i contenuti: controlla la connessione.');
  } finally {
    clearTimeout(t);
  }
}

export async function fetchSoci(): Promise<SociFile> {
  const data = await fetchData(SOCI_FILE);
  if (!isSociFile(data)) throw new Error('Il file dei soci non è valido.');
  return data;
}

export async function fetchDemo(): Promise<{ versione: string; records: DbRecord[] }> {
  const parsed = parseDbJson(await fetchData(DEMO_FILE));
  return { versione: parsed.versione ?? '', records: parsed.items.flatMap((i) => (i.record ? [i.record] : [])) };
}

// ------------------------------------------------------------------ dati locali

/** Sostituisce tutte le schede del dispositivo (cambio di accesso). */
async function replaceRecords(records: DbRecord[], versione: string) {
  await clearAll();
  const now = Date.now();
  await putRecords(records.map((r): StoredRecord => ({ ...r, tag: [...r.tag], origine: 'remoto', salvato_il: now })));
  await setMeta('versione', versione);
  await setMeta('aggiornato_il', new Date().toISOString());
}

/** Busta con la chiave AI condivisa (ricevuta nel file dei soci). */
export async function setAiEnvelope(env: Envelope | undefined) {
  await setMeta('aiEnvelope', env ?? null);
}

export function getAiEnvelope(): Promise<Envelope | null> {
  return getMeta<Envelope | null>('aiEnvelope', null);
}

/**
 * Dopo un aggiornamento dei soci: se la chiave AI condivisa è cambiata (o non è più condivisa)
 * il socio perde l'AI finché non inserisce la nuova password AI.
 * Restituisce un messaggio da mostrare, o null.
 */
export async function refreshAiShare(a: Accesso, env: Envelope | undefined): Promise<string | null> {
  await setAiEnvelope(env);
  if (!isSocio(a) || !a.aiKey) return null;
  if (env && keyMatches(a.aiKey, env)) {
    try {
      const share = await decryptJson<AiShare>(env, a.aiKey);
      await updateSettings({ apiKey: share.apiKey, model: share.model, riserve: share.riserve ?? {}, usoPagamento: share.usoPagamento ?? 'riserva', limitiAi: share.limiti ?? {} });
      return null;
    } catch {
      /* chiave non più valida */
    }
  }
  await setAccess({ ...a, aiKey: undefined });
  await updateSettings({ apiKey: '', webCheck: false, riserve: {}, limitiAi: {}, aiScelta: 'auto' });
  return env
    ? 'La password AI è cambiata: chiedi quella nuova al programmatore.'
    : 'Le risposte AI non sono più condivise.';
}

// ------------------------------------------------------------------ accessi

export async function loginDemo() {
  const { versione, records } = await fetchDemo();
  await forgetCategories();
  await replaceRecords(records, versione);
  await setAiEnvelope(undefined);
  await updateSettings({ apiKey: '', webCheck: false, riserve: {}, limitiAi: {}, aiScelta: 'auto' });
  await setAccess({ ruolo: 'demo' });
}

export async function loginSocio(password: string) {
  const file = await fetchSoci();
  const sociKey = await deriveKeyFor(password, file.cifrato);
  const payload = await openSoci(file, sociKey); // WrongPasswordError se sbagliata
  await replaceRecords(payload.records, file.versione);
  await setAiEnvelope(payload.ai);
  await setPlusEnvelope(file.plus);
  await receiveCategories(payload.categorie);
  await updateSettings({ apiKey: '', webCheck: false, riserve: {}, limitiAi: {}, aiScelta: 'auto' });
  await setAccess({ ruolo: 'socio', sociKey });
}

// ------------------------------------------------------------------ Socio plus

/** Busta dell'accesso Socio plus (dal file dei soci). */
export async function setPlusEnvelope(env: Envelope | undefined) {
  await setMeta('plusEnvelope', env ?? null);
}

export function getPlusEnvelope(): Promise<Envelope | null> {
  return getMeta<Envelope | null>('plusEnvelope', null);
}

/** Apre l'accesso Socio plus del file dei soci con la password Socio plus. */
async function openPlus(password: string, file: SociFile) {
  if (!file.plus) throw new Error('L\'accesso Socio plus non è attivo: chiedi al programmatore.');
  const plusKey = await deriveKeyFor(password, file.plus);
  const share = await decryptJson<PlusShare>(file.plus, plusKey); // WrongPasswordError se sbagliata
  const payload = await openSoci(file, share.sociKey);
  return { plusKey, share, payload };
}

/** Socio plus: come un socio, in più carica documenti e pubblica. Entra con la sola password Socio plus. */
export async function loginPlus(password: string) {
  const file = await fetchSoci();
  const { plusKey, share, payload } = await openPlus(password, file);
  await replaceRecords(payload.records, file.versione);
  await setAiEnvelope(payload.ai);
  await setPlusEnvelope(file.plus);
  await receiveCategories(payload.categorie);
  await updateSettings({ apiKey: '', webCheck: false, riserve: {}, limitiAi: {}, aiScelta: 'auto' });
  await setAccess({ ruolo: 'plus', sociKey: share.sociKey, plusKey, github: share.github });
}

/**
 * Dopo un aggiornamento dei contenuti: per il Socio plus, se il programmatore ha cambiato
 * il codice GitHub lo si aggiorna; se ha cambiato la password Socio plus o tolto l'accesso,
 * resta un accesso da socio (può continuare a leggere). Restituisce un messaggio, o null.
 */
export async function refreshPlus(a: Accesso, env: Envelope | undefined): Promise<string | null> {
  await setPlusEnvelope(env);
  if (a.ruolo !== 'plus') return null;
  if (env && keyMatches(a.plusKey, env)) {
    try {
      const share = await decryptJson<PlusShare>(env, a.plusKey!);
      await setAccess({ ...(await getAccess())!, sociKey: share.sociKey, github: share.github });
      return null;
    } catch {
      /* password cambiata */
    }
  }
  const now = (await getAccess())!;
  await setAccess({ ...now, ruolo: 'socio', plusKey: undefined, github: undefined });
  return env
    ? 'La password Socio plus è cambiata: per caricare e pubblicare esci e rientra con quella nuova.'
    : 'L\'accesso Socio plus è stato disattivato dal programmatore: puoi continuare a consultare l\'archivio.';
}

/** Repository dell'app: dal workflow di pubblicazione, altrimenti dall'indirizzo GitHub Pages. */
export function defaultRepo(): string {
  return normalizeRepo(import.meta.env.VITE_GITHUB_REPO ?? '') || repoFromPagesUrl(location.href);
}

/**
 * Accesso programmatore: codice GitHub + password soci.
 * Se i contenuti dei soci non sono ancora stati pubblicati, la password inserita diventa quella dei soci.
 */
export async function loginAdmin(token: string, password: string, repoInput: string): Promise<{ primoAccesso: boolean }> {
  const repo = normalizeRepo(repoInput);
  if (!repo) throw new Error('Indica il repository nel formato proprietario/nome.');
  if (!token.trim()) throw new Error('Inserisci il codice di accesso GitHub.');
  const { repo: fullName, branch } = await verifyToken({ token, repo });

  let file: SociFile | null = null;
  try {
    file = await fetchSoci();
  } catch (e) {
    if (!(e instanceof NotPublishedError)) throw e;
  }

  if (file) {
    const sociKey = await deriveKeyFor(password, file.cifrato);
    const payload = await openSoci(file, sociKey);
    await replaceRecords(payload.records, file.versione);
    await setAiEnvelope(payload.ai);
    await setPlusEnvelope(file.plus);
    await receiveCategories(payload.categorie);
    await setAccess({ ruolo: 'admin', sociKey, github: { token: token.trim(), repo: fullName, branch } });
    return { primoAccesso: false };
  }

  if (password.length < 8) throw new Error('Prima pubblicazione: scegli una password soci di almeno 8 caratteri.');
  await clearAll();
  await setAccess({ ruolo: 'admin', sociKey: await deriveKey(password), github: { token: token.trim(), repo: fullName, branch } });
  return { primoAccesso: true };
}

/** La password soci è cambiata: nuova password, stesso accesso. */
export async function reenterSociPassword(password: string, file: SociFile) {
  const a = await getAccess();
  if (!a || a.ruolo === 'demo') throw new Error('Accesso non valido.');
  if (a.ruolo === 'plus') {
    // il Socio plus inserisce la propria password (Socio plus), non quella dei soci
    const { plusKey, share, payload } = await openPlus(password, file);
    await setAccess({ ...a, sociKey: share.sociKey, plusKey, github: share.github });
    return payload;
  }
  const sociKey = await deriveKeyFor(password, file.cifrato);
  const payload = await openSoci(file, sociKey);
  await setAccess({ ...a, sociKey });
  return payload;
}

/** Socio: sblocca le risposte AI con la password AI. */
export async function unlockAi(password: string) {
  const a = await getAccess();
  const env = await getAiEnvelope();
  if (!a || !isSocio(a)) throw new Error('Solo per i soci.');
  if (!env) throw new Error('Il programmatore non ha condiviso le risposte AI.');
  const aiKey = await deriveKeyFor(password, env);
  const share = await decryptJson<AiShare>(env, aiKey); // WrongPasswordError se sbagliata
  await updateSettings({ apiKey: share.apiKey, model: share.model, riserve: share.riserve ?? {}, usoPagamento: share.usoPagamento ?? 'riserva', limitiAi: share.limiti ?? {} });
  await setAccess({ ...a, aiKey });
}

export async function lockAi() {
  const a = await getAccess();
  if (a) await setAccess({ ...a, aiKey: undefined });
  await updateSettings({ apiKey: '', webCheck: false, riserve: {}, limitiAi: {}, aiScelta: 'auto' });
}

/** Esci: cancella dal dispositivo contenuti, indice, chiavi, cronologia. */
export async function logout() {
  await clearAll();
  await forgetCategories();
  await db.meta.bulkDelete([KEY, 'aiEnvelope', 'plusEnvelope', 'indice', 'cronologia', 'versione', 'aggiornato_il']);
  await updateSettings({ apiKey: '', webCheck: false, riserve: {}, limitiAi: {}, aiScelta: 'auto' });
}

/**
 * Programmatore che non ricorda la password soci: con il codice GitHub (che dà già pieno controllo
 * del repository) imposta una nuova password. Le schede riservate pubblicate con la vecchia password
 * non si possono decifrare: si riparte dalle schede demo (pubbliche) e si reimporta il resto
 * (backup o db-generato.json); alla prima pubblicazione la nuova password vale per tutti.
 */
export async function loginAdminReset(token: string, newPassword: string, repoInput: string) {
  const repo = normalizeRepo(repoInput);
  if (!repo) throw new Error('Indica il repository nel formato proprietario/nome.');
  if (newPassword.length < 8) throw new Error('La nuova password soci deve avere almeno 8 caratteri.');
  const { repo: fullName, branch } = await verifyToken({ token, repo });
  await forgetCategories();

  let versione = '';
  try {
    versione = (await fetchSoci()).versione;
  } catch (e) {
    if (!(e instanceof NotPublishedError)) throw e;
  }
  let demo: DbRecord[] = [];
  try {
    demo = (await fetchDemo()).records;
  } catch (e) {
    if (!(e instanceof NotPublishedError)) throw e;
  }
  await replaceRecords(demo, versione);
  await setPlusEnvelope(undefined); // nuova password soci: l'accesso Socio plus va ricreato
  if (!versione) await db.meta.delete('versione');
  // da ripubblicare: le schede demo devono finire anche nel nuovo file dei soci
  await db.records.toCollection().modify((r) => { r.origine = 'locale'; });
  await setAiEnvelope(undefined);
  await setAccess({ ruolo: 'admin', sociKey: await deriveKey(newPassword), github: { token: token.trim(), repo: fullName, branch } });
}
