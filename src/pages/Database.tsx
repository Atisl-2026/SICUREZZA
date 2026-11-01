import { useRef, useState } from 'preact/hooks';
import { buildBackup, db, getMeta } from '../lib/db';
import { importFile, type ImportResult } from '../lib/importer';
import { useLiveQuery } from '../lib/live';
import { recordHref, useRoute } from '../lib/route';
import { saveFile } from '../lib/save';
import { formatDate } from '../lib/format';
import { stripAccents } from '../shared/normalize.ts';
import { REMOTE_CHECK_EVENT } from '../components/RemoteUpdate';
import { RecordDetail } from './RecordDetail';
import { RecordForm } from './RecordForm';
import { UploadPage } from './Upload';
import { PublishPanel } from '../components/PublishPanel';

interface Props {
  online: boolean;
  /** Solo il programmatore può creare, modificare, importare ed eliminare. */
  isAdmin: boolean;
}

export function DatabasePage({ online, isAdmin }: Props) {
  const route = useRoute();
  const [, sub, id] = route;
  if (sub === 'record' && id) return <RecordDetail id={id} isAdmin={isAdmin} />;
  if (isAdmin && sub === 'nuovo') return <RecordForm />;
  if (isAdmin && sub === 'modifica' && id) return <RecordForm id={id} />;
  if (isAdmin && sub === 'carica') return <UploadPage />;
  return <DatabaseHome online={online} isAdmin={isAdmin} />;
}

const PAGE = 50;

function DatabaseHome({ online, isAdmin }: Props) {
  const [filtro, setFiltro] = useState('');
  const [categoria, setCategoria] = useState('');
  const [limite, setLimite] = useState(PAGE);
  const [esito, setEsito] = useState<ImportResult | null>(null);
  const [errore, setErrore] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const info = useLiveQuery(async () => ({
    records: await db.records.count(),
    demo: await db.records.filter((r) => !!r.demo).count(),
    daPubblicare: await db.records.filter((r) => r.origine === 'locale' || !!r.modificato).count(),
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

  return (
    <section>
      <div class="card">
        <dl class="kv small">
          <dt>Schede</dt>
          <dd>{info?.records ?? '…'}</dd>
          {isAdmin && <><dt>Visibili in demo</dt><dd>{info?.demo ?? '…'}</dd></>}
          {isAdmin && <><dt>Da pubblicare</dt><dd>{info?.daPubblicare ?? '…'}</dd></>}
          <dt>Versione contenuti</dt>
          <dd>{info?.versione ?? '—'}</dd>
          <dt>Ultimo aggiornamento</dt>
          <dd>{info?.aggiornato ? formatDate(info.aggiornato) : '—'}</dd>
        </dl>
      </div>

      {!isAdmin && (
        <button
          class="btn btn-block check-btn"
          disabled={!online}
          onClick={() => window.dispatchEvent(new Event(REMOTE_CHECK_EVENT))}
        >
          Controlla aggiornamenti
        </button>
      )}

      {isAdmin && <PublishPanel online={online} />}

      {isAdmin && <div class="card">
        <div class="actions-grid">
          <a class="btn btn-primary" href="#database/nuovo">＋ Nuova scheda</a>
          <a class="btn btn-primary" href="#database/carica">Carica documenti</a>
          <button class="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? 'Importazione…' : 'Importa JSON/CSV'}
          </button>
          <button class="btn" onClick={onExport} disabled={!info?.records}>Esporta backup</button>
          <button
            class="btn actions-wide"
            disabled={!online}
            title={online ? '' : 'Disponibile quando sei online'}
            onClick={() => window.dispatchEvent(new Event(REMOTE_CHECK_EVENT))}
          >
            Controlla aggiornamenti
          </button>
        </div>
        <input ref={fileInput} type="file" accept=".json,.csv,.tsv,application/json,text/csv" hidden onChange={onImport} />
        {errore && <p class="notice notice-error" role="alert">{errore}</p>}
        {esito && <ImportReport r={esito} onClose={() => setEsito(null)} />}
      </div>}

      <div class="filters">
        <input
          type="search"
          placeholder="Filtra per titolo o tag"
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
          {info?.records ? 'Nessuna scheda corrisponde al filtro.' : 'Non ci sono ancora contenuti: controlla gli aggiornamenti.'}
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
                    {isAdmin && r.demo && <span class="chip chip-demo">demo</span>}
                    {isAdmin && (r.origine === 'locale' || r.modificato) && <span class="chip chip-pending">da pubblicare</span>}
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
