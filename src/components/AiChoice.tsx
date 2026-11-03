import { useEffect, useState } from 'preact/hooks';
import { availableAi, nomeFornitore, type Fornitore } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { hasLimits, limitMessage, usageLine, usageStatus, type UsageStatus } from '../lib/usage';
import { isPaid, type ProviderId } from '../shared/providers.ts';

/**
 * Programmatore: quale AI usare, senza restrizioni (anche quelle a pagamento usate «solo come riserva»).
 * Se l'AI scelta non risponde, l'app prova da sola le altre e lo dice.
 */
export function AiChoice() {
  const s = useSettings();
  const list = availableAi(s);
  const label = (f: Fornitore) => `${nomeFornitore(f)}${f !== 'gemini' && isPaid(f as ProviderId) ? ' (a pagamento)' : ''}`;
  const value = list.includes(s.aiScelta as Fornitore) ? s.aiScelta : 'auto';
  return (
    <label class="field ai-choice">
      <span class="small">AI da usare</span>
      <select value={value} onChange={(e) => updateSettings({ aiScelta: (e.target as HTMLSelectElement).value })}>
        <option value="auto">Automatica (prima le gratuite)</option>
        {list.map((f) => <option key={f} value={f}>{label(f)}</option>)}
      </select>
      {value !== 'auto' && <span class="muted small">Se {nomeFornitore(value as Fornitore)} non risponde, l'app prova da sola le altre.</span>}
    </label>
  );
}

/** Socio: stato dei limiti di richieste AI (si aggiorna quando cambia `tick`). */
export function useUsage(tick: number): UsageStatus | null {
  const s = useSettings();
  const [u, setU] = useState<UsageStatus | null>(null);
  const key = JSON.stringify(s.limitiAi);
  useEffect(() => {
    if (!hasLimits(s.limitiAi)) { setU(null); return; }
    usageStatus(s.limitiAi).then(setU).catch(() => setU(null));
  }, [tick, key]);
  return u;
}

/**
 * Socio: richieste AI usate rispetto ai limiti; raggiunto il limite, avviso in evidenza
 * («Hai utilizzato l'AI 20 volte oggi: la risposta AI è disattivata fino a domani»).
 */
export function UsageLine({ tick }: { tick: number }) {
  const u = useUsage(tick);
  if (!u || !usageLine(u)) return null;
  if (u.superato) return <p class="notice notice-error small usage-over" role="alert">{limitMessage(u)}</p>;
  return <p class="small usage-line" role="status">Richieste AI: {usageLine(u)}</p>;
}
