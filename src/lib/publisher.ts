import { hasAi } from './router';
import { configuredReserves } from '../shared/providers.ts';
import { deriveKey, encryptJson, type DerivedKey, type Envelope } from '../shared/crypto.ts';
import { commitFiles, readRepoJson } from '../shared/github.ts';
import { compareVersions } from '../shared/normalize.ts';
import {
  buildPublication, DEMO_FILE, isSociFile, serializeDemo, serializeSoci, SOCI_FILE, type AiShare
} from '../shared/publish.ts';
import { getAccess, getAiEnvelope, setAccess, setAiEnvelope, type Accesso } from './access';
import { db, getMeta, setMeta } from './db';
import { CATEGORIES_DIRTY, getCategoryList } from './categories';
import { useLiveQuery } from './live';
import { getSettings } from './settings';

const DELETED_KEY = 'eliminateDaPubblicare';

// ------------------------------------------------------------------ modifiche in attesa

/** Il programmatore ha eliminato una scheda già pubblicata: va tolta anche per gli altri alla prossima pubblicazione. */
export async function trackDeletion(id: string) {
  const list = await getMeta<string[]>(DELETED_KEY, []);
  if (!list.includes(id)) await setMeta(DELETED_KEY, [...list, id]);
}

export interface Pending {
  nuove: number;
  modificate: number;
  eliminate: number;
  /** elenco delle categorie cambiato */
  categorie: boolean;
  totale: number;
}

export async function getPending(): Promise<Pending> {
  const [nuove, modificate, eliminate, categorie] = await Promise.all([
    db.records.where('origine').equals('locale').count(),
    db.records.filter((r) => r.origine === 'remoto' && !!r.modificato).count(),
    getMeta<string[]>(DELETED_KEY, []).then((l) => l.length),
    getMeta<boolean>(CATEGORIES_DIRTY, false)
  ]);
  return { nuove, modificate, eliminate, categorie, totale: nuove + modificate + eliminate + (categorie ? 1 : 0) };
}

export function usePending(): Pending | undefined {
  return useLiveQuery(getPending);
}

// ------------------------------------------------------------------ pubblicazione

export class PublishConflictError extends Error {}

export interface PublishOptions {
  /** Nuova password soci: tutti i soci dovranno inserirla. */
  newSociPassword?: string;
  /** Nuova password AI: condivide la chiave Gemini con chi la conosce. */
  aiPassword?: string;
  /** Smette di condividere la chiave Gemini. */
  stopAi?: boolean;
  /** Messaggio della modifica su GitHub. */
  message?: string;
}

export interface PublishResult {
  versione: string;
  schede: number;
  demo: number;
  url: string;
}

/**
 * Pubblica per tutti lo stato attuale dell'archivio del programmatore:
 * data/demo.json (schede demo, in chiaro) + data/soci.json (tutto, cifrato), in un'unica modifica su GitHub.
 * Il sito si aggiorna da solo in 1–2 minuti (GitHub Actions).
 */
export async function publish(opts: PublishOptions = {}): Promise<PublishResult> {
  const a = await getAccess();
  if (a?.ruolo !== 'admin' || !a.github || !a.sociKey) throw new Error('Solo il programmatore può pubblicare.');
  if (!navigator.onLine) throw new Error('Per pubblicare serve la connessione a internet.');
  const gh = { token: a.github.token, repo: a.github.repo };

  // 1. qualcun altro (un altro telefono del programmatore) ha pubblicato nel frattempo?
  const remote = await readRepoJson<unknown>(gh, a.github.branch, SOCI_FILE);
  const local = await getMeta<string | undefined>('versione', undefined);
  if (isSociFile(remote) && local && compareVersions(remote.versione, local) > 0) {
    throw new PublishConflictError(
      'Su GitHub ci sono contenuti più recenti di quelli di questo telefono. Tocca «Controlla aggiornamenti», poi pubblica di nuovo: le tue modifiche non andranno perse.'
    );
  }

  // 2. chiavi
  let sociKey: DerivedKey = a.sociKey;
  if (opts.newSociPassword != null) {
    if (opts.newSociPassword.length < 8) throw new Error('La password soci deve avere almeno 8 caratteri.');
    sociKey = await deriveKey(opts.newSociPassword);
  }

  let aiKey = a.aiKey;
  let ai: Envelope | undefined;
  if (opts.stopAi) {
    aiKey = undefined;
  } else {
    const settings = await getSettings();
    if (opts.aiPassword != null) {
      if (opts.aiPassword.length < 8) throw new Error('La password AI deve avere almeno 8 caratteri.');
      if (!hasAi(settings)) throw new Error('Prima inserisci la chiave Gemini o una AI di riserva (Impostazioni → Intelligenza artificiale).');
      aiKey = await deriveKey(opts.aiPassword);
    }
    if (aiKey && hasAi(settings)) {
      // ricifrata ogni volta: così chiavi o modello aggiornati arrivano anche ai soci
      const share: AiShare = { apiKey: settings.apiKey.trim(), model: settings.model };
      const riserve = Object.fromEntries(configuredReserves(settings.riserve).map((id) => [id, settings.riserve[id]!]));
      if (Object.keys(riserve).length) share.riserve = riserve;
      ai = await encryptJson(share, aiKey);
    } else {
      // condivisione fatta da un altro telefono: la busta resta com'è
      ai = (await getAiEnvelope()) ?? undefined;
    }
  }

  // 3. file da pubblicare
  const records = await db.records.toArray();
  const pub = await buildPublication(records, sociKey, { ai, categorie: await getCategoryList() });
  const pending = await getPending();
  const message = opts.message ?? describeCommit(pending, opts, records.length);
  const { url } = await commitFiles(gh, a.github.branch, [
    { path: DEMO_FILE, content: serializeDemo(pub.demo) },
    { path: SOCI_FILE, content: serializeSoci(pub.soci) }
  ], message);

  // 4. stato locale: tutto pubblicato
  const next: Accesso = { ...a, sociKey, aiKey };
  await setAccess(next);
  await setAiEnvelope(ai);
  await setMeta('versione', pub.soci.versione);
  await setMeta('aggiornato_il', new Date().toISOString());
  await setMeta(DELETED_KEY, []);
  await setMeta(CATEGORIES_DIRTY, false);
  await db.records.toCollection().modify((r) => {
    r.origine = 'remoto';
    delete r.modificato;
  });
  return { versione: pub.soci.versione, schede: records.length, demo: pub.demo.records.length, url };
}

function describeCommit(p: Pending, opts: PublishOptions, total: number): string {
  const parts: string[] = [];
  if (p.nuove) parts.push(`${p.nuove} nuove`);
  if (p.modificate) parts.push(`${p.modificate} modificate`);
  if (p.eliminate) parts.push(`${p.eliminate} eliminate`);
  if (p.categorie) parts.push('categorie');
  if (opts.newSociPassword != null) parts.push('nuova password soci');
  if (opts.aiPassword != null) parts.push('nuova password AI');
  if (opts.stopAi) parts.push('AI non più condivisa');
  return `Contenuti aggiornati dall'app${parts.length ? `: ${parts.join(', ')}` : ''} (${total} schede)`;
}
