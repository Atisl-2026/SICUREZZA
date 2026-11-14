// Riconoscimento dei possibili doppioni quando si caricano documenti: stesso titolo o nome del file,
// titolo molto simile, testo identico o in gran parte uguale (anche se uno contiene l'altro).
// Usato dall'app prima di inserire le schede: chi carica decide se inserirle comunque.

export interface DupCandidate {
  id: string;
  titolo: string;
  testo: string;
  fonte?: string;
  categoria?: string;
}

export type DupKind =
  | 'stesso-id' // stesso file nella stessa categoria: la scheda verrebbe sostituita
  | 'titolo-uguale'
  | 'nome-file-uguale'
  | 'titolo-simile'
  | 'contenuto-identico'
  | 'contenuto-simile'
  | 'contenuto-incluso' // il nuovo testo è già quasi tutto dentro la scheda esistente
  | 'contiene'; // il nuovo testo contiene quasi tutta la scheda esistente (es. versione ampliata)

export interface DupMatch {
  id: string;
  titolo: string;
  categoria?: string;
  /** true se il confronto è con un altro documento appena caricato (non ancora nell'archivio) */
  nuovo?: boolean;
  kinds: DupKind[];
  /** quota di testo in comune (0-1), quando significativa */
  somiglianza?: number;
}

export interface Fingerprint {
  titleKey: string;
  titleTokens: string[];
  titleNumbers: string;
  fileKey: string;
  words: number;
  hash: string;
  shingles: Set<number>;
}

const SHINGLE = 5;
/** si tiene circa un gruppo di parole su 4 (sempre gli stessi per lo stesso testo): veloce anche sui testi lunghi */
const SAMPLE = 4;
/** sotto questa lunghezza il confronto parziale del testo non è affidabile (vale solo «identico») */
const MIN_WORDS = 40;

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function words(s: string): string[] {
  return fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function fnv(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Titolo confrontabile: senza data iniziale, estensione, accenti, punteggiatura e maiuscole. */
export function titleKey(t: string): string {
  return words(t.replace(/^\s*\d{4}-\d{2}-\d{2}[ _.-]+/, '').replace(/\.(pdf|docx?|xlsx?|xlsm|pptx?|html?|txt|md|csv|json|jpe?g|png|webp)\s*$/i, '')).join(' ');
}

const STOP = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'di', 'del', 'della', 'dei', 'delle', 'e', 'ed', 'a', 'al', 'alla', 'in', 'per', 'con', 'su', 'da']);

export function fingerprint(r: DupCandidate): Fingerprint {
  const tk = titleKey(r.titolo);
  const w = words(r.testo);
  const shingles = new Set<number>();
  if (w.length >= MIN_WORDS) {
    for (let i = 0; i + SHINGLE <= w.length; i++) {
      const h = fnv(w.slice(i, i + SHINGLE).join(' '));
      if (h % SAMPLE === 0) shingles.add(h);
    }
  }
  const joined = w.join(' ');
  return {
    titleKey: tk,
    // singolare/plurale e maschile/femminile contano come la stessa parola (cantiere/cantieri)
    titleTokens: tk.split(' ').filter((x) => x && !STOP.has(x)).map((x) => (x.length > 4 && /^\D+$/.test(x) ? x.replace(/[aeio]$/, '') : x)),
    titleNumbers: (tk.match(/\d+/g) ?? []).join(' '),
    fileKey: titleKey((r.fonte ?? '').split(/[\\/]/).pop() ?? ''),
    words: w.length,
    hash: `${w.length}:${fnv(joined).toString(36)}:${fnv(joined, 0x9747b28c).toString(36)}`,
    shingles
  };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Titoli molto simili (ma con gli stessi numeri: «Allegato IV» e «Allegato V», «D.Lgs 81/2008» e «106/2009» restano diversi). */
export function similarTitles(a: Fingerprint, b: Fingerprint): boolean {
  if (!a.titleKey || !b.titleKey || a.titleKey === b.titleKey) return false;
  if (a.titleNumbers !== b.titleNumbers) return false;
  const ta = new Set(a.titleTokens);
  const tb = new Set(b.titleTokens);
  if (!ta.size || !tb.size) return false;
  // parole diverse anche solo per un numero romano o una lettera: titoli diversi
  const roman = (s: Set<string>) => [...s].filter((x) => /^[ivxlcdm]+$/.test(x) || x.length === 1).sort().join(' ');
  if (roman(ta) !== roman(tb)) return false;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const dice = (2 * common) / (ta.size + tb.size);
  if (dice >= 0.8 && Math.min(ta.size, tb.size) >= 2) return true;
  const ka = a.titleKey.slice(0, 160);
  const kb = b.titleKey.slice(0, 160);
  return Math.min(ka.length, kb.length) >= 8 && 1 - levenshtein(ka, kb) / Math.max(ka.length, kb.length) >= 0.88;
}

/** Confronta un documento nuovo (a) con uno esistente (b). */
export function compareFingerprints(a: Fingerprint, b: Fingerprint): { kinds: DupKind[]; somiglianza?: number } {
  const kinds: DupKind[] = [];
  let somiglianza: number | undefined;
  if (a.titleKey && a.titleKey === b.titleKey) kinds.push('titolo-uguale');
  else if (similarTitles(a, b)) kinds.push('titolo-simile');
  if (a.fileKey && a.fileKey === b.fileKey && !kinds.includes('titolo-uguale')) kinds.push('nome-file-uguale');
  if (a.words > 0 && a.hash === b.hash) {
    kinds.push('contenuto-identico');
    somiglianza = 1;
  } else if (a.shingles.size >= 3 && b.shingles.size >= 3) {
    const [small, big] = a.shingles.size <= b.shingles.size ? [a.shingles, b.shingles] : [b.shingles, a.shingles];
    let inter = 0;
    for (const h of small) if (big.has(h)) inter++;
    if (inter) {
      const jaccard = inter / (a.shingles.size + b.shingles.size - inter);
      const aInB = inter / a.shingles.size;
      const bInA = inter / b.shingles.size;
      if (jaccard >= 0.5) {
        kinds.push('contenuto-simile');
        somiglianza = jaccard;
      } else if (aInB >= 0.8) {
        kinds.push('contenuto-incluso');
        somiglianza = aInB;
      } else if (bInA >= 0.8) {
        kinds.push('contiene');
        somiglianza = bInA;
      }
    }
  }
  return { kinds, somiglianza };
}

const KIND_ORDER: DupKind[] = ['stesso-id', 'contenuto-identico', 'titolo-uguale', 'nome-file-uguale', 'contenuto-simile', 'contenuto-incluso', 'contiene', 'titolo-simile'];
const rank = (m: DupMatch) => Math.min(...m.kinds.map((k) => KIND_ORDER.indexOf(k)));

/**
 * Per ogni documento nuovo, i possibili doppioni nell'archivio e tra quelli caricati prima nello
 * stesso gruppo (dal più evidente). `archive` può essere grande: ogni impronta si calcola una volta.
 */
export function findDuplicates(news: DupCandidate[], archive: DupCandidate[], max = 3): DupMatch[][] {
  const arch = archive.map((r) => ({ r, f: fingerprint(r) }));
  const done: { r: DupCandidate; f: Fingerprint }[] = [];
  return news.map((n) => {
    const f = fingerprint(n);
    const out: DupMatch[] = [];
    const check = (o: { r: DupCandidate; f: Fingerprint }, nuovo: boolean) => {
      const { kinds, somiglianza } = compareFingerprints(f, o.f);
      if (!nuovo && o.r.id === n.id) kinds.unshift('stesso-id');
      if (kinds.length) {
        out.push({ id: o.r.id, titolo: o.r.titolo, categoria: o.r.categoria, kinds, ...(somiglianza != null ? { somiglianza } : {}), ...(nuovo ? { nuovo } : {}) });
      }
    };
    for (const o of arch) check(o, false);
    for (const o of done) check(o, true);
    done.push({ r: n, f });
    return out.sort((x, y) => rank(x) - rank(y) || (y.somiglianza ?? 0) - (x.somiglianza ?? 0)).slice(0, max);
  });
}

const pct = (x?: number) => `${Math.round((x ?? 0) * 100)}%`;

/** Descrizione in italiano di un possibile doppione: «X» (categoria): stesso titolo, contenuto identico. */
export function describeMatch(m: DupMatch): string {
  const dove = m.nuovo ? ' (tra quelli che stai caricando)' : m.categoria ? ` (${m.categoria})` : '';
  const parts = m.kinds.map((k) => {
    switch (k) {
      case 'stesso-id': return 'è lo stesso file, la scheda verrebbe sostituita';
      case 'titolo-uguale': return 'stesso titolo';
      case 'nome-file-uguale': return 'stesso nome del file';
      case 'titolo-simile': return 'titolo simile';
      case 'contenuto-identico': return 'contenuto identico';
      case 'contenuto-simile': return `contenuto simile al ${pct(m.somiglianza)}`;
      case 'contenuto-incluso': return `il ${pct(m.somiglianza)} del testo è già in questa scheda`;
      case 'contiene': return `contiene il ${pct(m.somiglianza)} del testo di questa scheda (forse una versione più ampia)`;
    }
  });
  return `«${m.titolo}»${dove}: ${parts.join(', ')}.`;
}
