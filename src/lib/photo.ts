import { callGemini, GeminiError, type GeminiAnswer } from '../shared/gemini.ts';
import {
  buildAnalysisRequest, buildDescribeRequest, parseDescription, photoSearchQuery,
  type PhotoDescription, type PhotoImage
} from '../shared/vision.ts';
import { toBlocks } from './ai';
import { searchLocal, type LocalResult } from './search';
import type { Settings } from './settings';
import { withModelFallback } from './model';

export const MAX_PHOTOS = 3;
const MAX_SIDE = 1600;
const QUALITY = 0.82;

export interface PreparedPhoto extends PhotoImage {
  /** anteprima (object URL) da liberare con URL.revokeObjectURL */
  preview: string;
  width: number;
  height: number;
  /** dimensione del JPEG inviato, in byte */
  bytes: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('immagine non leggibile'));
    img.src = url;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Ridimensiona (lato lungo max 1600 px) e ricodifica in JPEG.
 * La ricodifica tramite canvas elimina i metadati (posizione GPS, modello del telefono…).
 * Il browser applica già l'orientamento della foto.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) {
    throw new Error(`«${file.name}» non è un'immagine.`);
  }
  const src = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(src);
    } catch {
      throw new Error(`Il telefono non riesce ad aprire «${file.name}». Prova a scattare di nuovo la foto dall'app.`);
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // le zone trasparenti (PNG) diventano bianche
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('compressione non riuscita');
    return { mimeType: 'image/jpeg', data: await blobToBase64(blob), preview: URL.createObjectURL(blob), width, height, bytes: blob.size };
  } finally {
    URL.revokeObjectURL(src);
  }
}

export type PhotoStep = 'descrizione' | 'ricerca' | 'analisi';

export interface PhotoAnalysis {
  description: PhotoDescription;
  query: string;
  results: LocalResult[];
  answer: GeminiAnswer;
}

/** Descrizione → ricerca nell'archivio → analisi con le fonti. */
export async function analyzePhotos(
  images: PhotoImage[],
  note: string,
  s: Settings,
  signal: AbortSignal,
  onStep: (step: PhotoStep) => void = () => {}
): Promise<PhotoAnalysis> {
  if (!images.length) throw new Error('Aggiungi almeno una foto.');
  const opts = { apiKey: s.apiKey, model: s.model, timeoutMs: 60000, signal };

  onStep('descrizione');
  let model = s.model;
  const first = await withModelFallback(s, (m) => {
    model = m;
    return callGemini(buildDescribeRequest(images, note), { ...opts, model: m });
  });
  const description = parseDescription(first.text);

  onStep('ricerca');
  const query = photoSearchQuery(description, note);
  const results = query ? await searchLocal(query, { limit: 10, maxPerRecord: 3 }) : [];

  onStep('analisi');
  const answer = await callGemini(buildAnalysisRequest(images, note, description, toBlocks(results)), { ...opts, model, timeoutMs: 90000 });
  return { description, query, results, answer };
}

export function asGeminiError(e: unknown): GeminiError {
  return e instanceof GeminiError ? e : new GeminiError('sconosciuto', (e as Error)?.message || 'Errore imprevisto.');
}
