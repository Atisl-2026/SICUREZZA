// Sceglie quale AI usare: prima Gemini, poi le AI gratuite di riserva configurate (Groq, Mistral,
// OpenRouter). Se un servizio non risponde (limite raggiunto, sovraccarico, lentezza, modello
// non disponibile) si passa da soli al successivo; chi ha esaurito la quota viene saltato per un po'.
import {
  callGemini, cleanModelName, GeminiError, streamGemini, type GeminiAnswer, type GeminiRequest, type ThinkingLevel
} from '../shared/gemini.ts';
import {
  callChat, configuredReserves, hasImages, listChatModels, pickModel, PROVIDERS, type ChatModel, type ProviderId
} from '../shared/providers.ts';
import { withModelFallback } from './model';
import type { Settings } from './settings';

export type Fornitore = 'gemini' | ProviderId;

export const nomeFornitore = (f: Fornitore) => (f === 'gemini' ? 'Gemini' : PROVIDERS[f].nome);

export interface AiTask {
  request: GeminiRequest;
  /** chiamata normale: tempo massimo; in tempo reale: tempo massimo di silenzio */
  timeoutMs: number;
  signal: AbortSignal;
  thinking?: ThinkingLevel;
  /** se presente la risposta arriva in tempo reale */
  onText?: (text: string) => void;
  /** avvisi da mostrare (es. "Gemini ha raggiunto il limite: provo con Groq…") */
  onNotice?: (msg: string) => void;
  /** servizio da provare per primo (es. quello che ha risposto al passo precedente) */
  prefer?: Fornitore;
  /** servizi già falliti in questa operazione: si provano solo se non resta altro */
  skip?: Set<Fornitore>;
}

export interface AiAnswer extends GeminiAnswer {
  fornitore: Fornitore;
}

/** Servizi utilizzabili con le chiavi presenti, nell'ordine in cui si provano. */
export function availableAi(s: Settings): Fornitore[] {
  return [...(s.apiKey.trim() ? (['gemini'] as Fornitore[]) : []), ...configuredReserves(s.riserve)];
}

export function hasAi(s: Settings): boolean {
  return availableAi(s).length > 0;
}

/** Servizi che hanno esaurito la quota (fino a quando). */
const cooldown = new Map<Fornitore, number>();
const modelLists = new Map<string, Promise<ChatModel[]>>();

function chatModels(p: ProviderId, apiKey: string): Promise<ChatModel[]> {
  const k = `${p}:${apiKey}`;
  let list = modelLists.get(k);
  if (!list) {
    list = listChatModels(p, apiKey);
    list.catch(() => modelLists.delete(k));
    modelLists.set(k, list);
  }
  return list;
}

function cooldownMs(e: GeminiError): number {
  const q = e.quota;
  if (e.status === 402 || q?.limite === 0 || q?.periodo === 'giorno') return 3 * 3600_000;
  return Math.max(30, q?.attesaS ?? 60) * 1000;
}

const asGeminiError = (e: unknown) =>
  e instanceof GeminiError ? e : new GeminiError('sconosciuto', (e as Error)?.message || 'Errore imprevisto.');

async function viaGemini(s: Settings, t: AiTask): Promise<AiAnswer> {
  let used = cleanModelName(s.model);
  const answer = await withModelFallback(s, (model) => {
    used = model;
    const opts = { apiKey: s.apiKey, model, timeoutMs: t.timeoutMs, signal: t.signal, thinking: t.thinking };
    return t.onText ? streamGemini(t.request, { ...opts, onText: t.onText }) : callGemini(t.request, opts);
  });
  return { ...answer, fornitore: 'gemini', servizio: 'Gemini', modello: used };
}

async function viaReserve(p: ProviderId, s: Settings, t: AiTask): Promise<AiAnswer> {
  const key = s.riserve[p]!;
  const vision = hasImages(t.request);
  const auto = async () => {
    const m = pickModel(p, await chatModels(p, key.apiKey), vision);
    if (!m) {
      throw new GeminiError('non-supportato', `${PROVIDERS[p].nome}: nessun modello gratuito${vision ? ' che legga le foto' : ''} disponibile.`);
    }
    return m;
  };
  let model = key.model?.trim() || (await auto());
  const run = (m: string) => callChat(p, t.request, { apiKey: key.apiKey, model: m, timeoutMs: t.timeoutMs, signal: t.signal, onText: t.onText });
  let answer: GeminiAnswer;
  try {
    answer = await run(model);
  } catch (e) {
    // modello scelto a mano non più disponibile: si torna alla scelta automatica
    if (!(e instanceof GeminiError) || e.kind !== 'modello' || !key.model?.trim()) throw e;
    model = await auto();
    answer = await run(model);
  }
  return { ...answer, fornitore: p, servizio: PROVIDERS[p].nome, modello: model };
}

/** Esegue la richiesta con il primo servizio che risponde. */
export async function runAi(s: Settings, t: AiTask): Promise<AiAnswer> {
  let order = availableAi(s);
  if (!order.length) {
    throw new GeminiError('chiave', 'Nessuna AI configurata: inserisci la chiave Gemini o una AI di riserva nelle Impostazioni.');
  }
  if (t.prefer && order.includes(t.prefer)) order = [t.prefer, ...order.filter((f) => f !== t.prefer)];
  const now = Date.now();
  const fresh = order.filter((f) => !t.skip?.has(f) && (cooldown.get(f) ?? 0) <= now);
  // chi ha esaurito la quota da poco si prova per ultimo (il limite potrebbe essersi già azzerato)
  const tired = order.filter((f) => !t.skip?.has(f) && !fresh.includes(f));
  const queue = fresh.length || tired.length ? [...fresh, ...tired] : order;

  const errors: { f: Fornitore; err: GeminiError }[] = [];
  // il messaggio dice sempre quale servizio ha avuto il problema
  const label = (x: { f: Fornitore; err: GeminiError }) =>
    x.err.message.startsWith(nomeFornitore(x.f))
      ? x.err.message
      : `${nomeFornitore(x.f)}: ${x.err.message.replace(/^./, (c) => c.toLowerCase())}`;
  for (const f of queue) {
    if (errors.length) t.onNotice?.(`${label(errors[errors.length - 1])} Provo con ${nomeFornitore(f)}…`);
    try {
      const answer = f === 'gemini' ? await viaGemini(s, t) : await viaReserve(f, s, t);
      cooldown.delete(f);
      return answer;
    } catch (e) {
      const err = asGeminiError(e);
      if (err.kind === 'annullata' || t.signal.aborted) throw new GeminiError('annullata', 'Richiesta annullata.');
      t.skip?.add(f);
      if (err.kind === 'quota') cooldown.set(f, Date.now() + cooldownMs(err));
      errors.push({ f, err });
    }
  }
  if (errors.length === 1) throw errors[0].err;
  const kinds = errors.map((x) => x.err.kind);
  const first = errors[0].err;
  throw new GeminiError(
    kinds.includes('timeout') ? 'timeout' : kinds.includes('sovraccarico') ? 'sovraccarico' : first.kind,
    `Nessuna AI ha risposto:\n${errors.map((x) => `• ${label(x)}`).join('\n')}`,
    first.status,
    first.quota
  );
}

/** Solo per i test. */
export function resetRouter() {
  cooldown.clear();
  modelLists.clear();
}
