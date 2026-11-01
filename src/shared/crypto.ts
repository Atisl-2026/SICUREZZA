// Cifratura dei contenuti riservati con una password (Web Crypto: identica nel browser e in Node).
//
//   password ──PBKDF2-SHA256 (sale casuale, 400.000 iterazioni)──▶ chiave AES-256
//   JSON ──deflate──▶ AES-GCM (IV casuale) ──▶ base64
//
// AES-GCM è autenticato: con la password sbagliata o con un file manomesso la decifratura fallisce.
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

export const KDF_ITERATIONS = 400000;

export interface Envelope {
  formato: 'consulta-cifrato-1';
  kdf: { nome: 'PBKDF2-SHA256'; iterazioni: number; sale: string };
  iv: string;
  dati: string;
}

/** Chiave derivata dalla password, con i parametri per riconoscerla. */
export interface DerivedKey {
  /** 32 byte in base64. */
  chiave: string;
  sale: string;
  iterazioni: number;
}

export class WrongPasswordError extends Error {
  constructor(message = 'Password non corretta.') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Questo browser non supporta la cifratura (serve una connessione HTTPS).');
  return s;
};

// ---------- base64 (senza Buffer: funziona anche nel browser)

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomB64(bytes: number): string {
  return toB64(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

// ---------- chiavi

export async function deriveKey(password: string, sale = randomB64(16), iterazioni = KDF_ITERATIONS): Promise<DerivedKey> {
  if (!password) throw new WrongPasswordError('Inserisci la password.');
  const base = await subtle().importKey('raw', new Uint8Array(strToU8(password.normalize('NFC'))), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(sale), iterations: iterazioni },
    base,
    256
  );
  return { chiave: toB64(new Uint8Array(bits)), sale, iterazioni };
}

/** Deriva la chiave con gli stessi parametri (sale, iterazioni) di una busta cifrata. */
export function deriveKeyFor(password: string, env: Envelope): Promise<DerivedKey> {
  return deriveKey(password, env.kdf.sale, env.kdf.iterazioni);
}

async function aesKey(k: DerivedKey, usage: KeyUsage[]) {
  return subtle().importKey('raw', fromB64(k.chiave), 'AES-GCM', false, usage);
}

// ---------- cifratura

export async function encryptJson(value: unknown, key: DerivedKey): Promise<Envelope> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(deflateSync(strToU8(JSON.stringify(value)), { level: 9 }));
  const cipher = await subtle().encrypt({ name: 'AES-GCM', iv }, await aesKey(key, ['encrypt']), plain);
  return {
    formato: 'consulta-cifrato-1',
    kdf: { nome: 'PBKDF2-SHA256', iterazioni: key.iterazioni, sale: key.sale },
    iv: toB64(iv),
    dati: toB64(new Uint8Array(cipher))
  };
}

/** La chiave è compatibile con la busta? (stesso sale e iterazioni: altrimenti la password è cambiata) */
export function keyMatches(key: DerivedKey | undefined, env: Envelope): boolean {
  return !!key && key.sale === env.kdf.sale && key.iterazioni === env.kdf.iterazioni;
}

export async function decryptJson<T>(env: Envelope, key: DerivedKey): Promise<T> {
  if (env?.formato !== 'consulta-cifrato-1') throw new Error('Formato del file cifrato non riconosciuto.');
  if (!keyMatches(key, env)) throw new WrongPasswordError('La password è cambiata.');
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, await aesKey(key, ['decrypt']), fromB64(env.dati));
  } catch {
    throw new WrongPasswordError();
  }
  return JSON.parse(strFromU8(inflateSync(new Uint8Array(plain)))) as T;
}

/** Comodità: password + busta → contenuto (e chiave da conservare per i prossimi aggiornamenti). */
export async function decryptWithPassword<T>(env: Envelope, password: string): Promise<{ value: T; key: DerivedKey }> {
  const key = await deriveKeyFor(password, env);
  return { value: await decryptJson<T>(env, key), key };
}
