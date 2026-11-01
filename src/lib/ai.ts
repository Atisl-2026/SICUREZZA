import {
  buildDbRequest, buildWebRequest, callGemini, GeminiError, streamGemini, type ContextBlock, type GeminiAnswer
} from '../shared/gemini.ts';
import type { LocalResult } from './search';
import { articlesForChunk, findHeadings, type ChunkArticles, type Heading } from '../shared/articles.ts';
import type { Settings } from './settings';
import { withModelFallback } from './model';

export type AiState =
  | { status: 'idle' }
  | { status: 'loading'; /** testo che sta arrivando */ partial?: string }
  | { status: 'done'; answer: GeminiAnswer }
  | { status: 'error'; error: GeminiError; disabledWeb?: boolean };

// intestazioni degli articoli per scheda (il testo completo si analizza una volta sola)
const headingsCache = new Map<string, { testo: string; headings: Heading[] }>();

/** Articolo/allegato a cui appartiene il brano trovato (es. "Art. 126 – Parapetti"). */
export function articlesOf(r: LocalResult): ChunkArticles {
  let c = headingsCache.get(r.record.id);
  if (!c || c.testo !== r.record.testo) {
    c = { testo: r.record.testo, headings: findHeadings(r.record.testo) };
    if (headingsCache.size > 200) headingsCache.clear();
    headingsCache.set(r.record.id, c);
  }
  return articlesForChunk(r.record.testo, r.chunk.testo, c.headings);
}

/** Articoli dei brani consultati, per scheda (nell'ordine in cui compaiono). */
export function articlesByRecord(results: LocalResult[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of results) {
    const a = articlesOf(r);
    const list = out.get(r.record.id) ?? [];
    for (const x of [a.inizio, ...a.nelBrano]) {
      const label = x?.split(' – ')[0];
      if (label && !list.includes(label)) list.push(label);
    }
    out.set(r.record.id, list);
  }
  return out;
}

export function toBlocks(results: LocalResult[]): ContextBlock[] {
  return results.map((r) => {
    const a = articlesOf(r);
    return {
      recordId: r.record.id,
      titolo: r.record.titolo,
      categoria: r.record.categoria,
      fonte: r.record.fonte,
      data_aggiornamento: r.record.data_aggiornamento,
      testo: r.chunk.testo,
      ...(a.inizio ? { articolo: a.inizio } : {}),
      ...(a.nelBrano.length ? { articoliNelBrano: a.nelBrano } : {})
    };
  });
}

const asGeminiError = (e: unknown) =>
  e instanceof GeminiError ? e : new GeminiError('sconosciuto', (e as Error)?.message || 'Errore imprevisto.');

/** Risposta "Dal database": solo sulla base dei blocchi trovati localmente. */
export async function askDatabase(
  question: string,
  results: LocalResult[],
  s: Settings,
  signal: AbortSignal,
  onPartial: (text: string) => void = () => {}
): Promise<AiState> {
  try {
    // in tempo reale: il testo compare mentre Gemini lo scrive; il tempo massimo vale per il silenzio
    const answer = await withModelFallback(s, (model) =>
      streamGemini(buildDbRequest(question, toBlocks(results)), {
        apiKey: s.apiKey, model, timeoutMs: 40000, signal, thinking: 'low', onText: onPartial
      })
    );
    return { status: 'done', answer };
  } catch (e) {
    return { status: 'error', error: asGeminiError(e) };
  }
}

/** Errori per cui la verifica sul web va disattivata (quota, modello o strumento non supportato). */
export function shouldDisableWeb(e: GeminiError): boolean {
  return e.kind === 'quota' || e.kind === 'non-supportato' || e.kind === 'modello' || (e.kind === 'sconosciuto' && e.status === 400);
}

/** Risposta "Dal web": grounding con Ricerca Google. */
export async function askWeb(question: string, s: Settings, signal: AbortSignal): Promise<AiState> {
  try {
    const answer = await withModelFallback(s, (model) =>
      callGemini(buildWebRequest(question), { apiKey: s.apiKey, model, timeoutMs: 60000, signal, thinking: 'low' })
    );
    return { status: 'done', answer };
  } catch (e) {
    const error = asGeminiError(e);
    return { status: 'error', error, disabledWeb: shouldDisableWeb(error) };
  }
}
