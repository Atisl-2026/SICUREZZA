import type { ComponentChildren } from 'preact';
import { parseMarkdown, type Inline } from '../shared/markdown.ts';
import { recordHref } from '../lib/route';
import { ARTICLE_REF, refLabel } from '../shared/articles.ts';
import { highlight } from '../shared/search.ts';

interface Props {
  text: string;
  /** id dei record citabili: le citazioni [id] diventano link al record. */
  ids?: Set<string>;
  /** etichetta breve per ogni id citato (es. numero o titolo). */
  label?: (id: string) => string;
  titleOf?: (id: string) => string;
  /** parole cercate da evidenziare in giallo (già normalizzate) */
  terms?: string[];
  /**
   * Riferimenti ad articoli («Art. 19, comma 1») evidenziati in verde chiaro; se la funzione
   * restituisce un indirizzo diventano collegamenti (ids = documenti citati vicino al riferimento).
   */
  articleLink?: (label: string, ids: string[]) => string | undefined;
}

/** Testo con articoli in verde (eventualmente collegati) e parole cercate in giallo. */
function decorate(v: string, terms: string[], ids: string[], articleLink?: Props['articleLink']): ComponentChildren {
  const refs = [...v.matchAll(ARTICLE_REF)].map((m) => ({ a: m.index!, b: m.index! + m[0].length, label: refLabel(m) }));
  if (!refs.length && !terms.length) return v;
  const segs = highlight(v, terms, refs.map((r) => [r.a, r.b] as [number, number]));
  let pos = 0;
  return segs.map((sg, i) => {
    const at = pos;
    pos += sg.text.length;
    if (!sg.art) return sg.mark ? <mark key={i}>{sg.text}</mark> : sg.text;
    const ref = refs.find((r) => at >= r.a && at < r.b)!;
    const body = sg.mark ? <mark class="in-art">{sg.text}</mark> : sg.text;
    const href = articleLink?.(ref.label, ids);
    return href
      ? <a key={i} class="art-ref" href={href} title={`Apri ${ref.label} nel documento`}>{body}</a>
      : <span key={i} class="art-ref">{body}</span>;
  });
}

/** Rende il Markdown di Gemini come elementi Preact (mai innerHTML). */
export function Markdown({ text, ids = new Set(), label = (id) => id, titleOf = (id) => id, terms = [], articleLink }: Props) {
  // documenti citati vicino a un testo: prima la citazione che segue, altrimenti quella che precede
  const citesNear = (nodes: Inline[], i: number, outer: string[]): string[] => {
    for (let j = i + 1; j < nodes.length; j++) { const n = nodes[j]; if (n.t === 'cite') return n.ids; }
    for (let j = i - 1; j >= 0; j--) { const n = nodes[j]; if (n.t === 'cite') return n.ids; }
    return outer;
  };
  const inline = (nodes: Inline[], outer: string[] = []): ComponentChildren =>
    nodes.map((n, i) => {
      switch (n.t) {
        // il numero di citazione resta attaccato alla parola che lo precede (niente "1" a capo da solo)
        case 'text': {
          const v = nodes[i + 1]?.t === 'cite' ? n.v.replace(/\s+$/, '\u00a0') : n.v;
          return decorate(v, terms, citesNear(nodes, i, outer), articleLink);
        }
        case 'strong': return <strong key={i}>{inline(n.c, citesNear(nodes, i, outer))}</strong>;
        case 'em': return <em key={i}>{inline(n.c, citesNear(nodes, i, outer))}</em>;
        case 'code': return <code key={i}>{n.v}</code>;
        case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{inline(n.c)}</a>;
        case 'cite':
          return (
            <span key={i} class="cites">
              {n.ids.map((id) => (
                <a key={id} class="cite" href={recordHref(id)} title={titleOf(id)} aria-label={`Fonte: ${titleOf(id)}`}>
                  {label(id)}
                </a>
              ))}
            </span>
          );
      }
    });

  return (
    <div class="md">
      {parseMarkdown(text, ids).map((b, i) => {
        switch (b.t) {
          case 'h': return <h4 key={i}>{inline(b.c)}</h4>;
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
          case 'ol': return <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
          case 'p':
            return (
              <p key={i}>
                {b.lines.map((l, j) => <>{j > 0 && <br />}{inline(l)}</>)}
              </p>
            );
        }
      })}
    </div>
  );
}
