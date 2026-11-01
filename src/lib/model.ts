import { cleanModelName, fallbackModels, GeminiError, isGemma, listModels, type ModelInfo } from '../shared/gemini.ts';
import { updateSettings, type Settings } from './settings';

// Ogni modello Gemini ha una quota gratuita propria (al minuto e al giorno): quando un modello la
// esaurisce si passa al successivo. I modelli esauriti si ricordano (anche chiudendo l'app)
// fino all'azzeramento: al giorno verso le 9 del mattino, ora italiana (mezzanotte in California).
const STORE = 'atisl-modelli-esauriti';

function load(): Map<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, number>;
    const now = Date.now();
    return new Map(Object.entries(raw).filter(([, t]) => t > now));
  } catch {
    return new Map();
  }
}

let exhausted: Map<string, number> | null = null;
const getExhausted = () => (exhausted ??= load());

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(getExhausted())));
  } catch { /* archiviazione non disponibile: si ricorda solo finché l'app è aperta */ }
}

/** Prossimo azzeramento delle quote giornaliere di Google (mezzanotte del Pacifico ≈ 8:00 UTC). */
export function nextDailyReset(now = Date.now()): number {
  const d = new Date(now);
  const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 5);
  return reset > now ? reset : reset + 86_400_000;
}

function until(e: GeminiError): number {
  const q = e.quota;
  if (q?.limite === 0) return Date.now() + 7 * 86_400_000; // modello escluso dal piano gratuito
  if (q?.periodo === 'giorno') return nextDailyReset();
  return Date.now() + Math.max(30, q?.attesaS ?? 60) * 1000;
}

function markExhausted(ids: (string | undefined)[], e: GeminiError) {
  const t = until(e);
  for (const id of ids) if (id) getExhausted().set(cleanModelName(id), t);
  save();
}

export const isExhausted = (id: string) => (getExhausted().get(cleanModelName(id)) ?? 0) > Date.now();

let modelsCache: { key: string; list: Promise<ModelInfo[]> } | null = null;
function candidateModels(s: Settings): Promise<ModelInfo[]> {
  if (!modelsCache || modelsCache.key !== s.apiKey) {
    const list = listModels({ apiKey: s.apiKey, model: s.model, timeoutMs: 15000 }).then(fallbackModels);
    list.catch(() => { modelsCache = null; });
    modelsCache = { key: s.apiKey, list };
  }
  return modelsCache.list;
}

export interface ModelChoice {
  /** compito semplice (es. capire cosa c'è in una foto): prima un modello leggero, per risparmiare la quota del principale */
  leggero?: boolean;
}

const isLight = (id: string) => /flash-lite|lite/i.test(id) || isGemma(id);
const MAX_TENTATIVI = 6;

/**
 * Esegue una chiamata a Gemini cambiando modello quando serve:
 * - modello ritirato o inesistente → sceglie il consigliato tra quelli disponibili, lo salva e riprova;
 * - limite gratuito del modello raggiunto → prova gli altri modelli (ognuno ha una quota separata),
 *   compresi i Gemma, senza cambiare il modello impostato.
 */
export async function withModelFallback<T>(s: Settings, call: (model: string) => Promise<T>, choice: ModelChoice = {}): Promise<T> {
  const configured = cleanModelName(s.model);
  const tried = new Set<string>();
  let list: ModelInfo[] | null = null;
  const models = async () => {
    if (!list) {
      try { list = await candidateModels(s); } catch { list = []; }
    }
    return list;
  };
  const next = async () => (await models()).find((m) => !tried.has(m.id) && !isExhausted(m.id))?.id;

  let model = configured;
  if (choice.leggero) model = (await models()).find((m) => isLight(m.id) && !isExhausted(m.id))?.id ?? configured;
  else if (isExhausted(configured)) model = (await next()) ?? configured;

  let first: GeminiError | null = null;
  const esauriti: string[] = [];
  for (let i = 0; i < MAX_TENTATIVI; i++) {
    tried.add(model);
    try {
      return await call(model);
    } catch (e) {
      if (!(e instanceof GeminiError) || (e.kind !== 'modello' && e.kind !== 'quota')) throw e;
      first ??= e;
      // alias come «gemini-flash-latest» e il modello reale («gemini-3.8-flash») condividono la quota
      if (e.kind === 'quota') {
        markExhausted([model, e.quota?.modello], e);
        esauriti.push(e.quota?.modello ?? model);
      }
      if (e.quota?.modello) tried.add(cleanModelName(e.quota.modello));
      const alt = await next();
      if (!alt) {
        if (esauriti.length > 1) {
          throw new GeminiError('quota', `Gemini: limite gratuito raggiunto su tutti i modelli provati (${[...new Set(esauriti)].join(', ')}). I limiti giornalieri si azzerano verso le 9 del mattino.`, first.status, first.quota);
        }
        throw first.kind === 'quota' ? first : e;
      }
      if (e.kind === 'modello' && model === configured) await updateSettings({ model: alt });
      model = alt;
    }
  }
  throw first!;
}

/** Solo per i test. */
export function resetModelState() {
  exhausted = new Map();
  modelsCache = null;
  try { localStorage.removeItem(STORE); } catch { /* niente */ }
}
