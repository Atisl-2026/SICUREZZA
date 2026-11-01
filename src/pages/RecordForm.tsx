import { useEffect, useState } from 'preact/hooks';
import { db, putRecords } from '../lib/db';
import { useLiveQuery } from '../lib/live';
import { navigate } from '../lib/route';
import { parseTags, slugify } from '../shared/normalize.ts';
import type { StoredRecord } from '../shared/types.ts';

interface Draft {
  id: string;
  titolo: string;
  categoria: string;
  tag: string;
  fonte: string;
  data_aggiornamento: string;
  testo: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const empty = (): Draft => ({
  id: '', titolo: '', categoria: '', tag: '', fonte: '', data_aggiornamento: today(), testo: ''
});

/** Crea (senza id) o modifica (con id) un record. */
export function RecordForm({ id }: { id?: string }) {
  const [draft, setDraft] = useState<Draft | null>(id ? null : empty());
  const [original, setOriginal] = useState<StoredRecord | undefined>();
  const [errore, setErrore] = useState('');
  const [saving, setSaving] = useState(false);
  const categorie = useLiveQuery(async () => (await db.records.orderBy('categoria').uniqueKeys()) as string[]);

  useEffect(() => {
    if (!id) return;
    db.records.get(id).then((r) => {
      if (!r) { setErrore(`Record «${id}» non trovato.`); return; }
      setOriginal(r);
      setDraft({ ...r, tag: r.tag.join(', ') });
    });
  }, [id]);

  if (!draft) return <p class="muted">{errore || 'Caricamento…'}</p>;

  const set = (k: keyof Draft) => (e: Event) =>
    setDraft({ ...draft, [k]: (e.target as HTMLInputElement | HTMLTextAreaElement).value });

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    setErrore('');
    const titolo = draft.titolo.trim();
    const testo = draft.testo.trim();
    if (!titolo) return setErrore('Il titolo è obbligatorio.');
    if (!testo) return setErrore('Il testo è obbligatorio.');

    let newId = original ? original.id : draft.id.trim() || slugify(titolo);
    if (!newId) return setErrore('Impossibile ricavare un id dal titolo: inseriscilo a mano.');
    if (!original) {
      // evita di sovrascrivere un record esistente con lo stesso id
      if (draft.id.trim() && (await db.records.get(newId))) return setErrore(`Esiste già un record con id «${newId}».`);
      let i = 2;
      const base = newId;
      while (await db.records.get(newId)) newId = `${base}-${i++}`;
    }

    const rec: StoredRecord = {
      id: newId,
      titolo,
      testo,
      categoria: draft.categoria.trim() || 'Generale',
      tag: parseTags(draft.tag),
      fonte: draft.fonte.trim(),
      data_aggiornamento: draft.data_aggiornamento || today(),
      origine: original?.origine ?? 'locale',
      ...(original?.origine === 'remoto' ? { modificato: true } : {}),
      salvato_il: Date.now()
    };
    setSaving(true);
    try {
      await putRecords([rec]);
      navigate('database', 'record', rec.id);
    } catch (err) {
      setErrore(`Salvataggio non riuscito: ${(err as Error).message}`);
      setSaving(false);
    }
  };

  const back = original ? `#database/record/${encodeURIComponent(original.id)}` : '#database';

  return (
    <form class="record-form" onSubmit={onSubmit}>
      <a class="back" href={back}>‹ Annulla</a>
      <h2>{original ? 'Modifica record' : 'Nuovo record'}</h2>
      {original?.origine === 'remoto' && (
        <p class="notice small">
          Questo record arriva dal database remoto: dopo la modifica gli aggiornamenti remoti non lo sovrascriveranno più.
        </p>
      )}

      <label>
        Titolo *
        <input required value={draft.titolo} onInput={set('titolo')} />
      </label>
      <div class="form-row">
        <label>
          Categoria
          <input list="categorie" value={draft.categoria} onInput={set('categoria')} placeholder="Generale" />
          <datalist id="categorie">{categorie?.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label>
          Data aggiornamento
          <input type="date" value={draft.data_aggiornamento} onInput={set('data_aggiornamento')} />
        </label>
      </div>
      <label>
        Tag <span class="muted small">(separati da virgola)</span>
        <input value={draft.tag} onInput={set('tag')} placeholder="es. sicurezza, DPI" />
      </label>
      <label>
        Fonte <span class="muted small">(riferimento o URL)</span>
        <input value={draft.fonte} onInput={set('fonte')} inputMode="url" />
      </label>
      {!original && (
        <label>
          Id <span class="muted small">(facoltativo: generato dal titolo)</span>
          <input value={draft.id} onInput={set('id')} autocapitalize="off" autocorrect="off" spellcheck={false} />
        </label>
      )}
      <label>
        Testo *
        <textarea required rows={12} value={draft.testo} onInput={set('testo')} />
      </label>

      {errore && <p class="notice notice-error" role="alert">{errore}</p>}
      <button class="btn btn-primary btn-block" type="submit" disabled={saving}>
        {saving ? 'Salvataggio…' : 'Salva'}
      </button>
    </form>
  );
}
