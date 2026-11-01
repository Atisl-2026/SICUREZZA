import { useState } from 'preact/hooks';
import { recordHref } from '../lib/route';
import type { LocalResult } from '../lib/search';
import { highlight, snippet } from '../shared/search.ts';
import { formatDate } from '../lib/format';
import { Highlighted } from './Highlighted';
import { articleHref, passageInfo } from '../lib/articles';
import { headingText } from '../shared/articles.ts';

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** Scheda di un blocco trovato: titolo, fonte, estratto con termini evidenziati. */
export function ResultCard({ r, index }: { r: LocalResult; index: number | string }) {
  const [open, setOpen] = useState(false);
  const info = passageInfo(r);
  const short = snippet(r.chunk.testo, r.terms, 320, r.phrases, info.headRanges);
  const truncated = short.some((s) => s.text === '… ' || s.text === ' …');
  // gli articoli in cui compare la parola cercata; se nessuno (parola solo nel titolo) quello del brano
  const withWord = info.articoli.filter((a) => a.conParola);
  const articoli = withWord.length ? withWord : info.articoli.slice(0, 1);

  return (
    <article class="card result-card" aria-labelledby={`res-${index}`}>
      <header>
        <a id={`res-${index}`} class="result-title" href={recordHref(r.record.id)}>{r.record.titolo}</a>
        <div class="result-meta">
          <span class="chip">{r.record.categoria}</span>
          {r.record.data_aggiornamento && <span>{formatDate(r.record.data_aggiornamento)}</span>}
          {r.chunk.n > 0 && <span>parte {r.chunk.n + 1}</span>}
        </div>
        {articoli.length > 0 && (
          <div class="result-articles">
            {articoli.map((a) => (
              <span key={a.section.pos} class="art-badge">
                <a href={articleHref(r.record.id, a.section.pos, r.terms)} title="Apri l'articolo nel documento">{headingText(a.section)}</a>
                {a.online && (
                  <a class="art-online" href={a.online} target="_blank" rel="noopener noreferrer" title="Testo ufficiale online (Normattiva)" aria-label={`${a.section.label} sul testo ufficiale online`}>↗</a>
                )}
              </span>
            ))}
          </div>
        )}
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
