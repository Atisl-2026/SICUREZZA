// Limiti di richieste AI per i soci (al giorno, alla settimana, al mese), decisi dal programmatore.
// L'app non ha un server: il conteggio è fatto sul telefono del socio e resta anche uscendo
// dall'accesso. I limiti che nessuno può aggirare sono quelli impostati sui siti dei servizi AI.
import { getMeta, setMeta } from './db';

export interface Limiti {
  giorno?: number;
  settimana?: number;
  mese?: number;
}

export type Periodo = keyof Limiti;
export const PERIODI: Periodo[] = ['giorno', 'settimana', 'mese'];

const NOMI: Record<Periodo, { oggi: string; finoA: string }> = {
  giorno: { oggi: 'oggi', finoA: 'fino a domani' },
  settimana: { oggi: 'questa settimana', finoA: 'fino a lunedì' },
  mese: { oggi: 'questo mese', finoA: 'fino al primo del mese prossimo' }
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Chiave del periodo in corso (ora locale): 2026-11-03, 2026-W45, 2026-11. */
export function periodKey(p: Periodo, d = new Date()): string {
  if (p === 'giorno') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (p === 'mese') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  // settimana ISO (da lunedì)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${pad(week)}`;
}

type Store = Partial<Record<Periodo, { key: string; n: number }>>;
const LS = 'atisl-uso-ai';
const META = 'usoAi';

function readLs(): Store {
  try { return JSON.parse(localStorage.getItem(LS) ?? '{}') as Store; } catch { return {}; }
}

/** Conteggio salvato in due posti (archivio dell'app e memoria del browser): vale il più alto. */
async function load(now = new Date()): Promise<Record<Periodo, number>> {
  const a = readLs();
  const b = await getMeta<Store>(META, {});
  const out = {} as Record<Periodo, number>;
  for (const p of PERIODI) {
    const k = periodKey(p, now);
    out[p] = Math.max(a[p]?.key === k ? a[p]!.n : 0, b[p]?.key === k ? b[p]!.n : 0);
  }
  return out;
}

export interface UsageStatus {
  usate: Record<Periodo, number>;
  limiti: Limiti;
  /** primo limite raggiunto, se c'è */
  superato?: Periodo;
}

export const hasLimits = (l: Limiti | undefined) => !!l && PERIODI.some((p) => (l[p] ?? 0) > 0);

export async function usageStatus(limiti: Limiti | undefined, now = new Date()): Promise<UsageStatus> {
  const usate = await load(now);
  const l = limiti ?? {};
  const superato = PERIODI.find((p) => (l[p] ?? 0) > 0 && usate[p] >= l[p]!);
  return { usate, limiti: l, ...(superato ? { superato } : {}) };
}

/** Registra una richiesta AI (una domanda o un'analisi foto). */
export async function recordUse(now = new Date()) {
  const usate = await load(now);
  const store: Store = {};
  for (const p of PERIODI) store[p] = { key: periodKey(p, now), n: usate[p] + 1 };
  try { localStorage.setItem(LS, JSON.stringify(store)); } catch { /* niente */ }
  await setMeta(META, store);
}

/** Messaggio quando il limite è raggiunto: l'AI resta spenta fino all'azzeramento. */
export function limitMessage(s: UsageStatus): string {
  const p = s.superato!;
  return `Hai utilizzato l'AI ${s.usate[p]} ${s.usate[p] === 1 ? 'volta' : 'volte'} ${NOMI[p].oggi}: la risposta AI è disattivata ${NOMI[p].finoA}. Puoi continuare a cercare nei documenti.`;
}

/** Riepilogo per il socio: «AI: 3 di 20 oggi · 10 di 100 questa settimana». */
export function usageLine(s: UsageStatus): string {
  return PERIODI.filter((p) => (s.limiti[p] ?? 0) > 0)
    .map((p) => `${s.usate[p]} di ${s.limiti[p]} ${NOMI[p].oggi}`)
    .join(' · ');
}
