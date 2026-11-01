import type { Segment } from '../shared/search.ts';

/**
 * Testo con le parole cercate evidenziate in giallo (<mark>) e le intestazioni degli articoli
 * in verde chiaro; le righe vuote vengono compattate.
 */
export function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        const text = s.mark ? s.text : s.text.replace(/\n\s*\n/g, '\n');
        if (s.mark) return <mark key={i} class={s.art ? 'in-art' : undefined}>{text}</mark>;
        if (s.art) return <span key={i} class="art-hl">{text}</span>;
        return text;
      })}
    </>
  );
}
