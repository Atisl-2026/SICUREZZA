// Claude (Anthropic) come AI a pagamento, chiamato dal telefono con la libreria ufficiale
// @anthropic-ai/sdk (caricata solo quando serve). Le richieste dell'app sono nel formato Gemini
// (GeminiRequest): qui diventano messaggi Claude; la risposta torna come GeminiAnswer.
import type Anthropic from '@anthropic-ai/sdk';
import { GeminiError, schemaInstruction, type GeminiAnswer, type GeminiRequest, type ThinkingLevel } from '../shared/gemini.ts';

export interface ClaudeModel {
  id: string;
  nome: string;
  /** prezzo per milione di token, ingresso / uscita */
  prezzo: string;
  /** costo indicativo: domanda con 8 brani dell'archivio / analisi di 2-3 foto */
  domanda: string;
  foto: string;
  /** se Claude rifiuta per motivi di sicurezza, la richiesta passa a un altro modello sul server */
  fallback: boolean;
}

export const CLAUDE_MODELS: ClaudeModel[] = [
  { id: 'claude-opus-5-5', nome: 'Claude Opus 5.5 (consigliato)', prezzo: '4 $ / 20 $', domanda: '≈ 2–3 centesimi', foto: '≈ 6–8 centesimi', fallback: true },
  { id: 'claude-sonnet-5-5', nome: 'Claude Sonnet 5.5', prezzo: '2 $ / 10 $', domanda: '≈ 1–1,5 centesimi', foto: '≈ 3–4 centesimi', fallback: true },
  { id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5 (economico)', prezzo: '0,10 $ / 0,50 $', domanda: '≈ 0,1 centesimi', foto: '≈ 0,2–0,3 centesimi', fallback: false },
  { id: 'claude-fable-5-1', nome: 'Claude Fable 5.1 (il più capace)', prezzo: '10 $ / 50 $', domanda: '≈ 6–8 centesimi', foto: '≈ 15–20 centesimi', fallback: true }
];

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
type Effort = 'low' | 'medium' | 'high';

/** Quanto «ragiona» Claude: poco per i compiti semplici (più rapido ed economico). */
function effortFor(thinking?: ThinkingLevel): Effort {
  return thinking === 'minimal' ? 'low' : 'medium';
}

/** Richiesta nel formato dell'app → parametri della Messages API. */
export function toClaudeParams(req: GeminiRequest, model: string, thinking?: ThinkingLevel): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const gc = (req.generationConfig ?? {}) as { maxOutputTokens?: number; responseSchema?: unknown; responseMimeType?: string };
  const system = [
    ...(req.systemInstruction?.parts ?? []).map((p) => p.text),
    gc.responseMimeType === 'application/json' ? schemaInstruction(gc.responseSchema) : ''
  ].filter(Boolean).join('\n\n');
  const messages: Anthropic.Beta.BetaMessageParam[] = req.contents.map((c) => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: c.parts.map((p): Anthropic.Beta.BetaContentBlockParam =>
      'inlineData' in p
        ? { type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType as ImageMediaType, data: p.inlineData.data } }
        : { type: 'text', text: p.text }
    )
  }));
  const info = CLAUDE_MODELS.find((m) => m.id === model);
  return {
    model,
    // risposte brevi (passo 1 delle foto) con un tetto più basso; le altre con margine ampio
    max_tokens: gc.maxOutputTokens ? 16000 : 64000,
    ...(system ? { system } : {}),
    messages,
    output_config: { effort: effortFor(thinking) },
    // se Claude rifiuta la richiesta per i suoi filtri di sicurezza, il server la passa da solo al
    // modello consigliato da Anthropic per quel caso (solo dove previsto)
    ...(info?.fallback ?? true ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
  };
}

export interface ClaudeOptions {
  apiKey: string;
  model: string;
  /** tempo massimo di silenzio */
  timeoutMs?: number;
  signal?: AbortSignal;
  thinking?: ThinkingLevel;
  onText?: (text: string) => void;
  /** solo per i test */
  fetchImpl?: typeof fetch;
}

async function sdk() {
  try {
    return (await import('@anthropic-ai/sdk')).default;
  } catch {
    throw new GeminiError('rete', 'Claude: impossibile caricare il collegamento (serve la connessione; se persiste chiudi e riapri l\'app).');
  }
}

async function client(apiKey: string, fetchImpl?: typeof fetch) {
  const A = await sdk();
  const key = apiKey.trim();
  // la chiave resta sul dispositivo dell'utente: la libreria richiede di confermarlo esplicitamente.
  // La libreria la manderebbe come «Authorization: Bearer», che nelle chiamate dal browser (l'app sul
  // telefono) Anthropic non legge («x-api-key header is required»): si manda come «x-api-key».
  return {
    A,
    c: new A({
      apiKey: key,
      defaultHeaders: { 'x-api-key': key, Authorization: null },
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      ...(fetchImpl ? { fetch: fetchImpl } : {})
    })
  };
}

/** Il motivo indicato da Anthropic (es. «invalid x-api-key», «Your credit balance is too low…»). */
function reason(e: { error?: unknown; message: string }): string {
  const m = (e.error as { error?: { message?: unknown } } | undefined)?.error?.message;
  return (typeof m === 'string' && m ? m : e.message).replace(/^\d{3}\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

const errorType = (e: { error?: unknown }) => (e.error as { error?: { type?: string } } | undefined)?.error?.type ?? '';

/** Errori della libreria → GeminiError (stessi tipi del resto dell'app), con il motivo dato da Anthropic. */
export function classify(A: typeof Anthropic, e: unknown, timedOut: boolean, signal?: AbortSignal): GeminiError {
  if (e instanceof GeminiError) return e;
  if (e instanceof A.APIUserAbortError) {
    return timedOut ? new GeminiError('timeout', 'Claude non ha risposto in tempo.') : new GeminiError('annullata', 'Richiesta annullata.');
  }
  if (signal?.aborted) return new GeminiError('annullata', 'Richiesta annullata.');
  if (e instanceof A.APIConnectionTimeoutError) return new GeminiError('timeout', 'Claude non ha risposto in tempo.');
  if (e instanceof A.APIConnectionError) return new GeminiError('rete', 'Claude: connessione non riuscita. Controlla la rete.');
  if (!(e instanceof A.APIError)) return new GeminiError('sconosciuto', `Claude: ${(e as Error)?.message || 'errore imprevisto'}`);

  const r = reason(e);
  const type = errorType(e);
  const status = e.status;
  if (status === 402 || type === 'billing_error' || /credit balance|billing|purchase credits|insufficient (funds|credit)/i.test(r)) {
    return new GeminiError('quota', `Claude: credito esaurito o pagamento non attivo («${r}»). Ricarica il credito su console.anthropic.com → Billing.`, status ?? 402, { periodo: 'giorno' });
  }
  if (status === 401 || type === 'authentication_error') {
    return new GeminiError('chiave', `Claude: chiave non valida o revocata («${r}»). Ricopiala da console.anthropic.com → API keys e incollala di nuovo nelle Impostazioni.`, 401);
  }
  if (status === 403 || type === 'permission_error') {
    return new GeminiError('chiave', `Claude: accesso negato («${r}»). Controlla su console.anthropic.com che la chiave sia attiva e che ci sia credito.`, 403);
  }
  if (status === 404 || type === 'not_found_error') {
    return new GeminiError('modello', `Claude: modello non disponibile per questa chiave («${r}»).`, 404);
  }
  if (status === 429 || type === 'rate_limit_error') {
    return /spend|budget|usage limit|monthly/i.test(r)
      ? new GeminiError('quota', `Claude: raggiunto il limite di spesa impostato su console.anthropic.com («${r}»). Se vuoi, alzalo in Settings → Limits.`, 429, { periodo: 'giorno' })
      : new GeminiError('quota', `Claude: superato il limite di richieste al minuto del tuo account («${r}»). Riprova tra un minuto: i limiti crescono dopo i primi acquisti di credito.`, 429, { periodo: 'minuto' });
  }
  if (status === 529 || type === 'overloaded_error' || (status ?? 0) >= 500) {
    return new GeminiError('sovraccarico', 'Claude: servizio momentaneamente sovraccarico. Riprova tra poco.', status ?? 529);
  }
  if (status === 413 || type === 'request_too_large') {
    return new GeminiError('sconosciuto', `Claude: richiesta troppo grande («${r}»). Prova con meno foto o una domanda più breve.`, 413);
  }
  if (status === 400 || type === 'invalid_request_error') {
    return new GeminiError('sconosciuto', `Claude: richiesta non valida («${r}»).`, 400);
  }
  return new GeminiError('sconosciuto', `Claude: errore${status ? ` ${status}` : ''} («${r}»).`, status);
}

/** Risposta di Claude in tempo reale (il testo arriva mentre viene scritto). */
export async function callClaude(req: GeminiRequest, opts: ClaudeOptions): Promise<GeminiAnswer> {
  if (!opts.apiKey.trim()) throw new GeminiError('chiave', 'Claude: manca la chiave.');
  const { A, c } = await client(opts.apiKey, opts.fetchImpl);
  const ctrl = new AbortController();
  const idle = opts.timeoutMs ?? 60000;
  let timedOut = false;
  let timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, idle);
  const poke = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, idle);
  };
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const stream = c.beta.messages.stream(toClaudeParams(req, opts.model, opts.thinking), { signal: ctrl.signal });
    stream.on('streamEvent', poke);
    stream.on('text', (_delta, snapshot) => opts.onText?.(snapshot));
    const msg = await stream.finalMessage();
    // rifiuto per i filtri di sicurezza (anche dopo l'eventuale modello di ripiego)
    if (msg.stop_reason === 'refusal') {
      throw new GeminiError('bloccata', 'Claude ha rifiutato di rispondere a questa richiesta per i suoi criteri di sicurezza. Prova con un\'altra AI o riformula.');
    }
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new GeminiError('vuota', 'Claude ha restituito una risposta vuota.');
    return {
      text,
      truncated: msg.stop_reason === 'max_tokens',
      finishReason: msg.stop_reason ?? undefined,
      sources: [],
      searchQueries: [],
      servizio: 'Claude',
      // il modello che ha risposto davvero (diverso da quello scelto se è intervenuto il ripiego)
      modello: msg.model
    };
  } catch (e) {
    throw classify(A, e, timedOut, opts.signal);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Verifica della chiave senza spendere credito: elenco dei modelli disponibili. */
export async function checkClaudeKey(apiKey: string, fetchImpl?: typeof fetch): Promise<string[]> {
  const { A, c } = await client(apiKey, fetchImpl);
  try {
    const ids: string[] = [];
    for await (const m of c.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  } catch (e) {
    throw classify(A, e, false);
  }
}
