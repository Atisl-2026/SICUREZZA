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
  return t
    .replace(/(\p{Ll})\d{1,3}(?=[\s.;:]*$)/u, '$1') // numero di nota attaccato: «Valutazione dei rischi99»
    .replace(/[\s.;:]+$/, '')
    .replace(/^\((.*)\)$/, '$1')
    .trim();
}

const ART_INLINE = new RegExp(String.raw`Articolo\s+(\d+${SUFFIX})[ \t]+[-–][ \t]+(\p{Lu}[^\n]*)`, 'gu');
// puntini o trattini di riempimento delle voci d'indice
const TOC_LEADER = /\.{4,}|…{2,}|_{4,}/;
const REFERENCE_REST = /^\s*(?:[,;]|co\.|comm[ai]\b|lett(?:era)?\b|del(?:la|lo|l'|l’)?\b|dei\b|degli\b|delle\b|d\.\s?lgs|d\.p\.r|e\s+(?:art|\d))/i;

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
  // candidati: intestazioni a inizio riga / dopo fine frase, e «Articolo N - Titolo» anche a metà riga
  // (nei PDF l'intestazione finisce spesso in coda alla riga dei rimandi: «… Art. 206, co. 4 Articolo 14 - Provvedimenti»)
  const found = new Map<number, { num: string; rest: string }>();
  for (const m of text.matchAll(ART)) {
    // rimandi, non intestazioni: «Art. 2, co. 1, lett. a)», «Art. 65 del d.lgs. n. 81/2008», «art. 18 comma 2»
    if (REFERENCE_REST.test(m[4]) || TOC_LEADER.test(m[4])) continue;
    found.set(m.index! + m[1].length, { num: m[3], rest: m[4] });
  }
  for (const m of text.matchAll(ART_INLINE)) {
    // voci dell'indice («Articolo 1 - Finalità ........ 12») non sono intestazioni
    if (!found.has(m.index!) && !TOC_LEADER.test(m[2])) found.set(m.index!, { num: m[1], rest: m[2] });
  }
  let prev = 0;
  for (const [pos, { num: raw, rest }] of [...found].sort((a, b) => a[0] - b[0])) {
    let num = tidyNum(raw);
    const n = Number(num.match(/^\d+/)![0]);
    // numero della nota attaccato al numero dell'articolo nei PDF: «Articolo 206234» = art. 206 + nota 234
    if (n > prev + 15 && /^\d{4,}$/.test(num)) {
      for (let k = 1; k < num.length; k++) {
        const p = Number(num.slice(0, k));
        if (p >= prev && p <= prev + 15) { num = String(p); break; }
      }
    }
    const fixed = Number(num.match(/^\d+/)![0]);
    if (fixed < 1000) prev = fixed;
    out.push({ pos, label: `Art. ${num}`, titolo: headingTitle(rest, nextLineAt(pos)) });
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

// ============================================================ sezioni e collegamenti

/** Intestazione con la fine della sua sezione (inizio dell'intestazione successiva). */
export interface Section extends Heading {
  end: number;
  /** lunghezza della riga d'intestazione (per evidenziarla) */
  headLen: number;
}

export function sectionsOf(text: string, headings = findHeadings(text)): Section[] {
  return headings.map((h, i) => {
    const nl = text.indexOf('\n', h.pos);
    const lineEnd = nl < 0 ? text.length : nl;
    // intestazione e titolo: fino a fine riga, ma non oltre il titolo se il testo prosegue sulla stessa riga
    const head = headingText(h).length + 4;
    return { ...h, end: headings[i + 1]?.pos ?? text.length, headLen: Math.max(h.label.length, Math.min(lineEnd - h.pos, head + 20)) };
  });
}

/** Sezione che contiene la posizione (ultima intestazione prima di `pos`). */
export function sectionAt(sections: Section[], pos: number): Section | undefined {
  let lo = 0;
  let hi = sections.length - 1;
  let found: Section | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sections[mid].pos <= pos) { found = sections[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Posizione del brano nel testo completo (-1 se non trovato). */
export function chunkStart(fullText: string, chunk: string): number {
  const i = fullText.indexOf(chunk);
  return i >= 0 ? i : fullText.indexOf(chunk.slice(0, 80));
}

const NORMATTIVA_81 = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2008-04-09;81';

/** Il documento è il D.Lgs. 81/2008 (Testo unico sicurezza)? */
export function isDlgs81(r: { titolo: string; fonte: string }): boolean {
  const s = `${r.titolo} ${r.fonte}`;
  return /\b81\s*[/._-]\s*(?:20)?08\b/.test(s) && /d\.?\s*lgs|decreto|testo unico|\bt\.?u\b/i.test(s);
}

const isUrlText = (s: string) => /^https?:\/\//i.test(s.trim());

const artNum = (label: string) => Number(label.match(/^Art\. (\d+)/)?.[1] ?? NaN);

const mainCache = new WeakMap<object, [number, number] | null>();

/**
 * Tratto del documento con gli articoli del provvedimento principale: la sequenza crescente di
 * articoli (Art. 1, 2, 3… o un estratto, es. 88-160) con più testo. Esclude l'indice iniziale (stessi numeri ma voci brevi) e i decreti riportati
 * in appendice (che ricominciano da Art. 1).
 */
export function mainArticles(sections: Pick<Section, 'label' | 'pos'>[]): [number, number] | null {
  const hit = mainCache.get(sections);
  if (hit !== undefined) return hit;
  const arts = sections.filter((x) => !Number.isNaN(artNum(x.label)));
  let best: { from: number; to: number; size: number } | null = null;
  let run: { from: number; last: number; lastPos: number; size: number } | null = null;
  const close = (end: number) => {
    if (run && (!best || run.size > best.size)) best = { from: run.from, to: end, size: run.size };
  };
  let misfits = 0;
  for (let i = 0; i < arts.length; i++) {
    const n = artNum(arts[i].label);
    // peso di ogni articolo limitato: un allegato lunghissimo dopo l'ultimo articolo non conta
    const len = Math.min(20000, (arts[i + 1]?.pos ?? arts[i].pos) - arts[i].pos);
    if (run && n >= run.last && n <= run.last + 15) {
      run.last = n;
      run.lastPos = arts[i].pos;
      run.size += Math.max(0, len);
      misfits = 0;
    } else if (run && n !== 1 && misfits < 3) {
      misfits++; // intestazione fuori sequenza isolata: si ignora
    } else {
      close(run ? run.lastPos + 1 : 0);
      misfits = 0;
      // nuova sequenza (anche un estratto che non parte dall'Art. 1, es. Titolo IV: artt. 88-160)
      run = { from: arts[i].pos, last: n, lastPos: arts[i].pos, size: Math.max(0, len) };
    }
  }
  close(run ? (run as { lastPos: number }).lastPos + 1 : 0);
  const out: [number, number] | null = best ? [(best as { from: number }).from, (best as { to: number }).to] : null;
  mainCache.set(sections, out);
  return out;
}

/** L'intestazione fa parte degli articoli del provvedimento principale? */
export function inMainArticles(s: Pick<Section, 'label' | 'pos'>, sections: Pick<Section, 'label' | 'pos'>[]): boolean {
  const main = mainArticles(sections);
  return !!main && s.pos >= main[0] && s.pos < main[1];
}

/**
 * Collegamento al testo ufficiale online dell'articolo:
 * - Fonte con «{art}» (es. https://…~art{art}) → il numero dell'articolo al posto di {art};
 * - Fonte con un indirizzo Normattiva (…/uri-res/N2Ls?urn:…) → si aggiunge «~artN»;
 * - D.Lgs. 81/2008 riconosciuto dal titolo → Normattiva.
 * Solo per gli articoli del provvedimento principale: l'indice iniziale e i testi riportati
 * in appendice hanno una loro numerazione.
 */
export function onlineArticleUrl(r: { titolo: string; fonte: string }, s: Pick<Section, 'label' | 'pos'>, sections: Pick<Section, 'label' | 'pos'>[]): string | undefined {
  const m = s.label.match(/^Art\. (\d+)(?:-(\w+))?$/);
  if (!m) return undefined;
  if (!inMainArticles(s, sections)) return undefined;
  const num = `${m[1]}${m[2] ?? ''}`;
  const fonte = r.fonte.trim();
  if (isUrlText(fonte) && fonte.includes('{art}')) return fonte.replace(/\{art\}/g, num);
  if (isUrlText(fonte) && /normattiva\.it\/uri-res\/N2Ls\?urn:/i.test(fonte)) return `${fonte.replace(/~art[\w]*.*$/i, '').replace(/[!#].*$/, '')}~art${num}`;
  if (isDlgs81(r)) return `${NORMATTIVA_81}~art${num}`;
  return undefined;
}

/** Collegamento al documento online (intero): la Fonte se è un indirizzo, oppure Normattiva per il D.Lgs. 81/2008. */
export function onlineDocumentUrl(r: { titolo: string; fonte: string }): string | undefined {
  const fonte = r.fonte.trim();
  if (isUrlText(fonte)) return fonte.replace(/\{art\}/g, '').replace(/~art$/, '');
  if (isDlgs81(r)) return NORMATTIVA_81;
  return undefined;
}

/** Riferimenti ad articoli in un testo libero (risposta dell'AI): «Art. 19», «articolo 19, comma 1», «Allegato XVIII». */
export const ARTICLE_REF = /\b(?:art(?:icol[oi])?\.?\s*(\d+)(?:\s*[-‑]?\s*(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?(?:\s*,\s*comm[ai]\s*\d+(?:\s*(?:e|,)\s*\d+)*)?(?:\s*,\s*(?:lett(?:era)?\.?\s*[a-z]\)?|punto\s*[\d.]+))?|allegato\s+([IVXLC]+|\d+))\b/gi;

/** Etichetta normalizzata di un riferimento trovato con ARTICLE_REF («Art. 19», «Art. 136-bis», «Allegato XVIII»). */
export function refLabel(m: RegExpMatchArray): string {
  if (m[3]) return `Allegato ${m[3].toUpperCase()}`;
  return `Art. ${m[1]}${m[2] ? `-${m[2].toLowerCase()}` : ''}`;
}

/** Numero di pagina del PDF (da 1) in cui si trova la posizione, se le pagine sono note. */
export function pageAt(pagine: number[] | undefined, pos: number): number | undefined {
  if (!pagine?.length || pos < 0) return undefined;
  let lo = 0;
  let hi = pagine.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pagine[mid] <= pos) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found + 1;
}
