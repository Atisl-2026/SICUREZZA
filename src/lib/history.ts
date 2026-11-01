import { getMeta, setMeta } from './db';
import { useLiveQuery } from './live';

export interface HistoryItem {
  q: string;
  t: number;
}

const KEY = 'cronologia';
const MAX = 20;

/** Aggiunge una domanda in cima alla cronologia (senza duplicati, max 20). Resta solo sul dispositivo. */
export async function addToHistory(q: string) {
  const text = q.trim();
  if (!text) return;
  const list = await getMeta<HistoryItem[]>(KEY, []);
  const norm = text.toLowerCase();
  const next = [{ q: text, t: Date.now() }, ...list.filter((h) => h.q.toLowerCase() !== norm)].slice(0, MAX);
  await setMeta(KEY, next);
}

export async function removeFromHistory(q: string) {
  const list = await getMeta<HistoryItem[]>(KEY, []);
  await setMeta(KEY, list.filter((h) => h.q !== q));
}

export function clearHistory() {
  return setMeta(KEY, []);
}

export function useHistory(): HistoryItem[] {
  return useLiveQuery(() => getMeta<HistoryItem[]>(KEY, [])) ?? [];
}
