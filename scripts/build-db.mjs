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
const SUPPORTED = new Set(['.docx', '.pdf', '.xlsx', '.xlsm', '.pptx', '.html', '.htm', '.txt', '.md', '.csv', '.json', ...Object.keys(LEGACY)]);

/** "schede-tecniche" -> "Schede tecniche" */
const ACRONYMS = new Set(['faq', 'it', 'hr', 'ict', 'dpi', 'ddt', 'sop']);
function prettify(s) {
  const t = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[A-Z]/.test(t)) return t; // l'utente ha già scelto maiuscole/minuscole
  return t.split(' ').map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

/** id dal percorso, senza ripetizioni: "faq/faq-helpdesk" -> "faq-helpdesk". */
function idFromPath(segments) {
  const slugs = segments.map((x) => slugify(x)).filter(Boolean);
  const kept = slugs.filter((seg, i) => !(i < slugs.length - 1 && slugs[i + 1].startsWith(seg)));
  return slugify(kept.join('-'));
}

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})[ _.-]+/;

/** Rifiuta titoli "spazzatura" provenienti dai metadati dei file. */
function goodTitle(t) {
  if (!t) return '';
  const s = String(t).replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 200) return '';
  if (/microsoft|\.docx?$|\.pdf$|untitled|senza titolo|presentazione standard|powerpoint|^documento\d*$|^diapositiva/i.test(s)) return '';
  return s;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

async function lazy(name) {
  try {
    return await import(name);
  } catch {
    console.error(`\nManca il pacchetto "${name}". Esegui: npm install\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- HTML -> testo

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'svg', 'template', 'button']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'blockquote', 'pre',
  'dl', 'dt', 'dd', 'figure', 'figcaption', 'hr', 'address', 'caption', 'body', 'html'
]);

async function htmlToText(html, { stripChrome = true } = {}) {
  const { parse } = await lazy('node-html-parser');
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const title = goodTitle(root.querySelector('title')?.text) || goodTitle(root.querySelector('h1')?.text);
  const start = (stripChrome && (root.querySelector('main') || root.querySelector('article'))) || root.querySelector('body') || root;
  let buf = '';
  const nl = (n) => {
    buf = buf.replace(/[ \t]+$/, '');
    const trailing = buf.length - buf.replace(/\n+$/, '').length;
    if (buf && trailing < n) buf += '\n'.repeat(n - trailing);
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      const t = node.text.replace(/\s+/g, ' '); // .text decodifica le entità (&nbsp; &egrave; …)
      if (t !== ' ' || !/\n$/.test(buf)) buf += t;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node.rawTagName || '').toLowerCase();
    if (stripChrome && SKIP_TAGS.has(tag)) return;
    if (tag === 'br') { buf += '\n'; return; }
    if (/^h[1-6]$/.test(tag)) { nl(2); node.childNodes.forEach(walk); nl(1); return; }
    if (tag === 'li') { nl(1); buf += '- '; }
    else if (tag === 'td' || tag === 'th') buf += ' | ';
    else if (tag === 'p' || tag === 'table' || tag === 'ul' || tag === 'ol') nl(2);
    else if (BLOCK_TAGS.has(tag)) nl(1);
    node.childNodes.forEach(walk);
    if (tag === 'p' || tag === 'table' || tag === 'ul' || tag === 'ol') nl(2);
    else if (BLOCK_TAGS.has(tag)) nl(1);
  };
  walk(start);
  const text = buf
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/^\s*\|\s*/, '').trim())
    .join('\n');
  return { title, text: normalizeText(text) };
}

// ---------------------------------------------------------------- estrattori per formato
// Ognuno restituisce { title?, text } oppure { rows: string[][][] , sheetNames } per i dati tabellari.

async function readDocx(buf) {
  const mammoth = (await lazy('mammoth')).default;
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const { text } = await htmlToText(`<body>${html}</body>`, { stripChrome: false });
  const m = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/);
  return { title: goodTitle(m ? decodeXml(m[1].replace(/<[^>]+>/g, '')) : ''), text };
}

async function readPdf(buf, rel) {
  const { getDocumentProxy, extractText, getMeta } = await lazy('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text: pages } = await extractText(pdf, { mergePages: false });
  let title = '';
  try { title = goodTitle((await getMeta(pdf)).info?.Title); } catch { /* metadati assenti */ }
  const text = normalizeText(
    pages.join('\n\n')
      .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2') // parole spezzate a fine riga
      // a capo "di impaginazione": unisce se la riga non chiude una frase e la successiva non è un elenco
      .replace(/([^.:;!?\n])\n(?!\s*(?:\d{1,3}[.)]\s|[-•–*▪]\s|\n|[A-ZÀ-Ý][^\n]{0,60}\n))/gu, '$1 ')
  );
  if (text.replace(/\s/g, '').length < 20 * totalPages) {
    warn(rel, `poco testo estratto (${text.length} caratteri su ${totalPages} pagine): forse è una scansione senza OCR`);
  }
  return { title, text };
}

function cellToString(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('it-IT', { timeZone: 'UTC' });
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellToString(v.result);
    if ('text' in v) return cellToString(v.text);
    if ('error' in v) return '';
  }
  return String(v);
}

async function readXlsx(buf) {
  const ExcelJS = (await lazy('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = cellToString(cell.value).trim(); });
      for (let i = 0; i < vals.length; i++) vals[i] ??= '';
      if (vals.some((v) => v)) rows.push(vals);
    });
    if (rows.length) sheets.push({ name: ws.name, rows });
  });
  return { sheets };
}

async function readPptx(buf) {
  const { unzipSync, strFromU8 } = await lazy('fflate');
  const files = unzipSync(new Uint8Array(buf));
  const slides = Object.keys(files)
    .map((k) => [k, k.match(/^ppt\/slides\/slide(\d+)\.xml$/)])
    .filter(([, m]) => m)
    .sort((a, b) => +a[1][1] - +b[1][1]);
  const parts = [];
  let firstLine = '';
  slides.forEach(([k], i) => {
    const xml = strFromU8(files[k]);
    const paras = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
      .map((m) => [...m[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1])).join('').trim())
      .filter(Boolean);
    if (!paras.length) return;
    if (!firstLine) firstLine = paras[0];
    parts.push(`Slide ${i + 1}: ${paras[0]}\n${paras.slice(1).join('\n')}`.trim());
  });
  let title = '';
  if (files['docProps/core.xml']) {
    const m = strFromU8(files['docProps/core.xml']).match(/<dc:title>([\s\S]*?)<\/dc:title>/);
    title = goodTitle(m && decodeXml(m[1]));
  }
  return { title: title || goodTitle(firstLine), text: normalizeText(parts.join('\n\n')) };
}

async function readTextFile(buf, ext) {
  let text = normalizeText(decodeText(new Uint8Array(buf)));
  const m = ext === '.md' ? text.match(/^#{1,2}\s+(.+)$/m) : null;
  if (ext === '.md') text = stripMarkdown(text);
  return { title: goodTitle(m?.[1] && stripMarkdown(m[1])), text };
}

function stripMarkdown(s) {
  return normalizeText(s
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*[*+]\s+/gm, '- ')
    .replace(/^>\s?/gm, ''));
}

// ---------------------------------------------------------------- tabelle (Excel/CSV)

/** Una tabella con colonne titolo/domanda + testo/risposta diventa un record per riga. */
function isRecordTable(rows) {
  if (rows.length < 2) return false;
  const fields = rows[0].map((h) => fieldForKey(String(h)));
  return fields.includes('testo') && (fields.includes('titolo') || fields.includes('id'));
}

function tableToRecords(rows, ctx, label) {
  if (isRecordTable(rows)) {
    const hasId = rows[0].some((h) => fieldForKey(String(h)) === 'id');
    const titleCol = rows[0].findIndex((h) => fieldForKey(String(h)) === 'titolo');
    return rowsToObjects(rows).flatMap((obj, i) => {
      const rowTitle = titleCol >= 0 ? Object.values(obj)[titleCol] : '';
      const defaults = {
        ...ctx.defaults,
        id: hasId ? undefined : `${ctx.fileId}-${slugify(rowTitle || `riga-${i + 2}`, 50)}`
      };
      const res = normalizeRecord(obj, defaults);
      if (!res.record) { warn(ctx.rel, `${label} riga ${i + 2}: ${res.error}`); return []; }
      if (ctx.defaults.tag.length) res.record.tag = parseTags([...ctx.defaults.tag, ...res.record.tag]);
      return [res.record];
    });
  }
  // tabella generica: un solo record, una riga di testo per riga della tabella
  const [head, ...body] = rows;
  const lines = body.map((r) =>
    r.map((v, i) => (v ? (head[i] ? `${head[i]}: ${v}` : v) : '')).filter(Boolean).join(' · ')
  );
  return [{ text: normalizeText(lines.join('\n')), label }];
}

// ---------------------------------------------------------------- FAQ

const QUESTION = /^\s*(?:(?:D|Q|Domanda)\s*[:.)-]\s*|\d{1,3}\s*[.)-]\s*)?(.{5,250}\?)\s*$/i;

/** Divide un testo FAQ in coppie domanda/risposta. */
export function splitFaq(text) {
  const pairs = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(QUESTION);
    if (m) {
      if (cur) pairs.push(cur);
      cur = { q: m[1].replace(/^[-–•]\s*/, '').trim(), a: [] };
    } else if (cur) {
      cur.a.push(line.replace(/^\s*(?:R|A|Risposta)\s*[:.)-]\s*/i, ''));
    }
  }
  if (cur) pairs.push(cur);
  return pairs
    .map((p) => ({ q: p.q, a: normalizeText(p.a.join('\n')) }))
    .filter((p) => p.a);
}

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
  const ctx = { rel, fileId, defaults };
  const fallbackTitle = prettify(cleanName);
  const buf = await readFile(readPath);

  // --- formati che possono produrre più record
  if (ext === '.json') {
    const parsed = parseDbJson(JSON.parse(decodeText(new Uint8Array(buf))));
    return parsed.items.flatMap((it, i) => {
      if (!it.record) { warn(rel, `elemento ${i + 1}: ${it.error}`); return []; }
      const r = it.record;
      if (r.categoria === 'Generale' && defaults.categoria !== 'Generale') r.categoria = defaults.categoria;
      if (!r.fonte) r.fonte = defaults.fonte;
      if (!r.data_aggiornamento) r.data_aggiornamento = defaults.data_aggiornamento;
      if (defaults.demo) r.demo = true;
      return [r];
    });
  }

  let doc;
  if (ext === '.xlsx' || ext === '.xlsm' || ext === '.csv') {
    const sheets = ext === '.csv'
      ? [{ name: '', rows: parseCsv(decodeText(new Uint8Array(buf))) }]
      : (await readXlsx(buf)).sheets;
    const records = [];
    const texts = [];
    for (const sh of sheets) {
      for (const item of tableToRecords(sh.rows, ctx, sh.name ? `foglio "${sh.name}"` : 'CSV')) {
        if ('text' in item) texts.push(sheets.length > 1 ? `## ${sh.name}\n${item.text}` : item.text);
        else records.push(item);
      }
    }
    if (texts.length) doc = { title: '', text: normalizeText(texts.join('\n\n')) };
    if (!doc) return records;
    if (records.length) {
      // file misto: record per riga + un record con i fogli generici
      return [...records, makeRecord(ctx, meta, { ...doc, id: `${fileId}-tabelle` }, fallbackTitle, true)];
    }
  } else if (ext === '.docx') doc = await readDocx(buf);
  else if (ext === '.pdf') doc = await readPdf(buf, rel);
  else if (ext === '.pptx') doc = await readPptx(buf);
  else if (ext === '.html' || ext === '.htm') doc = await htmlToText(decodeText(new Uint8Array(buf)));
  else doc = await readTextFile(buf, ext);

  if (!doc.text) { warn(rel, 'nessun testo estratto, ignorato'); return []; }

  // --- FAQ: un record per domanda
  if (/faq/i.test(`${defaults.categoria} ${rel}`)) {
    const pairs = splitFaq(doc.text);
    if (pairs.length >= 2) {
      return pairs.map((p) => ({
        id: `${fileId}-${slugify(p.q, 50)}`,
        titolo: p.q,
        testo: p.a,
        categoria: defaults.categoria,
        tag: defaults.tag,
        fonte: defaults.fonte,
        data_aggiornamento: defaults.data_aggiornamento,
        ...(defaults.demo ? { demo: true } : {})
      }));
    }
  }

  return [makeRecord(ctx, meta, doc, fallbackTitle, false)];
}

function makeRecord(ctx, meta, doc, fallbackTitle, multi) {
  const d = ctx.defaults;
  return {
    id: (!multi && meta.id) || doc.id || ctx.fileId,
    titolo: (!multi && meta.titolo) || doc.title || fallbackTitle,
    testo: doc.text,
    categoria: d.categoria,
    tag: d.tag,
    fonte: d.fonte,
    data_aggiornamento: d.data_aggiornamento,
    ...(d.demo ? { demo: true } : {})
  };
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
