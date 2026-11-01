import { useEffect, useState } from 'preact/hooks';
import { InstallCard } from '../components/InstallCard';
import { requestPersistence } from '../lib/db';
import { defaultRemoteUrl, updateSettings, useSettings } from '../lib/settings';

function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function SettingsPage() {
  const settings = useSettings();
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const refreshStorage = () => {
    navigator.storage?.estimate?.().then(setEstimate).catch(() => {});
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  };
  useEffect(refreshStorage, []);

  const urlValue = url ?? settings.remoteUrl;
  const saveUrl = () => {
    if (url == null) return;
    updateSettings({ remoteUrl: url.trim() });
    setUrl(null);
  };

  return (
    <section>
      <InstallCard />

      <div class="card">
        <h3>Database remoto</h3>
        <label class="field">
          <span class="small">URL del file db.json</span>
          <input
            type="url"
            inputMode="url"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            placeholder={defaultRemoteUrl()}
            value={urlValue}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            onBlur={saveUrl}
          />
          <span class="muted small">Lascia vuoto per usare il database pubblicato insieme all'app.</span>
        </label>
        <label class="switch">
          <span>Controlla aggiornamenti all'avvio</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.autoCheck}
            onChange={(e) => updateSettings({ autoCheck: (e.target as HTMLInputElement).checked })}
          />
        </label>
      </div>

      <div class="card">
        <h3>Archiviazione locale</h3>
        <dl class="kv small">
          <dt>Spazio usato</dt>
          <dd>{formatBytes(estimate?.usage)}</dd>
          <dt>Spazio disponibile</dt>
          <dd>{formatBytes(estimate?.quota)}</dd>
          <dt>Archiviazione persistente</dt>
          <dd>{persisted == null ? '—' : persisted ? 'Sì' : 'No'}</dd>
        </dl>
        {persisted === false && (
          <>
            <p class="muted small">
              Senza archiviazione persistente il sistema potrebbe cancellare i dati se lo spazio scarseggia.
              Su iPhone installa l'app sulla schermata Home e fai backup regolari dalla scheda Database.
            </p>
            <button class="btn btn-block" onClick={() => requestPersistence().then(refreshStorage)}>
              Richiedi archiviazione persistente
            </button>
          </>
        )}
      </div>

      <div class="card">
        <h3>Informazioni</h3>
        <dl class="kv small">
          <dt>Versione app</dt>
          <dd>{__APP_VERSION__}</dd>
        </dl>
      </div>
    </section>
  );
}
