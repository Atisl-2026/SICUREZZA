import { db, deleteRecords } from '../lib/db';
import { useLiveQuery } from '../lib/live';
import { navigate } from '../lib/route';
import { trackDeletion } from '../lib/publisher';
import { formatDate } from '../lib/format';
import { articleHref, sectionsFor } from '../lib/articles';
import { headingText, onlineArticleUrl, onlineDocumentUrl, pageAt, sectionAt } from '../shared/articles.ts';
import { highlight } from '../shared/search.ts';
import { Highlighted } from '../components/Highlighted';
import type { StoredRecord } from '../shared/types.ts';

export function isUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

export function RecordDetail({ id, isAdmin, art, q }: { id: string; isAdmin: boolean; art?: number; q?: string }) {
  const data = useLiveQuery(async () => ({
    record: await db.records.get(id),
    blocchi: await db.chunks.where('recordId').equals(id).count()
  }), [id]);

  if (!data) return <p class="muted">Caricamento…</p>;
  const r = data.record;
  if (!r) {
    return (
      <section>
        <a class="back" href="#database">‹ Database</a>
        <p class="muted">Record «{id}» non trovato.</p>
      </section>
    );
  }

  const onDelete = async () => {
    const warn = r.origine === 'remoto'
      ? '\n\nLa scheda sparirà per tutti alla prossima pubblicazione.'
      : '';
    if (!confirm(`Eliminare «${r.titolo}»?${warn}`)) return;
    if (r.origine === 'remoto') await trackDeletion(r.id);
    await deleteRecords([r.id]);
    navigate('database');
  };

  if (art != null) return <ArticleView r={r} pos={art} q={q} />;
  const online = onlineDocumentUrl(r);

  return (
    <article>
      <a class="back" href="#database">‹ Database</a>
      <h2 class="record-title">{r.titolo}</h2>
      <dl class="kv small card">
        {isAdmin && <><dt>Id</dt><dd><code>{r.id}</code></dd></>}
        <dt>Categoria</dt><dd>{r.categoria}</dd>
        <dt>Aggiornato</dt><dd>{formatDate(r.data_aggiornamento)}</dd>
        <dt>Fonte</dt>
        <dd class="break">
          {r.fonte ? (isUrl(r.fonte) ? <a href={r.fonte} target="_blank" rel="noopener noreferrer">{r.fonte}</a> : r.fonte) : '—'}
        </dd>
        {online && !isUrl(r.fonte) && <><dt>Online</dt><dd><a href={online} target="_blank" rel="noopener noreferrer">Testo ufficiale (Normattiva) ↗</a></dd></>}
        {isAdmin && <>
          <dt>Visibile in demo</dt><dd>{r.demo ? 'Sì' : 'No'}</dd>
          <dt>Stato</dt>
          <dd>{r.origine === 'remoto' && !r.modificato ? 'Pubblicata' : 'Da pubblicare'}</dd>
        </>}
      </dl>
      {r.tag.length > 0 && (
        <p class="chips">{r.tag.map((t) => <span class="chip" key={t}>{t}</span>)}</p>
      )}
      <div class="card record-text">{r.testo}</div>
      {isAdmin && (
        <div class="btn-row">
          <a class="btn btn-primary" href={`#database/modifica/${encodeURIComponent(r.id)}`}>Modifica</a>
          <button class="btn btn-danger" onClick={onDelete}>Elimina</button>
        </div>
      )}
    </article>
  );
}

/**
 * Documento aperto su un articolo: intestazione in verde chiaro, parole cercate in giallo,
 * articolo precedente/successivo e collegamento al testo ufficiale online.
 */
function ArticleView({ r, pos, q }: { r: StoredRecord; pos: number; q?: string }) {
  const sections = sectionsFor(r);
  const i = sections.findIndex((s) => s.pos === pos);
  const s = i >= 0 ? sections[i] : sectionAt(sections, pos);
  const idx = s ? sections.indexOf(s) : -1;
  const terms = (q ?? '').split(/\s+/).filter(Boolean);
  const from = s?.pos ?? 0;
  const to = s?.end ?? Math.min(r.testo.length, 4000);
  const text = r.testo.slice(from, to);
  const prev = idx > 0 ? sections[idx - 1] : undefined;
  const next = idx >= 0 && idx < sections.length - 1 ? sections[idx + 1] : undefined;
  const online = s && onlineArticleUrl(r, s, sections);
  const words = terms.length ? highlight(text, terms, s ? [[0, s.headLen]] : []) : highlight(text, [], s ? [[0, s.headLen]] : []);
  const count = words.filter((w) => w.mark).length;

  return (
    <article class="article-view">
      <button type="button" class="back link-btn" onClick={() => history.back()}>‹ Indietro</button>
      <p class="small muted article-doc">
        <a href={`#database/record/${encodeURIComponent(r.id)}`}>{r.titolo}</a> · {r.categoria}
      </p>
      <h2 class="record-title"><span class="art-hl">{s ? headingText(s) : 'Documento'}</span></h2>
      <p class="small muted">
        {count > 0 && <>Parola cercata evidenziata {count} {count === 1 ? 'volta' : 'volte'} in questo articolo · </>}
        {r.pagine?.length
          ? <>pag. {pageAt(r.pagine, from)}{pageAt(r.pagine, Math.max(from, to - 1)) !== pageAt(r.pagine, from) ? `–${pageAt(r.pagine, to - 1)}` : ''} del PDF</>
          : <>posizione nel documento: {Math.round((from / Math.max(1, r.testo.length)) * 100)}%</>}
      </p>
      {online && (
        <p><a class="btn" href={online} target="_blank" rel="noopener noreferrer">Testo ufficiale online (Normattiva) ↗</a></p>
      )}
      <div class="card record-text"><Highlighted segments={words} /></div>
      <nav class="btn-row article-nav" aria-label="Articoli vicini">
        {prev ? <a class="btn" href={articleHref(r.id, prev.pos, terms)}>‹ {prev.label}</a> : <span />}
        {next ? <a class="btn" href={articleHref(r.id, next.pos, terms)}>{next.label} ›</a> : <span />}
      </nav>
      <p class="small"><a href={`#database/record/${encodeURIComponent(r.id)}`}>Apri il documento completo</a></p>
    </article>
  );
}
