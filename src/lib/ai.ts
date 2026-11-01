import {
  buildDbRequest, buildWebRequest, callGemini, GeminiError, type ContextBlock, type GeminiAnswer
} from '../shared/gemini.ts';
import type { LocalResult } from './search';
import type { Settings } from './settings';

export type AiState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; answer: GeminiAnswer }
  | { status: 'error'; error: GeminiError; disabledWeb?: boolean };

export function toBlocks(results: LocalResult[]): ContextBlock[] {
  return results.map((r) => ({
    recordId: r.record.id,
    titolo: r.record.titolo,
    categoria: r.record.categoria,
    fonte: r.record.fonte,
    data_aggiornamento: r.record.data_aggiornamento,
    testo: r.chunk.testo
  }));
}

const asGeminiError = (e: unknown) =>
  e instanceof GeminiError ? e : new GeminiError('sconosciuto', (e as Error)?.message || 'Errore imprevisto.');

/** Risposta "Dal database": solo sulla base dei blocchi trovati localmente. */
export async function askDatabase(question: string, results: LocalResult[], s: Settings, signal: AbortSignal): Promise<AiState> {
  try {
    const answer = await callGemini(buildDbRequest(question, toBlocks(results)), {
      apiKey: s.apiKey, model: s.model, timeoutMs: 40000, signal
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
    const answer = await callGemini(buildWebRequest(question), {
      apiKey: s.apiKey, model: s.model, timeoutMs: 60000, signal
    });
    return { status: 'done', answer };
  } catch (e) {
    const error = asGeminiError(e);
    return { status: 'error', error, disabledWeb: shouldDisableWeb(error) };
  }
}
