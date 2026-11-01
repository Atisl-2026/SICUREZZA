import { useEffect, useRef, useState } from 'preact/hooks';
import { DbSection, WebSection, type AiUnavailable } from '../components/Answer';
import { IconSend } from '../components/Icons';
import { askDatabase, askWeb, type AiState } from '../lib/ai';
import { hasAi } from '../lib/router';
import { aiAllowed, getAccess, type Accesso } from '../lib/access';
import { db } from '../lib/db';
import { addToHistory, clearHistory, removeFromHistory, useHistory } from '../lib/history';
import { useLiveQuery } from '../lib/live';
import { allMatches, searchLocal, searchScope, type AllMatches, type LocalResult } from '../lib/search';
import { AllResults } from '../components/AllResults';
import { parseSimpleQuery, wordsOf } from '../shared/search.ts';
import { useRoute } from '../lib/route';
import { PhotoPage } from './Photo';
import { DetailedPage } from './Detailed';
import { TopicFilter } from '../components/TopicFilter';
import { getSettings, updateSettings, useSettings } from '../lib/settings';

interface Props {
  online: boolean;
  access: Accesso;
}

interface AskState {
  draft: string;
  asked: string;
  results: LocalResult[] | null;
  /** tutti i passaggi trovati, per documento */
  all: AllMatches | null;
  dbAi: AiState;
  webAi: AiState;
  unavailable: AiUnavailable;
}

const IDLE: AiState = { status: 'idle' };

// Lo stato sopravvive al cambio di scheda (il componente viene smontato).
let saved: AskState = { draft: '', asked: '', results: null, all: null, dbAi: IDLE, webAi: IDLE, unavailable: null };
let inflight: AbortController | null = null;

/** Cosa è stato cercato, per il riepilogo: «preposto», «tavola fermapiede» o «le parole cercate». */
function searchLabel(q: string): { label: string; multi: boolean } {
  const p = parseSimpleQuery(q);
  const words = wordsOf(p.text);
  if (p.phrases.length === 1 && !words.length) return { label: `«${p.phrases[0]}»`, multi: false };
  if (!p.phrases.length && words.length === 1) return { label: `«${words[0]}»`, multi: false };
  return { label: 'Le parole cercate', multi: true };
}

/** Scheda Chiedi: domande sull'archivio, oppure analisi foto (#chiedi/foto, solo con l'AI). */
export function AskPage(props: Props) {
  const route = useRoute();
  if (route[1] === 'foto' && aiAllowed(props.access)) return <PhotoPage online={props.online} />;
  const detailed = route[1] === 'dettagliata';
  return (
    <>
      <nav class="mode-switch" aria-label="Tipo di ricerca">
        <a href="#chiedi" aria-current={detailed ? undefined : 'page'}>Domanda</a>
        <a href="#chiedi/dettagliata" aria-current={detailed ? 'page' : undefined}>Ricerca dettagliata</a>
      </nav>
      {detailed ? <DetailedPage /> : <AskMain {...props} />}
    </>
  );
}

function AskMain({ online, access }: Props) {
  const [draft, setDraft] = useState(saved.draft);
  const [asked, setAsked] = useState(saved.asked);
  const [results, setResults] = useState<LocalResult[] | null>(saved.results);
  const [all, setAll] = useState<AllMatches | null>(saved.all);
  const [dbAi, setDbAi] = useState<AiState>(saved.dbAi);
  const [webAi, setWebAi] = useState<AiState>(saved.webAi);
  const [unavailable, setUnavailable] = useState<AiUnavailable>(saved.unavailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const settings = useSettings();
  const history = useHistory();
  const recordCount = useLiveQuery(() => db.records.count());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    saved = { draft, asked, results, all, dbAi, webAi, unavailable };
  }, [draft, asked, results, all, dbAi, webAi, unavailable]);

  // il campo cresce con il testo (fino al massimo definito nel CSS)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 4}px`;
  }, [draft]);

  /** Aggiorna lo stato anche se nel frattempo l'utente ha cambiato scheda. */
  const setAi = (which: 'db' | 'web', v: AiState) => {
    saved = { ...saved, [which === 'db' ? 'dbAi' : 'webAi']: v };
    if (mounted.current) (which === 'db' ? setDbAi : setWebAi)(v);
  };

  const runAi = async (question: string, res: LocalResult[], only?: 'db' | 'web') => {
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    const s = await getSettings();
    const isOnline = navigator.onLine;
    const why: AiUnavailable = !aiAllowed(await getAccess())
      ? 'nonabilitato'
      : !isOnline ? 'offline' : !hasAi(s) ? 'nokey' : null;
    setUnavailable(why);

    const jobs: Promise<void>[] = [];
    if (only !== 'web') {
      if (!why && res.length) {
        setAi('db', { status: 'loading' });
        let avviso: string | undefined;
        jobs.push(askDatabase(question, res, s, ctrl.signal, (partial) => {
          if (!ctrl.signal.aborted && partial.trim()) setAi('db', { status: 'loading', partial, avviso });
        }, (msg) => {
          // cambio di servizio AI: il testo ricomincia con il nuovo servizio
          avviso = msg;
          if (!ctrl.signal.aborted) setAi('db', { status: 'loading', avviso });
        }).then((v) => { if (!ctrl.signal.aborted) setAi('db', v); }));
      } else setAi('db', IDLE);
    }
    if (only !== 'db') {
      if (!why && s.webCheck && s.apiKey.trim()) {
        setAi('web', { status: 'loading' });
        jobs.push(askWeb(question, s, ctrl.signal).then((v) => {
          if (ctrl.signal.aborted) return;
          setAi('web', v);
          if (v.status === 'error' && v.disabledWeb) updateSettings({ webCheck: false });
        }));
      } else setAi('web', IDLE);
    }
    await Promise.all(jobs);
    if (inflight === ctrl) inflight = null;
  };

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setDraft(question);
    setBusy(true);
    setError('');
    inflight?.abort(); // la domanda precedente non serve più
    setAi('db', IDLE);
    setAi('web', IDLE);
    inputRef.current?.blur(); // chiude la tastiera su mobile
    try {
      const { categorie, documento } = await searchScope();
      // i passaggi più pertinenti (per l'AI) e tutti i passaggi trovati (per documento)
      const [res, tutti] = await Promise.all([searchLocal(question, { categorie, documento }), allMatches(question, categorie, documento)]);
      setAsked(question);
      setResults(res);
      setAll(tutti);
      addToHistory(question);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      runAi(question, res);
    } catch (e) {
      setError(`Errore durante la ricerca: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    inflight?.abort();
    setDraft('');
    setAsked('');
    setResults(null);
    setAll(null);
    setDbAi(IDLE);
    setWebAi(IDLE);
    inputRef.current?.focus();
  };

  const canAi = aiAllowed(access);
  const webOn = settings.webCheck && online;

  return (
    <section aria-labelledby="ask-title">
      <h2 id="ask-title" class="sr-only">Chiedi</h2>
      <form class="search-box" role="search" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <label for="q" class="sr-only">La tua domanda</label>
        <textarea
          id="q"
          ref={inputRef}
          rows={2}
          placeholder="Scrivi una domanda…"
          value={draft}
          enterkeyhint="search"
          autocomplete="off"
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              ask(draft);
            }
          }}
        />
        <button class="btn btn-primary" type="submit" aria-label="Cerca" disabled={!draft.trim() || busy}>
          {busy ? <span class="spinner" aria-hidden="true" /> : <IconSend />}
        </button>
      </form>
      <p class="search-hint small muted">
        Suggerimento: <code>"frase esatta"</code> tra virgolette, <code>-parola</code> per escludere.
      </p>
      <TopicFilter />

      {canAi && (
        <a class="card photo-entry" href="#chiedi/foto">
          <span class="photo-entry-icon" aria-hidden="true">📷</span>
          <span>
            <strong>Analizza una foto</strong>
            <span class="small muted">Ponteggi, cantieri, attrezzature: possibili criticità con le norme dell'archivio</span>
          </span>
          <span aria-hidden="true" class="photo-entry-arrow">›</span>
        </a>
      )}

      {canAi && <div class="card card-tight">
        <label class="switch">
          <span>
            Verifica anche sul web
            <br />
            <span class="muted small">
              {!online
                ? 'Disponibile quando sei online'
                : !settings.apiKey
                  ? 'Richiede la chiave Gemini (Impostazioni)'
                  : 'Seconda ricerca con Google tramite Gemini'}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={webOn}
            disabled={!online}
            onChange={(e) => updateSettings({ webCheck: (e.target as HTMLInputElement).checked })}
          />
        </label>
      </div>}

      {error && <p class="notice notice-error" role="alert">{error}</p>}

      {results && (
        <div ref={resultsRef} class="answer" aria-live="polite">
          <div class="answer-head">
            <p class="asked">«{asked}»</p>
            <button type="button" class="link-btn" onClick={reset}>Nuova domanda</button>
          </div>
          <DbSection
            results={results}
            ai={dbAi}
            unavailable={unavailable}
            recordCount={recordCount}
            onRetry={() => runAi(asked, results, 'db')}
          />
          {all && (all.passaggi > 0 || all.simili.length > 0) && <AllResults data={all} {...searchLabel(asked)} />}
          <WebSection ai={webAi} />
        </div>
      )}

      {history.length > 0 && (
        <div class="card card-flush history">
          <div class="history-head">
            <h3>Domande recenti</h3>
            <button type="button" class="link-btn" onClick={() => confirm('Cancellare la cronologia?') && clearHistory()}>
              Cancella
            </button>
          </div>
          <ul class="list">
            {history.slice(0, 10).map((h) => (
              <li key={h.t} class="history-item">
                <button type="button" onClick={() => ask(h.q)}>{h.q}</button>
                <button type="button" class="icon-btn" aria-label={`Rimuovi «${h.q}»`} onClick={() => removeFromHistory(h.q)}>×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {history.length === 0 && !results && (
        <p class="muted small center">Le domande che fai restano solo su questo dispositivo.</p>
      )}
    </section>
  );
}
