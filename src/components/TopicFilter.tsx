import { useEffect, useState } from 'preact/hooks';
import { ARGOMENTI } from '../branding';
import { useLiveQuery } from '../lib/live';
import { categoryCounts } from '../lib/search';
import { updateSettings, useSettings } from '../lib/settings';
import { normCategory } from '../shared/search.ts';

/** Argomenti da mostrare: quelli standard (sempre) + quelli presenti nell'archivio, con il numero di schede. */
function useTopics(): { nome: string; schede: number }[] {
  const counts = useLiveQuery(categoryCounts);
  const byNorm = new Map<string, { nome: string; schede: number }>();
  for (const nome of ARGOMENTI) byNorm.set(normCategory(nome), { nome, schede: 0 });
  for (const [nome, n] of counts ?? []) {
    const k = normCategory(nome);
    const cur = byNorm.get(k);
    if (cur) cur.schede += n;
    else byNorm.set(k, { nome, schede: n });
  }
  const std = ARGOMENTI.map((a) => byNorm.get(normCategory(a))!);
  const extra = [...byNorm.values()].filter((t) => !ARGOMENTI.some((a) => normCategory(a) === normCategory(t.nome)))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  return [...std, ...extra];
}

/** Spunte "Cerca in": argomenti in cui cercare (scelta ricordata sul dispositivo). */
export function TopicFilter() {
  const { categorie: saved } = useSettings();
  const topics = useTopics();
  const [open, setOpen] = useState(false);
  // scelta mostrata subito; il salvataggio avviene in sottofondo
  const [local, setLocal] = useState<string[] | null>(null);
  useEffect(() => setLocal(null), [saved.join('|')]);
  const categorie = local ?? saved;
  const save = (next: string[]) => {
    setLocal(next);
    updateSettings({ categorie: next });
  };
  const selected = new Set(categorie.map(normCategory));
  const tutti = selected.size === 0;
  const isOn = (nome: string) => tutti || selected.has(normCategory(nome));

  const toggle = (nome: string) => {
    const k = normCategory(nome);
    let next = tutti ? new Set(topics.map((t) => normCategory(t.nome))) : new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    if (next.size === 0) return; // almeno un argomento
    if (topics.every((t) => next.has(normCategory(t.nome)))) next = new Set(); // tutti selezionati = "Tutti"
    save([...next]);
  };

  const summary = tutti
    ? 'Tutti gli argomenti'
    : topics.filter((t) => selected.has(normCategory(t.nome))).map((t) => t.nome).join(', ') || 'Tutti gli argomenti';

  return (
    <div class={`card topic-filter ${tutti ? '' : 'is-filtered'}`}>
      <button type="button" class="topic-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <span class="small muted">Cerca in</span>
          <strong class="topic-summary">{summary}</strong>
        </span>
        <span class="topic-toggle">{open ? 'Chiudi' : 'Scegli'}</span>
      </button>
      {open && (
        <div class="topic-list" role="group" aria-label="Argomenti in cui cercare">
          <label class="topic-item topic-all">
            <input type="checkbox" checked={tutti} onChange={() => save([])} />
            <span>Tutti</span>
          </label>
          {topics.map((t) => (
            <label key={t.nome} class={`topic-item ${t.schede ? '' : 'is-empty'}`}>
              <input
                type="checkbox"
                checked={isOn(t.nome)}
                disabled={!tutti && isOn(t.nome) && selected.size === 1}
                onChange={() => toggle(t.nome)}
              />
              <span>{t.nome}</span>
              <span class="topic-count">{t.schede}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
