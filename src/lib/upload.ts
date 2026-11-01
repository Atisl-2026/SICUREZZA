// Caricamento di documenti dal telefono (programmatore): estrazione del testo nel browser,
// con le stesse regole di scripts/build-db.mjs (modulo condiviso src/shared/extract.ts).
import {
  DATE_PREFIX, fileToRecords, goodTitle, htmlNodeToText, idFromPath, prettify, readPdfWith, SUPPORTED_EXT, type Doc
} from '../shared/extract.ts';
import { parseDate } from '../shared/normalize.ts';
import type { DbRecord } from '../shared/types.ts';

export const ACCEPT = SUPPORTED_EXT.join(',');

export interface UploadResult {
  file: string;
  records: DbRecord[];
  warnings: string[];
  error?: string;
}

function readHtml(html: string): Doc {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = goodTitle(doc.querySelector('title')?.textContent) || goodTitle(doc.querySelector('h1')?.textContent);
  const start = doc.querySelector('main') ?? doc.querySelector('article') ?? doc.body ?? doc.documentElement;
  const text = htmlNodeToText<Node>(start, {
    isText: (n) => n.nodeType === Node.TEXT_NODE,
    isElement: (n) => n.nodeType === Node.ELEMENT_NODE,
    tag: (n) => n.nodeName.toLowerCase(),
    text: (n) => n.nodeValue ?? '',
    children: (n) => Array.from(n.childNodes)
  });
  return { title, text };
}

async function readPdf(bytes: Uint8Array, warn: (m: string) => void): Promise<Doc> {
  let unpdf;
  try {
    unpdf = await import('unpdf'); // caricato solo quando serve (~1,7 MB)
  } catch {
    throw new Error('il lettore PDF non è disponibile: serve la connessione la prima volta');
  }
  try {
    return await readPdfWith(unpdf as never, bytes, warn);
  } catch (e) {
    throw new Error(`impossibile leggere il PDF (${(e as Error).message}). Se il problema persiste caricalo dal computer.`);
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Estrae le schede da un file scelto dall'utente. Non salva nulla. */
export async function extractUpload(file: File, opts: { categoria: string; demo: boolean }): Promise<UploadResult> {
  const warnings: string[] = [];
  const name = file.name;
  const ext = (name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  const baseName = name.replace(/\.[^.]+$/, '');
  const datePrefix = baseName.match(DATE_PREFIX);
  const cleanName = baseName.replace(DATE_PREFIX, '');
  const categoria = opts.categoria.trim() || 'Generale';

  if (!SUPPORTED_EXT.includes(ext)) {
    const hint = /^\.(doc|xls|ppt|rtf|odt|ods|odp)$/.test(ext) ? ' Salvalo in formato moderno (.docx, .xlsx, .pptx) e riprova.' : '';
    return { file: name, records: [], warnings, error: `Formato non supportato.${hint}` };
  }

  const ctx = {
    fileId: idFromPath([categoria, cleanName]),
    label: name,
    defaults: {
      categoria,
      tag: [],
      fonte: name,
      data_aggiornamento: (datePrefix && parseDate(datePrefix[1])) || parseDate(new Date(file.lastModified)) || today(),
      demo: opts.demo
    },
    fallbackTitle: prettify(cleanName),
    warn: (m: string) => warnings.push(m)
  };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const records = await fileToRecords(bytes, ext, ctx, { pdf: (b) => readPdf(b, ctx.warn), html: readHtml });
    if (!records.length && !warnings.length) warnings.push('nessun testo trovato');
    return { file: name, records, warnings };
  } catch (e) {
    return { file: name, records: [], warnings, error: `Errore: ${(e as Error).message}` };
  }
}
