import type { DbRecord, Origine } from './types.ts';

/** Rimuove gli accenti: "perché" -> "perche". */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Identificativo leggibile e stabile: "Scheda Tecnica n° 12.pdf" -> "scheda-tecnica-n-12-pdf". */
export function slugify(s: string, max = 80): string {
  return stripAccents(String(s))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Pulisce il testo: a capo uniformi, niente spazi finali, al massimo una riga vuota consecutiva. */
export function normalizeText(s: unknown): string {
  return String(s ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

function validYmd(y: number, m: number, d: number): string {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Converte una data in YYYY-MM-DD.
 * Accetta: Date, ISO (2025-03-12, 2025-03-12T10:00), italiano (12/03/2025, 12-03-2025, 12.03.2025, 12/3/25).
 * Restituisce '' se non riconosciuta.
 */
export function parseDate(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : validYmd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y > 70 ? 1900 : 2000;
    return validYmd(y, +m[2], +m[1]);
  }
  return '';
}

/** Tag da array o stringa ("a | b", "a; b", "a, b"), senza duplicati. */
export function parseTags(v: unknown): string[] {
  let parts: string[];
  if (Array.isArray(v)) parts = v.map((x) => String(x ?? ''));
  else {
    const s = String(v ?? '');
    const sep = s.includes('|') ? '|' : s.includes(';') ? ';' : ',';
    parts = s.split(sep);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim().replace(/^#/, '');
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Nomi di colonna/proprietà alternativi accettati per ogni campo (confronto senza accenti e maiuscole). */
export const FIELD_ALIASES: Record<Exclude<keyof DbRecord, 'pagine'>, string[]> = {
  id: ['id', 'codice', 'cod', 'identificativo', 'code'],
  titolo: ['titolo', 'title', 'domanda', 'question', 'oggetto', 'nome', 'name'],
  testo: ['testo', 'text', 'risposta', 'answer', 'contenuto', 'content', 'descrizione', 'description', 'corpo', 'body'],
  categoria: ['categoria', 'category', 'tipo', 'tipologia', 'sezione'],
  tag: ['tag', 'tags', 'parole chiave', 'parole_chiave', 'keywords', 'etichette'],
  fonte: ['fonte', 'source', 'riferimento', 'url', 'link', 'origine documento'],
  data_aggiornamento: [
    'data_aggiornamento', 'data aggiornamento', 'aggiornamento', 'data', 'date', 'updated', 'updated_at', 'ultima modifica'
  ],
  demo: ['demo', 'visibile demo', 'visibile in demo', 'pubblico']
};

/** "sì", "si", "x", "true", "1", "yes" → true */
export function parseBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  return /^(s[iì]|x|true|1|yes|y|vero)$/i.test(String(v ?? '').trim());
}

const keyNorm = (k: string) => stripAccents(k).toLowerCase().trim().replace(/[\s_-]+/g, ' ');

/** Mappa un nome di colonna sul campo dello schema (o null se sconosciuto). */
export function fieldForKey(key: string): keyof DbRecord | null {
  const k = keyNorm(key);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => keyNorm(a) === k)) return field as keyof DbRecord;
  }
  return null;
}

export interface NormalizeResult {
  record?: DbRecord;
  /** Presente se il dato in ingresso era un backup dell'app. */
  origine?: Origine;
  modificato?: boolean;
  error?: string;
}

/**
 * Converte un oggetto qualsiasi (riga CSV, elemento JSON) in un record valido.
 * Le colonne non riconosciute vengono aggiunte in fondo al testo come "Colonna: valore".
 */
export function normalizeRecord(raw: unknown, defaults: Partial<DbRecord> = {}): NormalizeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'elemento non valido (atteso un oggetto)' };
  const src = raw as Record<string, unknown>;
  const f: Partial<Record<keyof DbRecord, unknown>> = {};
  const extra: string[] = [];
  let origine: Origine | undefined;
  let modificato: boolean | undefined;
  let pagine: number[] | undefined;

  for (const [key, value] of Object.entries(src)) {
    if (key === 'origine' && (value === 'remoto' || value === 'locale')) { origine = value; continue; }
    if (key === 'modificato') { modificato = value === true; continue; }
    if (key === 'salvato_il') continue;
    if (key === 'pagine') { if (validPages(value)) pagine = value; continue; }
    const field = fieldForKey(key);
    if (field && f[field] == null) f[field] = value;
    else if (value != null && String(value).trim() !== '' && typeof value !== 'object') {
      extra.push(`${key.trim()}: ${String(value).trim()}`);
    }
  }

  const titolo = normalizeText(f.titolo).replace(/\s+/g, ' ');
  let testo = normalizeText(f.testo);
  if (extra.length) testo = normalizeText(testo + '\n\n' + extra.join('\n'));
  if (!titolo && !testo) return { error: 'record senza titolo né testo' };

  const id = String(f.id ?? '').trim() || defaults.id || slugify(titolo || testo.slice(0, 60));
  if (!id) return { error: 'impossibile ricavare un id' };

  const record: DbRecord = {
    id,
    titolo: titolo || testo.split('\n')[0].slice(0, 100),
    testo,
    categoria: String(f.categoria ?? '').trim() || defaults.categoria || 'Generale',
    tag: f.tag != null ? parseTags(f.tag) : defaults.tag ?? [],
    fonte: String(f.fonte ?? '').trim() || defaults.fonte || '',
    data_aggiornamento: parseDate(f.data_aggiornamento) || defaults.data_aggiornamento || ''
  };
  if (f.demo != null ? parseBool(f.demo) : defaults.demo) record.demo = true;
  if (pagine && pagine.every((p) => p <= testo.length)) record.pagine = pagine;
  return { record, origine, modificato };
}

/** Garantisce id univoci aggiungendo -2, -3… ai duplicati. Restituisce gli id rinominati. */
export function ensureUniqueIds(records: DbRecord[]): string[] {
  const seen = new Set<string>();
  const renamed: string[] = [];
  for (const r of records) {
    if (seen.has(r.id)) {
      let i = 2;
      while (seen.has(`${r.id}-${i}`)) i++;
      renamed.push(`${r.id} → ${r.id}-${i}`);
      r.id = `${r.id}-${i}`;
    }
    seen.add(r.id);
  }
  return renamed;
}

export interface ParsedImport {
  versione?: string;
  items: NormalizeResult[];
}

/**
 * Interpreta un JSON importato. Formati accettati:
 * - array di record
 * - { versione, records: [...] }  (db.json e backup dell'app)
 * - singolo record
 */
export function parseDbJson(data: unknown): ParsedImport {
  let list: unknown[];
  let versione: string | undefined;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (o.versione != null) versione = String(o.versione);
    if (Array.isArray(o.records)) list = o.records;
    else if (Array.isArray(o.record)) list = o.record;
    else list = [o];
  } else {
    throw new Error('Il file JSON non contiene record.');
  }
  return { versione, items: list.map((x) => normalizeRecord(x)) };
}

/** Confronto versioni: "2025.10.3" < "2025.10.12", "9" < "10". */
export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

/** Due record hanno lo stesso contenuto? */
export function sameContent(a: DbRecord, b: DbRecord): boolean {
  return (
    a.id === b.id &&
    a.titolo === b.titolo &&
    a.testo === b.testo &&
    a.categoria === b.categoria &&
    a.fonte === b.fonte &&
    a.data_aggiornamento === b.data_aggiornamento &&
    !!a.demo === !!b.demo &&
    a.tag.length === b.tag.length &&
    a.tag.every((t, i) => t === b.tag[i]) &&
    (a.pagine ?? []).join(',') === (b.pagine ?? []).join(',')
  );
}

/** Estrae solo i campi dello schema (senza metadati locali). */
export function pickSchema(r: DbRecord): DbRecord {
  const { id, titolo, testo, categoria, tag, fonte, data_aggiornamento } = r;
  return {
    id, titolo, testo, categoria, tag: [...tag], fonte, data_aggiornamento,
    ...(r.demo ? { demo: true } : {}),
    ...(r.pagine?.length ? { pagine: [...r.pagine] } : {})
  };
}

/** Elenco di posizioni crescenti (inizio di ogni pagina). */
function validPages(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every((x, i) => Number.isInteger(x) && x >= 0 && (i === 0 || x >= v[i - 1]));
}
