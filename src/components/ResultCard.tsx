import { useState } from 'preact/hooks';
import { recordHref } from '../lib/route';
import type { LocalResult } from '../lib/search';
import { highlight, snippet } from '../shared/search.ts';
import { formatDate } from '../lib/format';
import { Highlighted } from './Highlighted';
import { articlesOf } from '../lib/ai';

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** Scheda di un blocco trovato: titolo, fonte, estratto con termini evidenziati. */
export function ResultCard({ r, index }: { r: LocalResult; index: number | string }) {
  const [open, setOpen] = useState(false);
  const short = snippet(r.chunk.testo, r.terms, 320, r.phrases);
  const truncated = short.some((s) => s.text === '… ' || s.text === ' …');
  const art = articlesOf(r);
  const articoli = [art.inizio, ...art.nelBrano].filter((x): x is string => !!x);

  return (
    <article class="card result-card" aria-labelledby={`res-${index}`}>
      <header>
        <a id={`res-${index}`} class="result-title" href={recordHref(r.record.id)}>{r.record.titolo}</a>
        <div class="result-meta">
          <span class="chip">{r.record.categoria}</span>
          {r.record.data_aggiornamento && <span>{formatDate(r.record.data_aggiornamento)}</span>}
          {r.chunk.n > 0 && <span>parte {r.chunk.n + 1}</span>}
        </div>
        {articoli.length > 0 && <div class="result-article">{articoli.join(' · ')}</div>}
      </header>
      <p class="result-text">
        <Highlighted segments={open ? highlight(r.chunk.testo, r.terms) : short} />
      </p>
      <footer class="result-footer">
        {r.record.fonte && (
          <span class="result-source">
            Fonte:{' '}
            {isUrl(r.record.fonte)
              ? <a href={r.record.fonte} target="_blank" rel="noopener noreferrer">{r.record.fonte}</a>
              : r.record.fonte}
          </span>
        )}
        {truncated && (
          <button type="button" class="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Mostra meno' : 'Mostra tutto il blocco'}
          </button>
        )}
      </footer>
    </article>
  );
}
