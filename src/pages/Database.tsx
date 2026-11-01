import { useRef, useState } from 'preact/hooks';
import { buildBackup, clearAll, db, getMeta } from '../lib/db';
import { importFile, type ImportResult } from '../lib/importer';
import { useLiveQuery } from '../lib/live';
import { recordHref, useRoute } from '../lib/route';
import { saveFile } from '../lib/save';
import { formatDate } from '../lib/format';
import { stripAccents } from '../shared/normalize.ts';
import { REMOTE_CHECK_EVENT } from '../components/RemoteUpdate';
import { RecordDetail } from './RecordDetail';
import { RecordForm } from './RecordForm';

interface Props {
  online: boolean;
}

export function DatabasePage({ online }: Props) {
  const route = useRoute();
  const [, sub, id] = route;
  if (sub === 'record' && id) return <RecordDetail id={id} />;
  if (sub === 'nuovo') return <RecordForm />;
  if (sub === 'modifica' && id) return <RecordForm id={id} />;
  return <DatabaseHome online={online} />;
}

const PAGE = 50;

function DatabaseHome({ online }: Props) {
  const [filtro, setFiltro] = useState('');
  const [categoria, setCategoria] = useState('');
  const [limite, setLimite] = useState(PAGE);
  const [esito, setEsito] = useState<ImportResult | null>(null);
  const [errore, setErrore] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const info = useLiveQuery(async () => ({
    records: await db.records.count(),
    chunks: await db.chunks.count(),
    versione: await getMeta<string | undefined>('versione', undefined),
    aggiornato: await getMeta<string | undefined>('aggiornato_il', undefined),
    categorie: (await db.records.orderBy('categoria').uniqueKeys()) as string[]
  }));

  const records = useLiveQuery(async () => {
    const q = stripAccents(filtro.trim().toLowerCase());
    const coll = categoria ? db.records.where('categoria').equals(categoria) : db.records.toCollection();
    const all = await coll.toArray();
    const filtered = q
      ? all.filter((r) => stripAccents(`${r.titolo} ${r.id} ${r.tag.join(' ')}`.toLowerCase()).includes(q))
      : all;
    filtered.sort((a, b) => a.titolo.localeCompare(b.titolo, 'it'));
    return filtered;
  }, [filtro, categoria]);

  const onImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setBusy(true);
    setErrore('');
    setEsito(null);
    try {
      setEsito(await importFile(file));
    } catch (err) {
      setErrore((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    const backup = await buildBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    await saveFile(JSON.stringify(backup, null, 2), `consulta-backup-${stamp}.json`);
  };

  const onClear = async () => {
    if (!confirm('Eliminare TUTTI i record dal dispositivo?\n\nConsiglio: esporta prima un backup.')) return;
    if (!confirm('Confermi? L\'operazione non si può annullare.')) return;
    await clearAll();
  };

  return (
    <section>
      <div class="card">
        <dl class="kv small">
          <dt>Record</dt>
          <dd>{info?.records ?? '…'}</dd>
          <dt>Blocchi indicizzabili</dt>
          <dd>{info?.chunks ?? '…'}</dd>
          <dt>Versione database</dt>
          <dd>{info?.versione ?? '—'}</dd>
          <dt>Ultimo aggiornamento remoto</dt>
          <dd>{info?.aggiornato ? formatDate(info.aggiornato) : '—'}</dd>
        </dl>
      </div>

      <div class="card">
        <div class="actions-grid">
          <a class="btn btn-primary" href="#database/nuovo">＋ Nuovo record</a>
          <button class="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? 'Importazione…' : 'Importa JSON/CSV'}
          </button>
          <button
            class="btn"
            disabled={!online}
            title={online ? '' : 'Disponibile quando sei online'}
            onClick={() => window.dispatchEvent(new Event(REMOTE_CHECK_EVENT))}
          >
            Controlla aggiornamenti
          </button>
          <button class="btn" onClick={onExport} disabled={!info?.records}>Esporta backup</button>
        </div>
        <input ref={fileInput} type="file" accept=".json,.csv,.tsv,application/json,text/csv" hidden onChange={onImport} />
        {errore && <p class="notice notice-error" role="alert">{errore}</p>}
        {esito && <ImportReport r={esito} onClose={() => setEsito(null)} />}
      </div>

      <div class="filters">
        <input
          type="search"
          placeholder="Filtra per titolo, id o tag"
          value={filtro}
          onInput={(e) => { setFiltro((e.target as HTMLInputElement).value); setLimite(PAGE); }}
          aria-label="Filtra record"
        />
        <select
          value={categoria}
          onChange={(e) => { setCategoria((e.target as HTMLSelectElement).value); setLimite(PAGE); }}
          aria-label="Categoria"
        >
          <option value="">Tutte le categorie</option>
          {info?.categorie.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {records && records.length === 0 && (
        <p class="muted center">
          {info?.records ? 'Nessun record corrisponde al filtro.' : 'Il database è vuoto: importa un file o controlla gli aggiornamenti.'}
        </p>
      )}

      {records && records.length > 0 && (
        <div class="card card-flush">
          <ul class="list record-list">
            {records.slice(0, limite).map((r) => (
              <li key={r.id}>
                <a href={recordHref(r.id)}>
                  <span class="rl-title">{r.titolo}</span>
                  <span class="rl-meta">
                    {r.categoria} · {formatDate(r.data_aggiornamento)}
                    {r.origine === 'locale' && <span class="chip">locale</span>}
                    {r.modificato && <span class="chip">modificato</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {records.length > limite && (
            <button class="btn btn-block btn-flat" onClick={() => setLimite(limite + PAGE)}>
              Mostra altri ({records.length - limite})
            </button>
          )}
        </div>
      )}

      <details class="card danger-zone">
        <summary>Zona pericolosa</summary>
        <p class="small muted">Elimina tutti i dati dal dispositivo. I record remoti si possono riscaricare; quelli creati da te no.</p>
        <button class="btn btn-danger btn-block" onClick={onClear} disabled={!info?.records}>Elimina tutti i record</button>
      </details>
    </section>
  );
}

function ImportReport({ r, onClose }: { r: ImportResult; onClose: () => void }) {
  return (
    <div class="import-report" role="status">
      <strong>Importato «{r.file}»</strong>
      <ul class="small">
        <li>{r.stats.aggiunti} aggiunti, {r.stats.aggiornati} aggiornati, {r.stats.invariati} invariati</li>
        {r.stats.saltati > 0 && <li>{r.stats.saltati} saltati perché la versione sul dispositivo è più recente</li>}
        {r.errori.length > 0 && <li>{r.errori.length} avvisi o righe scartate</li>}
      </ul>
      {r.errori.length > 0 && (
        <details class="small">
          <summary>Dettagli</summary>
          <ul>{r.errori.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul>
        </details>
      )}
      <button class="btn" onClick={onClose}>Chiudi</button>
    </div>
  );
}
