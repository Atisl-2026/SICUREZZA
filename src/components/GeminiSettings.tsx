import { useState } from 'preact/hooks';
import { updateSettings, useSettings } from '../lib/settings';
import { AI_STUDIO_KEY_URL, checkModel, cleanModelName, DEFAULT_MODEL, GeminiError } from '../shared/gemini.ts';

const MODEL_SUGGESTIONS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];

export function GeminiSettings({ online }: { online: boolean }) {
  const s = useSettings();
  const [key, setKey] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

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
      setTest({ ok: false, msg: e instanceof GeminiError ? e.message : 'Verifica non riuscita.' });
    } finally {
      setTesting(false);
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
          placeholder={DEFAULT_MODEL}
          value={modelValue}
          onInput={(e) => { setModel((e.target as HTMLInputElement).value); setTest(null); }}
          onBlur={save}
        />
        <datalist id="gemini-models">{MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
        <span class="muted small">
          Predefinito: {DEFAULT_MODEL}. I nomi e i limiti gratuiti cambiano nel tempo: se un modello smette di
          funzionare, controlla i modelli disponibili in AI Studio.
        </span>
      </label>

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
