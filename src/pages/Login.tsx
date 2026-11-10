import { useState } from 'preact/hooks';
import { defaultRepo, loginAdmin, loginAdminReset, loginDemo, loginPlus, loginSocio } from '../lib/access';
import { WrongPasswordError } from '../shared/crypto.ts';
import { NEW_TOKEN_URL } from '../shared/github.ts';
import { asset, BRAND } from '../branding';
import { Contacts } from '../components/Contacts';
import { WelcomePage } from './Welcome';

type Busy = null | 'demo' | 'socio' | 'plus' | 'admin';

function errorText(e: unknown): string {
  if (e instanceof WrongPasswordError) return 'Password non corretta.';
  return (e as Error)?.message || 'Accesso non riuscito.';
}

/** Schermata iniziale: benvenuto, poi scelta dell'accesso (socio, demo, programmatore). */
export function LoginPage({ online }: { online: boolean }) {
  const [welcome, setWelcome] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [plusPassword, setPlusPassword] = useState('');
  const [showPlus, setShowPlus] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [token, setToken] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [repo, setRepo] = useState(defaultRepo());
  const [reset, setReset] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [adminWrongPw, setAdminWrongPw] = useState(false);

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
      if (kind === 'admin' && e instanceof WrongPasswordError) setAdminWrongPw(true);
      setBusy(null);
    }
  };

  if (welcome) return <WelcomePage onEnter={() => { setWelcome(false); window.scrollTo(0, 0); }} />;

  return (
    <div class="login">
      <button type="button" class="link-btn login-back" onClick={() => setWelcome(true)}>‹ Indietro</button>
      <header class="login-brand login-brand-compact">
        <img src={asset(BRAND.logo)} alt="" width="64" height="57" />
        <h1>{BRAND.nome}</h1>
        <p class="muted small">Scegli come accedere</p>
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
        <Contacts intro="Password dimenticata o non ancora ricevuta?" />
      </form>

      <form
        class="card login-card plus-card"
        onSubmit={(e) => { e.preventDefault(); run('plus', () => loginPlus(plusPassword)); }}
      >
        <button type="button" class="link-btn plus-toggle" aria-expanded={showPlus} onClick={() => setShowPlus(!showPlus)}>
          Accesso Socio plus {showPlus ? '▴' : '▾'}
        </button>
        {showPlus && (
          <>
            <p class="muted small">Come i soci, in più puoi caricare documenti nell'archivio e pubblicarli. La password te la dà il programmatore.</p>
            <label class="field">
              <span class="small">Password Socio plus</span>
              <input
                type="password"
                autocomplete="current-password"
                value={plusPassword}
                onInput={(e) => setPlusPassword((e.target as HTMLInputElement).value)}
              />
            </label>
            <button class="btn btn-primary btn-block" type="submit" disabled={!plusPassword || !!busy || !online}>
              {busy === 'plus' ? 'Verifica…' : 'Entra come Socio plus'}
            </button>
          </>
        )}
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
          {!reset && (
            <button class="btn btn-primary btn-block" type="submit" disabled={!token || !adminPassword || !!busy || !online}>
              {busy === 'admin' ? 'Verifica…' : 'Entra come programmatore'}
            </button>
          )}
          {!reset && adminWrongPw && (
            <button type="button" class="link-btn" onClick={() => setReset(true)}>Ho dimenticato la password soci</button>
          )}
          {reset && (
            <div class="reset-box">
              <p class="notice notice-error small">
                Le schede riservate già pubblicate non si possono recuperare senza la vecchia password: ripartirai dalle
                schede demo e dovrai reimportare le altre (backup o file generato dal computer). Alla prima pubblicazione
                la nuova password varrà per tutti i soci.
              </p>
              <label class="field">
                <span class="small">Nuova password soci (almeno 8 caratteri)</span>
                <input type="password" autocomplete="new-password" value={newPw} onInput={(e) => setNewPw((e.target as HTMLInputElement).value)} />
              </label>
              <label class="field">
                <span class="small">Ripeti la nuova password</span>
                <input type="password" autocomplete="new-password" value={newPw2} onInput={(e) => setNewPw2((e.target as HTMLInputElement).value)} />
              </label>
              {newPw2 && newPw !== newPw2 && <p class="small notice notice-error">Le due password non coincidono.</p>}
              <button
                type="button"
                class="btn btn-danger btn-block"
                disabled={!token || newPw.length < 8 || newPw !== newPw2 || !!busy || !online}
                onClick={() => run('admin', () => loginAdminReset(token, newPw, repo))}
              >
                {busy === 'admin' ? 'Verifica…' : 'Imposta la nuova password ed entra'}
              </button>
              <button type="button" class="link-btn" onClick={() => setReset(false)}>Annulla</button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
