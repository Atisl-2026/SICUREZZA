import { useState } from 'preact/hooks';
import { defaultRepo, loginAdmin, loginDemo, loginSocio } from '../lib/access';
import { WrongPasswordError } from '../shared/crypto.ts';
import { NEW_TOKEN_URL } from '../shared/github.ts';

type Busy = null | 'demo' | 'socio' | 'admin';

function errorText(e: unknown): string {
  if (e instanceof WrongPasswordError) return 'Password non corretta.';
  return (e as Error)?.message || 'Accesso non riuscito.';
}

/** Schermata iniziale: scelta dell'accesso (socio, demo, programmatore). */
export function LoginPage({ online }: { online: boolean }) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [token, setToken] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [repo, setRepo] = useState(defaultRepo());

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  return (
    <div class="login">
      <header class="login-brand">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="88" height="88" />
        <h1>Consulta</h1>
        <p class="muted">Archivio di normativa, procedure e schede tecniche</p>
      </header>

      {!online && <p class="notice" role="status">Per il primo accesso serve la connessione a internet.</p>}
      {error && <p class="notice notice-error" role="alert">{error}</p>}

      <form
        class="card login-card"
        onSubmit={(e) => { e.preventDefault(); run('socio', () => loginSocio(password)); }}
      >
        <h2>Accesso soci</h2>
        <label class="field">
          <span class="small">Password soci</span>
          <input
            type="password"
            autocomplete="current-password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </label>
        <button class="btn btn-primary btn-block" type="submit" disabled={!password || !!busy || !online}>
          {busy === 'socio' ? 'Verifica…' : 'Entra'}
        </button>
      </form>

      <div class="card login-card">
        <h2>Demo</h2>
        <p class="muted small">Prova l'app con una selezione di contenuti, senza password.</p>
        <button class="btn btn-block" disabled={!!busy || !online} onClick={() => run('demo', loginDemo)}>
          {busy === 'demo' ? 'Caricamento…' : 'Prova la demo'}
        </button>
      </div>

      {!showAdmin ? (
        <button type="button" class="link-btn login-admin-link" onClick={() => setShowAdmin(true)}>
          Accesso programmatore
        </button>
      ) : (
        <form
          class="card login-card"
          onSubmit={(e) => { e.preventDefault(); run('admin', () => loginAdmin(token, adminPassword, repo)); }}
        >
          <h2>Accesso programmatore</h2>
          <label class="field">
            <span class="small">Codice di accesso GitHub</span>
            <input
              type="password"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              placeholder="github_pat_…"
              value={token}
              onInput={(e) => setToken((e.target as HTMLInputElement).value)}
            />
          </label>
          <details class="howto">
            <summary>Come si crea il codice (una volta sola)</summary>
            <ol class="small">
              <li>Apri <a href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">GitHub → nuovo codice di accesso</a> (accedi con il tuo account).</li>
              <li><strong>Token name</strong>: per esempio <code>App telefono</code>. <strong>Expiration</strong>: la durata più lunga disponibile.</li>
              <li><strong>Repository access</strong>: <em>Only select repositories</em> → scegli <code>{repo.split('/')[1] || 'il repository dell\'app'}</code>.</li>
              <li><strong>Permissions</strong> → <em>Repository permissions</em> → <strong>Contents</strong>: <em>Read and write</em>.</li>
              <li>Premi <strong>Generate token</strong>, copia il codice (inizia con <code>github_pat_</code>) e incollalo qui.</li>
            </ol>
            <p class="muted small">Il codice resta solo su questo telefono e serve a pubblicare gli aggiornamenti.</p>
          </details>
          <label class="field">
            <span class="small">Password soci</span>
            <input
              type="password"
              autocomplete="current-password"
              value={adminPassword}
              onInput={(e) => setAdminPassword((e.target as HTMLInputElement).value)}
            />
            <span class="muted small">Se i contenuti non sono ancora pubblicati, questa diventa la password dei soci.</span>
          </label>
          <label class="field">
            <span class="small">Repository</span>
            <input
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              placeholder="proprietario/nome"
              value={repo}
              onInput={(e) => setRepo((e.target as HTMLInputElement).value)}
            />
          </label>
          <button class="btn btn-primary btn-block" type="submit" disabled={!token || !adminPassword || !!busy || !online}>
            {busy === 'admin' ? 'Verifica…' : 'Entra come programmatore'}
          </button>
        </form>
      )}
    </div>
  );
}
