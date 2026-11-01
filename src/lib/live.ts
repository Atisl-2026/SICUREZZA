import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

/** Equivalente minimale di useLiveQuery (dexie-react-hooks) per Preact: si aggiorna quando i dati cambiano. */
export function useLiveQuery<T>(query: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: setValue,
      error: (e) => console.error('[liveQuery]', e)
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
