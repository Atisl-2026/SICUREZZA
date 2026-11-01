#!/usr/bin/env node
/**
 * build-db.mjs — converte i file sorgente in un database in chiaro (formato dello schema dell'app).
 *
 * Uso:
 *   npm run build-db                       # legge ./sorgenti, scrive ./sorgenti/db-generato.json (in chiaro, NON va su GitHub)
 *   npm run cifra-db                       # poi: crea data/demo.json e data/soci.json (cifrato) da pubblicare
 *   npm run build-db -- percorso/cartella  # altra cartella sorgente
 *   npm run build-db -- --versione 2025.3  # versione esplicita
 *   npm run build-db -- --forza            # riscrive anche se il contenuto non è cambiato
 *
 * Formati: .docx .pdf .xlsx .pptx .html/.htm .txt .md .csv .json
 *          (.doc .xls .ppt .rtf .odt .ods .odp se LibreOffice è installato: vengono convertiti al volo)
 *
 * Regole:
 * - La sottocartella di primo livello è la categoria (es. sorgenti/normativa/… → "Normativa");
 *   le sottocartelle più profonde diventano tag.
 * - Un file = un record. Eccezioni:
 *     · Excel/CSV con colonne tipo titolo/domanda + testo/risposta → un record per riga;
 *     · file in una categoria/nome contenente "faq" → un record per ogni domanda (riga che termina con "?").
 * - id stabile ricavato dal percorso del file (senza estensione e senza eventuale data iniziale).
 * - data_aggiornamento: data all'inizio del nome file (2025-03-12_nome.pdf), altrimenti data di modifica del file.
 * - metadati.csv (facoltativo, nella cartella sorgente) per sovrascrivere i campi:
 *     file;id;titolo;categoria;tag;fonte;data_aggiornamento;demo   (demo = sì → visibile nell'accesso demo)
 *     normativa/dlgs-81.pdf;;D.Lgs. 81/2008;;sicurezza|lavoro;https://www.normattiva.it/…;2024-05-01
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureUniqueIds, fieldForKey, normalizeRecord, normalizeText, parseBool, parseDate, parseDbJson, parseTags, slugify
} from '../src/shared/normalize.ts';
import { decodeText, parseCsv, rowsToObjects } from '../src/shared/csv.ts';
import {
  DATE_PREFIX, fileToRecords, goodTitle, htmlNodeToText, idFromPath, prettify, readPdfWith, splitFaq, SUPPORTED_EXT
} from '../src/shared/extract.ts';

// ---------------------------------------------------------------- argomenti

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(readFileHeader());
  process.exit(0);
}
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flagValues = new Set(['--out', '--versione'].flatMap((f) => (args.includes(f) ? [args[args.indexOf(f) + 1]] : [])));
const srcDir = path.resolve(args.find((a) => !a.startsWith('--') && !flagValues.has(a)) ?? 'sorgenti');
const outFile = path.resolve(opt('--out') ?? path.join(srcDir, 'db-generato.json'));
const forza = args.includes('--forza');

function readFileHeader() {
  return 'Uso: node scripts/build-db.mjs [cartella-sorgenti] [--out <cartella-sorgenti>/db-generato.json] [--versione X] [--forza]';
}

// ---------------------------------------------------------------- utilità

const warnings = [];
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const LEGACY = { '.doc': 'docx', '.rtf': 'docx', '.odt': 'docx', '.xls': 'xlsx', '.ods': 'xlsx', '.ppt': 'pptx', '.odp': 'pptx' };
const SUPPORTED = new Set([...SUPPORTED_EXT, ...Object.keys(LEGACY)]);

async function lazy(name) {
  try {
    return await import(name);
  } catch {
    console.error(`\nManca il pacchetto "${name}". Esegui: npm install\n`);
    process.exit(1);
  }
}

// HTML con node-html-parser (nel browser lo stesso testo si ottiene con il DOM)
async function readHtml(html) {
  const { parse } = await lazy('node-html-parser');
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const title = goodTitle(root.querySelector('title')?.text) || goodTitle(root.querySelector('h1')?.text);
  const start = root.querySelector('main') || root.querySelector('article') || root.querySelector('body') || root;
  const text = htmlNodeToText(start, {
    isText: (n) => n.nodeType === 3,
    isElement: (n) => n.nodeType === 1,
    tag: (n) => (n.rawTagName || '').toLowerCase(),
    text: (n) => n.text, // .text decodifica le entità (&nbsp; &egrave; …)
    children: (n) => n.childNodes
  });
  return { title, text };
}

export { splitFaq };

// ---------------------------------------------------------------- metadati.csv

async function loadMetadata() {
  const file = path.join(srcDir, 'metadati.csv');
  if (!existsSync(file)) return new Map();
  const objs = rowsToObjects(parseCsv(decodeText(new Uint8Array(await readFile(file)))));
  const map = new Map();
  for (const o of objs) {
    const key = Object.entries(o).find(([k]) => /^(file|percorso|nome file)$/i.test(k.trim()))?.[1];
    if (!key) continue;
    const meta = {};
    for (const [k, v] of Object.entries(o)) {
      const f = fieldForKey(k);
      if (f && v) meta[f] = v;
    }
    map.set(key.replace(/\\/g, '/').toLowerCase(), meta);
  }
  console.log(`metadati.csv: ${map.size} righe`);
  return map;
}

// ---------------------------------------------------------------- scansione

async function walkDir(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name.startsWith('~$')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walkDir(full)));
    else out.push(full);
  }
  return out;
}

let sofficeTmp = null;
function convertLegacy(file, target) {
  sofficeTmp ??= mkdtempSync(path.join(tmpdir(), 'build-db-'));
  try {
    execFileSync('soffice', ['--headless', '--convert-to', target, '--outdir', sofficeTmp, file], { stdio: 'ignore', timeout: 120000 });
  } catch {
    return null;
  }
  const out = path.join(sofficeTmp, path.basename(file).replace(/\.[^.]+$/, `.${target}`));
  return existsSync(out) ? out : null;
}

async function processFile(full, metaMap) {
  const rel = path.relative(srcDir, full).split(path.sep).join('/');
  let ext = path.extname(full).toLowerCase();
  if (rel.toLowerCase() === 'metadati.csv' || rel.toLowerCase() === 'db-generato.json') return [];
  if (!SUPPORTED.has(ext)) { warn(rel, 'formato non supportato, ignorato'); return []; }

  let readPath = full;
  if (LEGACY[ext]) {
    const conv = convertLegacy(full, LEGACY[ext]);
    if (!conv) { warn(rel, `formato vecchio: salvalo come .${LEGACY[ext]} (o installa LibreOffice per la conversione automatica)`); return []; }
    readPath = conv;
    ext = `.${LEGACY[ext]}`;
  }

  const parts = rel.split('/');
  const baseName = parts.at(-1).replace(/\.[^.]+$/, '');
  const datePrefix = baseName.match(DATE_PREFIX);
  const cleanName = baseName.replace(DATE_PREFIX, '');
  const fileId = idFromPath([...parts.slice(0, -1), cleanName]);
  const meta = metaMap.get(rel.toLowerCase()) ?? metaMap.get(parts.at(-1).toLowerCase()) ?? {};
  const mtime = (await stat(full)).mtime;

  const defaults = {
    categoria: meta.categoria || (parts.length > 1 ? prettify(parts[0]) : 'Generale'),
    tag: parseTags([...parts.slice(1, -1).map(prettify), ...parseTags(meta.tag ?? '')]),
    fonte: meta.fonte || rel,
    data_aggiornamento: parseDate(meta.data_aggiornamento) || (datePrefix ? parseDate(datePrefix[1]) : '') || parseDate(mtime),
    demo: meta.demo != null ? parseBool(meta.demo) : false
  };
  const ctx = {
    fileId,
    label: rel,
    defaults,
    fallbackTitle: prettify(cleanName),
    override: { id: meta.id, titolo: meta.titolo },
    warn: (msg) => warn(rel, msg)
  };
  const bytes = new Uint8Array(await readFile(readPath));
  const unpdf = ext === '.pdf' ? await lazy('unpdf') : null;
  return fileToRecords(bytes, ext, ctx, { pdf: (b) => readPdfWith(unpdf, b, ctx.warn), html: readHtml });
}

// ---------------------------------------------------------------- main

function defaultVersion() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  if (!existsSync(srcDir)) {
    console.error(`Cartella sorgente non trovata: ${srcDir}\nCreala e mettici i tuoi file (sottocartelle = categorie).`);
    process.exit(1);
  }
  console.log(`Sorgenti: ${srcDir}`);
  const metaMap = await loadMetadata();
  const files = (await walkDir(srcDir)).sort();
  const records = [];
  const perFile = [];
  for (const f of files) {
    const rel = path.relative(srcDir, f);
    try {
      const recs = await processFile(f, metaMap);
      records.push(...recs);
      if (recs.length) perFile.push(`  ✓ ${rel} → ${recs.length} record`);
    } catch (e) {
      warn(rel, `errore di lettura: ${e.message}`);
    }
  }
  if (sofficeTmp) rmSync(sofficeTmp, { recursive: true, force: true });

  // normalizzazione finale (stessa logica dell'app) e id univoci
  const clean = records.flatMap((r) => {
    const res = normalizeRecord(r);
    if (!res.record) { warn(r.fonte || r.id, res.error); return []; }
    return [res.record];
  });
  for (const r of ensureUniqueIds(clean)) warn('id', `duplicato rinominato: ${r}`);
  clean.sort((a, b) => a.id.localeCompare(b.id));

  const hash = createHash('sha256').update(JSON.stringify(clean)).digest('hex').slice(0, 16);
  let previous = null;
  if (existsSync(outFile)) {
    try { previous = JSON.parse(await readFile(outFile, 'utf8')); } catch { /* file corrotto: verrà riscritto */ }
  }

  console.log(perFile.join('\n'));
  if (warnings.length) console.log(`\nAvvisi (${warnings.length}):\n` + warnings.map((w) => `  ⚠ ${w}`).join('\n'));

  if (!forza && !opt('--versione') && previous?.hash === hash) {
    console.log(`\nNessuna modifica ai contenuti: ${path.relative(process.cwd(), outFile)} resta alla versione ${previous.versione}.`);
    return;
  }

  const versione = opt('--versione') ?? defaultVersion();
  // un record per riga: file compatto ma con diff leggibili su GitHub
  const body = clean.map((r) => JSON.stringify(r)).join(',\n');
  const json = `{"versione":${JSON.stringify(versione)},"generato":${JSON.stringify(new Date().toISOString())},"hash":"${hash}","records":[\n${body}\n]}\n`;
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, json);
  const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
  console.log(`\nScritto ${path.relative(process.cwd(), outFile)}: ${clean.length} record (${clean.filter((r) => r.demo).length} visibili in demo), ${kb} KB, versione ${versione}`);
  console.log('Questo file è IN CHIARO: non pubblicarlo. Per creare i file da pubblicare: npm run cifra-db');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-db.mjs')) {
  await main();
}
