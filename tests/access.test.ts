import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptJson, decryptWithPassword, deriveKey, encryptJson, fromB64, keyMatches, toB64, WrongPasswordError
} from '../src/shared/crypto.ts';
import { buildPublication, isSociFile, openSoci, serializeDemo, serializeSoci, type AiShare, type Publication } from '../src/shared/publish.ts';
import { normalizeRepo, repoFromPagesUrl, verifyToken, classifyGitHubError } from '../src/shared/github.ts';
import type { DbFile, DbRecord } from '../src/shared/types.ts';

const sample: DbFile = JSON.parse(readFileSync('tests/fixtures/esempio.json', 'utf8'));
const FAST = 1000; // iterazioni ridotte per velocizzare i test

describe('cifratura', () => {
  it('cifra e decifra con la stessa password; il testo cifrato non contiene il contenuto', async () => {
    const key = await deriveKey('password-segreta', undefined, FAST);
    const env = await encryptJson({ testo: 'Regolamento veicoli aziendali' }, key);
    expect(env.dati).not.toContain('Regolamento');
    expect(atob(env.dati)).not.toContain('Regolamento');
    expect(await decryptJson(env, key)).toEqual({ testo: 'Regolamento veicoli aziendali' });
  });

  it('password sbagliata → WrongPasswordError', async () => {
    const key = await deriveKey('giusta-123', undefined, FAST);
    const env = await encryptJson({ a: 1 }, key);
    await expect(decryptWithPassword(env, 'sbagliata-123')).rejects.toBeInstanceOf(WrongPasswordError);
    const ok = await decryptWithPassword<{ a: number }>(env, 'giusta-123');
    expect(ok.value.a).toBe(1);
    expect(keyMatches(ok.key, env)).toBe(true);
  });

  it('file manomesso → errore (AES-GCM autenticato)', async () => {
    const key = await deriveKey('pw-di-prova', undefined, FAST);
    const env = await encryptJson({ a: 1 }, key);
    const bytes = fromB64(env.dati);
    bytes[0] ^= 1;
    await expect(decryptJson({ ...env, dati: toB64(bytes) }, key)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('nuova password (nuovo sale) → la chiave salvata non è più valida', async () => {
    const vecchia = await deriveKey('vecchia-pw', undefined, FAST);
    const nuova = await deriveKey('nuova-pw-1', undefined, FAST);
    const env = await encryptJson({ a: 1 }, nuova);
    expect(keyMatches(vecchia, env)).toBe(false);
    await expect(decryptJson(env, vecchia)).rejects.toThrow(/cambiata/);
  });

  it('stessa password e stesso sale → stessa chiave (i soci non reinseriscono la password)', async () => {
    const a = await deriveKey('pw-uguale', 'c2FsZXNhbGVzYWxlc2FsZQ==', FAST);
    const b = await deriveKey('pw-uguale', 'c2FsZXNhbGVzYWxlc2FsZQ==', FAST);
    expect(a.chiave).toBe(b.chiave);
  });

  it('base64 regge contenuti grandi', () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(fromB64(toB64(big))).toEqual(big);
  });
});

describe('pubblicazione', () => {
  let pub: Publication;
  let key: Awaited<ReturnType<typeof deriveKey>>;
  beforeAll(async () => {
    key = await deriveKey('password-soci', undefined, FAST);
    pub = await buildPublication(sample.records, key, { versione: '2026.01.01.000000' });
  });

  it('demo.json contiene solo le schede demo, in chiaro', () => {
    expect(pub.demo.records.length).toBe(sample.records.filter((r) => r.demo).length);
    expect(pub.demo.records.every((r) => r.demo)).toBe(true);
    expect(JSON.parse(serializeDemo(pub.demo)).records).toHaveLength(pub.demo.records.length);
  });

  it('soci.json non contiene testo leggibile e si apre con la password', async () => {
    const text = serializeSoci(pub.soci);
    for (const r of sample.records) expect(text).not.toContain(r.titolo);
    const file = JSON.parse(text);
    expect(isSociFile(file)).toBe(true);
    expect(file.versione).toBe('2026.01.01.000000');
    const payload = await openSoci(file, key);
    expect(payload.records).toHaveLength(sample.records.length);
  });

  it('la chiave AI condivisa è cifrata separatamente con la password AI', async () => {
    const aiKey = await deriveKey('password-ai', undefined, FAST);
    const ai = await encryptJson({ apiKey: 'AIzaSEGRETA', model: 'gemini-2.5-flash' } satisfies AiShare, aiKey);
    const p = await buildPublication(sample.records, key, { ai });
    expect(serializeSoci(p.soci)).not.toContain('AIza');
    const payload = await openSoci(p.soci, key);
    expect(JSON.stringify(payload)).not.toContain('AIzaSEGRETA'); // il socio senza password AI non la vede
    expect((await decryptJson<AiShare>(payload.ai!, aiKey)).apiKey).toBe('AIzaSEGRETA');
  });
});

describe('GitHub', () => {
  it('normalizeRepo e repoFromPagesUrl', () => {
    expect(normalizeRepo(' https://github.com/Atisl-2026/SICUREZZA.git ')).toBe('Atisl-2026/SICUREZZA');
    expect(normalizeRepo('solo-nome')).toBe('');
    expect(repoFromPagesUrl('https://atisl-2026.github.io/SICUREZZA/#chiedi')).toBe('atisl-2026/SICUREZZA');
    expect(repoFromPagesUrl('https://mario.github.io/')).toBe('mario/mario.github.io');
    expect(repoFromPagesUrl('http://localhost:5173/')).toBe('');
  });

  it('verifyToken: intestazioni corrette e errori chiari', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ full_name: 'A/B', default_branch: 'main', permissions: { push: true } }), { status: 200 }));
    expect(await verifyToken({ token: ' github_pat_X ', repo: 'A/B', fetchImpl: ok })).toEqual({ repo: 'A/B', branch: 'main' });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/A/B');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer github_pat_X');

    const no = (status: number, body = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
    await expect(verifyToken({ token: 't', repo: 'A/B', fetchImpl: no(401) })).rejects.toMatchObject({ kind: 'token' });
    await expect(verifyToken({ token: 't', repo: 'A/B', fetchImpl: no(404) })).rejects.toMatchObject({ kind: 'repo' });
    expect(classifyGitHubError(403, { message: 'Resource not accessible by personal access token' }).kind).toBe('permessi');
  });
});

// ------------------------------------------------------------------ flussi di accesso nell'app

describe('accessi nell\'app', () => {
  const PW = 'password-soci-test';
  const AI_PW = 'password-ai-test';
  let files: Record<string, unknown>;

  const publish = async (records: DbRecord[], opts: { password?: string; aiPassword?: string; versione: string; sameKeyFrom?: string }) => {
    const sociKey = await deriveKey(opts.password ?? PW, opts.sameKeyFrom, FAST);
    const ai = opts.aiPassword
      ? await encryptJson({ apiKey: 'AIzaCONDIVISA', model: 'gemini-2.5-flash' }, await deriveKey(opts.aiPassword, undefined, FAST))
      : undefined;
    const pub = await buildPublication(records, sociKey, { versione: opts.versione, ai });
    files = { 'demo.json': JSON.parse(serializeDemo(pub.demo)), 'soci.json': JSON.parse(serializeSoci(pub.soci)) };
    return pub;
  };

  beforeEach(async () => {
    vi.stubGlobal('location', { origin: 'https://atisl-2026.github.io', href: 'https://atisl-2026.github.io/SICUREZZA/' });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const name = String(url).match(/data\/([\w.]+)\?/)?.[1];
      if (name && files[name]) return new Response(JSON.stringify(files[name]), { status: 200 });
      if (String(url).startsWith('https://api.github.com/repos/')) {
        return new Response(JSON.stringify({ full_name: 'Atisl-2026/SICUREZZA', default_branch: 'main', permissions: { push: true } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
    const { logout } = await import('../src/lib/access');
    await logout();
    await publish(sample.records, { aiPassword: AI_PW, versione: '2026.01.01.000000' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('demo: vede solo le schede demo e non può usare l\'AI', async () => {
    const { loginDemo, getAccess, aiAllowed } = await import('../src/lib/access');
    const { db } = await import('../src/lib/db');
    await loginDemo();
    const ids = (await db.records.toArray()).map((r) => r.id);
    expect(ids.length).toBe(sample.records.filter((r) => r.demo).length);
    expect(ids).not.toContain('normativa-regolamento-veicoli-aziendali');
    expect(aiAllowed(await getAccess())).toBe(false);
  });

  it('socio: password giusta → tutte le schede; sbagliata → errore senza dati', async () => {
    const { loginSocio, getAccess, aiAllowed } = await import('../src/lib/access');
    const { db } = await import('../src/lib/db');
    await expect(loginSocio('sbagliata')).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await db.records.count()).toBe(0);
    expect(await getAccess()).toBeNull();
    await loginSocio(PW);
    expect(await db.records.count()).toBe(sample.records.length);
    const a = await getAccess();
    expect(a?.ruolo).toBe('socio');
    expect(aiAllowed(a)).toBe(false);
  });

  it('socio con password AI: AI sbloccata; il programmatore cambia password AI → AI tolta', async () => {
    const { loginSocio, unlockAi, getAccess, aiAllowed } = await import('../src/lib/access');
    const { getSettings } = await import('../src/lib/settings');
    const { checkRemote, applyRemote } = await import('../src/lib/remote');
    await loginSocio(PW);
    await expect(unlockAi('sbagliata')).rejects.toBeInstanceOf(WrongPasswordError);
    await unlockAi(AI_PW);
    expect(aiAllowed(await getAccess())).toBe(true);
    expect((await getSettings()).apiKey).toBe('AIzaCONDIVISA');

    // nuova pubblicazione con un'altra password AI (stessa password soci)
    const sale = (files['soci.json'] as { cifrato: { kdf: { sale: string } } }).cifrato.kdf.sale;
    await publish(sample.records, { aiPassword: 'altra-password-ai', versione: '2026.02.01.000000', sameKeyFrom: sale });
    const res = await checkRemote();
    expect(res.stato).toBe('disponibile');
    if (res.stato !== 'disponibile') return;
    const { avvisoAi } = await applyRemote(res.versione, res.records, res.ai);
    expect(avvisoAi).toMatch(/password AI è cambiata/);
    expect(aiAllowed(await getAccess())).toBe(false);
    expect((await getSettings()).apiKey).toBe('');
  });

  it('password soci cambiata: il socio conserva i dati vecchi finché non inserisce la nuova', async () => {
    const { loginSocio } = await import('../src/lib/access');
    const { db } = await import('../src/lib/db');
    const { checkRemote, applyWithNewPassword } = await import('../src/lib/remote');
    await loginSocio(PW);
    await publish(sample.records.slice(0, 3), { password: 'nuova-password-soci', versione: '2026.03.01.000000' });
    const res = await checkRemote();
    expect(res.stato).toBe('password-cambiata');
    expect(await db.records.count()).toBe(sample.records.length);
    if (res.stato !== 'password-cambiata') return;
    await expect(applyWithNewPassword(PW, res.file)).rejects.toBeInstanceOf(WrongPasswordError);
    await applyWithNewPassword('nuova-password-soci', res.file);
    expect(await db.records.count()).toBe(3);
    expect((await checkRemote()).stato).toBe('aggiornato');
  });

  it('programmatore: codice GitHub + password soci; primo accesso senza contenuti pubblicati', async () => {
    const { loginAdmin, getAccess, aiAllowed } = await import('../src/lib/access');
    const { db } = await import('../src/lib/db');
    const res = await loginAdmin('github_pat_TEST', PW, 'Atisl-2026/SICUREZZA');
    expect(res.primoAccesso).toBe(false);
    const a = await getAccess();
    expect(a?.ruolo).toBe('admin');
    expect(a?.github).toMatchObject({ repo: 'Atisl-2026/SICUREZZA', branch: 'main' });
    expect(aiAllowed(a)).toBe(true);
    expect(await db.records.count()).toBe(sample.records.length);

    files = {}; // niente pubblicato
    const { logout } = await import('../src/lib/access');
    await logout();
    await expect(loginAdmin('github_pat_TEST', 'corta', 'Atisl-2026/SICUREZZA')).rejects.toThrow(/almeno 8/);
    expect((await loginAdmin('github_pat_TEST', 'nuova-password-1', 'Atisl-2026/SICUREZZA')).primoAccesso).toBe(true);
  });

  it('uscire cancella contenuti, indice, cronologia, chiave e accesso', async () => {
    const { loginSocio, unlockAi, logout, getAccess } = await import('../src/lib/access');
    const { db, getMeta } = await import('../src/lib/db');
    const { searchLocal } = await import('../src/lib/search');
    const { addToHistory } = await import('../src/lib/history');
    const { getSettings } = await import('../src/lib/settings');
    await loginSocio(PW);
    await unlockAi(AI_PW);
    await searchLocal('ferie');
    await addToHistory('domanda riservata');
    await new Promise((r) => setTimeout(r, 50)); // salvataggio dell'indice in background
    await logout();
    expect(await db.records.count()).toBe(0);
    expect(await db.chunks.count()).toBe(0);
    expect(await getMeta('indice', null)).toBeNull();
    expect(await getMeta('cronologia', null)).toBeNull();
    expect(await getAccess()).toBeNull();
    expect((await getSettings()).apiKey).toBe('');
  });
});

describe('versioni', () => {
  it('due pubblicazioni ravvicinate hanno versioni diverse e ordinate', async () => {
    const { newVersion } = await import('../src/shared/publish.ts');
    const { compareVersions } = await import('../src/shared/normalize.ts');
    const a = newVersion(new Date(2026, 10, 1, 13, 1, 27, 5));
    const b = newVersion(new Date(2026, 10, 1, 13, 1, 27, 900));
    expect(a).toBe('2026.11.01.130127.005');
    expect(compareVersions(b, a)).toBeGreaterThan(0);
    // compatibile con le versioni senza millesimi già pubblicate
    expect(compareVersions(a, '2026.11.01.130126')).toBeGreaterThan(0);
  });
});
