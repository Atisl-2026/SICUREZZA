import { articleHref, passageInfo } from '../lib/articles';
import type { LocalResult } from '../lib/search';
import { headingText } from '../shared/articles.ts';

/**
 * Articoli di un passaggio in verde chiaro: quelli in cui compare la parola cercata (o, se nessuno,
 * quello del passaggio). Clic → articolo nel documento; ↗ → testo ufficiale online.
 */
export function ArticleBadges({ r, withDoc = false, max = 6 }: { r: LocalResult; withDoc?: boolean; max?: number }) {
  const info = passageInfo(r);
  const withWord = info.articoli.filter((a) => a.conParola);
  const articoli = (withWord.length ? withWord : info.articoli.slice(0, 1)).slice(0, max);
  if (!articoli.length) return null;
  return (
    <div class="result-articles">
      {articoli.map((a) => (
        <span key={a.section.pos} class="art-badge">
          <a href={articleHref(r.record.id, a.section.pos, r.terms)} title={`Apri l'articolo in «${r.record.titolo}»`}>
            {headingText(a.section)}{withDoc ? <span class="art-doc"> · {r.record.titolo}</span> : null}
          </a>
          {a.online && (
            <a class="art-online" href={a.online} target="_blank" rel="noopener noreferrer" title="Testo ufficiale online (Normattiva)" aria-label={`${a.section.label} sul testo ufficiale online`}>↗</a>
          )}
        </span>
      ))}
    </div>
  );
}
