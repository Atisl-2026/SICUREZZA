import { useState } from 'preact/hooks';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '../lib/claude';
import { GeminiError } from '../shared/gemini.ts';
import { listChatModels, pickModel, PROVIDERS, type ProviderId, type ProviderKey } from '../shared/providers.ts';

const LIMITI: Record<'anthropic' | 'openai', string> = {
  anthropic: 'https://console.anthropic.com/settings/limits',
  openai: 'https://platform.openai.com/settings/organization/limits'
};

/**
 * AI a pagamento (Claude di Anthropic e ChatGPT di OpenAI): credito prepagato, nessun abbonamento.
 * Si possono usare solo quando le gratuite non rispondono (si spende meno) oppure sempre per prime.
 */
export function PaidSettings({ online }: { online: boolean }) {
  const s = useSettings();
  return (
    <div class="card">
      <h3>AI a pagamento (Claude e ChatGPT)</h3>
      <p class="muted small">
        Si pagano a consumo con un <strong>credito prepagato</strong>, senza abbonamento: ogni domanda costa pochi
        centesimi (vedi sotto). Imposta sempre un <strong>limite di spesa mensile</strong> sul sito del servizio.
      </p>

      <fieldset class="paid-use">
        <legend class="small">Quando usarle</legend>
        <label class="check-row">
          <input type="radio" name="uso-pagamento" checked={s.usoPagamento !== 'prima'} onChange={() => updateSettings({ usoPagamento: 'riserva' })} />
          <span>Solo se le AI gratuite non rispondono <span class="muted small">(consigliato: si spende solo quando serve)</span></span>
        </label>
        <label class="check-row">
          <input type="radio" name="uso-pagamento" checked={s.usoPagamento === 'prima'} onChange={() => updateSettings({ usoPagamento: 'prima' })} />
          <span>Sempre per prime <span class="muted small">(massima qualità, ogni domanda e ogni foto si paga)</span></span>
        </label>
      </fieldset>

      <PaidBox id="anthropic" value={s.riserve.anthropic} online={online} />
      <PaidBox id="openai" value={s.riserve.openai} online={online} />

      <label class="switch paid-share">
        <span>
          Condividi anche con i soci che hanno la password AI
          <br />
          <span class="muted small">Le loro domande useranno il tuo credito. Dopo averlo attivato, pubblica.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={s.condividiPagamento}
          onChange={(e) => updateSettings({ condividiPagamento: (e.target as HTMLInputElement).checked })}
        />
      </label>
      <p class="muted small">
        Le chiavi restano solo su questo dispositivo (non nel codice, non su GitHub, non nei backup).
      </p>
    </div>
  );
}

function PaidBox({ id, value, online }: { id: 'anthropic' | 'openai'; value?: ProviderKey; online: boolean }) {
  const p = PROVIDERS[id as ProviderId];
  const [key, setKey] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [openaiModels, setOpenaiModels] = useState<string[] | null>(null);
  const keyValue = key ?? value?.apiKey ?? '';
  const configured = !!value?.apiKey?.trim();

  const store = async (patch: Partial<ProviderKey> | null) => {
    const riserve = { ...(await getSettings()).riserve };
    if (patch === null) delete riserve[id];
    else riserve[id] = { apiKey: '', ...riserve[id], ...patch };
    if (riserve[id] && !riserve[id]!.apiKey.trim()) delete riserve[id];
    await updateSettings({ riserve });
  };
  const save = async () => {
    if (key == null) return;
    await store({ apiKey: key.trim() });
    setKey(null);
  };

  const verify = async () => {
    await save();
    setBusy(true);
    setTest(null);
    try {
      if (id === 'anthropic') {
        const { checkClaudeKey } = await import('../lib/claude');
        const ids = await checkClaudeKey(keyValue);
        const model = value?.model || DEFAULT_CLAUDE_MODEL;
        setTest(ids.includes(model)
          ? { ok: true, msg: `Funziona. Modello in uso: ${CLAUDE_MODELS.find((m) => m.id === model)?.nome ?? model}.` }
          : { ok: false, msg: `La chiave funziona, ma il modello «${model}» non risulta disponibile: scegline un altro.` });
      } else {
        const list = await listChatModels('openai', keyValue);
        setOpenaiModels(list.map((m) => m.id).sort());
        const auto = pickModel('openai', list, true);
        setTest(auto ? { ok: true, msg: `Funziona. Modello automatico: ${value?.model || auto}.` } : { ok: false, msg: 'La chiave funziona, ma non ci sono modelli di chat disponibili.' });
      }
    } catch (e) {
      setTest({ ok: false, msg: e instanceof GeminiError ? e.message : (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const claude = CLAUDE_MODELS.find((m) => m.id === (value?.model || DEFAULT_CLAUDE_MODEL));

  return (
    <details class="reserve" open={configured}>
      <summary>
        <strong>{p.nome}{id === 'anthropic' ? ' (Anthropic)' : ' (OpenAI)'}</strong>
        {configured ? <span class="chip chip-demo">attiva</span> : <span class="chip">non configurata</span>}
      </summary>
      <p class="small">{p.piano.charAt(0).toUpperCase() + p.piano.slice(1)}. <span class="muted">Riservatezza: {p.privacy}.</span></p>
      <ol class="small">
        <li>Crea la chiave su <a href={p.keyUrl} target="_blank" rel="noopener noreferrer">{p.keyUrl.replace(/^https:\/\//, '')}</a> e carica un piccolo credito (es. 5–10 $).</li>
        <li>Imposta un limite di spesa: <a href={LIMITI[id]} target="_blank" rel="noopener noreferrer">{LIMITI[id].replace(/^https:\/\//, '')}</a>.</li>
        <li>Incolla la chiave qui e tocca <strong>Verifica</strong> (non consuma credito).</li>
      </ol>
      <label class="field">
        <span class="small">Chiave {p.nome}</span>
        <div class="input-row">
          <input
            type={show ? 'text' : 'password'}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            placeholder={p.keyHint}
            value={keyValue}
            onInput={(e) => { setKey((e.target as HTMLInputElement).value); setTest(null); }}
            onBlur={save}
          />
          <button type="button" class="btn" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Nascondi' : 'Mostra'}</button>
        </div>
      </label>

      {id === 'anthropic' && (
        <label class="field">
          <span class="small">Modello</span>
          <select value={value?.model || DEFAULT_CLAUDE_MODEL} onChange={(e) => store({ model: (e.target as HTMLSelectElement).value })} disabled={!configured}>
            {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          {claude && (
            <span class="muted small">
              {claude.prezzo} per milione di token · una domanda {claude.domanda} · un'analisi foto {claude.foto}
            </span>
          )}
        </label>
      )}
      {id === 'openai' && configured && (
        <label class="field">
          <span class="small">Modello</span>
          <select value={value?.model ?? ''} onChange={(e) => store({ model: (e.target as HTMLSelectElement).value })}>
            <option value="">Automatico (il modello principale più recente)</option>
            {value?.model && !(openaiModels ?? []).includes(value.model) && <option value={value.model}>{value.model}</option>}
            {(openaiModels ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {!openaiModels && <span class="muted small">Tocca «Verifica» per vedere l'elenco dei modelli. Costo indicativo: pochi centesimi a domanda, meno con i modelli «mini».</span>}
        </label>
      )}

      <div class="btn-row">
        <button type="button" class="btn btn-primary" disabled={!keyValue.trim() || !online || busy} onClick={verify}>
          {busy ? 'Verifica…' : 'Verifica'}
        </button>
        {configured && (
          <button type="button" class="btn btn-danger" onClick={async () => { await store(null); setKey(null); setTest(null); setOpenaiModels(null); }}>
            Rimuovi
          </button>
        )}
      </div>
      {test && <p class={`notice ${test.ok ? 'notice-ok' : 'notice-error'} small`} role="status">{test.msg}</p>}
    </details>
  );
}
