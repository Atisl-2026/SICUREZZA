import { useEffect, useState } from 'preact/hooks';
import { loadMatches, type AllMatches, type DocMatches, type LocalResult } from '../lib/search';
import { recordHref } from '../lib/route';
import { ResultCard } from './ResultCard';

const PAGE = 10;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('it-IT')} ${n === 1 ? one : many}`;

/**
 * Tutti i passaggi trovati nell'archivio, raggruppati per documento e nell'ordine del testo,
 * con il numero di volte in cui compaiono le parole cercate (come "Trova" in un documento).
 */
export function AllResults({ data, label, multi = false, title = 'Tutti i risultati nell\'archivio' }: {
  data: AllMatches;
  /** cosa è stato cercato, es. «preposto» */
  label: string;
  /** più parole: «compaiono» invece di «compare» */
  multi?: boolean;
  title?: string;
}) {
  const single = data.documenti.length === 1;
  // parola non trovata: si contano le parole simili
  const simili = data.simili.length > 0 && !multi;
  const what = simili ? `Le parole simili a ${label}` : label;
  return (
    <section class="answer-section all-results" aria-label={title}>
      <h3 class="section-title">{title}</h3>
      {data.simili.length > 0 && (
        <p class="notice small" role="note">
          {data.simili.map((w) => `«${w}»`).join(', ')} non compare nell'archivio: mostro le parole più simili.
        </p>
      )}
      {data.passaggi === 0 ? (
        <div class="card"><p class="muted">Nessun passaggio trovato.</p></div>
      ) : (
        <>
          <p class="all-summary">
            {data.occorrenze > 0 && <><strong>{what}</strong> {multi || simili ? 'compaiono' : 'compare'} <strong>{plural(data.occorrenze, 'volta', 'volte')}</strong> · </>}
            {plural(data.passaggi, 'passaggio', 'passaggi')} in {plural(data.documenti.length, 'documento', 'documenti')}
            {data.forme.length > 1 && (
              <span class="all-forms small">
                {data.forme.slice(0, 6).map(([f, n]) => `${f} ${n.toLocaleString('it-IT')}`).join(' · ')}
                {data.forme.length > 6 ? ' · …' : ''}
              </span>
            )}
            {!data.conTutte && <span class="muted"> (nessun passaggio contiene tutte le parole: mostro quelli che ne contengono almeno una)</span>}
          </p>
          {data.documenti.map((d, i) => <DocGroup key={d.recordId} d={d} phrases={data.phrases} open={single || i === 0} />)}
        </>
      )}
    </section>
  );
}

function DocGroup({ d, phrases, open }: { d: DocMatches; phrases: string[]; open: boolean }) {
  const [isOpen, setOpen] = useState(open);
  const [shown, setShown] = useState<LocalResult[]>([]);
  const [busy, setBusy] = useState(false);

  const more = async () => {
    setBusy(true);
    const next = await loadMatches(d.passaggi.slice(shown.length, shown.length + PAGE), phrases);
    setShown((s) => [...s, ...next]);
    setBusy(false);
  };

  useEffect(() => {
    if (isOpen && !shown.length) more();
  }, [isOpen]);

  const rest = d.passaggi.length - shown.length;
  return (
    <details class="card doc-group" open={isOpen} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span class="doc-title">{d.titolo}</span>
        <span class="small muted">
          {d.categoria} · {plural(d.passaggi.length, 'passaggio', 'passaggi')}
          {d.occorrenze > 0 && ` · ${plural(d.occorrenze, 'volta', 'volte')}`}
          {d.forme.length > 1 && ` (${d.forme.slice(0, 4).map(([f, n]) => `${f} ${n.toLocaleString('it-IT')}`).join(', ')})`}
        </span>
      </summary>
      {isOpen && (
        <div class="doc-passages">
          {shown.map((r, i) => <ResultCard key={r.chunkId} r={r} index={`${d.recordId}-${i}`} />)}
          {busy && <p class="muted small"><span class="spinner" aria-hidden="true" /> Caricamento…</p>}
          {!busy && rest > 0 && (
            <button type="button" class="btn btn-block" onClick={more}>
              Mostra altri {Math.min(PAGE, rest)} (ne restano {rest.toLocaleString('it-IT')})
            </button>
          )}
          <a class="link-btn" href={recordHref(d.recordId)}>Apri il documento completo</a>
        </div>
      )}
    </details>
  );
}
