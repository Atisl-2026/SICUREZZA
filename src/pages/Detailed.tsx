import { useEffect, useRef, useState } from 'preact/hooks';
import { AllResults } from '../components/AllResults';
import { TopicFilter } from '../components/TopicFilter';
import { allDetailedMatches, searchScope, type AllMatches } from '../lib/search';
import { EMPTY_DETAILED, isDetailedEmpty, wordsOf, type DetailedQuery } from '../shared/search.ts';

interface Form {
  all: string;
  phrases: string;
  any: string;
  none: string;
  exact: boolean;
}

const EMPTY_FORM: Form = { all: '', phrases: '', any: '', none: '', exact: false };

// Lo stato sopravvive al cambio di scheda.
let saved: { form: Form; result: AllMatches | null; label: { label: string; multi: boolean } } = {
  form: EMPTY_FORM, result: null, label: { label: '', multi: true }
};

/** Cosa è stato cercato, per il riepilogo («preposto», «tavola fermapiede» o «le parole cercate»). */
function labelOf(q: DetailedQuery): { label: string; multi: boolean } {
  const words = [...wordsOf(q.all), ...wordsOf(q.any)];
  if (q.phrases.length === 1 && !words.length) return { label: `«${q.phrases[0]}»`, multi: false };
  if (!q.phrases.length && words.length === 1) return { label: `«${words[0]}»`, multi: false };
  return { label: 'Le parole cercate', multi: true };
}

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
  const [result, setResult] = useState<AllMatches | null>(saved.result);
  const [label, setLabel] = useState(saved.label);
  const [busy, setBusy] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saved = { form, result, label }; }, [form, result, label]);

  const set = (k: keyof Form) => (e: Event) => {
    const t = e.target as HTMLInputElement;
    setForm({ ...form, [k]: k === 'exact' ? t.checked : t.value });
  };

  const run = async () => {
    setBusy(true);
    const { categorie, documento } = await searchScope();
    const q = toQuery(form);
    setResult(await allDetailedMatches(q, categorie, documento));
    setLabel(labelOf(q));
    setBusy(false);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
          {result.passaggi === 0 && result.simili.length === 0 ? (
            <>
              <h3 class="section-title">Risultati</h3>
              <div class="card">
                <p class="muted">Nessun passaggio soddisfa tutte le condizioni. Prova a togliere una parola, a spegnere «Solo parole esatte» o a cercare in tutti gli argomenti.</p>
              </div>
            </>
          ) : (
            <AllResults data={result} label={label.label} multi={label.multi} title="Risultati" />
          )}
        </div>
      )}
    </section>
  );
}
