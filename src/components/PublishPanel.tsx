import { useState } from 'preact/hooks';
import { publish, PublishConflictError, usePending, type PublishOptions } from '../lib/publisher';
import { GitHubError } from '../shared/github.ts';

export type PublishState = { tipo: 'ok' | 'errore'; testo: string; link?: string } | null;

/** "1 nuova", "3 nuove", … */
export function describePending(p: { nuove: number; modificate: number; eliminate: number; categorie?: boolean }): string {
  const f = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : '');
  return [f(p.nuove, 'nuova', 'nuove'), f(p.modificate, 'modificata', 'modificate'), f(p.eliminate, 'eliminata', 'eliminate'), p.categorie ? 'elenco categorie' : '']
    .filter(Boolean)
    .join(' · ');
}

/** Messaggio chiaro per gli errori di pubblicazione. */
export function publishErrorText(e: unknown): string {
  if (e instanceof PublishConflictError) return e.message;
  if (e instanceof GitHubError) {
    if (e.kind === 'token') return 'Il codice di accesso GitHub non è più valido (forse è scaduto): esci, creane uno nuovo e rientra.';
    return e.message;
  }
  return `Pubblicazione non riuscita: ${(e as Error).message}`;
}

/** Esegue una pubblicazione e restituisce il messaggio da mostrare. */
export async function runPublish(opts?: PublishOptions): Promise<PublishState> {
  try {
    const r = await publish(opts);
    return {
      tipo: 'ok',
      testo: `Pubblicato: ${r.schede} schede (${r.demo} visibili in demo). Tutti i telefoni le riceveranno tra 1–2 minuti.`,
      link: r.url
    };
  } catch (e) {
    return { tipo: 'errore', testo: publishErrorText(e) };
  }
}

export function PublishMessage({ state, onClose }: { state: PublishState; onClose: () => void }) {
  if (!state) return null;
  return (
    <div class={`notice ${state.tipo === 'ok' ? 'notice-ok' : 'notice-error'} publish-msg`} role="status">
      <span>{state.testo}</span>
      {state.link && <a href={state.link} target="_blank" rel="noopener noreferrer" class="small">Vedi su GitHub</a>}
      <button type="button" class="link-btn" onClick={onClose}>Chiudi</button>
    </div>
  );
}

/** Archivio (programmatore): modifiche in attesa e pulsante Pubblica. */
export function PublishPanel({ online }: { online: boolean }) {
  const pending = usePending();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<PublishState>(null);

  const onPublish = async () => {
    if (!pending) return;
    const what = describePending(pending);
    if (!confirm(`Pubblicare per tutti?\n\n${what || 'Nessuna modifica: verrà ripubblicato lo stato attuale.'}\n\nLe schede «visibili in demo» saranno leggibili da chiunque.`)) return;
    setBusy(true);
    setState(null);
    setState(await runPublish());
    setBusy(false);
  };

  const n = pending?.totale ?? 0;
  return (
    <div class={`card publish-panel ${n ? 'has-pending' : ''}`} aria-busy={!pending}>
      <div class="publish-head">
        <div>
          <strong>{!pending ? 'Controllo delle modifiche…' : n ? `${n} ${n === 1 ? 'modifica' : 'modifiche'} da pubblicare` : 'Tutto pubblicato'}</strong>
          {n > 0 && pending && (
            <div class="small muted">
              {describePending(pending)}
            </div>
          )}
        </div>
        <button class="btn btn-primary" disabled={busy || !online || !n} onClick={onPublish}>
          {busy ? 'Pubblicazione…' : 'Pubblica'}
        </button>
      </div>
      {!online && n > 0 && <p class="small muted">Per pubblicare serve la connessione.</p>}
      <PublishMessage state={state} onClose={() => setState(null)} />
    </div>
  );
}
