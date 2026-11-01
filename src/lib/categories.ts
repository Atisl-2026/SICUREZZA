// Categorie (argomenti) dell'archivio: elenco ordinato gestito dal programmatore e pubblicato con le schede.
// Se l'elenco non è mai stato pubblicato si parte dagli argomenti standard (ARGOMENTI).
import { ARGOMENTI } from '../branding';
import { normCategory } from '../shared/search.ts';
import type { StoredRecord } from '../shared/types.ts';
import { db, getMeta, putRecords, setMeta } from './db';
import { useLiveQuery } from './live';
import { getSettings, updateSettings } from './settings';

const KEY = 'categorie';
/** true se l'elenco è stato cambiato sul telefono e non ancora pubblicato */
export const CATEGORIES_DIRTY = 'categorieDaPubblicare';

export async function getCategoryList(): Promise<string[]> {
  return (await getMeta<string[] | null>(KEY, null)) ?? [...ARGOMENTI];
}

async function saveList(list: string[]) {
  await setMeta(KEY, list);
  await setMeta(CATEGORIES_DIRTY, true);
}

/** Elenco ricevuto con i contenuti pubblicati (non sovrascrive modifiche locali non ancora pubblicate). */
export async function receiveCategories(list: string[] | undefined) {
  if (!Array.isArray(list) || !list.length) return;
  if (await getMeta<boolean>(CATEGORIES_DIRTY, false)) return;
  await setMeta(KEY, list.map((c) => String(c).trim()).filter(Boolean));
}

export function forgetCategories() {
  return db.meta.bulkDelete([KEY, CATEGORIES_DIRTY]);
}

export interface CategoryInfo {
  nome: string;
  schede: number;
  /** false se è una categoria usata da qualche scheda ma assente dall'elenco */
  inElenco: boolean;
}

/** Elenco ordinato + categorie usate dalle schede ma non in elenco, con il numero di schede. */
export async function categoriesWithCounts(): Promise<CategoryInfo[]> {
  const list = await getCategoryList();
  const counts = new Map<string, { nome: string; n: number }>();
  await db.records.each((r) => {
    const k = normCategory(r.categoria);
    const cur = counts.get(k);
    if (cur) cur.n++;
    else counts.set(k, { nome: r.categoria, n: 1 });
  });
  const listed = list.map((nome) => ({ nome, schede: counts.get(normCategory(nome))?.n ?? 0, inElenco: true }));
  const known = new Set(list.map(normCategory));
  const extra = [...counts.entries()]
    .filter(([k]) => !known.has(k))
    .map(([, v]) => ({ nome: v.nome, schede: v.n, inElenco: false }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  return [...listed, ...extra];
}

export function useCategories(): CategoryInfo[] | undefined {
  return useLiveQuery(categoriesWithCounts);
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function validate(nome: string) {
  const n = clean(nome);
  if (!n) throw new Error('Scrivi il nome della categoria.');
  if (n.length > 60) throw new Error('Nome troppo lungo (massimo 60 caratteri).');
  return n;
}

/** Aggiunge una categoria in fondo all'elenco. */
export async function addCategory(nome: string): Promise<string> {
  const n = validate(nome);
  const list = await getCategoryList();
  const existing = list.find((c) => normCategory(c) === normCategory(n));
  if (existing) throw new Error(`La categoria «${existing}» esiste già.`);
  await saveList([...list, n]);
  return n;
}

/** Se la categoria non è in elenco la aggiunge (usata da caricamento documenti e nuova scheda). */
export async function ensureCategory(nome: string): Promise<string> {
  const n = clean(nome) || 'Generale';
  const list = await getCategoryList();
  const existing = list.find((c) => normCategory(c) === normCategory(n));
  if (existing) return existing;
  await saveList([...list, n]);
  return n;
}

/** Cambia la categoria di tutte le schede `from` → `to` (le schede pubblicate diventano "modificate"). */
async function moveRecords(from: string, to: string): Promise<number> {
  const k = normCategory(from);
  const recs = await db.records.filter((r) => normCategory(r.categoria) === k).toArray();
  if (!recs.length) return 0;
  const now = Date.now();
  await putRecords(recs.map((r): StoredRecord => ({
    ...r,
    categoria: to,
    ...(r.origine === 'remoto' ? { modificato: true } : {}),
    salvato_il: now
  })));
  return recs.length;
}

/** Aggiorna la scelta "Cerca in" se conteneva la categoria rinominata o eliminata. */
async function updateFilter(from: string, to: string | null) {
  const { categorie } = await getSettings();
  const k = normCategory(from);
  if (!categorie.some((c) => normCategory(c) === k)) return;
  const next = categorie.filter((c) => normCategory(c) !== k);
  if (to && !next.some((c) => normCategory(c) === normCategory(to))) next.push(normCategory(to));
  await updateSettings({ categorie: next });
}

/** Rinomina la categoria e tutte le sue schede. Restituisce il numero di schede aggiornate. */
export async function renameCategory(vecchio: string, nuovo: string): Promise<number> {
  const n = validate(nuovo);
  const list = await getCategoryList();
  const clash = list.find((c) => normCategory(c) === normCategory(n) && normCategory(c) !== normCategory(vecchio));
  if (clash) throw new Error(`Esiste già la categoria «${clash}»: per unirle elimina «${vecchio}» e sposta le schede in «${clash}».`);
  const idx = list.findIndex((c) => normCategory(c) === normCategory(vecchio));
  const next = idx >= 0 ? list.map((c, i) => (i === idx ? n : c)) : [...list, n];
  await saveList(next);
  const moved = await moveRecords(vecchio, n);
  await updateFilter(vecchio, n);
  return moved;
}

/** Elimina la categoria; se ha schede vanno spostate in `spostaIn`. Restituisce le schede spostate. */
export async function deleteCategory(nome: string, spostaIn?: string): Promise<number> {
  const k = normCategory(nome);
  const count = await db.records.filter((r) => normCategory(r.categoria) === k).count();
  if (count && !spostaIn) throw new Error('La categoria contiene delle schede: scegli dove spostarle.');
  if (spostaIn && normCategory(spostaIn) === k) throw new Error('Scegli una categoria diversa.');
  const list = await getCategoryList();
  let next = list.filter((c) => normCategory(c) !== k);
  let target = spostaIn;
  if (spostaIn) {
    target = next.find((c) => normCategory(c) === normCategory(spostaIn)) ?? clean(spostaIn);
    if (!next.some((c) => normCategory(c) === normCategory(target!))) next = [...next, target];
  }
  if (!next.length) throw new Error('Deve restare almeno una categoria.');
  await saveList(next);
  const moved = target ? await moveRecords(nome, target) : 0;
  await updateFilter(nome, target ?? null);
  return moved;
}

/** Sposta la categoria su (-1) o giù (+1) nell'elenco. */
export async function moveCategory(nome: string, dir: -1 | 1) {
  const list = await getCategoryList();
  const i = list.findIndex((c) => normCategory(c) === normCategory(nome));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  await saveList(next);
}
