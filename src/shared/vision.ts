// Analisi di foto (cantieri, ponteggi, attrezzature) con Gemini, in due passaggi:
//   1. descrizione della foto + parole chiave per cercare nell'archivio;
//   2. analisi della foto con i brani dell'archivio trovati: possibili non conformità con le fonti citate.
import { formatContext, type ContextBlock, type GeminiRequest } from './gemini.ts';

export interface PhotoImage {
  mimeType: string;
  /** base64 senza intestazione "data:" */
  data: string;
}

export interface PhotoDescription {
  descrizione: string;
  tipo_opera: string;
  elementi: string[];
  parole_chiave: string[];
  /** possibili criticità individuate al primo esame (ognuna si cerca nell'archivio) */
  criticita?: string[];
  limiti: string;
}

// Il passo 1 serve solo a capire cosa cercare nell'archivio: deve essere rapidissimo
// (foto piccole, poco ragionamento, risposta breve). L'analisi vera è al passo 2.
export const SYSTEM_PHOTO_DESCRIBE = `Sei un tecnico della sicurezza sul lavoro. Guarda le immagini e rispondi in modo molto sintetico, in italiano:
che tipo di opera o luogo di lavoro è, cosa si vede di rilevante per la sicurezza (opere provvisionali, attrezzature,
macchine, lavoratori e DPI), le parole chiave tecniche (al singolare) e l'elenco delle POSSIBILI CRITICITÀ visibili.
Ogni criticità è una frase breve con i termini tecnici usati dalla normativa, per cercarla nell'archivio delle norme,
ad esempio: «parapetto mancante sul ponteggio», «deposito di materiali sull'impalcato», «mantovana parasassi assente»,
«tavola fermapiede assente», «ancoraggio del ponteggio», «accesso agli impalcati», «lavoratore senza casco».`;

/** Schema della risposta del passo 1 (risposta JSON strutturata e breve). */
export const DESCRIBE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tipo_opera: { type: 'STRING', description: 'Tipo di opera o ambiente, es. "ponteggio metallico fisso", "scavo", "officina"' },
    descrizione: { type: 'STRING', description: 'Cosa si vede, 1-2 frasi' },
    parole_chiave: { type: 'ARRAY', items: { type: 'STRING' }, description: '5-10 parole chiave tecniche per cercare le norme' },
    elementi: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Elementi rilevanti visibili (al massimo 8)' },
    criticita: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Possibili criticità visibili, una frase breve ciascuna con i termini tecnici (al massimo 8)' },
    limiti: { type: 'STRING', description: 'Cosa non è valutabile dalle immagini (breve, facoltativo)' }
  },
  required: ['tipo_opera', 'descrizione', 'parole_chiave', 'criticita'],
  propertyOrdering: ['tipo_opera', 'descrizione', 'parole_chiave', 'criticita', 'elementi', 'limiti']
} as const;

export const SYSTEM_PHOTO_ANALYSIS = `Sei un assistente tecnico per ispettori e tecnici della sicurezza sul lavoro.
Analizzi le immagini di un luogo di lavoro confrontandole con i BRANI DELL'ARCHIVIO forniti (normativa, procedure, schede).
Regole obbligatorie:
1. Rispondi in italiano.
2. Elenca solo le POSSIBILI non conformità che si vedono davvero nelle immagini. Non inventare elementi non visibili.
3. Per ogni non conformità indica il RIFERIMENTO PRECISO: articolo (o allegato e punto) e comma, presi dal campo "articolo" del brano o dalle intestazioni "Art." / "Allegato" e dai numeri dei commi nel testo del brano; poi il titolo del documento; poi l'id del record tra parentesi quadre, esattamente come scritto nel brano. Esempio: *Riferimento*: Art. 126, comma 1 – «D.Lgs. 81/2008 – Titolo IV» [normativa-dlgs-81-titolo-iv]. Non citare id che non compaiono nei brani.
4. I brani possono usare parole diverse da quelle che useresti tu (es. «deposito di materiali sulle impalcature» per i materiali sul ponteggio, «parasassi» per la mantovana, «opere provvisionali» per i ponteggi): leggili tutti e cita il requisito se il contenuto corrisponde. Se il brano pertinente non riporta il numero dell'articolo, scrivi il titolo del documento e l'id, aggiungendo "(articolo non indicato nel documento)". Se nessun brano contiene il requisito scrivi "Riferimento: non presente nell'archivio".
5. NON citare articoli, commi, allegati o norme che non compaiono nei brani: niente riferimenti a memoria.
6. Distingui ciò che è certo da ciò che è dubbio ("sembra", "non si vede chiaramente"). Se le immagini non permettono una valutazione, dillo.
7. Non dare giudizi definitivi di colpevolezza: si tratta di criticità da verificare sul posto.
Usa ESATTAMENTE questa struttura in Markdown:

### Cosa si vede
(2-4 frasi)

### Possibili non conformità
1. **Titolo breve** — descrizione di cosa si vede e perché è un problema. *Gravità*: alta/media/bassa. *Riferimento*: Art. … , comma … – «titolo del documento» [id] oppure "non presente nell'archivio".
(se non ne trovi, scrivi "Nessuna non conformità evidente dalle immagini.")

### Non valutabile dalle immagini
- …

### Verifiche consigliate sul posto
- …`;

const imageParts = (images: PhotoImage[]) => images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } }));

/** Passo 1: descrizione e parole chiave (risposta JSON). */
export function buildDescribeRequest(images: PhotoImage[], note: string): GeminiRequest {
  const text = note.trim()
    ? `Nota dell'ispettore: ${note.trim()}\n\nDescrivi brevemente le immagini.`
    : 'Descrivi brevemente le immagini.';
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PHOTO_DESCRIBE }] },
    contents: [{ role: 'user', parts: [...imageParts(images), { text }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json', responseSchema: DESCRIBE_SCHEMA }
  };
}

/** Legge la risposta del passo 1 anche se il modello aggiunge testo o blocchi ``` attorno al JSON. */
export function parseDescription(text: string): PhotoDescription {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as Partial<PhotoDescription>;
    } catch {
      return null;
    }
  };
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const braces = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const raw = tryParse(text) ?? (fenced ? tryParse(fenced) : null) ?? (braces ? tryParse(braces) : null);
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  if (!raw) {
    // risposta non strutturata: la si usa comunque come descrizione
    return { descrizione: text.trim(), tipo_opera: '', elementi: [], parole_chiave: [], criticita: [], limiti: '' };
  }
  return {
    descrizione: String(raw.descrizione ?? '').trim(),
    tipo_opera: String(raw.tipo_opera ?? '').trim(),
    elementi: list(raw.elementi),
    parole_chiave: list(raw.parole_chiave),
    criticita: list(raw.criticita).slice(0, 8),
    limiti: String(raw.limiti ?? '').trim()
  };
}

/** Testo da usare per la ricerca nell'archivio: nota, tipo di opera, parole chiave ed elementi. */
export function photoSearchQuery(desc: PhotoDescription, note: string): string {
  const parts = [note, desc.tipo_opera, ...desc.parole_chiave, ...desc.elementi];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  // l'ultima parola vale come prefisso nella ricerca: si chiude con un termine completo
  return out.join(', ').slice(0, 600);
}

/** Passo 2: analisi delle immagini con i brani dell'archivio. */
export function buildAnalysisRequest(images: PhotoImage[], note: string, desc: PhotoDescription, blocks: ContextBlock[]): GeminiRequest {
  const context = blocks.length
    ? `BRANI DELL'ARCHIVIO:\n\n${formatContext(blocks)}`
    : "BRANI DELL'ARCHIVIO: nessun brano pertinente trovato. Non citare riferimenti normativi.";
  const text = [
    context,
    '===',
    (desc.descrizione || desc.tipo_opera) && `DESCRIZIONE PRELIMINARE: ${desc.descrizione}${desc.tipo_opera ? ` (${desc.tipo_opera})` : ''}`,
    desc.criticita?.length && `CRITICITÀ INDIVIDUATE AL PRIMO ESAME (da confermare sulle immagini): ${desc.criticita.join('; ')}`,
    desc.limiti && `LIMITI GIÀ RILEVATI: ${desc.limiti}`,
    note.trim() && `NOTA DELL'ISPETTORE: ${note.trim()}`,
    'Analizza le immagini e indica le possibili non conformità secondo le regole.'
  ].filter(Boolean).join('\n\n');
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PHOTO_ANALYSIS }] },
    contents: [{ role: 'user', parts: [...imageParts(images), { text }] }],
    generationConfig: { temperature: 0.2 }
  };
}

// ============================================================ criticità della risposta

export interface Finding {
  /** titolo della criticità (in grassetto nella risposta) */
  titolo: string;
  /** testo per cercare nell'archivio: titolo e descrizione, senza gravità e riferimento */
  query: string;
  /** l'AI non ha trovato un riferimento nell'archivio */
  senzaRiferimento: boolean;
}

/** Le possibili non conformità della risposta, una per voce numerata. */
export function findingsOf(answer: string): Finding[] {
  const sec = answer.match(/#+\s*Possibili non conformit[àa][^\n]*\n([\s\S]*?)(?=\n#+\s|$)/i)?.[1] ?? '';
  const items = sec.split(/\n(?=\s*\d+[.)]\s)/).map((x) => x.trim()).filter((x) => /^\d+[.)]\s/.test(x));
  return items.map((it) => {
    const body = it.replace(/^\d+[.)]\s*/, '');
    const titolo = (body.match(/\*\*(.+?)\*\*/)?.[1] ?? body.split(/\s[—–-]\s/)[0]).trim();
    const descr = body
      .replace(/\*\*(.+?)\*\*/, '')
      .split(/\*?Gravit[àa]\*?\s*:/i)[0]
      .replace(/^[\s—–-]+/, '')
      .split(/\s+/).slice(0, 25).join(' ');
    const rif = body.match(/\*?Riferimento\*?\s*:\s*([\s\S]*)$/i)?.[1] ?? '';
    return {
      titolo,
      query: `${titolo} ${descr}`.replace(/[*_[\]«»"]/g, ' ').replace(/\s+/g, ' ').trim(),
      senzaRiferimento: /non presente nell.archivio/i.test(rif) || (!!rif && !/\[[^\]]+\]/.test(rif))
    };
  });
}
