import { useState } from 'preact/hooks';
import { recordHref } from '../lib/route';
import type { LocalResult } from '../lib/search';
import { highlight, snippet } from '../shared/search.ts';
import { formatDate } from '../lib/format';
import { Highlighted } from './Highlighted';
import { passageInfo, passagePage } from '../lib/articles';
import { ArticleBadges } from './ArticleBadges';

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** Scheda di un blocco trovato: titolo, fonte, estratto con termini evidenziati. */
export function ResultCard({ r, index }: { r: LocalResult; index: number | string }) {
  const [open, setOpen] = useState(false);
  const info = passageInfo(r);
  const page = passagePage(r);
  const short = snippet(r.chunk.testo, r.terms, 320, r.phrases, info.headRanges);
  const truncated = short.some((s) => s.text === '… ' || s.text === ' …');


  return (
    <article class="card result-card" aria-labelledby={`res-${index}`}>
      <header>
        <a id={`res-${index}`} class="result-title" href={recordHref(r.record.id)}>{r.record.titolo}</a>
        <div class="result-meta">
          <span class="chip">{r.record.categoria}</span>
          {r.record.data_aggiornamento && <span>{formatDate(r.record.data_aggiornamento)}</span>}
          {page != null && <span class="page-ref" title="Pagina del documento PDF">pag. {page}</span>}
        </div>
        <ArticleBadges r={r} />
      </header>
      <p class="result-text">
        <Highlighted segments={open ? highlight(r.chunk.testo, r.terms, info.headRanges) : short} />
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
