import { useEffect, useRef, useState } from 'preact/hooks';
import { IconSend } from '../components/Icons';
import { ResultCard } from '../components/ResultCard';
import { db } from '../lib/db';
import { addToHistory, clearHistory, removeFromHistory, useHistory } from '../lib/history';
import { useLiveQuery } from '../lib/live';
import { searchLocal, type LocalResult } from '../lib/search';
import { updateSettings, useSettings } from '../lib/settings';

interface Props {
  online: boolean;
}

interface AskState {
  draft: string;
  asked: string;
  results: LocalResult[] | null;
}

// Lo stato sopravvive al cambio di scheda (il componente viene smontato).
let saved: AskState = { draft: '', asked: '', results: null };

export function AskPage({ online }: Props) {
  const [draft, setDraft] = useState(saved.draft);
  const [asked, setAsked] = useState(saved.asked);
  const [results, setResults] = useState<LocalResult[] | null>(saved.results);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const settings = useSettings();
  const history = useHistory();
  const recordCount = useLiveQuery(() => db.records.count());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saved = { draft, asked, results };
  }, [draft, asked, results]);

  // il campo cresce con il testo (fino al massimo definito nel CSS)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 4}px`;
  }, [draft]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setDraft(question);
    setBusy(true);
    setError('');
    inputRef.current?.blur(); // chiude la tastiera su mobile
    try {
      const res = await searchLocal(question);
      setAsked(question);
      setResults(res);
      addToHistory(question);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      setError(`Errore durante la ricerca: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDraft('');
    setAsked('');
    setResults(null);
    inputRef.current?.focus();
  };

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

      <div class="card card-tight">
        <label class="switch">
          <span>
            Verifica anche sul web
            <br />
            <span class="muted small">
              {online ? 'Seconda ricerca con Google tramite Gemini' : 'Disponibile quando sei online'}
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
      </div>

      {error && <p class="notice notice-error" role="alert">{error}</p>}

      {results && (
        <div ref={resultsRef} class="answer" aria-live="polite">
          <div class="answer-head">
            <p class="asked">«{asked}»</p>
            <button type="button" class="link-btn" onClick={reset}>Nuova domanda</button>
          </div>

          <p class="ai-hint" role="note">
            {online ? 'Risposta AI: in arrivo nella prossima versione (chiave Gemini nelle Impostazioni).' : 'Risposta AI disponibile quando sei online.'}
          </p>

          <h3 class="section-title">
            Dal database <span class="muted small">· {results.length} {results.length === 1 ? 'blocco' : 'blocchi'}</span>
          </h3>
          {results.length === 0 && (
            <div class="card">
              {recordCount === 0 ? (
                <p>Il database è vuoto. <a href="#database">Importa dei contenuti</a> o controlla gli aggiornamenti.</p>
              ) : (
                <p class="muted">Nessun contenuto trovato per questa domanda. Prova con parole diverse o più generiche.</p>
              )}
            </div>
          )}
          {results.map((r, i) => <ResultCard key={r.chunkId} r={r} index={i} />)}
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
