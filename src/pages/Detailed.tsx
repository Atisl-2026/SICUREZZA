import { useEffect, useRef, useState } from 'preact/hooks';
import { ResultCard } from '../components/ResultCard';
import { TopicFilter } from '../components/TopicFilter';
import { searchDetailed, type DetailedResult } from '../lib/search';
import { getSettings } from '../lib/settings';
import { EMPTY_DETAILED, isDetailedEmpty, type DetailedQuery } from '../shared/search.ts';

interface Form {
  all: string;
  phrases: string;
  any: string;
  none: string;
  exact: boolean;
}

const EMPTY_FORM: Form = { all: '', phrases: '', any: '', none: '', exact: false };
const PAGE = 30;

// Lo stato sopravvive al cambio di scheda.
let saved: { form: Form; result: DetailedResult | null; limit: number } = { form: EMPTY_FORM, result: null, limit: PAGE };

export function toQuery(f: Form): DetailedQuery {
  return {
    ...EMPTY_DETAILED,
    all: f.all,
    // una frase per riga; accettate anche le virgolette
    phrases: f.phrases.split(/\n|["“”«»]/).map((p) => p.trim()).filter(Boolean),
    any: f.any,
    none: f.none,
    exact: f.exact
  };
}

/** Ricerca dettagliata: più parole e frasi, esclusioni, parole esatte, per argomento. Funziona offline. */
export function DetailedPage() {
  const [form, setForm] = useState<Form>(saved.form);
  const [result, setResult] = useState<DetailedResult | null>(saved.result);
  const [limit, setLimit] = useState(saved.limit);
  const [busy, setBusy] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saved = { form, result, limit }; }, [form, result, limit]);

  const set = (k: keyof Form) => (e: Event) => {
    const t = e.target as HTMLInputElement;
    setForm({ ...form, [k]: k === 'exact' ? t.checked : t.value });
  };

  const run = async (lim = PAGE) => {
    setBusy(true);
    const { categorie } = await getSettings();
    const r = await searchDetailed(toQuery(form), categorie, lim);
    setResult(r);
    setLimit(lim);
    setBusy(false);
    if (lim === PAGE) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const empty = isDetailedEmpty(toQuery(form));

  return (
    <section class="detailed">
      <form class="card detailed-form" onSubmit={(e) => { e.preventDefault(); if (!empty) run(); }}>
        <label class="field">
          <span>Tutte queste parole</span>
          <input value={form.all} onInput={set('all')} placeholder="es. ponteggio parapetto" autocapitalize="off" />
        </label>
        <label class="field">
          <span>Frasi esatte <span class="muted small">(una per riga)</span></span>
          <textarea rows={2} value={form.phrases} onInput={set('phrases')} placeholder={'es. tavola fermapiede\nmessa a terra'} />
        </label>
        <label class="field">
          <span>Almeno una di queste parole</span>
          <input value={form.any} onInput={set('any')} placeholder="es. cantiere edile" autocapitalize="off" />
        </label>
        <label class="field">
          <span>Escludi queste parole</span>
          <input value={form.none} onInput={set('none')} placeholder="es. trabattello" autocapitalize="off" />
        </label>
        <label class="check-row">
          <input type="checkbox" checked={form.exact} onChange={set('exact')} />
          <span>
            Solo parole esatte
            <br />
            <span class="muted small">Niente plurali, varianti o errori di battitura: «ponteggio» non trova «ponteggi».</span>
          </span>
        </label>
        <div class="btn-row detailed-actions">
          <button type="button" class="btn" disabled={busy} onClick={() => { setForm(EMPTY_FORM); setResult(null); }}>Azzera</button>
          <button type="submit" class="btn btn-primary" disabled={busy || empty}>{busy ? 'Ricerca…' : 'Cerca'}</button>
        </div>
        {empty && <p class="muted small">Compila almeno «Tutte queste parole», «Frasi esatte» o «Almeno una».</p>}
      </form>

      <TopicFilter />

      {result && (
        <div ref={resultsRef} class="answer" aria-live="polite">
          <h3 class="section-title">
            Risultati <span class="muted small">· {result.totale} {result.totale === 1 ? 'passaggio' : 'passaggi'}</span>
          </h3>
          {result.totale === 0 && (
            <div class="card">
              <p class="muted">Nessun passaggio soddisfa tutte le condizioni. Prova a togliere una parola, a spegnere «Solo parole esatte» o a cercare in tutti gli argomenti.</p>
            </div>
          )}
          {result.results.map((r, i) => <ResultCard key={r.chunkId} r={r} index={i} />)}
          {result.totale > result.results.length && result.results.length >= limit && (
            <button type="button" class="btn btn-block" disabled={busy} onClick={() => run(limit + PAGE)}>
              Mostra altri
            </button>
          )}
          {result.totale > result.results.length && result.results.length < limit && (
            <p class="muted small">Mostrati al massimo 3 passaggi per scheda: apri la scheda per leggere il resto.</p>
          )}
        </div>
      )}
    </section>
  );
}
