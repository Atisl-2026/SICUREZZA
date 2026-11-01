// Articoli dei documenti trovati: a quale articolo appartiene ogni parola trovata, collegamenti
// all'articolo dentro l'app (documento trasmesso) e al testo ufficiale online.
import {
  articlesForChunk, chunkStart, inMainArticles, onlineArticleUrl, pageAt, sectionAt, sectionsOf, type ChunkArticles, type Section
} from '../shared/articles.ts';
import { matchRanges } from '../shared/search.ts';
import type { StoredRecord } from '../shared/types.ts';
import type { LocalResult } from './search';

// sezioni (articoli e allegati) per scheda: il testo completo si analizza una volta sola
const cache = new Map<string, { key: string; sections: Section[] }>();

export function sectionsFor(r: Pick<StoredRecord, 'id' | 'testo' | 'salvato_il'>): Section[] {
  const key = `${r.testo.length}:${r.salvato_il}`;
  let c = cache.get(r.id);
  if (!c || c.key !== key) {
    c = { key, sections: sectionsOf(r.testo) };
    if (cache.size > 200) cache.clear();
    cache.set(r.id, c);
  }
  return c.sections;
}

/** Articolo/allegato in cui inizia il brano e quelli che contiene (testo per l'AI). */
export function articlesOf(r: LocalResult): ChunkArticles {
  return articlesForChunk(r.record.testo, r.chunk.testo, sectionsFor(r.record));
}

/** Pagina del PDF in cui inizia il passaggio («pag. 345»), se il documento è stato caricato con le pagine. */
export function passagePage(r: LocalResult): number | undefined {
  if (!r.record.pagine?.length) return undefined;
  return pageAt(r.record.pagine, chunkStart(r.record.testo, r.chunk.testo));
}

/** Indirizzo dell'articolo dentro l'app, con le parole cercate da evidenziare. */
export function articleHref(recordId: string, pos: number, terms: string[] = []): string {
  const q = terms.length ? `/q/${encodeURIComponent(terms.join(' '))}` : '';
  return `#database/record/${encodeURIComponent(recordId)}/art/${pos}${q}`;
}

export interface PassageArticle {
  section: Section;
  /** la parola cercata compare in questo articolo (dentro il brano) */
  conParola: boolean;
  /** quante parole cercate compaiono nell'articolo (dentro il brano); la rubrica conta doppio */
  hits: number;
  /** collegamento al testo ufficiale online, se disponibile */
  online?: string;
}

export interface PassageInfo {
  /** articoli toccati dal brano: prima quelli che contengono la parola cercata */
  articoli: PassageArticle[];
  /** intestazioni degli articoli dentro il brano: [inizio, fine) relativi al brano, da evidenziare in verde */
  headRanges: [number, number][];
}

/** Articoli di un brano trovato, con quelli che contengono la parola cercata. */
export function passageInfo(r: LocalResult): PassageInfo {
  const sections = sectionsFor(r.record);
  if (!sections.length) return { articoli: [], headRanges: [] };
  const start = chunkStart(r.record.testo, r.chunk.testo);
  if (start < 0) return { articoli: [], headRanges: [] };
  const end = start + r.chunk.testo.length;
  const touched: Section[] = [];
  const first = sectionAt(sections, start);
  if (first) touched.push(first);
  for (const s of sections) if (s.pos > start && s.pos < end) touched.push(s);
  const hits = new Map<Section, number>();
  for (const [a] of matchRanges(r.chunk.testo, r.terms)) {
    const s = sectionAt(touched, start + a);
    if (!s) continue;
    // nella rubrica («Art. 124 – Deposito di materiali sulle impalcature») la parola pesa di più
    const inHead = start + a >= s.pos && start + a < s.pos + s.headLen;
    hits.set(s, (hits.get(s) ?? 0) + (inHead ? 2 : 1));
  }
  const articoli = touched
    .map((section) => ({ section, conParola: hits.has(section), hits: hits.get(section) ?? 0, online: onlineArticleUrl(r.record, section, sections) }))
    .sort((a, b) => b.hits - a.hits);
  const headRanges = touched
    .filter((s) => s.pos >= start)
    .map((s): [number, number] => [s.pos - start, Math.min(s.pos - start + s.headLen, r.chunk.testo.length)]);
  return { articoli, headRanges };
}

export interface RecordArticle {
  label: string;
  titolo: string;
  pos: number;
  online?: string;
}

/** Articoli dei brani consultati, per scheda (per l'elenco dei documenti citati e i link nella risposta AI). */
export function articlesByRecord(results: LocalResult[]): Map<string, RecordArticle[]> {
  const out = new Map<string, RecordArticle[]>();
  for (const r of results) {
    const list = out.get(r.record.id) ?? [];
    const info = passageInfo(r);
    const sections = sectionsFor(r.record);
    for (const a of info.articoli) {
      if (list.some((x) => x.pos === a.section.pos)) continue;
      list.push({ label: a.section.label, titolo: a.section.titolo, pos: a.section.pos, online: onlineArticleUrl(r.record, a.section, sections) });
    }
    out.set(r.record.id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.pos - b.pos);
  return out;
}

/**
 * Collegamento per un riferimento («Art. 19») scritto dall'AI accanto alla citazione di un documento:
 * prima l'articolo tra i brani consultati, poi un articolo con quel numero nel documento
 * (se ce ne sono più d'uno, quello del provvedimento principale).
 */
export function resolveArticle(results: LocalResult[], label: string, ids: string[], terms: string[]): string | undefined {
  const byRecord = articlesByRecord(results);
  const candidates = ids.length ? ids : [...byRecord.keys()];
  for (const id of candidates) {
    const hit = byRecord.get(id)?.find((x) => x.label === label);
    if (hit) return articleHref(id, hit.pos, terms);
  }
  for (const id of candidates) {
    const r = results.find((x) => x.record.id === id)?.record;
    if (!r) continue;
    const sections = sectionsFor(r);
    const same = sections.filter((s) => s.label === label);
    if (!same.length) continue;
    // più articoli con lo stesso numero (indice iniziale, decreti in appendice): quello del provvedimento principale
    const pick = same.find((s) => inMainArticles(s, sections)) ?? same.reduce((a, b) => (b.end - b.pos > a.end - a.pos ? b : a));
    return articleHref(id, pick.pos, terms);
  }
  return undefined;
}
