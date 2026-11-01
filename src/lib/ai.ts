import {
  buildDbRequest, buildWebRequest, callGemini, GeminiError, type ContextBlock, type GeminiAnswer
} from '../shared/gemini.ts';
import { runAi } from './router';
import type { LocalResult } from './search';
import { articlesOf } from './articles';
import type { Settings } from './settings';
import { withModelFallback } from './model';

export type AiState =
  | { status: 'idle' }
  | { status: 'loading'; /** testo che sta arrivando */ partial?: string; /** es. cambio di servizio AI */ avviso?: string }
  | { status: 'done'; answer: GeminiAnswer }
  | { status: 'error'; error: GeminiError; disabledWeb?: boolean };

export { articlesOf } from './articles';

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
  onPartial: (text: string) => void = () => {},
  onNotice: (msg: string) => void = () => {}
): Promise<AiState> {
  try {
    // in tempo reale: il testo compare mentre l'AI lo scrive; il tempo massimo vale per il silenzio.
    // Se Gemini non risponde si passa da soli alle AI di riserva configurate.
    const answer = await runAi(s, {
      request: buildDbRequest(question, toBlocks(results)),
      timeoutMs: 40000,
      signal,
      thinking: 'low',
      onText: onPartial,
      onNotice
    });
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
