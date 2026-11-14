// Lettura OCR sul telefono (tesseract.js, gratuito e senza inviare i documenti a nessuno):
// PDF scansionati (solo le pagine senza testo) e foto di documenti. Il motore e il vocabolario
// italiano (~5 MB in tutto) si scaricano dal sito dell'app al primo uso e poi restano in memoria.
import type { Worker } from 'tesseract.js';


/** Cartella con il motore OCR, con nome fisso per versione (vedi vite.config.ts). */
const ocrDir = () => new URL(`${import.meta.env.BASE_URL}assets/ocr-${__OCR_VERSION__}/`, location.href).href;

/** Estensioni delle immagini leggibili con l'OCR. */
export const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

export const isImageName = (name: string) => IMAGE_EXT.includes((name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase());

export interface OcrPage {
  text: string;
  /** affidabilità media (0-100) indicata dal motore OCR */
  confidence: number;
}

export type OcrStatus = (msg: string) => void;

export class OcrAbort extends Error {
  constructor() { super('lettura interrotta'); }
}

/** Una sessione OCR: il motore si avvia una volta e legge più pagine o foto. */
export class OcrSession {
  private worker: Promise<Worker> | null = null;
  private current = '';
  private stopped = false;

  constructor(private onStatus: OcrStatus, signal?: AbortSignal) {
    signal?.addEventListener('abort', () => { this.stopped = true; void this.close(); });
  }

  private start(): Promise<Worker> {
    if (!this.worker) {
      this.onStatus('Preparazione della lettura OCR (la prima volta scarica circa 5 MB)…');
      this.worker = (async () => {
        let T: typeof import('tesseract.js');
        try {
          T = await import('tesseract.js');
        } catch {
          throw new Error(navigator.onLine
            ? 'il lettore OCR di questa versione dell\'app non è più sul sito: tocca «Aggiorna» in alto (o chiudi e riapri l\'app) e riprova'
            : 'il lettore OCR non è disponibile: serve la connessione la prima volta');
        }
        const dir = ocrDir();
        try {
          return await T.createWorker('ita', T.OEM.LSTM_ONLY, {
            workerPath: `${dir}worker.min.js`,
            corePath: dir,
            langPath: dir,
            workerBlobURL: false,
            logger: (m: { status: string; progress: number }) => {
              if (m.status === 'recognizing text' && this.current) {
                this.onStatus(`${this.current} – ${Math.round(m.progress * 100)}%`);
              }
            }
          });
        } catch (e) {
          throw new Error(`impossibile avviare la lettura OCR (${(e as Error)?.message ?? e}). ${navigator.onLine ? '' : 'Serve la connessione la prima volta.'}`.trim());
        }
      })();
      this.worker.catch(() => { this.worker = null; });
    }
    return this.worker;
  }

  /** Legge il testo di un'immagine (pagina di PDF già disegnata o foto). */
  async read(image: HTMLCanvasElement, label: string): Promise<OcrPage> {
    if (this.stopped) throw new OcrAbort();
    const w = await this.start();
    if (this.stopped) throw new OcrAbort();
    this.current = label;
    this.onStatus(label);
    try {
      const { data } = await w.recognize(image);
      return { text: data.text ?? '', confidence: data.confidence ?? 0 };
    } catch (e) {
      if (this.stopped) throw new OcrAbort();
      throw e;
    } finally {
      this.current = '';
      // libera la memoria della pagina
      image.width = image.height = 0;
    }
  }

  async close() {
    const w = this.worker;
    this.worker = null;
    if (w) {
      try { await (await w).terminate(); } catch { /* già chiuso */ }
    }
  }
}

/** Le pagine con meno di questi caratteri sono considerate scansioni (immagini senza testo). */
export const SCANNED_PAGE_CHARS = 40;

export const needsOcr = (pageText: string) => pageText.replace(/\s/g, '').length < SCANNED_PAGE_CHARS;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx };
}

interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: object): { promise: Promise<void> };
  cleanup(): void;
}

/** Disegna una pagina di PDF a circa 250-300 dpi (la risoluzione in cui l'OCR legge meglio). */
export async function renderPdfPage(pdf: { getPage(n: number): Promise<unknown> }, n: number): Promise<HTMLCanvasElement> {
  const page = (await pdf.getPage(n)) as PdfPage;
  const base = page.getViewport({ scale: 1 });
  // A4 (595 pt di larghezza) → circa 2300 pixel; mai più di ~10 milioni di pixel (memoria del telefono)
  let scale = Math.min(4, Math.max(1.5, 2300 / Math.min(base.width, base.height)));
  const px = base.width * base.height * scale * scale;
  if (px > 10e6) scale *= Math.sqrt(10e6 / px);
  const viewport = page.getViewport({ scale });
  const { c, ctx } = canvas(viewport.width, viewport.height);
  try {
    await page.render({ canvasContext: ctx, canvas: c, viewport }).promise;
  } finally {
    page.cleanup();
  }
  return c;
}

/** Prepara una foto per l'OCR: orientamento corretto e dimensioni adatte (lato lungo ~2000-3000 pixel). */
export async function imageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    throw new Error('immagine non leggibile: usa una foto JPG o PNG');
  }
  const long = Math.max(bmp.width, bmp.height);
  const scale = long > 3000 ? 3000 / long : long < 1500 ? Math.min(2, 1500 / long) : 1;
  const { c, ctx } = canvas(bmp.width * scale, bmp.height * scale);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** Titolo ricavato dal testo letto (prima riga significativa), per le foto con nomi come «IMG_1234». */
export function titleFromText(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.replace(/\s+/g, ' ').trim();
    const letters = t.replace(/[^\p{L}]/gu, '').length;
    if (t.length >= 6 && t.length <= 120 && letters >= 5 && letters / t.length > 0.6) return t;
  }
  return '';
}

/** Nomi di file generati dalla fotocamera, da WhatsApp o dagli screenshot: non sono un buon titolo. */
export function genericName(name: string): boolean {
  const rest = name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[\s_\-.()\d]+/g, ' ')
    .replace(/\b(img|image|immagine|dsc|dscn|dscf|pxl|photo|foto|scan|scansione|screenshot|schermata|whatsapp|wa|cam|camera|at|alle|am|pm)\b/g, ' ')
    .replace(/[^\p{L}]/gu, '');
  return rest.length < 3;
}
