import { useState } from 'preact/hooks';
import { IconSend } from '../components/Icons';

interface Props {
  online: boolean;
}

// FASE 1: interfaccia di base. Ricerca locale (fase 3) e Gemini (fase 4) arriveranno dopo.
export function AskPage({ online }: Props) {
  const [question, setQuestion] = useState('');
  const [webCheck, setWebCheck] = useState(false);

  const submit = (e: Event) => {
    e.preventDefault();
  };

  return (
    <section aria-labelledby="ask-title">
      <h2 id="ask-title" class="sr-only">Chiedi</h2>
      <form class="search-box" onSubmit={submit}>
        <label for="q" class="sr-only">La tua domanda</label>
        <textarea
          id="q"
          rows={2}
          placeholder="Scrivi una domanda…"
          value={question}
          enterkeyhint="search"
          onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
        />
        <button class="btn btn-primary" type="submit" aria-label="Cerca" disabled={!question.trim()}>
          <IconSend />
        </button>
      </form>

      <div class="card">
        <label class="switch">
          <span>
            Verifica anche sul web
            <br />
            <span class="muted small">
              {online ? 'Seconda ricerca con Google tramite Gemini' : 'Disponibile quando sei online'}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={webCheck && online}
            disabled={!online}
            onChange={(e) => setWebCheck((e.target as HTMLInputElement).checked)}
          />
        </label>
      </div>

      <div class="card">
        <h3>Domande recenti</h3>
        <p class="muted small">Nessuna domanda ancora.</p>
      </div>
    </section>
  );
}
