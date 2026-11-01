import { useEffect, useState } from 'preact/hooks';
import { InstallCard } from '../components/InstallCard';

function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// FASE 1: informazioni sull'app. Chiave Gemini e modello arriveranno nella fase 4.
export function SettingsPage() {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then(setEstimate).catch(() => {});
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  }, []);

  return (
    <section>
      <h2>Impostazioni</h2>
      <InstallCard />
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
