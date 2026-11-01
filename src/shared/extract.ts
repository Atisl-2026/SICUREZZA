// Estrazione del testo dai documenti → schede.
// Condiviso da scripts/build-db.mjs (computer) e dal caricamento documenti nell'app (telefono):
// stesse regole e stesso risultato ovunque. Nessuna dipendenza da Node o dal DOM:
// Word, Excel e PowerPoint sono archivi zip di XML, letti con fflate.
import { strFromU8, unzipSync } from 'fflate';
import { decodeText, parseCsv, rowsToObjects } from './csv.ts';
import {
  fieldForKey, normalizeRecord, normalizeText, parseDbJson, parseTags, slugify
} from './normalize.ts';
import type { DbRecord } from './types.ts';

// ============================================================ utilità

const ACRONYMS = new Set(['faq', 'it', 'hr', 'ict', 'dpi', 'ddt', 'sop']);

/** "schede-tecniche" -> "Schede tecniche" (le maiuscole scelte dall'utente restano). */
export function prettify(s: string): string {
  const t = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[A-Z]/.test(t)) return t;
  return t
    .split(' ')
    .map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** id dal percorso, senza ripetizioni: ["faq", "faq-helpdesk"] -> "faq-helpdesk". */
export function idFromPath(segments: string[]): string {
  const slugs = segments.map((x) => slugify(x)).filter(Boolean);
  const kept = slugs.filter((seg, i) => !(i < slugs.length - 1 && slugs[i + 1].startsWith(seg)));
  return slugify(kept.join('-'));
}

/** Data all'inizio del nome file: "2025-03-12_circolare.pdf". */
export const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})[ _.-]+/;

/** Rifiuta titoli "spazzatura" provenienti dai metadati dei file. */
export function goodTitle(t: unknown): string {
  if (!t) return '';
  const s = String(t).replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 200) return '';
  if (/microsoft|\.docx?$|\.pdf$|untitled|senza titolo|presentazione standard|powerpoint|^documento\d*$|^diapositiva/i.test(s)) return '';
  return s;
}

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

export function stripMarkdown(s: string): string {
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

export interface Doc {
  title: string;
  text: string;
  id?: string;
}

export interface Sheet {
  name: string;
  rows: string[][];
}

const unzip = (bytes: Uint8Array) => {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error('il file è danneggiato o non è nel formato atteso');
  }
};
const xmlOf = (files: Record<string, Uint8Array>, path: string) => (files[path] ? strFromU8(files[path]) : '');

function coreTitle(files: Record<string, Uint8Array>): string {
  const m = xmlOf(files, 'docProps/core.xml').match(/<dc:title>([\s\S]*?)<\/dc:title>/);
  return goodTitle(m && decodeXml(m[1]));
}

// ============================================================ Word (.docx)

function runText(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)) {
    if (m[1] != null) out += decodeXml(m[1]);
    else out += m[2] === 'tab' ? ' ' : '\n';
  }
  return out;
}

/** Legge un documento Word: titoli, paragrafi, elenchi e tabelle, nell'ordine. */
export function readDocx(bytes: Uint8Array): Doc {
  const files = unzip(bytes);
  const xml = xmlOf(files, 'word/document.xml');
  if (!xml) throw new Error('non è un documento Word (.docx)');
  const body = xml.slice(Math.max(0, xml.indexOf('<w:body')));
  const blocks: string[] = [];
  let firstHeading = '';
  let pos = 0;

  while (pos < body.length) {
    const p = body.slice(pos).search(/<w:p[\s>]/);
    const t = body.indexOf('<w:tbl>', pos);
    const pAt = p < 0 ? -1 : pos + p;
    if (pAt < 0 && t < 0) break;

    if (t >= 0 && (pAt < 0 || t < pAt)) {
      // tabella (anche annidata): si cerca la chiusura corrispondente
      let depth = 0;
      let i = t;
      const re = /<w:tbl>|<\/w:tbl>/g;
      re.lastIndex = t;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) {
        depth += m[0] === '<w:tbl>' ? 1 : -1;
        if (depth === 0) { i = m.index + m[0].length; break; }
      }
      const tbl = body.slice(t, i);
      const rows = [...tbl.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((r) =>
        [...r[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)]
          .map((c) => [...c[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((pp) => runText(pp[0]).trim()).filter(Boolean).join(' '))
          .join(' | ')
      ).filter((r) => r.replace(/[\s|]/g, ''));
      if (rows.length) blocks.push(rows.join('\n'));
      pos = i > t ? i : t + 7;
      continue;
    }

    const end = body.indexOf('</w:p>', pAt);
    const selfClose = body.slice(pAt, body.indexOf('>', pAt) + 1).endsWith('/>');
    if (selfClose) { pos = body.indexOf('>', pAt) + 1; continue; }
    const para = body.slice(pAt, end < 0 ? body.length : end + 6);
    pos = end < 0 ? body.length : end + 6;
    const text = runText(para).replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const style = para.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
    const level = style.match(/^(?:heading|titolo|title|intestazione)\s*(\d?)$/i);
    if (level) {
      const n = Number(level[1] || 1);
      if (!firstHeading && n <= 2) firstHeading = text;
      blocks.push(`\n${text}\n`);
    } else if (/<w:numPr>/.test(para) || /^(?:list|elenco)/i.test(style)) {
      blocks.push(`- ${text}`);
    } else {
      blocks.push(text);
    }
  }

  // elementi di elenco consecutivi su righe singole, il resto separato da una riga vuota
  let out = '';
  blocks.forEach((b, i) => {
    if (i > 0) out += b.startsWith('- ') && blocks[i - 1].startsWith('- ') ? '\n' : '\n\n';
    out += b;
  });
  return { title: goodTitle(firstHeading) || coreTitle(files), text: normalizeText(out) };
}

// ============================================================ PowerPoint (.pptx)

export function readPptx(bytes: Uint8Array): Doc {
  const files = unzip(bytes);
  const slides = Object.keys(files)
    .map((k) => [k, k.match(/^ppt\/slides\/slide(\d+)\.xml$/)] as const)
    .filter(([, m]) => m)
    .sort((a, b) => +a[1]![1] - +b[1]![1]);
  if (!slides.length) throw new Error('non è una presentazione PowerPoint (.pptx)');
  const parts: string[] = [];
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
  return { title: coreTitle(files) || goodTitle(firstLine), text: normalizeText(parts.join('\n\n')) };
}

// ============================================================ Excel (.xlsx)

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function excelSerialToDate(serial: number, date1904: boolean): string {
  const ms = Math.round((serial - (date1904 ? -1462 : 25569)) * 86400000);
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Legge i fogli visibili di un file Excel: righe di testo (date in formato gg/mm/aaaa). */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = unzip(bytes);
  const workbook = xmlOf(files, 'xl/workbook.xml');
  if (!workbook) throw new Error('non è un file Excel (.xlsx)');
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(workbook);

  const shared = [...xmlOf(files, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('')
  );

  const styles = xmlOf(files, 'xl/styles.xml');
  const customFormats = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) customFormats.set(+m[1], decodeXml(m[2]));
  const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].map((m) => {
    const id = +m[1];
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = (customFormats.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
    return /[dy]/i.test(code) || /m{1,4}[^:]*[dy]|[dy][^:]*m/i.test(code);
  });

  const rels = new Map<string, string>();
  // gli attributi possono comparire in qualsiasi ordine
  for (const m of xmlOf(files, 'xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/\bId="([^"]+)"/)?.[1];
    const target = m[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    if (/state="(hidden|veryHidden)"/.test(attrs)) continue;
    const name = decodeXml(attrs.match(/name="([^"]*)"/)?.[1] ?? '');
    const rid = attrs.match(/r:id="([^"]+)"/)?.[1] ?? '';
    const xml = xmlOf(files, rels.get(rid) ?? '');
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const vals: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = c[1];
        const inner = c[2] ?? '';
        const ref = a.match(/r="([A-Z]+)\d+"/)?.[1];
        const idx = ref ? colIndex(ref) : vals.length;
        const type = a.match(/t="([^"]+)"/)?.[1];
        const style = Number(a.match(/s="(\d+)"/)?.[1] ?? 0);
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let out = '';
        if (type === 's') out = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') out = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('');
        else if (type === 'str') out = decodeXml(v ?? '');
        else if (type === 'b') out = v === '1' ? 'VERO' : 'FALSO';
        else if (type === 'e') out = '';
        else if (v != null && v !== '') {
          const num = Number(v);
          out = dateStyle[style] && Number.isFinite(num) ? excelSerialToDate(num, date1904) : String(parseFloat(num.toPrecision(15)));
        }
        vals[idx] = out.trim();
      }
      for (let i = 0; i < vals.length; i++) vals[i] ??= '';
      if (vals.some((x) => x)) rows.push(vals);
    }
    if (rows.length) sheets.push({ name, rows });
  }
  return sheets;
}

// ============================================================ testo, Markdown, PDF, HTML

export function readText(bytes: Uint8Array, ext: string): Doc {
  let text = normalizeText(decodeText(bytes));
  const m = ext === '.md' ? text.match(/^#{1,2}\s+(.+)$/m) : null;
  if (ext === '.md') text = stripMarkdown(text);
  return { title: goodTitle(m?.[1] && stripMarkdown(m[1])), text };
}

/** Ricompone il testo estratto da un PDF (righe spezzate dall'impaginazione, parole con trattino). */
export function cleanPdfText(pages: string[]): string {
  return normalizeText(
    pages.join('\n\n')
      .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
      .replace(/([^.:;!?\n])\n(?!\s*(?:\d{1,3}[.)]\s|[-•–*▪]\s|\n|[A-ZÀ-Ý][^\n]{0,60}\n))/gu, '$1 ')
  );
}

/** Come leggere un nodo HTML: adattatori per il DOM del browser e per node-html-parser. */
export interface HtmlAdapter<N> {
  isText(n: N): boolean;
  isElement(n: N): boolean;
  tag(n: N): string;
  /** testo di un nodo di testo, con le entità già decodificate */
  text(n: N): string;
  children(n: N): N[];
}

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'svg', 'template', 'button']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'blockquote', 'pre',
  'dl', 'dt', 'dd', 'figure', 'figcaption', 'hr', 'address', 'caption', 'body', 'html'
]);

/** Testo leggibile da un albero HTML: titoli, paragrafi, elenchi, tabelle; senza menu, piè di pagina e script. */
export function htmlNodeToText<N>(start: N, a: HtmlAdapter<N>, stripChrome = true): string {
  let buf = '';
  const nl = (n: number) => {
    buf = buf.replace(/[ \t]+$/, '');
    const trailing = buf.length - buf.replace(/\n+$/, '').length;
    if (buf && trailing < n) buf += '\n'.repeat(n - trailing);
  };
  const walk = (node: N) => {
    if (a.isText(node)) {
      const t = a.text(node).replace(/\s+/g, ' ');
      if (t !== ' ' || !/\n$/.test(buf)) buf += t;
      return;
    }
    if (!a.isElement(node)) return;
    const tag = a.tag(node);
    if (stripChrome && SKIP_TAGS.has(tag)) return;
    if (tag === 'br') { buf += '\n'; return; }
    if (/^h[1-6]$/.test(tag)) { nl(2); a.children(node).forEach(walk); nl(1); return; }
    if (tag === 'li') { nl(1); buf += '- '; }
    else if (tag === 'td' || tag === 'th') buf += ' | ';
    else if (tag === 'p' || tag === 'table' || tag === 'ul' || tag === 'ol') nl(2);
    else if (BLOCK_TAGS.has(tag)) nl(1);
    a.children(node).forEach(walk);
    if (tag === 'p' || tag === 'table' || tag === 'ul' || tag === 'ol') nl(2);
    else if (BLOCK_TAGS.has(tag)) nl(1);
  };
  walk(start);
  return normalizeText(buf
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/^\s*\|\s*/, '').trim())
    .join('\n'));
}

// ============================================================ FAQ

const QUESTION = /^\s*(?:(?:D|Q|Domanda)\s*[:.)-]\s*|\d{1,3}\s*[.)-]\s*)?(.{5,250}\?)\s*$/i;

/** Divide un testo FAQ in coppie domanda/risposta (righe che terminano con "?"). */
export function splitFaq(text: string): { q: string; a: string }[] {
  const pairs: { q: string; a: string[] }[] = [];
  let cur: { q: string; a: string[] } | null = null;
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
  return pairs.map((p) => ({ q: p.q, a: normalizeText(p.a.join('\n')) })).filter((p) => p.a);
}

// ============================================================ documento → schede

export interface ExtractContext {
  /** id di base delle schede del file (es. "procedure-ferie"). */
  fileId: string;
  /** nome del file per i messaggi */
  label: string;
  defaults: { categoria: string; tag: string[]; fonte: string; data_aggiornamento: string; demo: boolean };
  /** titolo se il documento non ne ha uno */
  fallbackTitle: string;
  /** id e titolo imposti (metadati.csv), solo per i file che producono una sola scheda */
  override?: { id?: string; titolo?: string };
  warn: (msg: string) => void;
}

function makeRecord(ctx: ExtractContext, doc: Doc, multi: boolean): DbRecord {
  const d = ctx.defaults;
  return {
    id: (!multi && ctx.override?.id) || doc.id || ctx.fileId,
    titolo: (!multi && ctx.override?.titolo) || doc.title || ctx.fallbackTitle,
    testo: doc.text,
    categoria: d.categoria,
    tag: d.tag,
    fonte: d.fonte,
    data_aggiornamento: d.data_aggiornamento,
    ...(d.demo ? { demo: true } : {})
  };
}

function isRecordTable(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const fields = rows[0].map((h) => fieldForKey(String(h)));
  return fields.includes('testo') && (fields.includes('titolo') || fields.includes('id'));
}

/**
 * Fogli Excel/CSV → schede:
 * - tabelle con colonne titolo/domanda + testo/risposta: una scheda per riga;
 * - altre tabelle: una scheda per file, una riga di testo per riga.
 */
export function sheetsToRecords(sheets: Sheet[], ctx: ExtractContext): DbRecord[] {
  const records: DbRecord[] = [];
  const texts: string[] = [];
  for (const sh of sheets) {
    const label = sh.name ? `foglio "${sh.name}"` : 'CSV';
    if (isRecordTable(sh.rows)) {
      const hasId = sh.rows[0].some((h) => fieldForKey(String(h)) === 'id');
      const titleCol = sh.rows[0].findIndex((h) => fieldForKey(String(h)) === 'titolo');
      rowsToObjects(sh.rows).forEach((obj, i) => {
        const rowTitle = titleCol >= 0 ? Object.values(obj)[titleCol] : '';
        const res = normalizeRecord(obj, {
          ...ctx.defaults,
          id: hasId ? undefined : `${ctx.fileId}-${slugify(rowTitle || `riga-${i + 2}`, 50)}`
        });
        if (!res.record) { ctx.warn(`${label} riga ${i + 2}: ${res.error}`); return; }
        if (ctx.defaults.tag.length) res.record.tag = parseTags([...ctx.defaults.tag, ...res.record.tag]);
        records.push(res.record);
      });
    } else {
      const [head, ...body] = sh.rows;
      const lines = body.map((r) => r.map((v, i) => (v ? (head[i] ? `${head[i]}: ${v}` : v) : '')).filter(Boolean).join(' · '));
      const text = normalizeText(lines.join('\n'));
      if (text) texts.push(sheets.length > 1 ? `## ${sh.name}\n${text}` : text);
    }
  }
  if (!texts.length) return records;
  const doc = { title: '', text: normalizeText(texts.join('\n\n')) };
  // file misto: schede per riga + una scheda con i fogli generici
  return records.length ? [...records, makeRecord(ctx, { ...doc, id: `${ctx.fileId}-tabelle` }, true)] : [makeRecord(ctx, doc, false)];
}

/** Documento → una scheda, oppure una per domanda se è una FAQ. */
export function docToRecords(doc: Doc, ctx: ExtractContext): DbRecord[] {
  if (!doc.text) { ctx.warn('nessun testo estratto, ignorato'); return []; }
  if (/faq/i.test(`${ctx.defaults.categoria} ${ctx.label}`)) {
    const pairs = splitFaq(doc.text);
    if (pairs.length >= 2) {
      return pairs.map((p) => ({
        id: `${ctx.fileId}-${slugify(p.q, 50)}`,
        titolo: p.q,
        testo: p.a,
        categoria: ctx.defaults.categoria,
        tag: ctx.defaults.tag,
        fonte: ctx.defaults.fonte,
        data_aggiornamento: ctx.defaults.data_aggiornamento,
        ...(ctx.defaults.demo ? { demo: true } : {})
      }));
    }
  }
  return [makeRecord(ctx, doc, false)];
}

/** File JSON di schede (db-generato.json, backup, elenco). */
export function jsonToRecords(bytes: Uint8Array, ctx: ExtractContext): DbRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(decodeText(bytes));
  } catch {
    throw new Error('il file JSON non è valido');
  }
  return parseDbJson(data).items.flatMap((it, i) => {
    if (!it.record) { ctx.warn(`elemento ${i + 1}: ${it.error}`); return []; }
    const r = it.record;
    if (r.categoria === 'Generale' && ctx.defaults.categoria !== 'Generale') r.categoria = ctx.defaults.categoria;
    if (!r.fonte) r.fonte = ctx.defaults.fonte;
    if (!r.data_aggiornamento) r.data_aggiornamento = ctx.defaults.data_aggiornamento;
    if (ctx.defaults.demo) r.demo = true;
    return [r];
  });
}

/** Formati leggibili ovunque (computer e telefono); .pdf e .html richiedono un lettore dell'ambiente. */
export const SUPPORTED_EXT = ['.docx', '.pdf', '.xlsx', '.xlsm', '.pptx', '.html', '.htm', '.txt', '.md', '.csv', '.json'];

/**
 * Converte un file in schede. pdf e html dipendono dall'ambiente (unpdf, DOM o node-html-parser):
 * vengono passati come funzioni.
 */
export async function fileToRecords(
  bytes: Uint8Array,
  ext: string,
  ctx: ExtractContext,
  readers: { pdf: (b: Uint8Array) => Promise<Doc>; html: (text: string) => Doc | Promise<Doc> }
): Promise<DbRecord[]> {
  switch (ext) {
    case '.json': return jsonToRecords(bytes, ctx);
    case '.csv': return sheetsToRecords([{ name: '', rows: parseCsv(decodeText(bytes)) }], ctx);
    case '.xlsx':
    case '.xlsm': {
      const sheets = readXlsx(bytes);
      if (!sheets.length) ctx.warn('nessun foglio con dati trovato');
      return sheetsToRecords(sheets, ctx);
    }
    case '.docx': return docToRecords(readDocx(bytes), ctx);
    case '.pptx': return docToRecords(readPptx(bytes), ctx);
    case '.pdf': return docToRecords(await readers.pdf(bytes), ctx);
    case '.html':
    case '.htm': return docToRecords(await readers.html(decodeText(bytes)), ctx);
    case '.txt':
    case '.md': return docToRecords(readText(bytes, ext), ctx);
    default: throw new Error(`formato ${ext || 'sconosciuto'} non supportato`);
  }
}

/** PDF → testo con unpdf (stesso codice su computer e telefono). */
export async function readPdfWith(
  unpdf: {
    getDocumentProxy: (b: Uint8Array) => Promise<unknown>;
    extractText: (pdf: never, o: { mergePages: false }) => Promise<{ totalPages: number; text: string[] }>;
    getMeta: (pdf: never) => Promise<{ info?: Record<string, unknown> }>;
  },
  bytes: Uint8Array,
  warn: (m: string) => void
): Promise<Doc> {
  const pdf = (await unpdf.getDocumentProxy(new Uint8Array(bytes))) as never;
  const { totalPages, text: pages } = await unpdf.extractText(pdf, { mergePages: false });
  let title = '';
  try {
    title = goodTitle((await unpdf.getMeta(pdf)).info?.Title);
  } catch {
    /* metadati assenti */
  }
  const text = cleanPdfText(pages);
  if (text.replace(/\s/g, '').length < 20 * totalPages) {
    warn(`poco testo estratto (${text.length} caratteri su ${totalPages} pagine): forse è una scansione senza OCR`);
  }
  return { title, text };
}
