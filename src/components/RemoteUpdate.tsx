import { useEffect, useState } from 'preact/hooks';
import { applyRemote, applyWithNewPassword, checkRemote, type ApplyResult, type RemoteCheck } from '../lib/remote';
import { getSettings } from '../lib/settings';
import { db } from '../lib/db';
import type { RemotePlan } from '../shared/merge.ts';
import { WrongPasswordError } from '../shared/crypto.ts';
import type { Ruolo } from '../lib/access';
import { Contacts } from './Contacts';

type Disponibile = Extract<RemoteCheck, { stato: 'disponibile' }>;
type PasswordCambiata = Extract<RemoteCheck, { stato: 'password-cambiata' }>;

/** Evento globale per chiedere un controllo manuale (pulsante nella schermata Database). */
export const REMOTE_CHECK_EVENT = 'consulta:check-remote';

export function describePlan(p: RemotePlan): string {
  const s = p.stats;
  const parts = [`${s.aggiunti} aggiunti`, `${s.aggiornati} aggiornati`, `${s.rimossi} rimossi`];
  if (s.conservati) parts.push(`${s.conservati} modificati da te e conservati`);
  return parts.join(', ');
}

/**
 * All'avvio (se online e l'opzione è attiva) controlla se esistono contenuti più recenti
 * per il proprio accesso e chiede conferma prima di aggiornare.
 */
export function RemoteUpdate({ ruolo }: { ruolo: Ruolo }) {
  const [offer, setOffer] = useState<Disponibile | null>(null);
  const [pwChanged, setPwChanged] = useState<PasswordCambiata | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState<{ testo: string; tipo: 'ok' | 'errore' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);

  const run = async (manuale: boolean) => {
    setMsg(null);
    const res = await checkRemote();
    setEmpty((await db.records.count()) === 0);
    if (res.stato === 'disponibile') setOffer(res);
    else if (res.stato === 'password-cambiata') setPwChanged(res);
    else if (manuale && res.stato === 'aggiornato') setMsg({ testo: `Contenuti già aggiornati (versione ${res.versione}).`, tipo: 'ok' });
    else if (manuale && res.stato === 'errore') setMsg({ testo: res.messaggio, tipo: 'errore' });
  };

  // i messaggi positivi si chiudono da soli; gli errori restano finché l'utente non li chiude
  useEffect(() => {
    if (msg?.tipo !== 'ok') return;
    const t = setTimeout(() => setMsg(null), 8000);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    (async () => {
      const { autoCheck } = await getSettings();
      if (autoCheck && navigator.onLine) await run(false);
    })();
    const onManual = () => run(true);
    window.addEventListener(REMOTE_CHECK_EVENT, onManual);
    return () => window.removeEventListener(REMOTE_CHECK_EVENT, onManual);
  }, [ruolo]);

  const done = (versione: string, r: ApplyResult) => {
    setMsg({
      testo: `Contenuti aggiornati alla versione ${versione}: ${describePlan(r.plan)}.${r.avvisoAi ? ` ${r.avvisoAi}` : ''}`,
      tipo: r.avvisoAi ? 'errore' : 'ok'
    });
  };

  const confirm = async () => {
    if (!offer) return;
    setBusy(true);
    try {
      done(offer.versione, await applyRemote(offer.versione, offer.records, offer.ai, offer.categorie));
    } catch (e) {
      setMsg({ testo: `Aggiornamento non riuscito: ${(e as Error).message}`, tipo: 'errore' });
    } finally {
      setOffer(null);
      setBusy(false);
    }
  };

  const submitNewPassword = async (e: Event) => {
    e.preventDefault();
    if (!pwChanged) return;
    setBusy(true);
    try {
      done(pwChanged.file.versione, await applyWithNewPassword(newPassword, pwChanged.file));
      setPwChanged(null);
      setNewPassword('');
    } catch (err) {
      setMsg({ testo: err instanceof WrongPasswordError ? 'Password non corretta.' : (err as Error).message, tipo: 'errore' });
    } finally {
      setBusy(false);
    }
  };

  if (pwChanged) {
    return (
      <form class="banner banner-col" role="alertdialog" aria-labelledby="pw-t" onSubmit={submitNewPassword}>
        <div>
          <strong id="pw-t">La password dei soci è cambiata</strong>
          <div class="small">Inserisci la nuova password per ricevere i contenuti aggiornati. Fino ad allora vedi quelli già scaricati.</div>
        </div>
        <input
          type="password"
          autocomplete="current-password"
          aria-label="Nuova password soci"
          value={newPassword}
          onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
        />
        {msg?.tipo === 'errore' && <span class="small banner-error-text">{msg.testo}</span>}
        <div class="btn-row">
          <button type="button" class="btn" disabled={busy} onClick={() => setPwChanged(null)}>Più tardi</button>
          <button type="submit" class="btn btn-primary" disabled={busy || !newPassword}>{busy ? 'Verifica…' : 'Conferma'}</button>
        </div>
        {ruolo === 'socio' && <Contacts intro="Non hai la nuova password?" />}
      </form>
    );
  }

  if (offer) {
    return (
      <div class="banner banner-col" role="alertdialog" aria-labelledby="ru-t">
        <div>
          <strong id="ru-t">{empty ? 'Scarica i contenuti' : 'Aggiornamento dei contenuti disponibile'}</strong>
          <div class="small">
            Versione {offer.versione} · {offer.records.length} schede
            {offer.versioneLocale ? ` (attuale: ${offer.versioneLocale})` : ''}
          </div>
          {!empty && ruolo === 'admin' && <div class="small muted">Le schede modificate da te e non ancora pubblicate non verranno toccate.</div>}
        </div>
        <div class="btn-row">
          <button class="btn" disabled={busy} onClick={() => setOffer(null)}>Più tardi</button>
          <button class="btn btn-primary" disabled={busy} onClick={confirm}>
            {busy ? 'Aggiornamento…' : empty ? 'Scarica' : 'Aggiorna'}
          </button>
        </div>
      </div>
    );
  }

  if (msg) {
    return (
      <div class={`banner ${msg.tipo === 'errore' ? 'banner-error' : ''}`} role="status">
        <span class="small">{msg.testo}</span>
        <button class="btn" onClick={() => setMsg(null)}>OK</button>
      </div>
    );
  }
  return null;
}
