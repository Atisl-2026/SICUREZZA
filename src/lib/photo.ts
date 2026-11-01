import { GeminiError, type GeminiAnswer } from '../shared/gemini.ts';
import { runAi, type Fornitore } from './router';
import {
  buildAnalysisRequest, buildDescribeRequest, findingsOf, parseDescription, photoContext, photoSearchQuery,
  type PhotoContext, type PhotoDescription, type PhotoImage
} from '../shared/vision.ts';
import { toBlocks } from './ai';
import { passageInfo, sectionsFor } from './articles';
import { headingText, inMainArticles, mainArticles } from '../shared/articles.ts';
import { searchLocal, type LocalResult } from './search';
import { containsPhrase, containsWordForm, expandSynonyms, normalizeForMatch } from '../shared/search.ts';
import type { Settings } from './settings';

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
  /** criticità rimaste senza riferimento: articoli dell'archivio trovati dall'app (da verificare) */
  suggerimenti?: FindingRefs[];
}

export interface FindingRefs {
  titolo: string;
  results: LocalResult[];
}

const MAX_BLOCKS = 14;

/** Toglie le pagine d'indice dei PDF (molte intestazioni in un solo brano), se resta altro. */
function notIndex(list: LocalResult[]): LocalResult[] {
  const ok = list.filter((r) => passageInfo(r).articoli.length <= 4);
  return ok.length ? ok : list;
}

/** Il brano riguarda il lavoro della foto? (testo, rubrica dell'articolo o titolo del documento) */
function inContext(r: LocalResult, ctx: PhotoContext): boolean {
  if (!ctx.termini.length) return true;
  const heads = passageInfo(r).articoli.map((a) => headingText(a.section)).join(' ');
  const text = `${r.record.titolo} ${heads} ${r.chunk.testo}`;
  const norm = normalizeForMatch(text);
  return ctx.termini.some((t) => (t.includes(' ') ? containsPhrase(norm, t) : containsWordForm(text, t)));
}

/** Prima gli articoli del provvedimento principale (e i suoi allegati), poi i decreti riportati in appendice. */
function mainFirst(list: LocalResult[]): LocalResult[] {
  const rank = (r: LocalResult) => {
    const top = passageInfo(r).articoli[0]?.section;
    if (!top || !top.label.startsWith('Art.')) return 0;
    return mainArticles(sectionsFor(r.record)) && !inMainArticles(top, sectionsFor(r.record)) ? 1 : 0;
  };
  return list.map((r, i) => ({ r, i, k: rank(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r);
}

/** Risultati pertinenti alla foto: niente pagine d'indice, niente brani fuori tema (se resta altro), testo unico prima. */
function pertinent(list: LocalResult[], ctx: PhotoContext): LocalResult[] {
  const clean = notIndex(list);
  const inCtx = clean.filter((r) => inContext(r, ctx));
  return mainFirst(inCtx.length ? inCtx : ctx.termini.length ? [] : clean);
}

/**
 * Brani per l'analisi: ricerche di base per il tipo di lavoro (es. ponteggi → Art. 112, 122),
 * poi ogni criticità del primo esame cercata da sola («parapetto mancante sul ponteggio» → Art. 126),
 * più una ricerca generale. Solo brani che riguardano il lavoro della foto (niente parapetti delle
 * navi per una foto di cantiere). I risultati si alternano fino a 14 brani.
 */
export async function photoRetrieval(desc: PhotoDescription, note: string): Promise<{ query: string; results: LocalResult[] }> {
  const ctx = photoContext(desc, note);
  const crit = (desc.criticita ?? []).filter((c) => c.trim());
  const general = photoSearchQuery(desc, note);
  const queries: { q: string; n: number }[] = [
    ...crit.map((q) => ({ q, n: 3 })),
    ...ctx.ricerche.map((q) => ({ q, n: 2 })),
    ...(general.trim() ? [{ q: general, n: 3 }] : [])
  ];
  if (!queries.length) return { query: '', results: [] };
  const lists = await Promise.all(queries.map(async ({ q, n }) =>
    pertinent(await searchLocal(expandSynonyms(q), { limit: 10, maxPerRecord: 5 }), ctx).slice(0, n)));
  const out: LocalResult[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < 3 && out.length < MAX_BLOCKS; k++) {
    for (const list of lists) {
      const r = list[k];
      if (!r || seen.has(r.chunkId)) continue;
      seen.add(r.chunkId);
      out.push(r);
      if (out.length >= MAX_BLOCKS) break;
    }
  }
  return { query: crit.length ? crit.join(' · ') : general, results: out };
}

/** Per le criticità senza riferimento: gli articoli dell'archivio che le riguardano (ricerca locale, nessuna AI). */
export async function suggestReferences(answer: string, ctx: PhotoContext = { termini: [], ricerche: [] }): Promise<FindingRefs[]> {
  const out: FindingRefs[] = [];
  for (const f of findingsOf(answer).filter((x) => x.senzaRiferimento)) {
    // prima il solo titolo (più preciso), poi titolo e descrizione
    const search = async (q: string) => pertinent(await searchLocal(expandSynonyms(q), { limit: 8, maxPerRecord: 3 }), ctx)
      .filter((r) => passageInfo(r).articoli.some((a) => a.conParola));
    const byTitle = await search(f.titolo);
    // un risultato per articolo (lo stesso articolo può comparire in più brani)
    const seen = new Set<string>();
    const found = (byTitle.length ? byTitle : await search(f.query)).filter((r) => {
      const top = passageInfo(r).articoli[0];
      const k = `${r.record.id}:${top?.section.pos}`;
      return !seen.has(k) && !!seen.add(k);
    }).slice(0, 2);
    if (found.length) out.push({ titolo: f.titolo, results: found });
  }
  return out;
}

/** Copia piccola della foto (se esiste), altrimenti la foto stessa. */
function smallOf(i: PhotoImage & { small?: PhotoImage }): PhotoImage {
  return i.small?.data ? i.small : { mimeType: i.mimeType, data: i.data };
}

const EMPTY_DESCRIPTION: PhotoDescription = { descrizione: '', tipo_opera: '', elementi: [], parole_chiave: [], limiti: '' };

/**
 * Descrizione rapida → ricerca nell'archivio → analisi con le fonti, mostrata mentre arriva.
 * Il primo passaggio usa foto piccole e poco ragionamento (pochi secondi); se non risponde in tempo
 * si prosegue comunque cercando con la nota dell'ispettore. Se Gemini non risponde si passa da soli
 * alle AI di riserva configurate.
 */
export async function analyzePhotos(
  images: (PhotoImage & { small?: PhotoImage })[],
  note: string,
  s: Settings,
  signal: AbortSignal,
  onStep: (step: PhotoStep) => void = () => {},
  onText: (text: string, results: LocalResult[]) => void = () => {},
  onNotice: (msg: string) => void = () => {}
): Promise<PhotoAnalysis> {
  if (!images.length) throw new Error('Aggiungi almeno una foto.');
  const full = images.map((i) => ({ mimeType: i.mimeType, data: i.data }));
  // servizi che non hanno risposto: al passo successivo si provano solo se non resta altro
  const skip = new Set<Fornitore>();

  onStep('descrizione');
  let prefer: Fornitore | undefined;
  let description = EMPTY_DESCRIPTION;
  try {
    const first = await runAi(s, {
      request: buildDescribeRequest(images.map(smallOf), note),
      thinking: 'minimal',
      leggero: true, // basta un modello leggero: la quota del modello principale resta per l'analisi
      timeoutMs: 20000,
      signal,
      skip,
      onNotice
    });
    prefer = first.fornitore;
    description = parseDescription(first.text);
  } catch (e) {
    // lettura rapida non riuscita per lentezza: l'analisi completa guarda comunque le foto
    if (!(e instanceof GeminiError) || !['timeout', 'vuota', 'sovraccarico'].includes(e.kind)) throw e;
  }

  onStep('ricerca');
  const { query, results } = await photoRetrieval(description, note);

  onStep('analisi');
  const answer = await runAi(s, {
    request: buildAnalysisRequest(full, note, description, toBlocks(results)),
    thinking: 'low',
    timeoutMs: 45000, // tempo massimo di silenzio, non della risposta intera
    signal,
    prefer,
    skip,
    onNotice,
    onText: (t) => onText(t, results)
  });
  // criticità che l'AI non ha collegato a una norma: l'app cerca da sola gli articoli che le riguardano
  const suggerimenti = await suggestReferences(answer.text, photoContext(description, note)).catch(() => []);
  return { description, query, results, answer, ...(suggerimenti.length ? { suggerimenti } : {}) };
}

export function asGeminiError(e: unknown): GeminiError {
  return e instanceof GeminiError ? e : new GeminiError('sconosciuto', (e as Error)?.message || 'Errore imprevisto.');
}
