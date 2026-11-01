import { GeminiError, listModels, rankModels, cleanModelName, type ModelInfo } from '../shared/gemini.ts';
import { updateSettings, type Settings } from './settings';

/** Modelli Gemini che hanno esaurito la quota gratuita (fino a quando). Ogni modello ha una quota propria. */
const exhausted = new Map<string, number>();

let modelsCache: { key: string; list: Promise<ModelInfo[]> } | null = null;
function rankedModels(s: Settings): Promise<ModelInfo[]> {
  if (!modelsCache || modelsCache.key !== s.apiKey) {
    const list = listModels({ apiKey: s.apiKey, model: s.model, timeoutMs: 15000 }).then(rankModels);
    list.catch(() => { modelsCache = null; });
    modelsCache = { key: s.apiKey, list };
  }
  return modelsCache.list;
}

function cooldownMs(e: GeminiError): number {
  const q = e.quota;
  if (q?.limite === 0 || q?.periodo === 'giorno') return 3 * 3600_000;
  return Math.max(30, q?.attesaS ?? 60) * 1000;
}

const isExhausted = (id: string) => (exhausted.get(id) ?? 0) > Date.now();

/**
 * Esegue una chiamata a Gemini cambiando modello quando serve:
 * - modello ritirato o inesistente → sceglie il consigliato tra quelli disponibili, lo salva e riprova;
 * - limite gratuito del modello raggiunto → prova una volta un altro modello (quota separata), senza salvarlo.
 */
export async function withModelFallback<T>(s: Settings, call: (model: string) => Promise<T>): Promise<T> {
  let model = cleanModelName(s.model);
  // modello già "esaurito" in questa sessione: si parte da un altro, se c'è
  if (isExhausted(model)) {
    try {
      const alt = (await rankedModels(s)).find((m) => m.id !== model && !isExhausted(m.id));
      if (alt) model = alt.id;
    } catch { /* si prova comunque il modello impostato */ }
  }
  try {
    return await call(model);
  } catch (e) {
    if (!(e instanceof GeminiError) || (e.kind !== 'modello' && e.kind !== 'quota')) throw e;
    if (e.kind === 'quota') exhausted.set(model, Date.now() + cooldownMs(e));
    let models: ModelInfo[];
    try {
      models = await rankedModels(s);
    } catch {
      throw e;
    }
    const next = models.find((m) => m.id !== model && !isExhausted(m.id));
    if (!next) throw e;
    if (e.kind === 'modello') await updateSettings({ model: next.id });
    return call(next.id);
  }
}

/** Solo per i test. */
export function resetModelState() {
  exhausted.clear();
  modelsCache = null;
}
