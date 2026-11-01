import { useEffect, useRef, useState } from 'preact/hooks';
import { Markdown } from '../components/Markdown';
import { ResultCard } from '../components/ResultCard';
import { CitedDocs } from '../components/CitedDocs';
import { ArticleBadges } from '../components/ArticleBadges';
import { articlesByRecord, passageInfo, resolveArticle } from '../lib/articles';
import { headingText } from '../shared/articles.ts';
import { analyzePhotos, asGeminiError, MAX_PHOTOS, preparePhoto, type PhotoAnalysis, type PhotoStep, type PreparedPhoto } from '../lib/photo';
import { getSettings } from '../lib/settings';
import { citedIds, splitCitations, type GeminiError } from '../shared/gemini.ts';
import { BRAND } from '../branding';
import type { LocalResult } from '../lib/search';

interface PhotoState {
  photos: PreparedPhoto[];
  note: string;
  step: PhotoStep | null;
  result: PhotoAnalysis | null;
  error: GeminiError | null;
  /** testo dell'analisi che sta arrivando */
  partial: { text: string; results: LocalResult[] } | null;
  /** avviso di cambio servizio AI (es. "Gemini: limite raggiunto. Provo con Groq…") */
  avviso: string;
}

// Lo stato sopravvive al cambio di scheda; le foto non vengono salvate sul dispositivo.
let saved: PhotoState = { photos: [], note: '', step: null, result: null, error: null, partial: null, avviso: '' };
let inflight: AbortController | null = null;

const STEPS: { id: PhotoStep; label: string }[] = [
  { id: 'descrizione', label: 'Lettura delle foto' },
  { id: 'ricerca', label: "Ricerca nell'archivio" },
  { id: 'analisi', label: 'Analisi delle criticità' }
];

/** Testo semplice da copiare o condividere: citazioni numerate e, in fondo, i documenti con articoli e fonte. */
function plainReport(r: PhotoAnalysis, note: string): string {
  const recs = new Map(r.results.map((x) => [x.record.id, x.record]));
  const cited = citedIds(r.answer.text, new Set(recs.keys()));
  const body = splitCitations(r.answer.text, new Set(recs.keys()))
    .map((p) => (p.type === 'text' ? p.text : `[${p.ids.map((id) => cited.indexOf(id) + 1).join(', ')}]`))
    .join('')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
  const arts = articlesByRecord(r.results);
  const docs = cited.map((id, i) => {
    const rec = recs.get(id)!;
    const extra = [
      arts.get(id)?.length ? `articoli dei brani consultati: ${arts.get(id)!.map((a) => a.label).join(', ')}` : '',
      rec.fonte ? `fonte: ${rec.fonte}` : ''
    ].filter(Boolean).join('; ');
    return `${i + 1}. ${rec.titolo}${extra ? ` (${extra})` : ''}`;
  });
  const sugg = (r.suggerimenti ?? []).map((x) => {
    const arts = x.results.flatMap((res) => {
      const info = passageInfo(res);
      const w = info.articoli.filter((a) => a.conParola);
      return (w.length ? w : info.articoli.slice(0, 1)).slice(0, 1).map((a) => `${headingText(a.section)} (${res.record.titolo})`);
    });
    return `- ${x.titolo}: ${[...new Set(arts)].join('; ')}`;
  });
  const date = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  return [
    `${BRAND.nome} – Analisi foto del ${date}${note ? `\nOggetto: ${note}` : ''}`,
    body.trim(),
    docs.length ? `Documenti dell'archivio citati:\n${docs.join('\n')}` : '',
    sugg.length ? `Possibili riferimenti nell'archivio (da verificare):\n${sugg.join('\n')}` : '',
    'Analisi automatica di supporto: non sostituisce il sopralluogo né la valutazione del tecnico.'
  ].filter(Boolean).join('\n\n');
}

export function PhotoPage({ online }: { online: boolean }) {
  const [photos, setPhotos] = useState(saved.photos);
  const [note, setNote] = useState(saved.note);
  const [step, setStep] = useState(saved.step);
  const [result, setResult] = useState(saved.result);
  const [error, setError] = useState(saved.error);
  const [partial, setPartial] = useState(saved.partial);
  const [avviso, setAvviso] = useState(saved.avviso);
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
    saved = { photos, note, step, result, error, partial, avviso };
  }, [photos, note, step, result, error, partial, avviso]);

  /** aggiorna anche se nel frattempo l'utente ha cambiato schermata */
  const patch = (p: Partial<PhotoState>) => {
    saved = { ...saved, ...p };
    if (!mounted.current) return;
    if ('step' in p) setStep(p.step ?? null);
    if ('result' in p) setResult(p.result ?? null);
    if ('error' in p) setError(p.error ?? null);
    if ('partial' in p) setPartial(p.partial ?? null);
    if ('avviso' in p) setAvviso(p.avviso ?? '');
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
    patch({ result: null, error: null, partial: null, avviso: '', step: 'descrizione' });
    let scrolled = false;
    const scroll = () => {
      if (scrolled) return;
      scrolled = true;
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };
    try {
      const r = await analyzePhotos(
        photos, note, await getSettings(), ctrl.signal,
        (s) => { if (!ctrl.signal.aborted) patch({ step: s }); },
        (text, results) => {
          if (ctrl.signal.aborted || !text.trim()) return;
          patch({ partial: { text, results } });
          scroll();
        },
        // cambio di servizio AI: l'eventuale testo parziale ricomincia con il nuovo servizio
        (msg) => { if (!ctrl.signal.aborted) patch({ avviso: msg, partial: null }); }
      );
      if (!ctrl.signal.aborted) {
        patch({ result: r, partial: null, step: null });
        scroll();
      }
    } catch (e) {
      if (!ctrl.signal.aborted) patch({ error: asGeminiError(e), partial: null, step: null });
    }
  };

  const reset = () => {
    inflight?.abort();
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setNote('');
    patch({ result: null, error: null, partial: null, avviso: '', step: null });
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

  const shown = result?.results ?? partial?.results ?? [];
  const ids = new Set(shown.map((r) => r.record.id));
  const titles = new Map(shown.map((r) => [r.record.id, r.record.titolo]));
  // articoli citati nell'analisi: in verde, collegati al punto del documento
  const articleLink = (label: string, near: string[]) => resolveArticle(shown, label, near, [...new Set(shown.flatMap((r) => r.terms))]);
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

      {busy && avviso && <p class="ai-switch small" role="status">{avviso}</p>}

      {busy && !partial && (
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

      {partial && !result && (
        <div ref={resultRef} class="photo-result-wrap">
          <article class="card ai-card photo-result" aria-label="Analisi in arrivo" aria-busy="true">
            <Markdown text={partial.text} articleLink={articleLink} ids={ids} label={(id) => String(citedIds(partial.text, ids).indexOf(id) + 1)} titleOf={(id) => titles.get(id) ?? id} />
            <p class="muted small streaming"><span class="spinner" aria-hidden="true" /> L'AI sta scrivendo…</p>
          </article>
        </div>
      )}

      {result && (
        <div ref={resultRef} class="photo-result-wrap">
          <article class="card ai-card photo-result" aria-label="Risultato dell'analisi">
            <Markdown
              articleLink={articleLink}
              text={result.answer.text}
              ids={ids}
              label={(id) => String(cited.indexOf(id) + 1)}
              titleOf={(id) => titles.get(id) ?? id}
            />
            {result.answer.truncated && <p class="muted small">(risposta troncata per lunghezza)</p>}
            <CitedDocs cited={cited} results={result.results} title="Documenti dell'archivio citati" />
            {result.suggerimenti && result.suggerimenti.length > 0 && (
              <div class="cited suggest">
                <h4>Possibili riferimenti nell'archivio (da verificare)</h4>
                <p class="small muted">Per le criticità rimaste senza riferimento l'app ha cercato da sola nell'archivio:</p>
                <ol>
                  {result.suggerimenti.map((x) => (
                    <li key={x.titolo}>
                      <strong>{x.titolo}</strong>
                      {x.results.map((r) => <ArticleBadges key={r.chunkId} r={r} withDoc max={1} />)}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {result.results.length === 0 && !result.suggerimenti?.length && (
              <p class="notice small">Nell'archivio non ci sono schede pertinenti: le criticità indicate non hanno riferimenti normativi. Carica la normativa specifica (es. ponteggi) per avere i riferimenti.</p>
            )}
            <p class="ai-disclaimer">
              Analisi automatica di supporto{result.answer.servizio && result.answer.servizio !== 'Gemini' ? ` (fatta da ${result.answer.servizio}${result.answer.modello ? `, ${result.answer.modello}` : ''}, AI di riserva)` : ''}: può non vedere tutto o sbagliare. Non sostituisce il sopralluogo né la valutazione del tecnico.
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
