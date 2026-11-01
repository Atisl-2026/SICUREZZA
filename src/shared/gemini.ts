// Client minimale per l'API REST Gemini (generateContent), chiamata direttamente dal browser.
// Nessuna dipendenza: request builder, parser della risposta e classificazione degli errori sono
// funzioni pure, testate in tests/gemini.test.ts.

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
// alias che Google aggiorna all'ultimo Flash; se sparisse, l'app sceglie da sola un modello disponibile (lib/model.ts)
export const DEFAULT_MODEL = 'gemini-flash-latest';
export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/app/apikey';

// ============================================================ richieste

/** Blocco di contesto passato al modello. */
export interface ContextBlock {
  recordId: string;
  titolo: string;
  categoria: string;
  fonte: string;
  data_aggiornamento: string;
  testo: string;
  /** articolo/allegato in cui inizia il brano (es. "Art. 126 – Parapetti"), ricavato dal testo completo */
  articolo?: string;
  /** altri articoli/allegati che iniziano dentro il brano */
  articoliNelBrano?: string[];
  /** pagina del PDF in cui si trova il brano */
  pagina?: number;
}

export const SYSTEM_DB = `Sei l'assistente di un archivio interno di documenti (normativa, procedure, schede tecniche, FAQ).
Regole obbligatorie:
1. Rispondi SEMPRE in italiano.
2. Usa SOLO le informazioni contenute nei BLOCCHI forniti nel messaggio. Non usare conoscenze esterne, non fare supposizioni, non inventare dati, numeri, date, nomi o riferimenti normativi.
3. Se i blocchi non contengono l'informazione richiesta, o la contengono solo in parte, dillo chiaramente (per esempio: "Nel database non ho trovato informazioni su …") e riporta solo ciò che è presente.
4. Dopo ogni affermazione cita tra parentesi quadre l'id del record da cui proviene, esattamente come scritto nel blocco, ad esempio [procedure-richiesta-ferie]. Più id: [id-uno][id-due]. Non citare id che non compaiono nei blocchi.
   Se l'informazione viene da una norma e il blocco indica l'articolo (campo "articolo" o intestazione "Art." / "Allegato" nel testo), scrivi anche l'articolo e, se presente nel testo, il comma o punto, ad esempio: "Art. 126, comma 1 [normativa-dlgs-81]". Non inventare numeri di articoli o commi.
5. Se blocchi diversi sono in contrasto, segnalalo indicando entrambi gli id e le date di aggiornamento.
6. Sii chiaro e conciso: frasi brevi, elenchi puntati per passaggi o requisiti, grassetto solo per i punti chiave. Niente premesse inutili.`;

export const SYSTEM_WEB = `Rispondi in italiano alla domanda dell'utente usando la ricerca Google.
Sii conciso e preciso, privilegia fonti ufficiali e aggiornate (siti istituzionali, normativa ufficiale, documentazione dei produttori).
Se le fonti sono discordanti o l'informazione dipende dal contesto, dillo. Non inventare informazioni che non trovi.`;

export function formatContext(blocks: ContextBlock[]): string {
  return blocks
    .map((b, i) => {
      const meta = [
        `id: ${b.recordId}`,
        `titolo: ${b.titolo}`,
        b.categoria && `categoria: ${b.categoria}`,
        b.fonte && `fonte: ${b.fonte}`,
        b.data_aggiornamento && `aggiornato: ${b.data_aggiornamento}`,
        b.articolo && `articolo: ${b.articolo}`,
        b.articoliNelBrano?.length && `nel brano iniziano anche: ${b.articoliNelBrano.join('; ')}`,
        b.pagina && `pagina del PDF: ${b.pagina}`
      ].filter(Boolean).join(' | ');
      return `[BLOCCO ${i + 1}] ${meta}\n${b.testo.trim()}`;
    })
    .join('\n\n---\n\n');
}

/** Parte di un messaggio: testo o immagine (base64). */
export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GeminiRequest {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: 'user' | 'model'; parts: GeminiPart[] }[];
  tools?: Record<string, unknown>[];
  generationConfig?: Record<string, unknown>;
}

interface SchemaProp { type?: string; description?: string; items?: { type?: string } }

/** Lo schema JSON diventa un'istruzione nel testo (per i modelli che non accettano gli schemi). */
export function schemaInstruction(schema: unknown): string {
  const props = (schema as { properties?: Record<string, SchemaProp> })?.properties;
  if (!props) return 'Rispondi SOLO con un oggetto JSON valido, senza altro testo.';
  const fields = Object.entries(props).map(([k, p]) => {
    const t = p.type === 'ARRAY' ? 'elenco di testi' : p.type === 'NUMBER' || p.type === 'INTEGER' ? 'numero' : 'testo';
    return `- "${k}" (${t})${p.description ? `: ${p.description}` : ''}`;
  });
  return `Rispondi SOLO con un oggetto JSON valido, senza altro testo e senza blocchi di codice, con questi campi:\n${fields.join('\n')}`;
}

/** Modelli Gemma (stessa chiave Gemini, limiti gratuiti molto più alti, leggono le foto). */
export const isGemma = (model: string) => /(^|\/)gemma/i.test(model.trim());

/**
 * I modelli Gemma non accettano istruzioni di sistema, risposta JSON con schema, ragionamento e
 * strumenti: le istruzioni vanno all'inizio del messaggio, lo schema diventa testo.
 */
export function adaptRequest(req: GeminiRequest, model: string): GeminiRequest {
  if (!isGemma(model)) return req;
  const gc = { ...(req.generationConfig ?? {}) } as Record<string, unknown>;
  const json = gc.responseMimeType === 'application/json';
  const intro = [
    ...(req.systemInstruction?.parts ?? []).map((p) => p.text),
    json ? schemaInstruction(gc.responseSchema) : ''
  ].filter(Boolean).join('\n\n');
  delete gc.responseMimeType;
  delete gc.responseSchema;
  delete gc.thinkingConfig;
  const contents = req.contents.map((c, i) =>
    i === 0 && intro ? { ...c, parts: [{ text: `ISTRUZIONI:\n${intro}\n\n---\n` }, ...c.parts] } : c
  );
  return { contents, generationConfig: gc };
}

/** Richiesta "Dal database": blocchi come contesto, poi la domanda. */
export function buildDbRequest(question: string, blocks: ContextBlock[]): GeminiRequest {
  const text = `BLOCCHI DAL DATABASE:\n\n${formatContext(blocks)}\n\n===\n\nDOMANDA: ${question.trim()}`;
  return {
    systemInstruction: { parts: [{ text: SYSTEM_DB }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0.2 }
  };
}

/** Richiesta "Dal web": grounding con Ricerca Google. */
export function buildWebRequest(question: string): GeminiRequest {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_WEB }] },
    contents: [{ role: 'user', parts: [{ text: question.trim() }] }],
    tools: [{ google_search: {} }]
  };
}

/** "models/gemini-2.5-flash " -> "gemini-2.5-flash" */
export function cleanModelName(model: string): string {
  return (model || DEFAULT_MODEL).trim().replace(/^models\//, '') || DEFAULT_MODEL;
}

// ============================================================ risposte

export interface WebSource {
  uri: string;
  title: string;
}

export interface GeminiAnswer {
  text: string;
  /** true se la risposta è stata troncata per limite di lunghezza. */
  truncated: boolean;
  finishReason?: string;
  sources: WebSource[];
  searchQueries: string[];
  /** HTML dei "suggerimenti di ricerca" di Google (da mostrare quando si usa il grounding). */
  searchEntryPoint?: string;
  /** servizio AI che ha risposto (es. "Gemini", "Groq") e modello usato */
  servizio?: string;
  modello?: string;
}

interface RawPart { text?: string; thought?: boolean }
interface RawCandidate {
  content?: { parts?: RawPart[] };
  finishReason?: string;
  groundingMetadata?: {
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    webSearchQueries?: string[];
    searchEntryPoint?: { renderedContent?: string };
  };
}
interface RawResponse {
  candidates?: RawCandidate[];
  promptFeedback?: { blockReason?: string };
}

/** Estrae testo, fonti web e motivo di fine da una risposta generateContent. Lancia GeminiError se non c'è testo utile. */
export function parseGeminiResponse(json: unknown): GeminiAnswer {
  const res = (json ?? {}) as RawResponse;
  const cand = res.candidates?.[0];
  if (!cand) {
    if (res.promptFeedback?.blockReason) {
      throw new GeminiError('bloccata', `La richiesta è stata bloccata dai filtri di Google (${res.promptFeedback.blockReason}).`);
    }
    throw new GeminiError('vuota', 'Gemini non ha restituito alcuna risposta.');
  }
  const text = (cand.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
  const finishReason = cand.finishReason;

  if (!text) {
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT' || finishReason === 'BLOCKLIST') {
      throw new GeminiError('bloccata', 'La risposta è stata bloccata dai filtri di sicurezza di Google.');
    }
    if (finishReason === 'RECITATION') {
      throw new GeminiError('bloccata', 'Gemini non ha potuto rispondere perché il testo riprodurrebbe contenuti protetti.');
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new GeminiError('vuota', 'La risposta ha superato il limite di lunghezza prima di produrre testo.');
    }
    throw new GeminiError('vuota', 'Gemini ha restituito una risposta vuota.');
  }

  const gm = cand.groundingMetadata;
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const ch of gm?.groundingChunks ?? []) {
    const uri = ch.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ uri, title: ch.web?.title || hostOf(uri) });
  }

  return {
    text,
    truncated: finishReason === 'MAX_TOKENS',
    finishReason,
    sources,
    searchQueries: gm?.webSearchQueries ?? [],
    searchEntryPoint: gm?.searchEntryPoint?.renderedContent || undefined
  };
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return uri;
  }
}

// ============================================================ errori

export type GeminiErrorKind =
  | 'chiave' // chiave mancante, non valida o senza permessi
  | 'quota' // 429: limite gratuito esaurito
  | 'modello' // modello inesistente o non disponibile
  | 'non-supportato' // funzione (es. google_search) non supportata dal modello/piano
  | 'regione' // servizio non disponibile nel paese
  | 'sovraccarico' // 500/503
  | 'timeout'
  | 'rete'
  | 'bloccata'
  | 'vuota'
  | 'annullata'
  | 'sconosciuto';

/** Dettagli di un errore 429 (limiti della chiave API, diversi da quelli dell'app Gemini). */
export interface QuotaInfo {
  /** quale limite: richieste al minuto, al giorno, dati (token) al minuto */
  periodo: 'minuto' | 'giorno' | 'token' | 'sconosciuto';
  /** valore del limite (0 = modello non incluso nel piano gratuito) */
  limite?: number;
  /** modello a cui si riferisce il limite */
  modello?: string;
  /** secondi da attendere indicati da Google */
  attesaS?: number;
}

export class GeminiError extends Error {
  kind: GeminiErrorKind;
  status?: number;
  quota?: QuotaInfo;
  constructor(kind: GeminiErrorKind, message: string, status?: number, quota?: QuotaInfo) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.status = status;
    if (quota) this.quota = quota;
  }
}

interface RawError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: {
      '@type'?: string;
      reason?: string;
      retryDelay?: string;
      violations?: { quotaMetric?: string; quotaId?: string; quotaValue?: string; quotaDimensions?: Record<string, string> }[];
    }[];
  };
}

/** Legge dal 429 di Google quale limite è stato superato (QuotaFailure, RetryInfo, testo del messaggio). */
export function parseQuota(body: unknown): QuotaInfo {
  const err = (body as RawError)?.error ?? {};
  const msg = err.message ?? '';
  const details = err.details ?? [];
  const violations = details.filter((d) => /QuotaFailure/.test(d['@type'] ?? '')).flatMap((d) => d.violations ?? []);
  // se ce ne sono più d'una, conta quella giornaliera (è la più vincolante)
  const v = violations.find((x) => /PerDay/i.test(x.quotaId ?? '')) ?? violations[0];
  const id = `${v?.quotaId ?? ''} ${v?.quotaMetric ?? ''}`;
  const periodo: QuotaInfo['periodo'] = /token/i.test(id)
    ? 'token'
    : /PerDay|per_day|daily/i.test(id) ? 'giorno'
      : /PerMinute|per_minute/i.test(id) ? 'minuto'
        : /per day|daily|\bRPD\b|\bTPD\b/i.test(msg) ? 'giorno'
          : /tokens per minute|\bTPM\b/i.test(msg) ? 'token'
            : /per minute|\bRPM\b/i.test(msg) ? 'minuto' : 'sconosciuto';
  const num = (x: string | undefined) => (x != null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : undefined);
  const limite = num(v?.quotaValue) ?? num(msg.match(/limit:?\s*(\d+)/i)?.[1]);
  const modello = v?.quotaDimensions?.model ?? msg.match(/model:?\s*`?([\w./:-]*\w)/i)?.[1];
  const delay = details.find((d) => d.retryDelay)?.retryDelay ?? msg.match(/(?:retry|try again) in\s*([\d.]+)\s*s/i)?.[1];
  const attesaS = delay ? Math.ceil(parseFloat(delay)) : undefined;
  const q: QuotaInfo = { periodo };
  if (limite !== undefined) q.limite = limite;
  if (modello) q.modello = modello;
  if (attesaS !== undefined && Number.isFinite(attesaS)) q.attesaS = attesaS;
  return q;
}

/** Messaggio chiaro per un limite superato (nome = servizio AI). */
export function quotaMessage(q: QuotaInfo, nome = 'Gemini'): string {
  const mod = q.modello ? ` del modello «${q.modello}»` : '';
  const tra = q.attesaS ? ` Riprova tra ${q.attesaS} secondi.` : ' Riprova tra un minuto.';
  if (q.limite === 0) {
    return `${nome}: il modello${q.modello ? ` «${q.modello}»` : ' scelto'} non è incluso nel piano gratuito della chiave API: scegline un altro${nome === 'Gemini' ? ' (Impostazioni → Modello, meglio un «Flash»)' : ''}.`;
  }
  if (q.periodo === 'giorno') {
    return `${nome}: raggiunto il limite giornaliero gratuito${mod}${q.limite ? ` (${q.limite} richieste al giorno)` : ''}.${nome === 'Gemini' ? ' Si azzera ogni giorno verso le 9 del mattino (ora italiana).' : ''}`;
  }
  if (q.periodo === 'minuto') {
    return `${nome}: troppe richieste in un minuto per il piano gratuito${mod}${q.limite ? ` (massimo ${q.limite} al minuto)` : ''}.${tra}`;
  }
  if (q.periodo === 'token') {
    return `${nome}: troppi dati inviati in un minuto (foto o testi lunghi) per il piano gratuito.${tra}`;
  }
  return `${nome}: limite di utilizzo della chiave API raggiunto${nome === 'Gemini' ? " (è separato da quello dell'app Gemini)" : ''}.${tra}`;
}

/** Converte una risposta HTTP di errore in un GeminiError con messaggio chiaro in italiano. */
export function classifyHttpError(status: number, body: unknown): GeminiError {
  const err = (body as RawError)?.error ?? {};
  const msg = err.message ?? '';
  const reasons = (err.details ?? []).map((d) => d.reason ?? '');
  const has = (re: RegExp) => re.test(msg);

  if (reasons.includes('API_KEY_INVALID') || has(/API key (not valid|expired|invalid)/i)) {
    return new GeminiError('chiave', 'La chiave API Gemini non è valida o è scaduta. Controllala nelle Impostazioni.', status);
  }
  if (status === 429 || err.status === 'RESOURCE_EXHAUSTED') {
    const q = parseQuota(body);
    return new GeminiError('quota', quotaMessage(q), status, q);
  }
  if (has(/location is not supported|not available in your (country|region)/i)) {
    return new GeminiError('regione', "L'API Gemini non è disponibile nel paese da cui ti colleghi.", status);
  }
  if (has(/thinking/i)) {
    // parametro di "ragionamento" non accettato dal modello: l'app riprova senza (vedi withThinkingRetry)
    return new GeminiError('sconosciuto', `Errore Gemini (${status}): ${msg}`, status);
  }
  if (has(/search|grounding|google_search|tool/i) && has(/not supported|not enabled|unsupported|not available|is not allowed/i)) {
    return new GeminiError('non-supportato', 'Il modello scelto non supporta la ricerca Google.', status);
  }
  if (status === 404 || (has(/model/i) && has(/not found|not supported|does not exist|is not found/i))) {
    return new GeminiError('modello', 'Modello Gemini non trovato o non disponibile: controlla il nome nelle Impostazioni.', status);
  }
  if (status === 401 || status === 403) {
    return new GeminiError('chiave', 'Accesso negato da Gemini: verifica che la chiave sia corretta e che l\'API sia abilitata.', status);
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new GeminiError('sovraccarico', 'Il servizio Gemini è momentaneamente sovraccarico o non disponibile. Riprova tra poco.', status);
  }
  return new GeminiError('sconosciuto', `Errore Gemini (${status})${msg ? `: ${msg}` : ''}`, status);
}

// ============================================================ chiamata

export interface CallOptions {
  apiKey: string;
  model: string;
  /** Chiamata normale: tempo massimo totale. Streaming: tempo massimo di silenzio tra un pezzo e l'altro. */
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /**
   * Quanto il modello deve "ragionare" prima di rispondere: meno ragionamento = risposta più rapida.
   * Ignorato dai modelli che non lo prevedono.
   */
  thinking?: ThinkingLevel;
}

export type ThinkingLevel = 'minimal' | 'low';

/** Modelli che hanno rifiutato il parametro di ragionamento (si chiamano senza). */
const noThinking = new Set<string>();

/** Parametro di ragionamento adatto al modello (le famiglie di Gemini usano parametri diversi). */
export function thinkingConfigFor(model: string, level: ThinkingLevel): Record<string, unknown> | undefined {
  const m = cleanModelName(model);
  if (noThinking.has(m) || isGemma(m)) return undefined;
  if (/gemini-(1\.|2\.0)/i.test(m)) return undefined; // modelli senza ragionamento
  if (/gemini-2\.5-pro/i.test(m)) return { thinkingBudget: 128 }; // minimo consentito
  if (/gemini-2\.5/i.test(m)) return { thinkingBudget: level === 'minimal' ? 0 : 512 };
  // Gemini 3 e successivi (anche gli alias "-latest"): livello di ragionamento
  return { thinkingLevel: level === 'minimal' && !/pro/i.test(m) ? 'minimal' : 'low' };
}

function withThinkingConfig(req: GeminiRequest, cfg: Record<string, unknown>): GeminiRequest {
  return { ...req, generationConfig: { ...(req.generationConfig ?? {}), thinkingConfig: cfg } };
}

/** Esegue con il ragionamento ridotto; se il modello rifiuta il parametro riprova senza (e lo ricorda). */
async function withThinkingRetry<T>(req: GeminiRequest, opts: CallOptions, run: (r: GeminiRequest) => Promise<T>): Promise<T> {
  const model = cleanModelName(opts.model);
  const cfg = opts.thinking ? thinkingConfigFor(model, opts.thinking) : undefined;
  if (!cfg) return run(req);
  try {
    return await run(withThinkingConfig(req, cfg));
  } catch (e) {
    if (e instanceof GeminiError && e.status === 400 && /thinking/i.test(e.message)) {
      noThinking.add(model);
      return run(req);
    }
    throw e;
  }
}

/** POST generateContent. Restituisce la risposta già interpretata o lancia GeminiError. */
export async function callGemini(req: GeminiRequest, opts: CallOptions): Promise<GeminiAnswer> {
  return withThinkingRetry(req, opts, async (r) => parseGeminiResponse(await requestJson(
    `${GEMINI_ENDPOINT}/models/${encodeURIComponent(cleanModelName(opts.model))}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adaptRequest(r, opts.model)) },
    opts
  )));
}

export interface StreamOptions extends CallOptions {
  /** Chiamata a ogni nuovo pezzo con tutto il testo ricevuto finora. */
  onText?: (text: string) => void;
}

/**
 * Risposta in tempo reale (streamGenerateContent, Server-Sent Events): il testo arriva a pezzi
 * e l'interfaccia lo mostra subito. Il tempo massimo vale per il silenzio, non per la risposta intera.
 * Senza supporto allo streaming nel browser ricade sulla chiamata normale.
 */
export async function streamGemini(req: GeminiRequest, opts: StreamOptions): Promise<GeminiAnswer> {
  if (typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined') return callGemini(req, opts);
  return withThinkingRetry(req, opts, (r) => streamRequest(r, opts));
}

interface StreamChunk extends RawResponse {
  error?: { code?: number; message?: string; status?: string };
}

async function streamRequest(req: GeminiRequest, opts: StreamOptions): Promise<GeminiAnswer> {
  if (!opts.apiKey.trim()) throw new GeminiError('chiave', 'Manca la chiave API Gemini: inseriscila nelle Impostazioni.');
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const idleMs = opts.timeoutMs ?? 45000;
  let timedOut = false;
  let timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, idleMs);
  const poke = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, idleMs);
  };
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);

  let text = '';
  let finishReason: string | undefined;
  let grounding: RawCandidate['groundingMetadata'];
  let blockReason: string | undefined;
  const fail = (): never => {
    if (timedOut) throw new GeminiError('timeout', 'Gemini non ha risposto in tempo. Riprova tra poco.');
    if (opts.signal?.aborted) throw new GeminiError('annullata', 'Richiesta annullata.');
    throw new GeminiError('rete', 'Connessione interrotta durante la risposta di Gemini: controlla la rete e riprova.');
  };

  try {
    let res: Response;
    try {
      res = await doFetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(cleanModelName(opts.model))}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey.trim() },
        body: JSON.stringify(adaptRequest(req, opts.model)),
        signal: ctrl.signal
      });
    } catch {
      return fail();
    }
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* corpo non JSON */ }
      throw classifyHttpError(res.status, body);
    }

    const handle = (data: string) => {
      let chunk: StreamChunk;
      try { chunk = JSON.parse(data); } catch { return; }
      if (chunk.error) throw classifyHttpError(chunk.error.code ?? 500, { error: chunk.error });
      if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
      const cand = chunk.candidates?.[0];
      if (!cand) return;
      for (const p of cand.content?.parts ?? []) if (!p.thought && typeof p.text === 'string') text += p.text;
      if (cand.finishReason) finishReason = cand.finishReason;
      if (cand.groundingMetadata?.groundingChunks?.length || cand.groundingMetadata?.searchEntryPoint) grounding = cand.groundingMetadata;
      opts.onText?.(text);
    };
    const consume = (buffer: string): string => {
      const events = buffer.split(/\r?\n\r?\n/);
      const rest = events.pop() ?? '';
      for (const ev of events) {
        const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (data) handle(data);
      }
      return rest;
    };

    if (!res.body) {
      consume((await res.text()) + '\n\n');
    } else {
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
        consume(buf + dec.decode() + '\n\n');
      } catch (e) {
        if (e instanceof GeminiError) throw e;
        // interruzione a metà: se è già arrivato del testo lo si mostra come risposta troncata
        if (!text.trim()) fail();
        finishReason = 'MAX_TOKENS';
      }
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  return parseGeminiResponse({
    candidates: text || finishReason ? [{ content: { parts: [{ text }] }, finishReason, groundingMetadata: grounding }] : [],
    promptFeedback: blockReason ? { blockReason } : undefined
  });
}

/** Verifica chiave e modello senza consumare quota di generazione (GET models/{modello}). */
export async function checkModel(opts: CallOptions): Promise<{ name: string; displayName?: string }> {
  const json = (await requestJson(
    `${GEMINI_ENDPOINT}/models/${encodeURIComponent(cleanModelName(opts.model))}`,
    { method: 'GET' },
    opts
  )) as { name: string; displayName?: string };
  return json;
}

// ============================================================ modelli disponibili

export interface ModelInfo {
  /** "gemini-2.5-flash" (senza il prefisso "models/") */
  id: string;
  displayName: string;
}

interface RawModel {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

/** Elenco dei modelli che la chiave può usare per generare testo. */
export async function listModels(opts: CallOptions): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const json = (await requestJson(
      `${GEMINI_ENDPOINT}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      { method: 'GET' },
      opts
    )) as { models?: RawModel[]; nextPageToken?: string };
    for (const m of json.models ?? []) {
      if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue;
      out.push({ id: cleanModelName(m.name), displayName: m.displayName || cleanModelName(m.name) });
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

/** Modelli adatti all'app: testo e immagini in ingresso, risposta testuale (niente audio, immagini, embedding…). */
const NOT_SUITABLE = /(image|tts|audio|live|embed|aqa|imagen|veo|learnlm|gemma|robotics|computer-use|native|thinking-exp|nano|banana)/i;

/**
 * Ordine in cui provare i modelli quando uno ha esaurito la quota gratuita: prima i Gemini
 * consigliati, poi i Gemma più grandi (che leggono le foto: niente versioni da 1B).
 */
export function fallbackModels(models: ModelInfo[]): ModelInfo[] {
  const size = (id: string) => Number(id.match(/-(\d+)b\b/i)?.[1] ?? 0);
  const gver = (id: string) => Number(id.match(/gemma-(\d+(?:\.\d+)?)/i)?.[1] ?? 0);
  const gemma = models
    .filter((m) => /^gemma-\d/i.test(m.id) && size(m.id) >= 4 && !/-e\d+b|embed|\bn\b|-3n-/i.test(m.id))
    .sort((a, b) => gver(b.id) - gver(a.id) || size(b.id) - size(a.id));
  return [...rankModels(models), ...gemma];
}

function versionOf(id: string): number {
  const m = id.match(/gemini-(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Ordina i modelli dal più consigliato: Flash stabile più recente, poi Flash-Lite, poi Pro;
 * versioni "preview"/"exp" e alias "-latest" in coda.
 */
export function rankModels(models: ModelInfo[]): ModelInfo[] {
  const score = (id: string) => {
    let s = versionOf(id) * 10;
    if (/flash-lite/i.test(id)) s += 50;
    else if (/flash/i.test(id)) s += 100;
    else if (/pro/i.test(id)) s += 30;
    if (/latest/i.test(id)) s -= 5;
    if (/preview|exp/i.test(id)) s -= 200;
    if (/-\d{3}$|-\d{2}-\d{4}$/.test(id)) s -= 1; // versioni datate/numerate dopo l'alias stabile
    return s;
  };
  const seen = new Set<string>();
  return models
    .filter((m) => /^gemini/i.test(m.id) && !NOT_SUITABLE.test(m.id) && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => score(b.id) - score(a.id) || a.id.localeCompare(b.id));
}

async function requestJson(url: string, init: RequestInit, opts: CallOptions): Promise<unknown> {
  if (!opts.apiKey.trim()) throw new GeminiError('chiave', 'Manca la chiave API Gemini: inseriscila nelle Impostazioni.');
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, opts.timeoutMs ?? 30000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await doFetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), 'x-goog-api-key': opts.apiKey.trim() },
      signal: ctrl.signal
    });
  } catch {
    if (timedOut) throw new GeminiError('timeout', 'Gemini non ha risposto in tempo. Riprova o semplifica la domanda.');
    if (opts.signal?.aborted) throw new GeminiError('annullata', 'Richiesta annullata.');
    throw new GeminiError('rete', 'Impossibile contattare Gemini: controlla la connessione.');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* corpo non JSON */
  }
  if (!res.ok) throw classifyHttpError(res.status, body);
  return body;
}

// ============================================================ citazioni nel testo

/** Parte di una riga di testo: testo semplice o citazione di un record. */
export type CitedPart = { type: 'text'; text: string } | { type: 'cite'; ids: string[] };

/**
 * Trova le citazioni [id] nel testo e le separa dal resto, riconoscendo solo id noti
 * (quelli dei blocchi inviati). Accetta anche [id: x], [x, y], [x; y].
 * I contenuti tra parentesi non riconosciuti restano testo normale.
 */
export function splitCitations(text: string, knownIds: Set<string>): CitedPart[] {
  const out: CitedPart[] = [];
  let last = 0;
  const re = /\[([^\[\]\n]{1,300})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // [testo](url) è un link markdown, non una citazione
    if (text[m.index + m[0].length] === '(') continue;
    const ids = m[1]
      .split(/[,;]|\s+e\s+/)
      .map((s) => s.trim().replace(/^(id|record|fonte)\s*:\s*/i, '').replace(/^`|`$/g, '').trim())
      .filter(Boolean);
    if (!ids.length || !ids.every((id) => knownIds.has(id))) continue;
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    // citazioni consecutive [a][b] si uniscono
    const prev = out[out.length - 1];
    if (prev?.type === 'cite' && m.index === last) prev.ids.push(...ids.filter((id) => !prev.ids.includes(id)));
    else out.push({ type: 'cite', ids: [...new Set(ids)] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Id dei record effettivamente citati nella risposta, nell'ordine di prima comparsa. */
export function citedIds(text: string, knownIds: Set<string>): string[] {
  const ids: string[] = [];
  for (const p of splitCitations(text, knownIds)) {
    if (p.type === 'cite') for (const id of p.ids) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
