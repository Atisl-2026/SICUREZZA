import { useEffect, useState } from 'preact/hooks';
import { updateSettings, useSettings } from '../lib/settings';
import { PERIODI, type Limiti, type Periodo } from '../lib/usage';

const ETICHETTE: Record<Periodo, string> = { giorno: 'Al giorno', settimana: 'Alla settimana', mese: 'Al mese' };

/** Programmatore: quante richieste AI può fare ogni socio (vuoto = nessun limite). */
export function LimitsEditor({ onSend, canSend }: { onSend?: () => void; canSend?: boolean }) {
  const s = useSettings();
  const [draft, setDraft] = useState<Record<Periodo, string>>({ giorno: '', settimana: '', mese: '' });
  useEffect(() => {
    setDraft({
      giorno: s.limitiSoci.giorno ? String(s.limitiSoci.giorno) : '',
      settimana: s.limitiSoci.settimana ? String(s.limitiSoci.settimana) : '',
      mese: s.limitiSoci.mese ? String(s.limitiSoci.mese) : ''
    });
  }, [JSON.stringify(s.limitiSoci)]);

  const save = (next: Record<Periodo, string>) => {
    const limiti: Limiti = {};
    for (const p of PERIODI) {
      const n = Math.floor(Number(next[p]));
      if (next[p].trim() && Number.isFinite(n) && n > 0) limiti[p] = n;
    }
    updateSettings({ limitiSoci: limiti });
  };

  return (
    <div class="limits">
      <p class="small"><strong>Limite di richieste AI per ogni socio</strong> <span class="muted">(vuoto = nessun limite; tu non hai limiti)</span></p>
      <div class="limits-row">
        {PERIODI.map((p) => (
          <label key={p} class="field">
            <span class="small">{ETICHETTE[p]}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="—"
              value={draft[p]}
              onInput={(e) => setDraft({ ...draft, [p]: (e.target as HTMLInputElement).value })}
              onBlur={() => save(draft)}
            />
          </label>
        ))}
      </div>
      <p class="muted small">
        Una domanda con risposta AI o un'analisi foto = una richiesta (la sola ricerca nei documenti non conta).
        I limiti arrivano ai soci alla prossima <strong>pubblicazione</strong>. Il conteggio avviene sul telefono del socio:
        per un tetto che nessuno può aggirare imposta anche i limiti di spesa sui siti delle AI.
      </p>
      {onSend && (
        <button type="button" class="btn btn-block" disabled={!canSend} onClick={onSend}>Invia i limiti ai soci (pubblica)</button>
      )}
    </div>
  );
}
