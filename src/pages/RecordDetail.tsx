import { db, deleteRecords } from '../lib/db';
import { useLiveQuery } from '../lib/live';
import { navigate } from '../lib/route';
import { trackDeletion } from '../lib/publisher';
import { formatDate } from '../lib/format';

export function isUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

export function RecordDetail({ id, isAdmin }: { id: string; isAdmin: boolean }) {
  const data = useLiveQuery(async () => ({
    record: await db.records.get(id),
    blocchi: await db.chunks.where('recordId').equals(id).count()
  }), [id]);

  if (!data) return <p class="muted">Caricamento…</p>;
  const r = data.record;
  if (!r) {
    return (
      <section>
        <a class="back" href="#database">‹ Database</a>
        <p class="muted">Record «{id}» non trovato.</p>
      </section>
    );
  }

  const onDelete = async () => {
    const warn = r.origine === 'remoto'
      ? '\n\nLa scheda sparirà per tutti alla prossima pubblicazione.'
      : '';
    if (!confirm(`Eliminare «${r.titolo}»?${warn}`)) return;
    if (r.origine === 'remoto') await trackDeletion(r.id);
    await deleteRecords([r.id]);
    navigate('database');
  };

  return (
    <article>
      <a class="back" href="#database">‹ Database</a>
      <h2 class="record-title">{r.titolo}</h2>
      <dl class="kv small card">
        {isAdmin && <><dt>Id</dt><dd><code>{r.id}</code></dd></>}
        <dt>Categoria</dt><dd>{r.categoria}</dd>
        <dt>Aggiornato</dt><dd>{formatDate(r.data_aggiornamento)}</dd>
        <dt>Fonte</dt>
        <dd class="break">
          {r.fonte ? (isUrl(r.fonte) ? <a href={r.fonte} target="_blank" rel="noopener noreferrer">{r.fonte}</a> : r.fonte) : '—'}
        </dd>
        {isAdmin && <>
          <dt>Visibile in demo</dt><dd>{r.demo ? 'Sì' : 'No'}</dd>
          <dt>Stato</dt>
          <dd>{r.origine === 'remoto' && !r.modificato ? 'Pubblicata' : 'Da pubblicare'}</dd>
        </>}
      </dl>
      {r.tag.length > 0 && (
        <p class="chips">{r.tag.map((t) => <span class="chip" key={t}>{t}</span>)}</p>
      )}
      <div class="card record-text">{r.testo}</div>
      {isAdmin && (
        <div class="btn-row">
          <a class="btn btn-primary" href={`#database/modifica/${encodeURIComponent(r.id)}`}>Modifica</a>
          <button class="btn btn-danger" onClick={onDelete}>Elimina</button>
        </div>
      )}
    </article>
  );
}
