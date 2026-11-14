// Caricamento di documenti dal telefono (programmatore): estrazione del testo nel browser,
// con le stesse regole di scripts/build-db.mjs (modulo condiviso src/shared/extract.ts).
import {
  cleanPdfText, DATE_PREFIX, docToRecords, fileToRecords, goodTitle, htmlNodeToText, idFromPath, pageOffsets, prettify, readPdfWith,
  SUPPORTED_EXT, type Doc, type ExtractContext
} from '../shared/extract.ts';
import { parseDate } from '../shared/normalize.ts';
import type { DbRecord } from '../shared/types.ts';
import {
  genericName, IMAGE_EXT, imageToCanvas, isImageName, needsOcr, OcrAbort, renderPdfPage, titleFromText, type OcrSession
} from './ocr';

export const ACCEPT = [...SUPPORTED_EXT, ...IMAGE_EXT].join(',');

export interface UploadOptions {
  categoria: string;
  demo: boolean;
  /** lettura OCR di PDF scansionati e foto (se assente le scansioni restano senza testo) */
  ocr?: OcrSession | null;
}

export interface UploadResult {
  file: string;
  records: DbRecord[];
  warnings: string[];
  error?: string;
  /** l'utente ha interrotto la lettura */
  interrotta?: boolean;
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

/** Sotto questa affidabilità media l'OCR probabilmente ha letto male (scansione sfocata, storta, scritta a mano). */
const LOW_CONFIDENCE = 60;

function ocrNotes(warn: (m: string) => void, pages: number, total: number, confidence: number) {
  warn(total > 1
    ? `testo letto con OCR in ${pages} ${pages === 1 ? 'pagina' : 'pagine'} su ${total}: controlla che non ci siano errori`
    : 'testo letto con OCR: controlla che non ci siano errori');
  if (confidence < LOW_CONFIDENCE) {
    warn(`lettura poco sicura (affidabilità ${Math.round(confidence)}%): se possibile usa una scansione più nitida e diritta`);
  }
}

async function readPdf(bytes: Uint8Array, name: string, warn: (m: string) => void, ocr?: OcrSession | null): Promise<Doc> {
  let unpdf: typeof import('unpdf');
  try {
    unpdf = await import('unpdf'); // caricato solo quando serve (~1,7 MB)
  } catch {
    if (!navigator.onLine) throw new Error('il lettore PDF non è disponibile: serve la connessione la prima volta');
    // online: quasi sempre è una versione vecchia dell'app ancora aperta mentre il sito è stato aggiornato
    try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* niente */ }
    throw new Error('il lettore PDF di questa versione dell\'app non è più sul sito perché nel frattempo è uscita una versione nuova. Tocca «Aggiorna» nel riquadro in alto (oppure chiudi del tutto l\'app e riaprila) e carica di nuovo il file.');
  }
  // pagine senza testo (scansioni): si disegnano e si leggono con l'OCR, le altre restano come sono
  let scanned = false;
  const readScans = ocr
    ? async (pdf: never, pages: string[]) => {
      const todo = pages.flatMap((t, i) => (needsOcr(t) ? [i] : []));
      if (!todo.length) return pages;
      scanned = todo.length === pages.length;
      unpdf.registerImageDecoders(); // scansioni in JBIG2, CCITT, JPEG 2000
      const out = [...pages];
      let confidence = 0;
      for (const [k, i] of todo.entries()) {
        const page = await renderPdfPage(pdf as never, i + 1);
        const r = await ocr.read(page, `${name}: lettura OCR ${todo.length > 1 ? `pagina ${i + 1} (${k + 1} di ${todo.length})` : `pagina ${i + 1}`}`);
        out[i] = r.text;
        confidence += r.confidence;
      }
      ocrNotes(warn, todo.length, pages.length, confidence / todo.length);
      return out;
    }
    : undefined;
  try {
    const doc = await readPdfWith(unpdf as never, bytes, warn, readScans);
    // scansione con un nome di file generico (es. «scan0001.pdf»): titolo dalla prima riga letta
    if (!doc.title && scanned && genericName(name)) doc.title = titleFromText(doc.text);
    return doc;
  } catch (e) {
    if (e instanceof OcrAbort) throw e;
    throw new Error(`impossibile leggere il PDF (${(e as Error).message}). Se il problema persiste caricalo dal computer.`);
  }
}

/** Foto (una o più pagine dello stesso documento) → testo con l'OCR. */
async function readPhotos(files: File[], ocr: OcrSession, warn: (m: string) => void): Promise<Doc> {
  const pages: string[] = [];
  let confidence = 0;
  for (const [k, f] of files.entries()) {
    const img = await imageToCanvas(f);
    const r = await ocr.read(img, files.length > 1 ? `Lettura OCR foto ${k + 1} di ${files.length}` : `${f.name}: lettura OCR`);
    pages.push(r.text);
    confidence += r.confidence;
  }
  const text = cleanPdfText(pages);
  if (text) ocrNotes(warn, files.length, files.length, confidence / files.length);
  const first = files[0].name.replace(/\.[^.]+$/, '').replace(DATE_PREFIX, '');
  return {
    title: genericName(first) ? titleFromText(pages.join('\n')) : '',
    text,
    ...(files.length > 1 ? { pagine: pageOffsets(text, pages) } : {})
  };
}

const today = () => new Date().toISOString().slice(0, 10);

function contextFor(file: File, opts: UploadOptions, warnings: string[]): ExtractContext {
  const name = file.name;
  const baseName = name.replace(/\.[^.]+$/, '');
  const datePrefix = baseName.match(DATE_PREFIX);
  const cleanName = baseName.replace(DATE_PREFIX, '');
  const categoria = opts.categoria.trim() || 'Generale';
  return {
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
}

const failed = (file: string, warnings: string[], e: unknown): UploadResult => ({
  file,
  records: [],
  warnings,
  error: e instanceof OcrAbort ? 'Lettura interrotta.' : `Errore: ${(e as Error).message}`,
  ...(e instanceof OcrAbort ? { interrotta: true } : {})
});

/** Estrae le schede da un file scelto dall'utente. Non salva nulla. */
export async function extractUpload(file: File, opts: UploadOptions): Promise<UploadResult> {
  const warnings: string[] = [];
  const name = file.name;
  const ext = (name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();

  if (isImageName(name)) return extractPhotos([file], opts);
  if (!SUPPORTED_EXT.includes(ext)) {
    const hint = /^\.(doc|xls|ppt|rtf|odt|ods|odp)$/.test(ext)
      ? ' Salvalo in formato moderno (.docx, .xlsx, .pptx) e riprova.'
      : /^\.(heic|heif)$/.test(ext) ? ' Scatta o salva la foto in formato JPG e riprova.' : '';
    return { file: name, records: [], warnings, error: `Formato non supportato.${hint}` };
  }

  const ctx = contextFor(file, opts, warnings);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const records = await fileToRecords(bytes, ext, ctx, { pdf: (b) => readPdf(b, name, ctx.warn, opts.ocr), html: readHtml });
    if (!records.length && !warnings.length) warnings.push('nessun testo trovato');
    return { file: name, records, warnings };
  } catch (e) {
    return failed(name, warnings, e);
  }
}

/** Foto di documenti: ognuna una scheda, oppure (più foto insieme) le pagine di un unico documento. */
export async function extractPhotos(files: File[], opts: UploadOptions): Promise<UploadResult> {
  const warnings: string[] = [];
  const label = files.length > 1 ? `${files.length} foto (${files[0].name} …)` : files[0].name;
  if (!opts.ocr) {
    return { file: label, records: [], warnings, error: 'Per caricare le foto attiva «Leggi le scansioni e le foto (OCR)».' };
  }
  const ctx = contextFor(files[0], opts, warnings);
  try {
    const doc = await readPhotos(files, opts.ocr, ctx.warn);
    if (!doc.text) return { file: label, records: [], warnings, error: 'Nessun testo riconosciuto nella foto.' };
    return { file: label, records: docToRecords(doc, ctx), warnings };
  } catch (e) {
    return failed(label, warnings, e);
  }
}
