import { useState } from 'preact/hooks';
import { updateSettings, useSettings } from '../lib/settings';
import {
  AI_STUDIO_KEY_URL, checkModel, cleanModelName, GeminiError, listModels, rankModels, type ModelInfo
} from '../shared/gemini.ts';

export function GeminiSettings({ online }: { online: boolean }) {
  const s = useSettings();
  const [key, setKey] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  const keyValue = key ?? s.apiKey;
  const modelValue = model ?? s.model;

  const save = async () => {
    const patch: { apiKey?: string; model?: string } = {};
    if (key != null) patch.apiKey = key.trim();
    if (model != null) patch.model = cleanModelName(model);
    if (Object.keys(patch).length) await updateSettings(patch);
    setKey(null);
    setModel(null);
  };

  const onTest = async () => {
    await save();
    setTesting(true);
    setTest(null);
    try {
      const info = await checkModel({ apiKey: keyValue, model: modelValue, timeoutMs: 15000 });
      setTest({ ok: true, msg: `Chiave valida. Modello disponibile: ${info.displayName ?? info.name}.` });
    } catch (e) {
      // modello ritirato o scritto male: si sceglie da soli quello consigliato
      if (e instanceof GeminiError && e.kind === 'modello') {
        try {
          const best = rankModels(await listModels({ apiKey: keyValue, model: modelValue, timeoutMs: 15000 }))[0];
          if (best) {
            await updateSettings({ model: best.id });
            setTest({ ok: true, msg: `Chiave valida. Il modello «${cleanModelName(modelValue)}» non è più disponibile: impostato «${best.id}» (${best.displayName}).` });
            return;
          }
        } catch {
          /* si mostra l'errore originale */
        }
      }
      setTest({ ok: false, msg: e instanceof GeminiError ? e.message : 'Verifica non riuscita.' });
    } finally {
      setTesting(false);
    }
  };

  const onShowModels = async () => {
    await save();
    setLoadingModels(true);
    setTest(null);
    try {
      setModels(rankModels(await listModels({ apiKey: keyValue, model: modelValue, timeoutMs: 15000 })));
    } catch (e) {
      setTest({ ok: false, msg: e instanceof GeminiError ? e.message : 'Elenco dei modelli non disponibile.' });
    } finally {
      setLoadingModels(false);
    }
  };

  const onRemove = async () => {
    if (!confirm('Rimuovere la chiave Gemini da questo dispositivo?')) return;
    await updateSettings({ apiKey: '', webCheck: false });
    setKey(null);
    setTest(null);
  };

  return (
    <div class="card">
      <h3>Intelligenza artificiale (Gemini)</h3>

      <div class="privacy-warning" role="note">
        <strong>Attenzione alla riservatezza.</strong> Con il piano gratuito Google può usare le domande e i contenuti
        inviati (inclusi i blocchi del database) per migliorare i propri servizi, anche tramite revisori umani.
        <strong> Non inserire dati personali, sensibili o riservati.</strong>
      </div>

      <details class="howto" open={!s.apiKey}>
        <summary>Come ottenere la chiave gratuita</summary>
        <ol class="small">
          <li>Apri <a href={AI_STUDIO_KEY_URL} target="_blank" rel="noopener noreferrer">Google AI Studio</a> e accedi con un account Google.</li>
          <li>Tocca <strong>Create API key</strong> (Crea chiave API) e accetta i termini.</li>
          <li>Copia la chiave (inizia con <code>AIza…</code>) e incollala qui sotto.</li>
        </ol>
        <p class="muted small">Non serve carta di credito. La chiave resta solo su questo dispositivo: non è nel codice dell'app, non va su GitHub e non è inclusa nei backup.</p>
      </details>

      <label class="field">
        <span class="small">Chiave API</span>
        <div class="input-row">
          <input
            type={show ? 'text' : 'password'}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            placeholder="AIza…"
            value={keyValue}
            onInput={(e) => { setKey((e.target as HTMLInputElement).value); setTest(null); }}
            onBlur={save}
          />
          <button type="button" class="btn" onClick={() => setShow(!show)} aria-pressed={show}>
            {show ? 'Nascondi' : 'Mostra'}
          </button>
        </div>
      </label>

      <label class="field">
        <span class="small">Modello</span>
        <input
          list="gemini-models"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          placeholder="gemini-…-flash"
          value={modelValue}
          onInput={(e) => { setModel((e.target as HTMLInputElement).value); setTest(null); }}
          onBlur={save}
        />
        <datalist id="gemini-models">{(models ?? []).map((m) => <option key={m.id} value={m.id} />)}</datalist>
        <span class="muted small">
          Google ritira periodicamente i modelli: se quello impostato non esiste più, l'app ne sceglie da sola
          uno disponibile. Puoi anche sceglierlo dall'elenco.
        </span>
      </label>

      <button type="button" class="link-btn" disabled={!keyValue.trim() || !online || loadingModels} onClick={onShowModels}>
        {loadingModels ? 'Caricamento dei modelli…' : 'Mostra i modelli disponibili'}
      </button>
      {models && (
        <div class="model-list" role="list">
          {models.length === 0 && <p class="muted small">Nessun modello adatto trovato per questa chiave.</p>}
          {models.slice(0, 12).map((m, i) => (
            <button
              type="button"
              role="listitem"
              key={m.id}
              class={`model-item ${cleanModelName(s.model) === m.id ? 'is-current' : ''}`}
              onClick={async () => { await updateSettings({ model: m.id }); setModel(null); setTest(null); }}
            >
              <span>
                <strong>{m.id}</strong>
                <span class="small muted">{m.displayName}</span>
              </span>
              {cleanModelName(s.model) === m.id ? <span class="chip">in uso</span> : i === 0 ? <span class="chip chip-demo">consigliato</span> : null}
            </button>
          ))}
        </div>
      )}

      <div class="btn-row">
        <button type="button" class="btn btn-primary" disabled={!keyValue.trim() || !online || testing} onClick={onTest}>
          {testing ? 'Verifica…' : 'Verifica chiave'}
        </button>
        {s.apiKey && <button type="button" class="btn btn-danger" onClick={onRemove}>Rimuovi chiave</button>}
      </div>
      {!online && <p class="muted small">La verifica richiede la connessione.</p>}
      {test && <p class={`notice ${test.ok ? 'notice-ok' : 'notice-error'}`} role="status">{test.msg}</p>}
    </div>
  );
}
