// Articoli e allegati di un documento normativo: per ogni brano trovato si ricava a quale articolo
// (o allegato) appartiene, così l'AI può citare "Art. 126 – Parapetti" oltre al documento.
// Il brano spesso inizia a metà di un articolo e non ne contiene l'intestazione: la si cerca
// nel testo completo della scheda, prima del punto in cui inizia il brano.

export interface Heading {
  /** posizione nel testo */
  pos: number;
  /** "Art. 126" oppure "Allegato XVIII" */
  label: string;
  /** titolo dell'articolo, se presente (es. "Parapetti") */
  titolo: string;
}

const SUFFIX = String.raw`(?:\s*[-.]?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?`;
// intestazione di articolo: a inizio riga o dopo la fine di una frase, mai dentro un rinvio ("ai sensi dell'art. 18")
const ART = new RegExp(String.raw`(^|\n|[.;:]\s+)[ \t>*#-]*(Art(?:icolo)?\.?|ART(?:ICOLO)?\.?)\s*(\d+${SUFFIX})\b([^\n]*)`, 'g');
// intestazione di allegato: solo a inizio riga (i rinvii agli allegati sono frequenti nel testo)
const ALL = new RegExp(String.raw`(^|\n)[ \t>*#-]*(Allegato|ALLEGATO)\s+([IVXLC]+|\d+)${SUFFIX}\b([^\n]*)`, 'g');

const tidyNum = (n: string) => n.replace(/\s*[-.]?\s*(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)$/i, (_, s: string) => `-${s.toLowerCase()}`);

/** Titolo dopo il numero: "- Parapetti" → "Parapetti"; se la riga è già il testo dell'articolo, nessun titolo. */
function headingTitle(rest: string, nextLine: string): string {
  let t = rest.replace(/^[\s.\-–—:)]+/, '').trim();
  if (!t) {
    // titolo sulla riga successiva (formato frequente nei testi coordinati)
    const n = nextLine.trim();
    t = n && n.length <= 90 && !/^(\d|comma\b|[a-z]\))/i.test(n) ? n : '';
  }
  if (t.length > 90) {
    // titolo e testo sulla stessa riga ("Parapetti 1. Gli impalcati…"); altrimenti è già il testo: nessun titolo
    t = t.match(/^(.{3,90}?)\s+1[.)]\s/)?.[1] ?? '';
  }
  return t.replace(/[\s.;:]+$/, '').replace(/^\((.*)\)$/, '$1').trim();
}

/** Intestazioni di articoli e allegati, nell'ordine del testo. */
export function findHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  const nextLineAt = (i: number) => {
    const nl = text.indexOf('\n', i);
    if (nl < 0) return '';
    let j = nl + 1;
    while (text[j] === '\n') j++;
    const end = text.indexOf('\n', j);
    return text.slice(j, end < 0 ? undefined : end);
  };
  for (const m of text.matchAll(ART)) {
    const pos = m.index! + m[1].length;
    out.push({ pos, label: `Art. ${tidyNum(m[3])}`, titolo: headingTitle(m[4], nextLineAt(pos)) });
  }
  for (const m of text.matchAll(ALL)) {
    const pos = m.index! + m[1].length;
    out.push({ pos, label: `Allegato ${tidyNum(m[3]).toUpperCase().replace(/-(BIS|TER|QUATER)$/, (s) => s.toLowerCase())}`, titolo: headingTitle(m[4], nextLineAt(pos)) });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

export const headingText = (h: Pick<Heading, 'label' | 'titolo'>) => (h.titolo ? `${h.label} – ${h.titolo}` : h.label);

export interface ChunkArticles {
  /** articolo/allegato in cui inizia il brano (anche se l'intestazione è prima del brano) */
  inizio?: string;
  /** articoli/allegati che iniziano dentro il brano */
  nelBrano: string[];
}

/** A quali articoli appartiene un brano del testo completo di una scheda. */
export function articlesForChunk(fullText: string, chunk: string, headings = findHeadings(fullText)): ChunkArticles {
  if (!headings.length) return { nelBrano: [] };
  const text = fullText;
  let start = text.indexOf(chunk);
  if (start < 0) start = text.indexOf(chunk.slice(0, 80));
  if (start < 0) return { nelBrano: [] };
  const end = start + chunk.length;
  let current: Heading | undefined;
  const inside: Heading[] = [];
  for (const h of headings) {
    if (h.pos <= start) current = h;
    else if (h.pos < end) inside.push(h);
  }
  // se il brano inizia proprio con un'intestazione, quella è l'articolo d'inizio
  if (inside.length && /^\s*$/.test(text.slice(start, inside[0].pos))) current = inside.shift();
  return { inizio: current && headingText(current), nelBrano: inside.map(headingText) };
}
