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
  limiti: string;
}

export const SYSTEM_PHOTO_DESCRIBE = `Sei un tecnico esperto di sicurezza sul lavoro. Osserva con attenzione le immagini.
Descrivi in italiano, in modo oggettivo, cosa si vede: tipo di opera o luogo di lavoro, attrezzature, opere provvisionali
(ponteggi, parapetti, scale, trabattelli…), macchine, impianti, lavoratori e dispositivi di protezione indossati o mancanti,
condizioni dell'area. Non trarre ancora conclusioni sulle violazioni.
Indica anche le parole chiave tecniche (in italiano, al singolare) utili per cercare la normativa e le procedure pertinenti.
Indica cosa NON è valutabile dalle immagini (parti nascoste, inquadratura, risoluzione, distanze).`;

/** Schema della risposta del passo 1 (risposta JSON strutturata). */
export const DESCRIBE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    descrizione: { type: 'STRING', description: 'Descrizione oggettiva di ciò che si vede, 3-6 frasi' },
    tipo_opera: { type: 'STRING', description: 'Tipo di opera o ambiente, es. "ponteggio metallico fisso", "scavo", "officina"' },
    elementi: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Elementi rilevanti visibili' },
    parole_chiave: { type: 'ARRAY', items: { type: 'STRING' }, description: '5-12 parole chiave tecniche per cercare le norme' },
    limiti: { type: 'STRING', description: 'Cosa non è valutabile dalle immagini' }
  },
  required: ['descrizione', 'tipo_opera', 'elementi', 'parole_chiave', 'limiti']
} as const;

export const SYSTEM_PHOTO_ANALYSIS = `Sei un assistente tecnico per ispettori e tecnici della sicurezza sul lavoro.
Analizzi le immagini di un luogo di lavoro confrontandole con i BRANI DELL'ARCHIVIO forniti (normativa, procedure, schede).
Regole obbligatorie:
1. Rispondi in italiano.
2. Elenca solo le POSSIBILI non conformità che si vedono davvero nelle immagini. Non inventare elementi non visibili.
3. Per ogni non conformità cita tra parentesi quadre l'id del record dell'archivio che contiene il requisito, esattamente come scritto nel brano, ad esempio [normativa-dlgs-81-allegato-xviii]. Non citare id che non compaiono nei brani.
4. Se un problema è evidente ma nessun brano dell'archivio contiene il requisito, scrivi "Riferimento: non presente nell'archivio". NON citare articoli di legge, numeri o norme che non compaiono nei brani.
5. Distingui ciò che è certo da ciò che è dubbio ("sembra", "non si vede chiaramente"). Se le immagini non permettono una valutazione, dillo.
6. Non dare giudizi definitivi di colpevolezza: si tratta di criticità da verificare sul posto.
Usa ESATTAMENTE questa struttura in Markdown:

### Cosa si vede
(2-4 frasi)

### Possibili non conformità
1. **Titolo breve** — descrizione di cosa si vede e perché è un problema. *Gravità*: alta/media/bassa. *Riferimento*: [id] oppure "non presente nell'archivio".
(se non ne trovi, scrivi "Nessuna non conformità evidente dalle immagini.")

### Non valutabile dalle immagini
- …

### Verifiche consigliate sul posto
- …`;

const imageParts = (images: PhotoImage[]) => images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } }));

/** Passo 1: descrizione e parole chiave (risposta JSON). */
export function buildDescribeRequest(images: PhotoImage[], note: string): GeminiRequest {
  const text = note.trim()
    ? `Nota dell'ispettore: ${note.trim()}\n\nDescrivi le immagini.`
    : 'Descrivi le immagini.';
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PHOTO_DESCRIBE }] },
    contents: [{ role: 'user', parts: [...imageParts(images), { text }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: DESCRIBE_SCHEMA }
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
    return { descrizione: text.trim(), tipo_opera: '', elementi: [], parole_chiave: [], limiti: '' };
  }
  return {
    descrizione: String(raw.descrizione ?? '').trim(),
    tipo_opera: String(raw.tipo_opera ?? '').trim(),
    elementi: list(raw.elementi),
    parole_chiave: list(raw.parole_chiave),
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
    `DESCRIZIONE PRELIMINARE: ${desc.descrizione}${desc.tipo_opera ? ` (${desc.tipo_opera})` : ''}`,
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
