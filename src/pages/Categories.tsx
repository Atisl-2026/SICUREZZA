import { useState } from 'preact/hooks';
import { PublishPanel } from '../components/PublishPanel';
import { addCategory, deleteCategory, moveCategory, renameCategory, useCategories, type CategoryInfo } from '../lib/categories';
import { normCategory } from '../shared/search.ts';

type Mode = { kind: 'rename' | 'delete'; nome: string } | null;

/** Programmatore: aggiungere, rinominare, ordinare ed eliminare le categorie. */
export function CategoriesPage({ online }: { online: boolean }) {
  const cats = useCategories();
  const [nuova, setNuova] = useState('');
  const [mode, setMode] = useState<Mode>(null);
  const [testo, setTesto] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, t: await fn() });
      setMode(null);
      setTesto('');
    } catch (e) {
      setMsg({ ok: false, t: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onAdd = (e: Event) => {
    e.preventDefault();
    run(async () => {
      const n = await addCategory(nuova);
      setNuova('');
      return `Categoria «${n}» aggiunta.`;
    });
  };

  const others = (c: CategoryInfo) => (cats ?? []).filter((x) => normCategory(x.nome) !== normCategory(c.nome));

  return (
    <section class="categories">
      <a class="back" href="#database">‹ Archivio</a>
      <h2>Categorie</h2>
      <p class="muted small">
        Sono gli argomenti in cui si inseriscono i documenti e le spunte «Cerca in». L'ordine è quello mostrato a tutti.
        Le modifiche diventano visibili a soci e demo dopo <strong>Pubblica</strong>.
      </p>

      <form class="card cat-add" onSubmit={onAdd}>
        <label class="field">
          <span class="small">Nuova categoria</span>
          <div class="input-row">
            <input value={nuova} maxLength={60} placeholder="es. Cantieri, DPI, Antincendio" onInput={(e) => setNuova((e.target as HTMLInputElement).value)} />
            <button class="btn btn-primary" type="submit" disabled={busy || !nuova.trim()}>Aggiungi</button>
          </div>
        </label>
      </form>

      {msg && <p class={`notice ${msg.ok ? 'notice-ok' : 'notice-error'}`} role="status">{msg.t}</p>}

      <ul class="card card-flush cat-list">
        {(cats ?? []).map((c, i) => (
          <li key={c.nome} class="cat-row">
            <div class="cat-main">
              <span class="cat-name">
                <strong>{c.nome}</strong>
                <span class="small muted">
                  {c.schede === 1 ? '1 scheda' : `${c.schede} schede`}
                  {!c.inElenco && ' · usata da alcune schede ma non in elenco'}
                </span>
              </span>
              {c.inElenco && (
                <span class="cat-order">
                  <button type="button" class="icon-btn" aria-label={`Sposta su ${c.nome}`} disabled={busy || i === 0} onClick={() => run(async () => { await moveCategory(c.nome, -1); return 'Ordine aggiornato.'; })}>↑</button>
                  <button type="button" class="icon-btn" aria-label={`Sposta giù ${c.nome}`} disabled={busy || !cats || i >= cats.filter((x) => x.inElenco).length - 1} onClick={() => run(async () => { await moveCategory(c.nome, 1); return 'Ordine aggiornato.'; })}>↓</button>
                </span>
              )}
            </div>
            <div class="btn-row cat-actions">
              <button type="button" class="btn" disabled={busy} onClick={() => { setMode({ kind: 'rename', nome: c.nome }); setTesto(c.nome); setMsg(null); }}>Rinomina</button>
              <button type="button" class="btn btn-danger" disabled={busy} onClick={() => { setMode({ kind: 'delete', nome: c.nome }); setTesto(others(c)[0]?.nome ?? ''); setMsg(null); }}>Elimina</button>
            </div>

            {mode?.nome === c.nome && mode.kind === 'rename' && (
              <form class="cat-edit" onSubmit={(e) => { e.preventDefault(); run(async () => {
                const n = await renameCategory(c.nome, testo);
                return n ? `Categoria rinominata: ${n} ${n === 1 ? 'scheda aggiornata' : 'schede aggiornate'} (da pubblicare).` : 'Categoria rinominata.';
              }); }}>
                <input value={testo} maxLength={60} autoFocus onInput={(e) => setTesto((e.target as HTMLInputElement).value)} aria-label="Nuovo nome" />
                <div class="btn-row">
                  <button type="button" class="btn" onClick={() => setMode(null)}>Annulla</button>
                  <button type="submit" class="btn btn-primary" disabled={busy || !testo.trim()}>Salva</button>
                </div>
              </form>
            )}

            {mode?.nome === c.nome && mode.kind === 'delete' && (
              <form class="cat-edit" onSubmit={(e) => { e.preventDefault(); run(async () => {
                const n = await deleteCategory(c.nome, c.schede ? testo : undefined);
                return n ? `Categoria eliminata: ${n} ${n === 1 ? 'scheda spostata' : 'schede spostate'} in «${testo}» (da pubblicare).` : 'Categoria eliminata.';
              }); }}>
                {c.schede > 0 ? (
                  <label class="field">
                    <span class="small">Le sue {c.schede === 1 ? 'scheda va spostata' : `${c.schede} schede vanno spostate`} in:</span>
                    <select value={testo} onChange={(e) => setTesto((e.target as HTMLSelectElement).value)}>
                      {others(c).map((o) => <option key={o.nome} value={o.nome}>{o.nome}</option>)}
                    </select>
                  </label>
                ) : <p class="small muted">La categoria è vuota.</p>}
                <div class="btn-row">
                  <button type="button" class="btn" onClick={() => setMode(null)}>Annulla</button>
                  <button type="submit" class="btn btn-danger" disabled={busy || (c.schede > 0 && !testo)}>Elimina</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>

      <PublishPanel online={online} />
    </section>
  );
}
