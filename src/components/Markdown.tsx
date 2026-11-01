import type { ComponentChildren } from 'preact';
import { parseMarkdown, type Inline } from '../shared/markdown.ts';
import { recordHref } from '../lib/route';

interface Props {
  text: string;
  /** id dei record citabili: le citazioni [id] diventano link al record. */
  ids?: Set<string>;
  /** etichetta breve per ogni id citato (es. numero o titolo). */
  label?: (id: string) => string;
  titleOf?: (id: string) => string;
}

/** Rende il Markdown di Gemini come elementi Preact (mai innerHTML). */
export function Markdown({ text, ids = new Set(), label = (id) => id, titleOf = (id) => id }: Props) {
  const inline = (nodes: Inline[]): ComponentChildren =>
    nodes.map((n, i) => {
      switch (n.t) {
        // il numero di citazione resta attaccato alla parola che lo precede (niente "1" a capo da solo)
        case 'text': return nodes[i + 1]?.t === 'cite' ? n.v.replace(/\s+$/, '\u00a0') : n.v;
        case 'strong': return <strong key={i}>{inline(n.c)}</strong>;
        case 'em': return <em key={i}>{inline(n.c)}</em>;
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
