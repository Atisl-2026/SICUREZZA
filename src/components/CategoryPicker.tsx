import { useEffect, useState } from 'preact/hooks';
import { useCategories } from '../lib/categories';
import { normCategory } from '../shared/search.ts';

const NEW = '__nuova__';

/**
 * Scelta della categoria da un elenco, con "＋ Nuova categoria…".
 * Il valore è il nome della categoria; quella nuova viene aggiunta all'elenco al salvataggio (ensureCategory).
 */
export function CategoryPicker({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const cats = useCategories() ?? [];
  const known = cats.some((c) => normCategory(c.nome) === normCategory(value));
  const [adding, setAdding] = useState(false);
  const loaded = cats.length > 0;

  // senza scelta: "Generale" se esiste, altrimenti la prima categoria dell'elenco
  useEffect(() => {
    if (!loaded || adding || value) return;
    const pref = cats.find((c) => normCategory(c.nome) === 'generale') ?? cats[0];
    if (pref) onChange(pref.nome);
  }, [loaded, adding, value]);

  const showInput = adding || (!!value && loaded && !known);
  const selected = showInput ? NEW : cats.find((c) => normCategory(c.nome) === normCategory(value))?.nome ?? '';

  return (
    <div class="category-picker">
      <select
        id={id}
        value={selected}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === NEW) { setAdding(true); onChange(''); }
          else { setAdding(false); onChange(v); }
        }}
      >
        {!value && !showInput && <option value="">Scegli…</option>}
        {cats.map((c) => <option key={c.nome} value={c.nome}>{c.nome}{c.schede ? ` (${c.schede})` : ''}</option>)}
        <option value={NEW}>＋ Nuova categoria…</option>
      </select>
      {showInput && (
        <input
          class="category-new"
          placeholder="Nome della nuova categoria"
          value={value}
          autoFocus
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        />
      )}
    </div>
  );
}
