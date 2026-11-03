import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { limitMessage, periodKey, recordUse, usageLine, usageStatus } from '../src/lib/usage';
import type { Settings } from '../src/lib/settings';

describe('limiti di richieste AI dei soci', () => {
  it('periodi: giorno, settimana ISO (da lunedì), mese', () => {
    expect(periodKey('giorno', new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03');
    expect(periodKey('mese', new Date(2026, 10, 3))).toBe('2026-11');
    expect(periodKey('settimana', new Date(2026, 10, 2))).toBe(periodKey('settimana', new Date(2026, 10, 8))); // lun → dom
    expect(periodKey('settimana', new Date(2026, 10, 8))).not.toBe(periodKey('settimana', new Date(2026, 10, 9)));
    expect(periodKey('settimana', new Date(2027, 0, 1))).toBe('2026-W53');
  });

  it('conteggio, limite raggiunto e messaggio; si azzera il giorno dopo', async () => {
    const lim = { giorno: 2, settimana: 5 };
    const lun = new Date(2026, 10, 2, 10);
    expect((await usageStatus(lim, lun)).superato).toBeUndefined();
    await recordUse(lun);
    const u1 = await usageStatus(lim, lun);
    expect(usageLine(u1)).toBe('1 di 2 oggi · 1 di 5 questa settimana');
    await recordUse(lun);
    const u2 = await usageStatus(lim, lun);
    expect(u2.superato).toBe('giorno');
    expect(limitMessage(u2)).toBe('Hai utilizzato l\'AI 2 volte oggi: la risposta AI è disattivata fino a domani. Puoi continuare a cercare nei documenti.');
    // il giorno dopo si riparte, ma la settimana continua a contare
    const mar = new Date(2026, 10, 3, 9);
    const u3 = await usageStatus(lim, mar);
    expect(u3.superato).toBeUndefined();
    expect(u3.usate).toMatchObject({ giorno: 0, settimana: 2 });
    for (let i = 0; i < 3; i++) await recordUse(mar);
    const u4 = await usageStatus(lim, mar);
    expect(u4.superato).toBe('giorno');
    const mer = new Date(2026, 10, 4, 9);
    const u5 = await usageStatus(lim, mer);
    expect(u5.superato).toBe('settimana');
    expect(limitMessage(u5)).toMatch(/5 volte questa settimana: la risposta AI è disattivata fino a lunedì/);
  });

  it('il conteggio resta anche uscendo dall\'accesso', async () => {
    const { logout } = await import('../src/lib/access');
    const d = new Date(2026, 11, 1, 10);
    await recordUse(d);
    await logout();
    expect((await usageStatus({ giorno: 10 }, d)).usate.giorno).toBe(1);
  });
});

describe('scelta dell\'AI del programmatore', () => {
  it('l\'AI scelta si prova per prima, anche se è a pagamento «solo come riserva»', async () => {
    const { runAi, resetRouter } = await import('../src/lib/router');
    resetRouter();
    const s: Settings = {
      autoCheck: true, webCheck: false, categorie: [], documento: '', apiKey: 'AIza', model: 'gemini-flash-latest',
      riserve: { groq: { apiKey: 'g', model: 'llama-x' }, openai: { apiKey: 'sk', model: 'gpt-5.2' } },
      usoPagamento: 'riserva', condividiPagamento: false, usaAi: true, aiScelta: 'openai', limitiSoci: {}, limitiAi: {}
    };
    const urls: string[] = [];
    const { buildDbRequest } = await import('../src/shared/gemini.ts');
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const a = await runAi(s, { request: buildDbRequest('q', []), timeoutMs: 5000, signal: new AbortController().signal });
      expect(a).toMatchObject({ fornitore: 'openai', servizio: 'ChatGPT', modello: 'gpt-5.2' });
      expect(urls[0]).toBe('https://api.openai.com/v1/chat/completions');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
