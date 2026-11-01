import { articleHref, articlesByRecord } from '../lib/articles';
import { recordHref } from '../lib/route';
import type { LocalResult } from '../lib/search';
import { onlineDocumentUrl } from '../shared/articles.ts';

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** Documenti citati nella risposta: titolo (apre la scheda), articoli dei brani consultati (collegati) e fonte. */
export function CitedDocs({ cited, results, title }: { cited: string[]; results: LocalResult[]; title: string }) {
  if (!cited.length) return null;
  const recs = new Map(results.map((r) => [r.record.id, r.record]));
  const arts = articlesByRecord(results);
  const terms = [...new Set(results.flatMap((r) => r.terms))];
  return (
    <div class="cited">
      <h4>{title}</h4>
      <ol>
        {cited.map((id) => {
          const r = recs.get(id);
          const a = arts.get(id) ?? [];
          const online = r && onlineDocumentUrl(r);
          return (
            <li key={id}>
              <a href={recordHref(id)}>{r?.titolo ?? id}</a>
              {a.length > 0 && (
                <div class="cited-meta">
                  Articoli dei brani consultati:{' '}
                  {a.map((x, i) => (
                    <span key={x.pos}>
                      {i > 0 && ', '}
                      <a class="art-link" href={articleHref(id, x.pos, terms)} title={x.titolo || x.label}>{x.label}</a>
                    </span>
                  ))}
                </div>
              )}
              {r?.fonte && (
                <div class="cited-meta">
                  Fonte: {isUrl(r.fonte) ? <a href={r.fonte} target="_blank" rel="noopener noreferrer">{r.fonte}</a> : r.fonte}
                </div>
              )}
              {online && !isUrl(r?.fonte ?? '') && (
                <div class="cited-meta">
                  Testo ufficiale: <a href={online} target="_blank" rel="noopener noreferrer">Normattiva ↗</a>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
