import { describe, expect, it } from 'vitest';
import { articlesForChunk, findHeadings } from '../src/shared/articles.ts';
import { chunkText } from '../src/shared/chunk.ts';
import { buildDbRequest, formatContext, SYSTEM_DB } from '../src/shared/gemini.ts';
import { SYSTEM_PHOTO_ANALYSIS } from '../src/shared/vision.ts';
import { toBlocks } from '../src/lib/ai';
import { articlesByRecord } from '../src/lib/articles';
import type { LocalResult } from '../src/lib/search';

const filler = (s: string) => `${s} `.repeat(40).trim();
const testo = `D.Lgs. 81/2008 – Titolo IV, Capo II

Articolo 122 - Ponteggi ed opere provvisionali
1. Nei lavori in quota, ai sensi dell'articolo 107, devono essere adottate adeguate impalcature. ${filler('Le opere provvisionali devono essere allestite con buon materiale.')}

Art. 126
Parapetti
1. Gli impalcati e ponti di servizio, le passerelle, le andatoie, che siano posti ad un'altezza maggiore di 2 metri, devono essere provvisti su tutti i lati verso il vuoto di robusto parapetto e di tavola fermapiede. ${filler('Il parapetto è costituito da uno o più correnti paralleli.')}

Art. 5. Il datore di lavoro garantisce che tutti i lavoratori ricevano informazioni adeguate su ogni rischio presente in cantiere e sulle misure adottate.

Articolo 136-bis (Norme particolari)
Testo.

ALLEGATO XVIII
VIABILITÀ NEI CANTIERI, PONTEGGI E TRASPORTO DEI MATERIALI
2.1.5 I ponteggi devono essere provvisti di parapetti.`;

describe('articoli e allegati', () => {
  it('riconosce le intestazioni (titolo sulla stessa riga, sulla riga dopo o tra parentesi) e ignora i rinvii', () => {
    expect(findHeadings(testo).map((h) => [h.label, h.titolo])).toEqual([
      ['Art. 122', 'Ponteggi ed opere provvisionali'],
      ['Art. 126', 'Parapetti'],
      ['Art. 5', ''], // la riga è già testo: nessun titolo inventato
      ['Art. 136-bis', 'Norme particolari'],
      ['Allegato XVIII', 'VIABILITÀ NEI CANTIERI, PONTEGGI E TRASPORTO DEI MATERIALI']
    ]);
  });

  it('un brano che inizia a metà articolo viene attribuito all\'articolo giusto', () => {
    const chunks = chunkText(testo);
    // brano che inizia dopo l'intestazione dell'Art. 126 (non la contiene)
    const dopo = chunks.find((c) => testo.indexOf(c) > testo.indexOf('Art. 126') && c.includes('correnti paralleli'))!;
    expect(dopo).not.toContain('Art. 126');
    expect(articlesForChunk(testo, dopo).inizio).toBe('Art. 126 – Parapetti');
    // brano a cavallo: inizia nell'Art. 122 e contiene l'inizio dell'Art. 126
    const cavallo = chunks.find((c) => c.includes('Art. 126') && !c.startsWith('Art. 126'))!;
    expect(articlesForChunk(testo, cavallo)).toMatchObject({ inizio: 'Art. 122 – Ponteggi ed opere provvisionali', nelBrano: expect.arrayContaining(['Art. 126 – Parapetti']) });
    const allegato = chunks.at(-1)!;
    expect(articlesForChunk(testo, allegato).nelBrano.concat(articlesForChunk(testo, allegato).inizio ?? ''))
      .toContain('Allegato XVIII – VIABILITÀ NEI CANTIERI, PONTEGGI E TRASPORTO DEI MATERIALI');
    expect(articlesForChunk(testo, 'Il parapetto è costituito da uno o più correnti paralleli.')).toEqual({ inizio: 'Art. 126 – Parapetti', nelBrano: [] });
    expect(articlesForChunk(testo, 'Art. 126\nParapetti\n1. Gli impalcati')).toEqual({ inizio: 'Art. 126 – Parapetti', nelBrano: [] });
  });

  it('testo senza articoli: nessun riferimento', () => {
    expect(articlesForChunk('Procedura ferie: chiedere 5 giorni prima.', 'chiedere 5 giorni')).toEqual({ nelBrano: [] });
  });

  it('i brani passati a Gemini indicano l\'articolo; i prompt chiedono articolo, comma e documento', () => {
    const chunk = 'Il parapetto è costituito da uno o più correnti paralleli.';
    const r = {
      chunkId: 'n#1', recordId: 'normativa-titolo-iv', score: 1, terms: [],
      chunk: { id: 'n#1', recordId: 'normativa-titolo-iv', n: 1, testo: chunk },
      record: { id: 'normativa-titolo-iv', titolo: 'D.Lgs. 81/2008 – Titolo IV', testo, categoria: 'Normativa', tag: [], fonte: 'dlgs81.pdf', data_aggiornamento: '', origine: 'remoto', salvato_il: 0 }
    } as unknown as LocalResult;
    const [b] = toBlocks([r]);
    expect(b.articolo).toBe('Art. 126 – Parapetti');
    expect(formatContext([b])).toContain('articolo: Art. 126 – Parapetti');
    expect(articlesByRecord([r]).get('normativa-titolo-iv')!.map((a) => a.label)).toEqual(['Art. 126']);
    expect(buildDbRequest('parapetti', [b]).contents[0].parts[0]).toMatchObject({ text: expect.stringContaining('articolo: Art. 126') });
    expect(SYSTEM_DB).toMatch(/Art\. 126, comma 1/);
    expect(SYSTEM_PHOTO_ANALYSIS).toMatch(/RIFERIMENTO PRECISO/);
    expect(SYSTEM_PHOTO_ANALYSIS).toMatch(/articolo non indicato nel documento/);
  });
});
