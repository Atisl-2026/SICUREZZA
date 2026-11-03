// AI di riserva: gratuite (Groq, Mistral, OpenRouter) e a pagamento (ChatGPT di OpenAI) usano il
// formato "chat completions"; Claude (Anthropic, a pagamento) passa dalla libreria ufficiale (lib/claude.ts).
// Formato "chat completions" compatibile OpenAI. L'app costruisce le richieste nel formato Gemini (GeminiRequest) e qui
// le converte; le risposte tornano come GeminiAnswer, così il resto dell'app non cambia.
// Funzioni pure + fetch: testate in tests/providers.test.ts.
import {
  GeminiError, parseQuota, quotaMessage, schemaInstruction, type GeminiAnswer, type GeminiRequest
} from './gemini.ts';

export type ProviderId = 'groq' | 'mistral' | 'openrouter' | 'openai' | 'anthropic';

export interface ProviderInfo {
  id: ProviderId;
  nome: string;
  base: string;
  /** dove si crea la chiave gratuita */
  keyUrl: string;
  /** inizio tipico della chiave, per il segnaposto */
  keyHint: string;
  /** cosa offre il piano gratuito, in breve */
  piano: string;
  /** cosa succede ai dati sul piano gratuito */
  privacy: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  groq: {
    id: 'groq',
    nome: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    piano: 'gratuito senza carta di credito, molto veloce; limiti al minuto e al giorno per modello',
    privacy: 'i dati inviati non vengono usati per addestrare i modelli (condizioni di Groq)'
  },
  mistral: {
    id: 'mistral',
    nome: 'Mistral',
    base: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyHint: 'chiave Mistral',
    piano: 'piano gratuito «Experiment» (serve verificare il numero di telefono); limiti di velocità',
    privacy: 'sul piano gratuito i dati possono essere usati per migliorare i modelli'
  },
  openai: {
    id: 'openai',
    nome: 'ChatGPT',
    base: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    piano: 'a pagamento, credito prepagato (platform.openai.com → Billing); nessun piano gratuito per le app',
    privacy: 'i dati inviati con la chiave API non vengono usati per addestrare i modelli (condizioni di OpenAI)'
  },
  anthropic: {
    id: 'anthropic',
    nome: 'Claude',
    base: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    piano: 'a pagamento, credito prepagato (console.anthropic.com → Billing); nessun piano gratuito per le app',
    privacy: 'i dati inviati con la chiave API non vengono usati per addestrare i modelli (condizioni di Anthropic)'
  },
  openrouter: {
    id: 'openrouter',
    nome: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyHint: 'sk-or-…',
    piano: 'modelli gratuiti («:free»): circa 50 richieste al giorno e 20 al minuto',
    privacy: 'i modelli gratuiti sono offerti da terzi che possono conservare o usare i dati'
  }
};

/** Ordine in cui si provano le riserve gratuite: prima la più veloce. */
export const PROVIDER_ORDER: ProviderId[] = ['groq', 'mistral', 'openrouter'];
/** AI a pagamento. */
export const PAID_ORDER: ProviderId[] = ['anthropic', 'openai'];
export const isPaid = (p: ProviderId) => PAID_ORDER.includes(p);

export interface ProviderKey {
  apiKey: string;
  /** modello scelto a mano; vuoto = scelta automatica */
  model?: string;
}

export type Reserves = Partial<Record<ProviderId, ProviderKey>>;

export function configuredReserves(r: Reserves | undefined): ProviderId[] {
  return PROVIDER_ORDER.filter((id) => !!r?.[id]?.apiKey?.trim());
}

export function configuredPaid(r: Reserves | undefined): ProviderId[] {
  return PAID_ORDER.filter((id) => !!r?.[id]?.apiKey?.trim());
}

// ============================================================ richiesta

type ChatContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface ChatBody {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: ChatContent }[];
  temperature?: number;
  max_tokens?: number;
  /** OpenAI: i modelli recenti vogliono questo al posto di max_tokens */
  max_completion_tokens?: number;
  stream?: boolean;
}

/** GeminiRequest → corpo "chat completions". */
export function toChatBody(req: GeminiRequest, model: string, stream: boolean, p?: ProviderId): ChatBody {
  const gc = (req.generationConfig ?? {}) as { temperature?: number; maxOutputTokens?: number; responseSchema?: unknown; responseMimeType?: string };
  const system = [
    ...(req.systemInstruction?.parts ?? []).map((p) => p.text),
    gc.responseMimeType === 'application/json' ? schemaInstruction(gc.responseSchema) : ''
  ].filter(Boolean).join('\n\n');
  const messages: ChatBody['messages'] = system ? [{ role: 'system', content: system }] : [];
  for (const c of req.contents) {
    const parts: Exclude<ChatContent, string> = c.parts.map((p) =>
      'inlineData' in p
        ? { type: 'image_url' as const, image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
        : { type: 'text' as const, text: p.text }
    );
    const onlyText = parts.every((p) => p.type === 'text');
    messages.push({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: onlyText ? parts.map((p) => (p as { text: string }).text).join('\n\n') : parts
    });
  }
  if (p === 'openai') {
    // i modelli recenti di OpenAI (GPT-5, serie «o») non accettano max_tokens né una temperatura diversa da quella base
    return { model, messages, max_completion_tokens: Math.max(gc.maxOutputTokens ?? 0, 16000), ...(stream ? { stream: true } : {}) };
  }
  return {
    model,
    messages,
    ...(gc.temperature != null ? { temperature: gc.temperature } : {}),
    max_tokens: gc.maxOutputTokens ?? 4096,
    ...(stream ? { stream: true } : {})
  };
}

export function hasImages(req: GeminiRequest): boolean {
  return req.contents.some((c) => c.parts.some((p) => 'inlineData' in p));
}

// ============================================================ risposta ed errori

interface ChatChoice {
  message?: { content?: string | null };
  delta?: { content?: string | null };
  finish_reason?: string | null;
}
interface ChatResponse {
  choices?: ChatChoice[];
  error?: { message?: string; code?: number | string; type?: string; metadata?: { raw?: string } };
}

export function parseChatResponse(json: unknown): GeminiAnswer {
  const r = json as ChatResponse;
  const c = r?.choices?.[0];
  const text = (c?.message?.content ?? '').trim();
  if (!text) throw new GeminiError('vuota', 'Il servizio AI ha restituito una risposta vuota. Riprova.');
  return { text, truncated: c?.finish_reason === 'length', finishReason: c?.finish_reason ?? undefined, sources: [], searchQueries: [] };
}

/** Errore HTTP di un servizio di riserva → GeminiError (stessi tipi, così la gestione è unica). */
export function classifyChatError(p: ProviderId, status: number, body: unknown): GeminiError {
  const nome = PROVIDERS[p].nome;
  const e = (body as ChatResponse)?.error ?? (body as { message?: string }) ?? {};
  const msg = `${(e as { message?: string }).message ?? ''} ${(e as ChatResponse['error'])?.metadata?.raw ?? ''}`.trim();
  if (status === 401 || /invalid.*(api[_ ]?key|token)|unauthori[sz]ed|no auth/i.test(msg)) {
    return new GeminiError('chiave', `${nome}: chiave non valida o scaduta. Controllala nelle Impostazioni.`, status);
  }
  if (/key limit exceeded|credit limit/i.test(msg)) {
    return new GeminiError('quota', `${nome}: la chiave ha un limite di spesa a 0 $ e blocca anche i modelli gratuiti. Su ${p === 'openrouter' ? 'openrouter.ai → Keys' : 'il sito del servizio'} modifica la chiave e lascia vuoto il limite di credito («Credit limit»), oppure creane una nuova senza limite.`, status, { periodo: 'giorno' });
  }
  if (/insufficient_quota|exceeded your current quota|billing|credit balance/i.test(msg)) {
    return new GeminiError('quota', `${nome}: credito esaurito o assente. Ricarica il credito prepagato${p === 'openai' ? ' su platform.openai.com → Billing' : ''}.`, status, { periodo: 'giorno' });
  }
  if (status === 402) return new GeminiError('quota', `${nome}: credito o limite gratuito esaurito.`, status);
  if (status === 429) {
    const q = parseQuota({ error: { message: msg } });
    return new GeminiError('quota', quotaMessage(q, nome), status, q);
  }
  if (status === 404 || /invalid model|model.*(not found|does not exist|decommissioned|not available|invalid)/i.test(msg)) {
    return new GeminiError('modello', `${nome}: modello non disponibile.`, status);
  }
  if (status === 413 || /too large|payload|image.*(size|large)/i.test(msg)) {
    return new GeminiError('sconosciuto', `${nome}: foto troppo grandi per questo servizio.`, status);
  }
  if (status === 403) return new GeminiError('chiave', `${nome}: accesso negato${msg ? ` (${msg})` : ''}.`, status);
  if (status >= 500) return new GeminiError('sovraccarico', `${nome}: servizio momentaneamente non disponibile.`, status);
  return new GeminiError('sconosciuto', `${nome}: errore ${status}${msg ? `: ${msg}` : ''}`, status);
}

// ============================================================ chiamata

export interface ChatOptions {
  apiKey: string;
  model: string;
  /** normale: tempo massimo totale; streaming: tempo massimo di silenzio */
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** se presente la risposta arriva in tempo reale */
  onText?: (text: string) => void;
}

function headers(p: ProviderId, apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` };
  if (p === 'openrouter') h['X-Title'] = 'ATISL Security';
  return h;
}

/** Richiesta "chat completions" (normale o in tempo reale) con tempi massimi e annullamento. */
export async function callChat(p: ProviderId, req: GeminiRequest, opts: ChatOptions): Promise<GeminiAnswer> {
  if (!opts.apiKey.trim()) throw new GeminiError('chiave', `${PROVIDERS[p].nome}: manca la chiave.`);
  const stream = !!opts.onText && typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const limit = opts.timeoutMs ?? 45000;
  let timedOut = false;
  let timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, limit);
  const poke = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, limit);
  };
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const nome = PROVIDERS[p].nome;
  const fail = (): never => {
    if (timedOut) throw new GeminiError('timeout', `${nome} non ha risposto in tempo.`);
    if (opts.signal?.aborted) throw new GeminiError('annullata', 'Richiesta annullata.');
    // il browser blocca anche le richieste che il servizio non accetta da una pagina web (CORS)
    throw new GeminiError('rete', `${nome}: connessione non riuscita (rete assente o servizio che non accetta richieste dirette dall'app).`);
  };

  try {
    let res: Response;
    try {
      res = await doFetch(`${PROVIDERS[p].base}/chat/completions`, {
        method: 'POST',
        headers: headers(p, opts.apiKey),
        body: JSON.stringify(toChatBody(req, opts.model, stream, p)),
        signal: ctrl.signal
      });
    } catch {
      return fail();
    }
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* non JSON */ }
      throw classifyChatError(p, res.status, body);
    }
    if (!stream || !res.body) {
      let json: unknown;
      try { json = await res.json(); } catch { return fail(); }
      const err = (json as ChatResponse).error;
      if (err) throw classifyChatError(p, Number(err.code) || 500, json);
      return parseChatResponse(json);
    }

    let text = '';
    let finish: string | undefined;
    const handle = (data: string) => {
      if (data === '[DONE]') return;
      let chunk: ChatResponse;
      try { chunk = JSON.parse(data); } catch { return; }
      if (chunk.error) throw classifyChatError(p, Number(chunk.error.code) || 500, chunk);
      const c = chunk.choices?.[0];
      const piece = c?.delta?.content ?? c?.message?.content ?? '';
      if (piece) {
        text += piece;
        opts.onText?.(text);
      }
      if (c?.finish_reason) finish = c.finish_reason;
    };
    const consume = (buf: string): string => {
      const lines = buf.split(/\r?\n/);
      const rest = lines.pop() ?? '';
      for (const l of lines) if (l.startsWith('data:')) handle(l.slice(5).trim());
      return rest;
    };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        poke();
        buf = consume(buf + dec.decode(value, { stream: true }));
      }
      consume(buf + dec.decode() + '\n');
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if (!text.trim()) fail();
      finish = 'length'; // interrotta a metà: si tiene il testo arrivato
    }
    if (!text.trim()) throw new GeminiError('vuota', `${nome} ha restituito una risposta vuota.`);
    return { text: text.trim(), truncated: finish === 'length', finishReason: finish, sources: [], searchQueries: [] };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

// ============================================================ modelli

export interface ChatModel {
  id: string;
  /** legge le immagini */
  vision: boolean;
  /** gratuito (rilevante per OpenRouter) */
  free: boolean;
  contesto?: number;
}

interface RawChatModel {
  id: string;
  active?: boolean;
  context_window?: number;
  context_length?: number;
  capabilities?: { completion_chat?: boolean; vision?: boolean };
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; modality?: string };
  deprecation?: string | null;
}

const VISION_NAME = /llama-4|vision|scout|maverick|pixtral|qwen.*vl|gemma-3|llava|gemini/i;
const NOT_CHAT: Record<ProviderId, RegExp> = {
  groq: /whisper|tts|guard|playai|orpheus|compound|distil|embed|allam/i,
  mistral: /embed|ocr|moderation|codestral|devstral|voxtral|magistral|saba|ministral-3b/i,
  openrouter: /thinking|-r1\b|r1-|:extended|embed|audio|image-gen|router/i,
  // solo modelli di chat; esclusi audio, immagini, ricerca, i «pro» (molto costosi) e i vecchi
  openai: /^(?!gpt-|chatgpt-|o\d)|audio|realtime|tts|transcribe|whisper|dall-e|image|embedding|moderation|search|instruct|codex|computer|-pro\b|deep-research|^o1|gpt-3\.5|^gpt-4(?!o|\.1)/i,
  anthropic: /^(?!claude-)/i
};
// preferenze (dal migliore): modelli grandi e capaci in italiano
const PREFER: Record<ProviderId, RegExp[]> = {
  groq: [/llama-4-maverick/i, /llama-4-scout/i, /gpt-oss-120b/i, /kimi-k2/i, /llama-3\.3-70b/i, /qwen/i, /llama/i],
  mistral: [/^mistral-medium-latest$/i, /^mistral-large-latest$/i, /^mistral-small-latest$/i, /^pixtral-large-latest$/i, /medium/i, /large/i, /small/i],
  // il modello principale più recente (GPT-5.x), poi i precedenti; i «mini» solo se non c'è altro
  openai: [/^gpt-5(\.\d+)?$/i, /^gpt-5(\.\d+)?-chat/i, /^gpt-4\.1$/i, /^gpt-4o$/i, /^gpt-5.*mini/i, /mini/i],
  anthropic: [/opus/i],
  openrouter: [/google\/gemini/i, /meta-llama\/llama-4-maverick/i, /qwen.*vl.*(72|32)b/i, /google\/gemma-3-27b/i, /mistral-small/i, /meta-llama\/llama-4/i, /deepseek-(chat|v3)/i, /llama-3\.3-70b/i, /qwen/i]
};

export async function listChatModels(p: ProviderId, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ChatModel[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetchImpl(`${PROVIDERS[p].base}/models`, { headers: headers(p, apiKey), signal: ctrl.signal });
  } catch {
    throw new GeminiError('rete', `${PROVIDERS[p].nome}: connessione non riuscita (rete assente o servizio che non accetta richieste dirette dall'app).`);
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non JSON */ }
    throw classifyChatError(p, res.status, body);
  }
  const json = (await res.json()) as { data?: RawChatModel[] };
  return (json.data ?? [])
    .filter((m) => m.id && m.active !== false && !m.deprecation && m.capabilities?.completion_chat !== false && !NOT_CHAT[p].test(m.id))
    .map((m) => ({
      id: m.id,
      vision: m.capabilities?.vision ?? (m.architecture?.input_modalities?.includes('image') ?? (/image/.test(m.architecture?.modality ?? '') || VISION_NAME.test(m.id))),
      // OpenAI: i modelli di chat recenti leggono le immagini
      ...(p === 'openai' ? { vision: true } : {}),
      free: p !== 'openrouter' || m.id.endsWith(':free') || (Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0),
      contesto: m.context_window ?? m.context_length
    }));
}

/** Modello migliore per il compito (con le foto servono modelli che leggono le immagini). */
export function pickModel(p: ProviderId, models: ChatModel[], vision: boolean): string | undefined {
  const usable = models.filter((m) => m.free && (!vision || m.vision));
  for (const re of PREFER[p]) {
    const hit = usable.filter((m) => re.test(m.id)).sort((a, b) => (b.contesto ?? 0) - (a.contesto ?? 0))[0];
    if (hit) return hit.id;
  }
  return usable.sort((a, b) => (b.contesto ?? 0) - (a.contesto ?? 0))[0]?.id;
}
