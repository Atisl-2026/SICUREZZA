import { useRef, useState } from 'preact/hooks';
import { db, putRecords } from '../lib/db';
import { ensureCategory } from '../lib/categories';
import { CategoryPicker } from '../components/CategoryPicker';
import { navigate } from '../lib/route';
import { ACCEPT, extractPhotos, extractUpload, type UploadResult } from '../lib/upload';
import { isImageName, OcrSession } from '../lib/ocr';
import { describeMatch, findDuplicates, type DupMatch } from '../shared/duplicates.ts';
import { ensureUniqueIds } from '../shared/normalize.ts';
import type { DbRecord, StoredRecord } from '../shared/types.ts';

interface Item {
  record: DbRecord;
  file: string;
  include: boolean;
  /** possibili doppioni (stesso titolo, contenuto identico o simile, stesso file): serve una scelta */
  dups: DupMatch[];
  /** scelta fatta sui doppioni */
  decided?: boolean;
}

const PREF = 'atisl-carica-ocr';
function loadPref(): { ocr: boolean; unisci: boolean } {
  try {
    return { ocr: true, unisci: false, ...JSON.parse(localStorage.getItem(PREF) ?? '{}') };
  } catch {
    return { ocr: true, unisci: false };
  }
}
function savePref(p: { ocr: boolean; unisci: boolean }) {
  try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* niente */ }
}

/** Programmatore e Socio plus: carica documenti dal telefono e li trasforma in schede (da pubblicare). */
export function UploadPage({ allowDemo = true }: { allowDemo?: boolean }) {
  const [categoria, setCategoria] = useState('');
  const [demo, setDemo] = useState(false);
  const [pref, setPref] = useState(loadPref);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [reports, setReports] = useState<UploadResult[]>([]);
  const [saved, setSaved] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const setP = (patch: Partial<typeof pref>) => {
    const next = { ...pref, ...patch };
    setPref(next);
    savePref(next);
  };

  const onFiles = async (e: Event) => {
    const el = e.target as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    el.value = '';
    if (!files.length) return;
    setBusy(true);
    setSaved(null);
    setStatus('Lettura dei documenti…');
    const ctrl = new AbortController();
    abort.current = ctrl;
    const ocr = pref.ocr ? new OcrSession(setStatus, ctrl.signal) : null;
    const results: UploadResult[] = [];
    try {
      const cat = await ensureCategory(categoria);
      setCategoria(cat);
      const opts = { categoria: cat, demo, ocr };
      const photos = files.filter((f) => isImageName(f.name)).sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
      const others = files.filter((f) => !isImageName(f.name));
      for (const f of others) {
        if (ctrl.signal.aborted) break;
        if (others.length > 1) setStatus(`Lettura di ${f.name}…`);
        results.push(await extractUpload(f, opts));
      }
      if (photos.length && !ctrl.signal.aborted) {
        if (pref.unisci && photos.length > 1) results.push(await extractPhotos(photos, opts));
        else for (const f of photos) {
          if (ctrl.signal.aborted) break;
          results.push(await extractPhotos([f], opts));
        }
      }
      setStatus('Controllo dei doppioni…');
      const records = results.flatMap((r) => r.records.map((record) => ({ record, file: r.file })));
      ensureUniqueIds(records.map((x) => x.record));
      const archive = await db.records.toArray();
      const dups = findDuplicates(records.map((x) => x.record), archive);
      setItems(records.map((x, i) => ({ ...x, dups: dups[i], include: !dups[i].length })));
      setReports(results);
    } finally {
      await ocr?.close();
      abort.current = null;
      setStatus('');
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<Item> | ((it: Item) => Item)) =>
    setItems(items.map((it, j) => (j !== i ? it : typeof patch === 'function' ? patch(it) : { ...it, ...patch })));

  const chosen = items.filter((x) => x.include && x.record.titolo.trim() && x.record.testo.trim());
  const undecided = items.filter((x) => x.dups.length && !x.decided).length;

  const onSave = async () => {
    if (undecided && !confirm(`${undecided} ${undecided === 1 ? 'documento sembra già presente' : 'documenti sembrano già presenti'} e non hai ancora scelto cosa fare: ${undecided === 1 ? 'non verrà inserito' : 'non verranno inseriti'}.\n\nContinuare?`)) return;
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
        Word, Excel, PowerPoint, PDF (anche scansionati), foto di documenti, pagine HTML, testo, CSV o JSON. Il testo viene
        estratto sul telefono; le schede restano «da pubblicare» finché non tocchi <strong>Pubblica</strong> nell'Archivio.
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
          <CategoryPicker value={categoria} onChange={setCategoria} />
        </label>
        {allowDemo && <label class="switch">
          <span>
            Visibili anche nella demo
            <br />
            <span class="muted small">Le schede demo sono pubblicate in chiaro.</span>
          </span>
          <input type="checkbox" role="switch" checked={demo} onChange={(e) => setDemo((e.target as HTMLInputElement).checked)} />
        </label>}
        <label class="switch">
          <span>
            Leggi le scansioni e le foto (OCR)
            <br />
            <span class="muted small">
              Riconosce il testo dei PDF scansionati e delle foto di documenti, sul telefono e gratis. La prima volta
              scarica circa 5 MB; ogni pagina richiede alcuni secondi.
            </span>
          </span>
          <input type="checkbox" role="switch" checked={pref.ocr} onChange={(e) => setP({ ocr: (e.target as HTMLInputElement).checked })} />
        </label>
        {pref.ocr && <label class="switch">
          <span>
            Più foto insieme = un solo documento
            <br />
            <span class="muted small">Le foto scelte insieme diventano le pagine di un'unica scheda, in ordine di nome.</span>
          </span>
          <input type="checkbox" role="switch" checked={pref.unisci} onChange={(e) => setP({ unisci: (e.target as HTMLInputElement).checked })} />
        </label>}
        <button class="btn btn-primary btn-block" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Lettura dei documenti…' : 'Scegli i documenti'}
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={onFiles} />
        {busy && (
          <div class="upload-progress" role="status" aria-live="polite">
            <span class="small">{status}</span>
            {abort.current && <button type="button" class="btn" onClick={() => abort.current?.abort()}>Interrompi</button>}
          </div>
        )}
      </div>

      {reports.map((r) => (
        (r.error || r.warnings.length > 0) && (
          <p key={r.file} class={`notice ${r.error && !r.interrotta ? 'notice-error' : ''} small`} role="status">
            <strong>{r.file}</strong>: {[r.error, ...r.warnings].filter(Boolean).join('; ')}
          </p>
        )
      ))}

      {items.length > 0 && (
        <>
          <h3 class="section-title">Schede trovate · {items.length}</h3>
          {undecided > 0 && (
            <p class="notice small" role="status">
              {undecided === 1 ? 'Un documento sembra già presente' : `${undecided} documenti sembrano già presenti`} nell'archivio
              (titolo uguale o simile, contenuto identico o simile): scegli qui sotto se {undecided === 1 ? 'inserirlo' : 'inserirli'} o no.
            </p>
          )}
          {items.map((it, i) => (
            <div class={`card upload-item ${it.include ? '' : 'excluded'} ${it.dups.length && !it.decided ? 'upload-dup' : ''}`} key={`${it.file}-${i}`}>
              <label class="upload-include">
                <input
                  type="checkbox"
                  checked={it.include}
                  onChange={(e) => update(i, { include: (e.target as HTMLInputElement).checked, decided: true })}
                />
                <span class="small muted">{it.file} · {it.record.categoria} · {it.record.testo.length.toLocaleString('it-IT')} caratteri</span>
              </label>
              <input
                class="upload-title"
                aria-label="Titolo"
                value={it.record.titolo}
                onInput={(e) => update(i, (x) => ({ ...x, record: { ...x.record, titolo: (e.target as HTMLInputElement).value } }))}
              />
              {it.dups.length > 0 && <DupQuestion item={it} onChoose={(include) => update(i, { include, decided: true })} />}
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

function DupQuestion({ item, onChoose }: { item: Item; onChoose: (include: boolean) => void }) {
  const replaces = item.dups.some((d) => d.kinds.includes('stesso-id'));
  return (
    <div class="upload-dup-box">
      <p class="small"><strong>Possibile doppione</strong></p>
      <ul class="small">
        {item.dups.map((d) => <li key={d.id + (d.nuovo ? '-n' : '')}>{describeMatch(d)}</li>)}
      </ul>
      {item.decided ? (
        <p class="small">
          {item.include ? (replaces ? 'Scelto: sostituire la scheda esistente.' : 'Scelto: inserire comunque.') : 'Scelto: non inserire.'}{' '}
          <button type="button" class="btn" onClick={() => onChoose(!item.include)}>Cambia</button>
        </p>
      ) : (
        <>
          <p class="small">{replaces ? 'Vuoi sostituire la scheda esistente con questa?' : 'Vuoi inserirlo comunque?'}</p>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" onClick={() => onChoose(true)}>{replaces ? 'Sì, sostituisci' : 'Sì, inseriscilo'}</button>
            <button type="button" class="btn" onClick={() => onChoose(false)}>No, non inserirlo</button>
          </div>
        </>
      )}
    </div>
  );
}
