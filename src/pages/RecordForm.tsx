import { useEffect, useState } from 'preact/hooks';
import { db, putRecords } from '../lib/db';
import { ensureCategory } from '../lib/categories';
import { CategoryPicker } from '../components/CategoryPicker';
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
  demo: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

const empty = (): Draft => ({
  id: '', titolo: '', categoria: '', tag: '', fonte: '', data_aggiornamento: today(), testo: '', demo: false
});

/** Crea (senza id) o modifica (con id) un record. */
export function RecordForm({ id }: { id?: string }) {
  const [draft, setDraft] = useState<Draft | null>(id ? null : empty());
  const [original, setOriginal] = useState<StoredRecord | undefined>();
  const [errore, setErrore] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    db.records.get(id).then((r) => {
      if (!r) { setErrore(`Record «${id}» non trovato.`); return; }
      setOriginal(r);
      setDraft({ ...r, tag: r.tag.join(', '), demo: !!r.demo });
    });
  }, [id]);

  if (!draft) return <p class="muted">{errore || 'Caricamento…'}</p>;

  // aggiornamenti funzionali: la categoria predefinita impostata al caricamento non cancella ciò che si sta scrivendo
  const set = (k: keyof Draft) => (e: Event) => {
    const v = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
    setDraft((d) => d && { ...d, [k]: v });
  };

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
      categoria: await ensureCategory(draft.categoria),
      tag: parseTags(draft.tag),
      fonte: draft.fonte.trim(),
      data_aggiornamento: draft.data_aggiornamento || today(),
      ...(draft.demo ? { demo: true } : {}),
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
      <h2>{original ? 'Modifica scheda' : 'Nuova scheda'}</h2>

      <label>
        Titolo *
        <input required value={draft.titolo} onInput={set('titolo')} />
      </label>
      <div class="form-row">
        <label>
          Categoria
          <CategoryPicker value={draft.categoria} onChange={(v) => setDraft((d) => d && { ...d, categoria: v })} />
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
        {draft.categoria.trim().toLowerCase() === 'normativa' && (
          <span class="muted small">
            Per collegare ogni articolo al testo ufficiale incolla il link Normattiva del provvedimento
            (es. <code>https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2008-04-09;81</code>):
            l'app aggiunge da sola il numero dell'articolo. Per altri siti scrivi <code>{'{art}'}</code> dove va il numero.
            Il D.Lgs. 81/2008 è riconosciuto anche senza link.
          </span>
        )}
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

      <label class="switch demo-switch">
        <span>
          Visibile anche nella demo
          <br />
          <span class="muted small">Le schede demo sono pubblicate in chiaro: chiunque può leggerle.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={draft.demo}
          onChange={(e) => { const demo = (e.target as HTMLInputElement).checked; setDraft((d) => d && { ...d, demo }); }}
        />
      </label>

      {errore && <p class="notice notice-error" role="alert">{errore}</p>}
      <button class="btn btn-primary btn-block" type="submit" disabled={saving}>
        {saving ? 'Salvataggio…' : 'Salva sul telefono'}
      </button>
    </form>
  );
}
