#!/usr/bin/env node
/**
 * cifra-db.mjs — prepara i file da pubblicare a partire dal database in chiaro.
 *
 *   data/demo.json  in chiaro, solo le schede con "demo": true
 *   data/soci.json  tutte le schede, cifrate con la password dei soci
 *
 * Uso:
 *   npm run cifra-db                                   # legge sorgenti/db-generato.json, chiede la password
 *   npm run cifra-db -- mio-db.json                    # altro file in chiaro
 *   SOCI_PASSWORD='…' npm run cifra-db                 # password da variabile d'ambiente
 *   npm run cifra-db -- --nuova-password               # cambia la password (i soci dovranno inserire quella nuova)
 *
 * Se la password è la stessa di data/soci.json esistente, vengono mantenuti sale e chiave AI condivisa:
 * i telefoni dei soci si aggiornano senza chiedere di nuovo la password.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { deriveKey, deriveKeyFor, WrongPasswordError } from '../src/shared/crypto.ts';
import { ensureUniqueIds, parseDbJson } from '../src/shared/normalize.ts';
import {
  buildPublication, DEMO_FILE, isSociFile, openSoci, serializeDemo, serializeSoci, SOCI_FILE
} from '../src/shared/publish.ts';

const args = process.argv.slice(2);
const input = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'sorgenti/db-generato.json');
const nuova = args.includes('--nuova-password');

async function askPassword(question) {
  if (process.env.SOCI_PASSWORD) return process.env.SOCI_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function main() {
  if (!existsSync(input)) {
    console.error(`File non trovato: ${input}\nPrima esegui: npm run build-db`);
    process.exit(1);
  }
  const parsed = parseDbJson(JSON.parse(await readFile(input, 'utf8')));
  const records = parsed.items.flatMap((i) => (i.record ? [i.record] : []));
  ensureUniqueIds(records);

  const password = await askPassword(nuova ? 'Nuova password dei soci: ' : 'Password dei soci: ');
  if (password.length < 8) {
    console.error('La password deve avere almeno 8 caratteri.');
    process.exit(1);
  }

  // riusa sale e chiave AI se la password coincide con quella già pubblicata
  let key;
  let ai;
  const existing = existsSync(SOCI_FILE) ? JSON.parse(await readFile(SOCI_FILE, 'utf8')) : null;
  if (existing && isSociFile(existing) && !nuova) {
    try {
      key = await deriveKeyFor(password, existing.cifrato);
      ai = (await openSoci(existing, key)).ai;
      console.log('Password confermata: i soci non dovranno reinserirla.');
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw e;
      console.error('La password non corrisponde a quella già pubblicata.\nSe vuoi cambiarla usa: npm run cifra-db -- --nuova-password');
      process.exit(1);
    }
  }
  key ??= await deriveKey(password);

  const pub = await buildPublication(records, key, { ai });
  await mkdir(path.dirname(DEMO_FILE), { recursive: true });
  await writeFile(DEMO_FILE, serializeDemo(pub.demo));
  await writeFile(SOCI_FILE, serializeSoci(pub.soci));
  console.log(`Scritti ${DEMO_FILE} (${pub.demo.records.length} schede demo) e ${SOCI_FILE} (${records.length} schede cifrate), versione ${pub.soci.versione}.`);
  if (ai) console.log('Chiave AI condivisa mantenuta.');
}

await main();
