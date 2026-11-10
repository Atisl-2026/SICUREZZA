import { hasAi } from '../lib/router';
import { LimitsEditor } from './LimitsEditor';
import { useState } from 'preact/hooks';
import { getAiEnvelope, getPlusEnvelope, type Accesso } from '../lib/access';
import { useLiveQuery } from '../lib/live';
import { useSettings } from '../lib/settings';
import type { PublishOptions } from '../lib/publisher';
import { PublishMessage, runPublish, type PublishState } from './PublishPanel';

/** Due campi password uguali (min 8 caratteri) + pulsante. */
function NewPassword({ label, button, disabled, onSubmit }: {
  label: string;
  button: string;
  disabled?: boolean;
  onSubmit: (pw: string) => Promise<boolean>;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const error = a && a.length < 8 ? 'Almeno 8 caratteri.' : a && b && a !== b ? 'Le due password non coincidono.' : '';
  return (
    <form
      class="new-password"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await onSubmit(a)) { setA(''); setB(''); }
        setBusy(false);
      }}
    >
      <label class="field">
        <span class="small">{label}</span>
        <input type="password" autocomplete="new-password" value={a} onInput={(e) => setA((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span class="small">Ripeti la password</span>
        <input type="password" autocomplete="new-password" value={b} onInput={(e) => setB((e.target as HTMLInputElement).value)} />
      </label>
      {error && <p class="small notice notice-error">{error}</p>}
      <button class="btn btn-primary btn-block" type="submit" disabled={disabled || busy || !!error || !a || a !== b}>
        {busy ? 'Pubblicazione…' : button}
      </button>
    </form>
  );
}

/** Impostazioni del programmatore: password soci e condivisione delle risposte AI. */
export function AdminSecurity({ access, online }: { access: Accesso; online: boolean }) {
  const settings = useSettings();
  const envelope = useLiveQuery(getAiEnvelope);
  const plusEnvelope = useLiveQuery(getPlusEnvelope);
  const [state, setState] = useState<PublishState>(null);
  const [stopping, setStopping] = useState(false);
  const [plusToken, setPlusToken] = useState('');

  const run = async (opts: PublishOptions, confirmText: string) => {
    if (!confirm(confirmText)) return false;
    setState(null);
    const res = await runPublish(opts);
    if (res?.tipo === 'ok') res.testo = res.testo.replace(/^Pubblicato:/, 'Fatto. Pubblicato:');
    setState(res);
    return res?.tipo === 'ok';
  };

  const sharing = !!envelope;

  return (
    <div class="card">
      <h3>Password e condivisione</h3>

      <h4 class="subhead">Password dei soci</h4>
      <p class="muted small">
        Per escludere un socio cambia la password e comunicala solo agli altri. Ogni modifica viene pubblicata subito:
        i soci dovranno inserire la nuova password alla prossima apertura.
      </p>
      <NewPassword
        label="Nuova password soci"
        button="Cambia password soci"
        disabled={!online}
        onSubmit={(pw) => run({ newSociPassword: pw }, 'Cambiare la password dei soci?\n\nTutti i soci dovranno inserire la nuova password. Verranno pubblicate anche le modifiche in attesa.')}
      />

      <h4 class="subhead">Risposte AI per i soci</h4>
      <p class="muted small">
        {sharing
          ? 'Attiva: i soci con la password AI usano le tue chiavi (Gemini e AI di riserva; i limiti gratuiti sono condivisi tra tutti). Per toglierla a qualcuno, cambia la password AI. Dopo aver aggiunto una AI di riserva, pubblica perché arrivi anche ai soci.'
          : 'Non attiva: solo tu usi le risposte AI. Con una password AI le tue chiavi (Gemini e AI di riserva) vengono condivise, cifrate, con chi la conosce.'}
      </p>
      {!hasAi(settings) && <p class="notice small">Per condividere l'AI inserisci prima la chiave Gemini o una AI di riserva qui sopra.</p>}
      <NewPassword
        label={sharing ? 'Nuova password AI' : 'Password AI'}
        button={sharing ? 'Cambia password AI' : 'Condividi l\'AI con questa password'}
        disabled={!online || !hasAi(settings)}
        onSubmit={(pw) => run({ aiPassword: pw }, sharing
          ? 'Cambiare la password AI?\n\nChi aveva quella vecchia perderà le risposte AI finché non inserisce la nuova.'
          : 'Condividere le tue chiavi AI con chi conosce questa password?')}
      />
      <LimitsEditor
        canSend={online && sharing}
        onSend={() => run({ message: 'Limiti di richieste AI per i soci' }, 'Inviare ai soci i nuovi limiti di richieste AI?\n\nVerranno pubblicate anche le modifiche in attesa.')}
      />
      {sharing && (
        <button
          class="btn btn-danger btn-block stop-ai"
          disabled={!online || stopping}
          onClick={async () => {
            setStopping(true);
            await run({ stopAi: true }, 'Smettere di condividere le risposte AI con i soci?');
            setStopping(false);
          }}
        >
          Smetti di condividere l'AI
        </button>
      )}
      {!access.aiKey && sharing && (
        <p class="muted small">La condivisione è stata impostata da un altro dispositivo: per aggiornare chiave o modello imposta di nuovo la password AI.</p>
      )}

      <h4 class="subhead">Socio plus</h4>
      <p class="muted small">
        {plusEnvelope
          ? 'Attivo: chi ha la password Socio plus consulta l\'archivio come un socio e in più può caricare documenti e pubblicarli. Per togliere l\'accesso a qualcuno cambia la password; per toglierlo a tutti disattivalo.'
          : 'Non attivo. Con una password Socio plus chi la conosce consulta l\'archivio come un socio e in più può caricare documenti e pubblicarli (non può cambiare password né condivisioni).'}
      </p>
      <label class="field">
        <span class="small">Codice GitHub per i Socio plus <span class="muted">(facoltativo, consigliato)</span></span>
        <input
          type="password"
          autocomplete="off"
          placeholder="github_pat_… (vuoto = il tuo)"
          value={plusToken}
          onInput={(e) => setPlusToken((e.target as HTMLInputElement).value)}
        />
        <span class="muted small">
          Crea un codice separato (stesso tipo del tuo: solo questo repository, permesso «Contents» in lettura e scrittura):
          così puoi revocarlo su GitHub senza toccare il tuo accesso. Il codice arriva ai Socio plus cifrato con la loro password.
        </span>
      </label>
      <NewPassword
        label={plusEnvelope ? 'Nuova password Socio plus' : 'Password Socio plus'}
        button={plusEnvelope ? 'Cambia password Socio plus' : 'Attiva il Socio plus con questa password'}
        disabled={!online}
        onSubmit={async (pw) => {
          const ok = await run({ plusPassword: pw, plusToken }, plusEnvelope
            ? 'Cambiare la password Socio plus?\n\nChi aveva quella vecchia potrà solo consultare finché non rientra con la nuova. Verranno pubblicate anche le modifiche in attesa.'
            : 'Attivare l\'accesso Socio plus con questa password?\n\nVerranno pubblicate anche le modifiche in attesa.');
          if (ok) setPlusToken('');
          return ok;
        }}
      />
      {plusEnvelope && (
        <button
          class="btn btn-danger btn-block"
          disabled={!online}
          onClick={() => run({ stopPlus: true }, 'Disattivare l\'accesso Socio plus per tutti?\n\nChi lo usa potrà solo consultare l\'archivio.')}
        >
          Disattiva il Socio plus
        </button>
      )}
      {plusEnvelope && !access.plusKey && (
        <p class="muted small">Il Socio plus è stato attivato da un altro dispositivo: se cambi la password soci da qui, dovrai impostare di nuovo anche la password Socio plus.</p>
      )}

      {!online && <p class="muted small">Queste operazioni richiedono la connessione.</p>}
      <PublishMessage state={state} onClose={() => setState(null)} />
    </div>
  );
}
