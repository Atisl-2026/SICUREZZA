import { GeminiError, listModels, rankModels, cleanModelName } from '../shared/gemini.ts';
import { updateSettings, type Settings } from './settings';

/**
 * Esegue una chiamata a Gemini; se il modello impostato non esiste più (Google ritira i modelli
 * periodicamente) sceglie da solo il modello consigliato tra quelli disponibili per la chiave,
 * lo salva nelle impostazioni e riprova una volta.
 */
export async function withModelFallback<T>(s: Settings, call: (model: string) => Promise<T>): Promise<T> {
  try {
    return await call(s.model);
  } catch (e) {
    if (!(e instanceof GeminiError) || e.kind !== 'modello') throw e;
    let models;
    try {
      models = rankModels(await listModels({ apiKey: s.apiKey, model: s.model, timeoutMs: 15000 }));
    } catch {
      throw e;
    }
    const next = models.find((m) => m.id !== cleanModelName(s.model));
    if (!next) throw e;
    await updateSettings({ model: next.id });
    return call(next.id);
  }
}
