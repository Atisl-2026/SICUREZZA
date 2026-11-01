import { useEffect, useState } from 'preact/hooks';
import { InstallCard } from '../components/InstallCard';
import { GeminiSettings } from '../components/GeminiSettings';
import { ReserveSettings } from '../components/ReserveSettings';
import { AdminSecurity } from '../components/AdminSecurity';
import { getAiEnvelope, lockAi, logout, RUOLO_LABEL, unlockAi, type Accesso } from '../lib/access';
import { requestPersistence } from '../lib/db';
import { useLiveQuery } from '../lib/live';
import { updateSettings, useSettings } from '../lib/settings';
import { WrongPasswordError } from '../shared/crypto.ts';
import { Contacts } from '../components/Contacts';
import { BRAND } from '../branding';

function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

interface Props {
  online: boolean;
  access: Accesso;
}

export function SettingsPage({ online, access }: Props) {
  const settings = useSettings();
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const refreshStorage = () => {
    navigator.storage?.estimate?.().then(setEstimate).catch(() => {});
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  };
  useEffect(refreshStorage, []);

  const onLogout = async () => {
    const msg = access.ruolo === 'admin'
      ? 'Uscire? Dal telefono verranno cancellati contenuti, codice GitHub e chiave Gemini.\nLe schede non ancora pubblicate andranno perse.'
      : 'Uscire? I contenuti verranno cancellati da questo telefono: per rientrare servirà di nuovo la password.';
    if (!confirm(msg)) return;
    await logout();
    location.hash = '';
  };

  return (
    <section>
      <div class="card">
        <h3>Accesso</h3>
        <dl class="kv small">
          <dt>Tipo di accesso</dt>
          <dd>{RUOLO_LABEL[access.ruolo]}</dd>
          {access.github && <><dt>Repository</dt><dd class="break">{access.github.repo}</dd></>}
        </dl>
        <button type="button" class="btn btn-block logout-btn" onClick={onLogout}>
          {access.ruolo === 'demo' ? 'Esci dalla demo' : 'Esci'}
        </button>
      </div>

      <InstallCard />

      {access.ruolo === 'socio' && <AiUnlock access={access} />}
      {access.ruolo === 'admin' && <GeminiSettings online={online} />}
      {access.ruolo === 'admin' && <ReserveSettings online={online} />}
      {access.ruolo === 'admin' && <AdminSecurity access={access} online={online} />}

      <div class="card">
        <h3>Aggiornamenti dei contenuti</h3>
        <label class="switch">
          <span>Controlla all'avvio</span>
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
              Su iPhone apri l'app dall'icona sulla schermata Home.
            </p>
            <button class="btn btn-block" onClick={() => requestPersistence().then(refreshStorage)}>
              Richiedi archiviazione persistente
            </button>
          </>
        )}
      </div>

      <div class="card">
        <h3>Assistenza</h3>
        <Contacts intro="Per password, accessi o problemi con l'app." />
      </div>

      <div class="card">
        <h3>Informazioni</h3>
        <dl class="kv small">
          <dt>App</dt>
          <dd>{BRAND.nome}</dd>
          <dt>Versione</dt>
          <dd>{__APP_VERSION__}</dd>
        </dl>
        <p class="muted small">{BRAND.sottotitolo}</p>
      </div>
    </section>
  );
}

/** Soci: sblocco delle risposte AI con la password AI data dal programmatore. */
function AiUnlock({ access }: { access: Accesso }) {
  const shared = useLiveQuery(getAiEnvelope);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!shared && !access.aiKey) return null; // AI non condivisa: niente da mostrare

  const onUnlock = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await unlockAi(password);
      setPassword('');
    } catch (err) {
      setError(err instanceof WrongPasswordError ? 'Password AI non corretta.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card">
      <h3>Risposte AI</h3>
      {access.aiKey ? (
        <>
          <p class="notice notice-ok">Risposte AI attive su questo telefono.</p>
          <p class="muted small">
            Le domande e i brani trovati vengono inviati a Google Gemini: non scrivere dati personali o riservati.
          </p>
          <button type="button" class="btn btn-block" onClick={() => lockAi()}>Disattiva le risposte AI</button>
        </>
      ) : (
        <form onSubmit={onUnlock}>
          <p class="muted small">Se il programmatore ti ha dato la password AI, inseriscila per avere le risposte scritte da Gemini.</p>
          <label class="field">
            <span class="small">Password AI</span>
            <input type="password" autocomplete="off" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
          </label>
          {error && <p class="notice notice-error" role="alert">{error}</p>}
          <button class="btn btn-primary btn-block" type="submit" disabled={!password || busy}>
            {busy ? 'Verifica…' : 'Attiva le risposte AI'}
          </button>
          <Contacts intro="Non hai la password AI?" />
        </form>
      )}
    </div>
  );
}
