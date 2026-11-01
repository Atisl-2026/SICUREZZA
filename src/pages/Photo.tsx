import { useEffect, useRef, useState } from 'preact/hooks';
import { Markdown } from '../components/Markdown';
import { ResultCard } from '../components/ResultCard';
import { analyzePhotos, asGeminiError, MAX_PHOTOS, preparePhoto, type PhotoAnalysis, type PhotoStep, type PreparedPhoto } from '../lib/photo';
import { recordHref } from '../lib/route';
import { getSettings } from '../lib/settings';
import { citedIds, splitCitations, type GeminiError } from '../shared/gemini.ts';
import { BRAND } from '../branding';

interface PhotoState {
  photos: PreparedPhoto[];
  note: string;
  step: PhotoStep | null;
  result: PhotoAnalysis | null;
  error: GeminiError | null;
}

// Lo stato sopravvive al cambio di scheda; le foto non vengono salvate sul dispositivo.
let saved: PhotoState = { photos: [], note: '', step: null, result: null, error: null };
let inflight: AbortController | null = null;

const STEPS: { id: PhotoStep; label: string }[] = [
  { id: 'descrizione', label: 'Lettura delle foto' },
  { id: 'ricerca', label: "Ricerca nell'archivio" },
  { id: 'analisi', label: 'Analisi delle criticità' }
];

/** Testo semplice da copiare o condividere (le citazioni diventano i titoli delle schede). */
function plainReport(r: PhotoAnalysis, note: string): string {
  const titles = new Map(r.results.map((x) => [x.record.id, x.record.titolo]));
  const body = splitCitations(r.answer.text, new Set(titles.keys()))
    .map((p) => (p.type === 'text' ? p.text : `[${p.ids.map((id) => titles.get(id) ?? id).join('; ')}]`))
    .join('')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
  const date = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  return `${BRAND.nome} – Analisi foto del ${date}${note ? `\nOggetto: ${note}` : ''}\n\n${body}\n\nAnalisi automatica di supporto: non sostituisce il sopralluogo né la valutazione del tecnico.`;
}

export function PhotoPage({ online }: { online: boolean }) {
  const [photos, setPhotos] = useState(saved.photos);
  const [note, setNote] = useState(saved.note);
  const [step, setStep] = useState(saved.step);
  const [result, setResult] = useState(saved.result);
  const [error, setError] = useState(saved.error);
  const [prepError, setPrepError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [copied, setCopied] = useState('');
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    saved = { photos, note, step, result, error };
  }, [photos, note, step, result, error]);

  /** aggiorna anche se nel frattempo l'utente ha cambiato schermata */
  const patch = (p: Partial<PhotoState>) => {
    saved = { ...saved, ...p };
    if (!mounted.current) return;
    if ('step' in p) setStep(p.step ?? null);
    if ('result' in p) setResult(p.result ?? null);
    if ('error' in p) setError(p.error ?? null);
  };

  const onFiles = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    setPrepError('');
    setPreparing(true);
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) setPrepError(`Al massimo ${MAX_PHOTOS} foto per analisi.`);
    const added: PreparedPhoto[] = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        added.push(await preparePhoto(f));
      } catch (err) {
        setPrepError((err as Error).message);
      }
    }
    setPhotos([...photos, ...added]);
    setResult(null);
    setError(null);
    setPreparing(false);
  };

  const remove = (i: number) => {
    URL.revokeObjectURL(photos[i].preview);
    setPhotos(photos.filter((_, j) => j !== i));
    setResult(null);
  };

  const analyze = async () => {
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    patch({ result: null, error: null, step: 'descrizione' });
    try {
      const r = await analyzePhotos(photos, note, await getSettings(), ctrl.signal, (s) => patch({ step: s }));
      if (!ctrl.signal.aborted) {
        patch({ result: r, step: null });
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    } catch (e) {
      if (!ctrl.signal.aborted) patch({ error: asGeminiError(e), step: null });
    }
  };

  const reset = () => {
    inflight?.abort();
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setNote('');
    patch({ result: null, error: null, step: null });
  };

  const copy = async () => {
    if (!result) return;
    const text = plainReport(result, note);
    try {
      if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ title: `${BRAND.nome} – Analisi foto`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied('Testo copiato: puoi incollarlo in un verbale o in un messaggio.');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setCopied('Copia non riuscita: seleziona il testo a mano.');
    }
  };

  const ids = new Set(result?.results.map((r) => r.record.id));
  const titles = new Map(result?.results.map((r) => [r.record.id, r.record.titolo]));
  const cited = result ? citedIds(result.answer.text, ids) : [];
  const busy = step !== null;

  return (
    <section class="photo-page">
      <a class="back" href="#chiedi">‹ Chiedi</a>
      <h2>Analisi foto</h2>
      <p class="muted small">
        Fotografa un ponteggio, un cantiere o un'attrezzatura: l'AI individua le possibili criticità e le confronta con
        la normativa e le procedure dell'archivio.
      </p>
      <p class="privacy-warning small">
        Le foto vengono inviate a Google Gemini e sul piano gratuito possono essere usate da Google: evita volti
        riconoscibili, targhe e documenti. La posizione GPS e gli altri dati nascosti della foto vengono rimossi prima dell'invio.
      </p>

      <div class="card">
        {photos.length > 0 && (
          <div class="photo-grid">
            {photos.map((p, i) => (
              <figure key={p.preview} class="photo-thumb">
                <img src={p.preview} alt={`Foto ${i + 1}`} />
                <button type="button" class="photo-remove" aria-label={`Togli la foto ${i + 1}`} disabled={busy} onClick={() => remove(i)}>×</button>
              </figure>
            ))}
          </div>
        )}
        {photos.length < MAX_PHOTOS && (
          <div class="photo-add">
            <button type="button" class="btn btn-primary" disabled={busy || preparing} onClick={() => camera.current?.click()}>📷 Scatta foto</button>
            <button type="button" class="btn" disabled={busy || preparing} onClick={() => gallery.current?.click()}>🖼️ Dalla galleria</button>
          </div>
        )}
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
        <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={onFiles} />
        <p class="muted small photo-count">
          {preparing ? 'Preparazione delle foto…' : `${photos.length} di ${MAX_PHOTOS} foto · più angolazioni aiutano l'analisi`}
        </p>
        {prepError && <p class="notice notice-error small">{prepError}</p>}

        <label class="field">
          <span class="small">Cosa stai controllando? (facoltativo)</span>
          <textarea
            rows={2}
            class="photo-note"
            placeholder="es. ponteggio facciata nord, terzo impalcato"
            value={note}
            disabled={busy}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
        </label>
        <button class="btn btn-primary btn-block" disabled={!photos.length || busy || !online || preparing} onClick={analyze}>
          {busy ? 'Analisi in corso…' : 'Analizza'}
        </button>
        {!online && <p class="muted small">L'analisi delle foto richiede la connessione.</p>}
      </div>

      {busy && (
        <ol class="card photo-steps" aria-live="polite">
          {STEPS.map((s, i) => {
            const cur = STEPS.findIndex((x) => x.id === step);
            const state = i < cur ? 'done' : i === cur ? 'now' : 'todo';
            return (
              <li key={s.id} class={`step-${state}`}>
                {state === 'done' ? '✓' : state === 'now' ? <span class="spinner" aria-hidden="true" /> : '•'} {s.label}
              </li>
            );
          })}
        </ol>
      )}

      {error && (
        <div class="notice notice-error ai-error" role="alert">
          <span>{error.message}</span>
          {['timeout', 'rete', 'sovraccarico', 'sconosciuto', 'vuota'].includes(error.kind) && (
            <button type="button" class="btn" onClick={analyze}>Riprova</button>
          )}
        </div>
      )}

      {result && (
        <div ref={resultRef} class="photo-result-wrap">
          <article class="card ai-card photo-result" aria-label="Risultato dell'analisi">
            <Markdown
              text={result.answer.text}
              ids={ids}
              label={(id) => String(cited.indexOf(id) + 1)}
              titleOf={(id) => titles.get(id) ?? id}
            />
            {result.answer.truncated && <p class="muted small">(risposta troncata per lunghezza)</p>}
            {cited.length > 0 && (
              <div class="cited">
                <h4>Schede dell'archivio citate</h4>
                <ol>{cited.map((id) => <li key={id}><a href={recordHref(id)}>{titles.get(id) ?? id}</a></li>)}</ol>
              </div>
            )}
            {result.results.length === 0 && (
              <p class="notice small">Nell'archivio non ci sono schede pertinenti: le criticità indicate non hanno riferimenti normativi. Carica la normativa specifica (es. ponteggi) per avere i riferimenti.</p>
            )}
            <p class="ai-disclaimer">
              Analisi automatica di supporto: può non vedere tutto o sbagliare. Non sostituisce il sopralluogo né la valutazione del tecnico.
            </p>
            <div class="btn-row photo-actions">
              <button type="button" class="btn" onClick={copy}>Copia / condividi il testo</button>
              <button type="button" class="btn" onClick={reset}>Nuova analisi</button>
            </div>
            {copied && <p class="small muted">{copied}</p>}
          </article>

          {result.query && <p class="small muted photo-query">Cercato nell'archivio: {result.query}</p>}
          {result.results.length > 0 && (
            <>
              <button type="button" class="link-btn" aria-expanded={showBlocks} onClick={() => setShowBlocks(!showBlocks)}>
                {showBlocks ? 'Nascondi i brani consultati' : `Mostra i ${result.results.length} brani consultati`}
              </button>
              {showBlocks && result.results.map((r, i) => <ResultCard key={r.chunkId} r={r} index={i} />)}
            </>
          )}
        </div>
      )}
    </section>
  );
}
