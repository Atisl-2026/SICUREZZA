import type { Chunk } from './types.ts';

export interface ChunkOptions {
  /** Lunghezza minima di un blocco prima di cercare un punto di taglio. */
  min: number;
  /** Lunghezza massima di un blocco. */
  max: number;
  /** Caratteri ripetuti tra un blocco e il successivo. */
  overlap: number;
}

export const DEFAULT_CHUNK: ChunkOptions = { min: 800, max: 1200, overlap: 150 };

/** Cerca il punto di taglio migliore in s[from..to): fine paragrafo > fine frase > a capo > spazio. */
function findBreak(s: string, from: number, to: number): number {
  const win = s.slice(from, to);
  const tries: RegExp[] = [/\n\s*\n/g, /[.!?;:»"”)](?=\s)/g, /\n/g, /\s/g];
  for (const re of tries) {
    let last = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(win))) last = m.index + m[0].length;
    if (last > 0) return from + last;
  }
  return to;
}

/**
 * Suddivide un testo in blocchi di ~800–1200 caratteri con sovrapposizione,
 * tagliando preferibilmente tra paragrafi o frasi.
 */
export function chunkText(text: string, opts: ChunkOptions = DEFAULT_CHUNK): string[] {
  const s = text.trim();
  if (s.length <= opts.max) return s ? [s] : [];
  const out: string[] = [];
  let start = 0;
  while (start < s.length) {
    if (s.length - start <= opts.max) {
      out.push(s.slice(start).trim());
      break;
    }
    const end = findBreak(s, start + opts.min, start + opts.max);
    out.push(s.slice(start, end).trim());
    // inizio del blocco successivo: ~overlap caratteri prima, allineato all'inizio di una parola
    let next = Math.max(end - opts.overlap, start + 1);
    const ws = s.slice(next, end).search(/\s/);
    if (ws >= 0) next += ws + 1;
    while (next < end && /\s/.test(s[next])) next++;
    start = next;
  }
  return out.filter(Boolean);
}

/** Blocchi collegati al record padre. */
export function chunksForRecord(recordId: string, text: string, opts?: ChunkOptions): Chunk[] {
  return chunkText(text, opts).map((testo, n) => ({ id: `${recordId}#${n}`, recordId, n, testo }));
}
