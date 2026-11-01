import { useRef, useState } from 'preact/hooks';
import { db, putRecords } from '../lib/db';
import { useLiveQuery } from '../lib/live';
import { withStandardTopics } from '../branding';
import { navigate } from '../lib/route';
import { ACCEPT, extractUpload, type UploadResult } from '../lib/upload';
import { ensureUniqueIds } from '../shared/normalize.ts';
import type { DbRecord, StoredRecord } from '../shared/types.ts';

interface Item {
  record: DbRecord;
  file: string;
  include: boolean;
  /** titolo della scheda esistente con lo stesso id, che verrà sostituita */
  replaces?: string;
}

/** Programmatore: carica documenti dal telefono e li trasforma in schede (da pubblicare). */
export function UploadPage() {
  const [categoria, setCategoria] = useState('');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [reports, setReports] = useState<UploadResult[]>([]);
  const [saved, setSaved] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const categorie = useLiveQuery(async () => withStandardTopics((await db.records.orderBy('categoria').uniqueKeys()) as string[]));

  const onFiles = async (e: Event) => {
    const el = e.target as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    el.value = '';
    if (!files.length) return;
    setBusy(true);
    setSaved(null);
    const results: UploadResult[] = [];
    for (const f of files) results.push(await extractUpload(f, { categoria, demo }));
    const records = results.flatMap((r) => r.records.map((record) => ({ record, file: r.file })));
    ensureUniqueIds(records.map((x) => x.record));
    const existing = await db.records.bulkGet(records.map((x) => x.record.id));
    setItems(records.map((x, i) => ({ ...x, include: true, replaces: existing[i]?.titolo })));
    setReports(results);
    setBusy(false);
  };

  const update = (i: number, patch: Partial<Item> | ((it: Item) => Item)) =>
    setItems(items.map((it, j) => (j !== i ? it : typeof patch === 'function' ? patch(it) : { ...it, ...patch })));

  const chosen = items.filter((x) => x.include && x.record.titolo.trim() && x.record.testo.trim());

  const onSave = async () => {
    setBusy(true);
    const existing = await db.records.bulkGet(chosen.map((x) => x.record.id));
    const now = Date.now();
    const recs: StoredRecord[] = chosen.map((x, i) => {
      const ex = existing[i];
      return {
        ...x.record,
        titolo: x.record.titolo.trim(),
        origine: ex?.origine === 'remoto' ? 'remoto' : 'locale',
        ...(ex?.origine === 'remoto' ? { modificato: true } : {}),
        salvato_il: now
      };
    });
    await putRecords(recs);
    setSaved(recs.length);
    setItems([]);
    setReports([]);
    setBusy(false);
  };

  return (
    <section>
      <a class="back" href="#database">‹ Archivio</a>
      <h2>Carica documenti</h2>
      <p class="muted small">
        Word, Excel, PowerPoint, PDF (con testo), pagine HTML, testo, CSV o JSON. Il testo viene estratto sul telefono;
        le schede restano «da pubblicare» finché non tocchi <strong>Pubblica</strong> nell'Archivio.
      </p>

      {saved != null && (
        <div class="notice notice-ok upload-saved" role="status">
          <span>{saved} {saved === 1 ? 'scheda aggiunta' : 'schede aggiunte'} all'archivio.</span>
          <button class="btn" onClick={() => navigate('database')}>Vai all'Archivio</button>
        </div>
      )}

      <div class="card">
        <label class="field">
          <span class="small">Categoria</span>
          <input list="up-categorie" value={categoria} placeholder="Generale" onInput={(e) => setCategoria((e.target as HTMLInputElement).value)} />
          <datalist id="up-categorie">{categorie?.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label class="switch">
          <span>
            Visibili anche nella demo
            <br />
            <span class="muted small">Le schede demo sono pubblicate in chiaro.</span>
          </span>
          <input type="checkbox" role="switch" checked={demo} onChange={(e) => setDemo((e.target as HTMLInputElement).checked)} />
        </label>
        <button class="btn btn-primary btn-block" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Lettura dei documenti…' : 'Scegli i documenti'}
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={onFiles} />
      </div>

      {reports.map((r) => (
        (r.error || r.warnings.length > 0) && (
          <p key={r.file} class={`notice ${r.error ? 'notice-error' : ''} small`} role="status">
            <strong>{r.file}</strong>: {r.error ?? r.warnings.join('; ')}
          </p>
        )
      ))}

      {items.length > 0 && (
        <>
          <h3 class="section-title">Schede trovate · {items.length}</h3>
          {items.map((it, i) => (
            <div class={`card upload-item ${it.include ? '' : 'excluded'}`} key={`${it.file}-${i}`}>
              <label class="upload-include">
                <input type="checkbox" checked={it.include} onChange={(e) => update(i, { include: (e.target as HTMLInputElement).checked })} />
                <span class="small muted">{it.file} · {it.record.categoria} · {it.record.testo.length.toLocaleString('it-IT')} caratteri</span>
              </label>
              <input
                class="upload-title"
                aria-label="Titolo"
                value={it.record.titolo}
                onInput={(e) => update(i, (x) => ({ ...x, record: { ...x.record, titolo: (e.target as HTMLInputElement).value } }))}
              />
              {it.replaces && <p class="small upload-replace">Sostituirà la scheda esistente «{it.replaces}».</p>}
              <p class="small upload-preview">{it.record.testo.slice(0, 280)}{it.record.testo.length > 280 ? ' …' : ''}</p>
            </div>
          ))}
          <button class="btn btn-primary btn-block upload-save" disabled={busy || !chosen.length} onClick={onSave}>
            Aggiungi {chosen.length} {chosen.length === 1 ? 'scheda' : 'schede'} all'archivio
          </button>
        </>
      )}
    </section>
  );
}
