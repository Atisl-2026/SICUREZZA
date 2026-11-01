import { useEffect, useState } from 'preact/hooks';
import { applyRemote, checkRemote, type RemoteCheck } from '../lib/remote';
import { getSettings } from '../lib/settings';
import { db } from '../lib/db';
import type { RemotePlan } from '../shared/merge.ts';

type Disponibile = Extract<RemoteCheck, { stato: 'disponibile' }>;

/** Evento globale per chiedere un controllo manuale (pulsante nella schermata Database). */
export const REMOTE_CHECK_EVENT = 'consulta:check-remote';

export function describePlan(p: RemotePlan): string {
  const s = p.stats;
  const parts = [`${s.aggiunti} aggiunti`, `${s.aggiornati} aggiornati`, `${s.rimossi} rimossi`];
  if (s.conservati) parts.push(`${s.conservati} modificati da te e conservati`);
  return parts.join(', ');
}

/**
 * All'avvio (se online e l'opzione è attiva) controlla se esiste una versione più recente del db.json
 * e chiede conferma prima di aggiornare. Mostra anche l'esito dei controlli manuali.
 */
export function RemoteUpdate() {
  const [offer, setOffer] = useState<Disponibile | null>(null);
  const [msg, setMsg] = useState<{ testo: string; tipo: 'ok' | 'errore' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);

  const run = async (manuale: boolean) => {
    setMsg(null);
    const res = await checkRemote();
    setEmpty((await db.records.count()) === 0);
    if (res.stato === 'disponibile') setOffer(res);
    else if (manuale) {
      setMsg(res.stato === 'aggiornato'
        ? { testo: `Il database è già aggiornato (versione ${res.versione}).`, tipo: 'ok' }
        : { testo: res.messaggio, tipo: 'errore' });
    }
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
  }, []);

  const confirm = async () => {
    if (!offer) return;
    setBusy(true);
    try {
      const plan = await applyRemote(offer.versione, offer.records);
      setMsg({ testo: `Database aggiornato alla versione ${offer.versione}: ${describePlan(plan)}.`, tipo: 'ok' });
    } catch (e) {
      setMsg({ testo: `Aggiornamento non riuscito: ${(e as Error).message}`, tipo: 'errore' });
    } finally {
      setOffer(null);
      setBusy(false);
    }
  };

  if (offer) {
    return (
      <div class="banner banner-col" role="alertdialog" aria-labelledby="ru-t">
        <div>
          <strong id="ru-t">{empty ? 'Scarica il database' : 'Aggiornamento del database disponibile'}</strong>
          <div class="small">
            Versione {offer.versione} · {offer.records.length} record
            {offer.versioneLocale ? ` (attuale: ${offer.versioneLocale})` : ''}
          </div>
          {!empty && <div class="small muted">I record creati o modificati da te non verranno toccati.</div>}
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
