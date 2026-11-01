import { callGemini, GeminiError, streamGemini, type GeminiAnswer } from '../shared/gemini.ts';
import {
  buildAnalysisRequest, buildDescribeRequest, parseDescription, photoSearchQuery,
  type PhotoDescription, type PhotoImage
} from '../shared/vision.ts';
import { toBlocks } from './ai';
import { searchLocal, type LocalResult } from './search';
import type { Settings } from './settings';
import { withModelFallback } from './model';

export const MAX_PHOTOS = 3;
/** Foto per l'analisi: abbastanza dettaglio per leggere parapetti, tavole, ancoraggi. */
const MAX_SIDE = 1280;
const QUALITY = 0.8;
/** Copia piccola per il primo passaggio (capire cosa cercare): si invia in un attimo anche con poca rete. */
const SMALL_SIDE = 640;
const SMALL_QUALITY = 0.7;

export interface PreparedPhoto extends PhotoImage {
  /** anteprima (object URL) da liberare con URL.revokeObjectURL */
  preview: string;
  width: number;
  height: number;
  /** dimensione del JPEG inviato, in byte */
  bytes: number;
  /** copia piccola per il primo passaggio */
  small: PhotoImage;
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

async function encode(img: HTMLImageElement, side: number, quality: number) {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // le zone trasparenti (PNG) diventano bianche
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('compressione non riuscita');
  return { blob, width, height };
}

/**
 * Ridimensiona (lato lungo max 1280 px, più una copia da 640 px) e ricodifica in JPEG.
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
    const full = await encode(img, MAX_SIDE, QUALITY);
    const small = Math.max(img.naturalWidth, img.naturalHeight) > SMALL_SIDE * 1.2 ? await encode(img, SMALL_SIDE, SMALL_QUALITY) : full;
    return {
      mimeType: 'image/jpeg',
      data: await blobToBase64(full.blob),
      preview: URL.createObjectURL(full.blob),
      width: full.width,
      height: full.height,
      bytes: full.blob.size,
      small: { mimeType: 'image/jpeg', data: small === full ? '' : await blobToBase64(small.blob) }
    };
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

/** Copia piccola della foto (se esiste), altrimenti la foto stessa. */
function smallOf(i: PhotoImage & { small?: PhotoImage }): PhotoImage {
  return i.small?.data ? i.small : { mimeType: i.mimeType, data: i.data };
}

const EMPTY_DESCRIPTION: PhotoDescription = { descrizione: '', tipo_opera: '', elementi: [], parole_chiave: [], limiti: '' };

/**
 * Descrizione rapida → ricerca nell'archivio → analisi con le fonti, mostrata mentre arriva.
 * Il primo passaggio usa foto piccole e poco ragionamento (pochi secondi); se non risponde in tempo
 * si prosegue comunque cercando con la nota dell'ispettore.
 */
export async function analyzePhotos(
  images: (PhotoImage & { small?: PhotoImage })[],
  note: string,
  s: Settings,
  signal: AbortSignal,
  onStep: (step: PhotoStep) => void = () => {},
  onText: (text: string, results: LocalResult[]) => void = () => {}
): Promise<PhotoAnalysis> {
  if (!images.length) throw new Error('Aggiungi almeno una foto.');
  const opts = { apiKey: s.apiKey, model: s.model, signal };
  const full = images.map((i) => ({ mimeType: i.mimeType, data: i.data }));

  onStep('descrizione');
  let model = s.model;
  let description = EMPTY_DESCRIPTION;
  try {
    const first = await withModelFallback(s, (m) => {
      model = m;
      return callGemini(buildDescribeRequest(images.map(smallOf), note), { ...opts, model: m, thinking: 'minimal', timeoutMs: 25000 });
    });
    description = parseDescription(first.text);
  } catch (e) {
    // lettura rapida non riuscita per lentezza: l'analisi completa guarda comunque le foto
    if (!(e instanceof GeminiError) || !['timeout', 'vuota', 'sovraccarico'].includes(e.kind)) throw e;
  }

  onStep('ricerca');
  const query = photoSearchQuery(description, note);
  const results = query ? await searchLocal(query, { limit: 10, maxPerRecord: 3 }) : [];

  onStep('analisi');
  const answer = await streamGemini(buildAnalysisRequest(full, note, description, toBlocks(results)), {
    ...opts,
    model,
    thinking: 'low',
    timeoutMs: 45000, // tempo massimo di silenzio, non della risposta intera
    onText: (t) => onText(t, results)
  });
  return { description, query, results, answer };
}

export function asGeminiError(e: unknown): GeminiError {
  return e instanceof GeminiError ? e : new GeminiError('sconosciuto', (e as Error)?.message || 'Errore imprevisto.');
}
