// File pubblicati su GitHub Pages (cartella data/):
//
//   demo.json  → in chiaro: { versione, generato, records }  — solo le schede con demo: true
//   soci.json  → { formato, versione, generato, cifrato: Envelope }
//                il contenuto cifrato è SociPayload: tutte le schede + (facoltativa) chiave Gemini
//                cifrata a sua volta con la "password AI".
import type { Reserves } from './providers.ts';
import { decryptJson, encryptJson, type DerivedKey, type Envelope } from './crypto.ts';
import { pickSchema } from './normalize.ts';
import type { DbFile, DbRecord } from './types.ts';

export const DEMO_FILE = 'data/demo.json';
export const SOCI_FILE = 'data/soci.json';

export interface SociFile {
  formato: 'consulta-soci-1';
  versione: string;
  generato: string;
  cifrato: Envelope;
}

/** Configurazione AI condivisa con chi ha la password AI. */
export interface AiShare {
  apiKey: string;
  model: string;
  /** AI gratuite di riserva (le versioni precedenti dell'app ignorano il campo) */
  riserve?: Reserves;
}

export interface SociPayload {
  versione: string;
  records: DbRecord[];
  /** AiShare cifrato con la password AI (assente se l'AI non è condivisa). */
  ai?: Envelope;
  /** Elenco ordinato delle categorie (argomenti) gestito dal programmatore. */
  categorie?: string[];
}

/** Versione leggibile e ordinabile: 2026.11.01.143005.123 (con i millesimi: due pubblicazioni ravvicinate restano distinte) */
export function newVersion(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function isSociFile(x: unknown): x is SociFile {
  const o = x as SociFile;
  return !!o && o.formato === 'consulta-soci-1' && typeof o.versione === 'string' && o.cifrato?.formato === 'consulta-cifrato-1';
}

export interface Publication {
  demo: DbFile & { generato: string };
  soci: SociFile;
}

/** Prepara i due file da pubblicare a partire da tutte le schede. */
export async function buildPublication(
  records: DbRecord[],
  sociKey: DerivedKey,
  opts: { versione?: string; ai?: Envelope; categorie?: string[] } = {}
): Promise<Publication> {
  const versione = opts.versione ?? newVersion();
  const generato = new Date().toISOString();
  const clean = records.map(pickSchema).sort((a, b) => a.id.localeCompare(b.id));
  const payload: SociPayload = {
    versione,
    records: clean,
    ...(opts.ai ? { ai: opts.ai } : {}),
    ...(opts.categorie?.length ? { categorie: opts.categorie } : {})
  };
  return {
    demo: { versione, generato, records: clean.filter((r) => r.demo) },
    soci: { formato: 'consulta-soci-1', versione, generato, cifrato: await encryptJson(payload, sociKey) }
  };
}

export async function openSoci(file: SociFile, key: DerivedKey): Promise<SociPayload> {
  const payload = await decryptJson<SociPayload>(file.cifrato, key);
  if (!Array.isArray(payload?.records)) throw new Error('Contenuto cifrato non valido.');
  return payload;
}

/** JSON con una scheda per riga: compatto ma con differenze leggibili su GitHub. */
export function serializeDemo(file: DbFile & { generato?: string }): string {
  const body = file.records.map((r) => JSON.stringify(r)).join(',\n');
  return `{"versione":${JSON.stringify(file.versione)},"generato":${JSON.stringify(file.generato ?? '')},"records":[\n${body}\n]}\n`;
}

export function serializeSoci(file: SociFile): string {
  return JSON.stringify(file, null, 1) + '\n';
}
