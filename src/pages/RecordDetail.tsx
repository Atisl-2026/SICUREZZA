import { db, deleteRecords } from '../lib/db';
import { useLiveQuery } from '../lib/live';
import { navigate } from '../lib/route';
import { formatDate } from '../lib/format';

export function isUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

export function RecordDetail({ id }: { id: string }) {
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
      ? '\n\nNota: è un record del database remoto e tornerà al prossimo aggiornamento.'
      : '';
    if (!confirm(`Eliminare «${r.titolo}»?${warn}`)) return;
    await deleteRecords([r.id]);
    navigate('database');
  };

  return (
    <article>
      <a class="back" href="#database">‹ Database</a>
      <h2 class="record-title">{r.titolo}</h2>
      <dl class="kv small card">
        <dt>Id</dt><dd><code>{r.id}</code></dd>
        <dt>Categoria</dt><dd>{r.categoria}</dd>
        <dt>Aggiornato</dt><dd>{formatDate(r.data_aggiornamento)}</dd>
        <dt>Fonte</dt>
        <dd class="break">
          {r.fonte ? (isUrl(r.fonte) ? <a href={r.fonte} target="_blank" rel="noopener noreferrer">{r.fonte}</a> : r.fonte) : '—'}
        </dd>
        <dt>Provenienza</dt>
        <dd>{r.origine === 'remoto' ? (r.modificato ? 'Remoto, modificato da te' : 'Database remoto') : 'Creato/importato sul dispositivo'}</dd>
        <dt>Blocchi</dt><dd>{data.blocchi}</dd>
      </dl>
      {r.tag.length > 0 && (
        <p class="chips">{r.tag.map((t) => <span class="chip" key={t}>{t}</span>)}</p>
      )}
      <div class="card record-text">{r.testo}</div>
      <div class="btn-row">
        <a class="btn btn-primary" href={`#database/modifica/${encodeURIComponent(r.id)}`}>Modifica</a>
        <button class="btn btn-danger" onClick={onDelete}>Elimina</button>
      </div>
    </article>
  );
}
