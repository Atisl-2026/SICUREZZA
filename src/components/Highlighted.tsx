import type { Segment } from '../shared/search.ts';

/** Testo con i termini trovati evidenziati (<mark>); le righe vuote vengono compattate. */
export function Highlighted({ segments }: { segments: Segment[] }) {
  return <>{segments.map((s, i) => (s.mark ? <mark key={i}>{s.text}</mark> : s.text.replace(/\n\s*\n/g, '\n')))}</>;
}
