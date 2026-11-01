import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveKey, deriveKeyFor } from '../src/shared/crypto.ts';
import { readDocx, readXlsx, readPptx, sheetsToRecords, docToRecords, type ExtractContext } from '../src/shared/extract.ts';
import { buildPublication, openSoci, serializeDemo, serializeSoci, type SociFile } from '../src/shared/publish.ts';
import type { DbFile, StoredRecord } from '../src/shared/types.ts';

const sample: DbFile = JSON.parse(readFileSync('tests/fixtures/esempio.json', 'utf8'));
const PW = 'password-soci-test';
const FAST = 1000;

// ------------------------------------------------------------------ GitHub simulato in memoria

interface FakeRepo {
  files: Record<string, string>;
  head: string;
  commits: { sha: string; message: string; files: string[] }[];
  blobs: Map<string, string>;
  trees: Map<string, { path: string; sha: string }[]>;
  pendingCommits: Map<string, { tree: string; message: string; parent: string }>;
  /** se impostato, il prossimo aggiornamento del ramo fallisce (qualcun altro ha pubblicato) */
  raceOnce?: boolean;
}

function fakeGitHub(repo: FakeRepo) {
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  return vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input), 'https://atisl-2026.github.io');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;

    // GitHub Pages: data/*.json pubblicati
    const page = url.pathname.match(/\/(data\/[\w.]+)$/);
    if (url.host === 'atisl-2026.github.io' && page) {
      const f = repo.files[page[1]];
      return f ? new Response(f, { status: 200 }) : json(404, {});
    }
    if (url.host !== 'api.github.com') return json(404, {});
    const auth = (init.headers as Record<string, string>)?.Authorization;
    if (auth !== 'Bearer github_pat_OK') return json(401, { message: 'Bad credentials' });

    const p = url.pathname.replace('/repos/Atisl-2026/SICUREZZA', '');
    if (p === '') return json(200, { full_name: 'Atisl-2026/SICUREZZA', default_branch: 'main', permissions: { push: true } });
    const contents = p.match(/^\/contents\/(.+)$/);
    if (contents) {
      const f = repo.files[decodeURIComponent(contents[1])];
      return f ? new Response(f, { status: 200 }) : json(404, { message: 'Not Found' });
    }
    if (p === '/git/ref/heads/main') return json(200, { object: { sha: repo.head } });
    if (p.startsWith('/git/commits/') && method === 'GET') return json(200, { tree: { sha: `tree-of-${p.split('/').pop()}` } });
    if (p === '/git/blobs') { const sha = `blob${++n}`; repo.blobs.set(sha, body.content); return json(201, { sha }); }
    if (p === '/git/trees') { const sha = `tree${++n}`; repo.trees.set(sha, body.tree); return json(201, { sha }); }
    if (p === '/git/commits') {
      const sha = `commit${++n}`;
      repo.pendingCommits.set(sha, { tree: body.tree, message: body.message, parent: body.parents[0] });
      return json(201, { sha, html_url: `https://github.com/Atisl-2026/SICUREZZA/commit/${sha}` });
    }
    if (p === '/git/refs/heads/main' && method === 'PATCH') {
      const c = repo.pendingCommits.get(body.sha)!;
      if (repo.raceOnce || c.parent !== repo.head) { repo.raceOnce = false; return json(422, { message: 'Update is not a fast forward' }); }
      const entries = repo.trees.get(c.tree)!;
      for (const e of entries) repo.files[e.path] = repo.blobs.get(e.sha)!;
      repo.head = body.sha;
      repo.commits.push({ sha: body.sha, message: c.message, files: entries.map((e) => e.path) });
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: `non simulato: ${method} ${p}` });
  });
}

async function initialRepo(): Promise<FakeRepo> {
  const key = await deriveKey(PW, undefined, FAST);
  const pub = await buildPublication(sample.records, key, { versione: '2026.01.01.000000' });
  return {
    files: { 'data/demo.json': serializeDemo(pub.demo), 'data/soci.json': serializeSoci(pub.soci) },
    head: 'commit0',
    commits: [],
    blobs: new Map(),
    trees: new Map(),
    pendingCommits: new Map()
  };
}

const newRecord = (id: string, extra: Partial<StoredRecord> = {}): StoredRecord => ({
  id, titolo: `Scheda ${id}`, testo: `Testo della scheda ${id}.`, categoria: 'Prove', tag: [], fonte: '', data_aggiornamento: '2026-11-01',
  origine: 'locale', salvato_il: 0, ...extra
});

describe('pubblicazione dal telefono (GitHub simulato)', () => {
  let repo: FakeRepo;

  beforeEach(async () => {
    repo = await initialRepo();
    vi.stubGlobal('location', { origin: 'https://atisl-2026.github.io', href: 'https://atisl-2026.github.io/SICUREZZA/' });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', fakeGitHub(repo));
    const { logout } = await import('../src/lib/access');
    await logout();
    const { setMeta } = await import('../src/lib/db');
    await setMeta('eliminateDaPubblicare', []);
  });
  afterEach(() => vi.unstubAllGlobals());

  const soci = () => JSON.parse(repo.files['data/soci.json']) as SociFile;
  const demo = () => JSON.parse(repo.files['data/demo.json']) as DbFile;

  it('nuova scheda, modifica ed eliminazione arrivano ai soci in un unico commit', async () => {
    const { loginAdmin, logout, loginSocio } = await import('../src/lib/access');
    const { putRecords, deleteRecords, db } = await import('../src/lib/db');
    const { publish, getPending, trackDeletion } = await import('../src/lib/publisher');
    await loginAdmin('github_pat_OK', PW, 'Atisl-2026/SICUREZZA');

    await putRecords([newRecord('nuova-riservata'), newRecord('nuova-demo', { demo: true })]);
    const ferie = (await db.records.get('procedure-richiesta-ferie'))!;
    await putRecords([{ ...ferie, testo: 'Nuova procedura ferie.', modificato: true }]);
    await trackDeletion('formazione-antincendio-punti-chiave');
    await deleteRecords(['formazione-antincendio-punti-chiave']);
    expect(await getPending()).toMatchObject({ nuove: 2, modificate: 1, eliminate: 1, totale: 4 });

    const res = await publish();
    expect(res.schede).toBe(sample.records.length + 1);
    expect(repo.commits).toHaveLength(1);
    expect(repo.commits[0].files.sort()).toEqual(['data/demo.json', 'data/soci.json']);
    expect(repo.commits[0].message).toMatch(/2 nuove, 1 modificate, 1 eliminate/);
    expect(await getPending()).toMatchObject({ totale: 0 });

    // il file pubblicato è cifrato e la demo contiene solo le schede demo
    expect(repo.files['data/soci.json']).not.toContain('nuova-riservata');
    expect(demo().records.map((r) => r.id)).toContain('nuova-demo');
    expect(demo().records.map((r) => r.id)).not.toContain('nuova-riservata');

    // un socio vede le modifiche
    await logout();
    await loginSocio(PW);
    expect(await db.records.get('nuova-riservata')).toBeTruthy();
    expect((await db.records.get('procedure-richiesta-ferie'))!.testo).toBe('Nuova procedura ferie.');
    expect(await db.records.get('formazione-antincendio-punti-chiave')).toBeUndefined();
  });

  it('cambio password soci: i soci con la vecchia vengono fermati, la nuova funziona', async () => {
    const { loginAdmin, logout, loginSocio } = await import('../src/lib/access');
    const { publish } = await import('../src/lib/publisher');
    const { checkRemote } = await import('../src/lib/remote');
    await loginSocio(PW); // il socio entra con la vecchia password
    await logout();
    await loginAdmin('github_pat_OK', PW, 'Atisl-2026/SICUREZZA');
    await expect(publish({ newSociPassword: 'corta' })).rejects.toThrow(/almeno 8/);
    await publish({ newSociPassword: 'nuova-password-soci' });
    expect(repo.commits[0].message).toMatch(/nuova password soci/);
    await expect(openSoci(soci(), await deriveKeyFor(PW, soci().cifrato))).rejects.toThrow();
    expect((await openSoci(soci(), await deriveKeyFor('nuova-password-soci', soci().cifrato))).records.length).toBe(sample.records.length);

    // il programmatore resta dentro con la nuova chiave e può ripubblicare
    expect((await checkRemote()).stato).toBe('aggiornato');
    await logout();
    await expect(loginSocio(PW)).rejects.toThrow(/Password/);
    await loginSocio('nuova-password-soci');
  });

  it('password AI: condivisione, uso da parte del socio, revoca', async () => {
    const { loginAdmin, logout, loginSocio, unlockAi, getAccess, aiAllowed } = await import('../src/lib/access');
    const { publish } = await import('../src/lib/publisher');
    const { updateSettings, getSettings } = await import('../src/lib/settings');
    const { checkRemote, applyRemote } = await import('../src/lib/remote');
    await loginAdmin('github_pat_OK', PW, 'Atisl-2026/SICUREZZA');
    await expect(publish({ aiPassword: 'password-ai-1' })).rejects.toThrow(/chiave Gemini o una AI di riserva/);
    await updateSettings({ apiKey: 'AIzaMIA', model: 'gemini-2.5-flash', riserve: { groq: { apiKey: 'gsk_MIA' }, mistral: { apiKey: '  ' } } });
    await publish({ aiPassword: 'password-ai-1' });
    expect(repo.files['data/soci.json']).not.toContain('AIzaMIA');
    expect(repo.files['data/soci.json']).not.toContain('gsk_MIA');

    await logout();
    expect((await getSettings()).riserve).toEqual({}); // uscendo si cancellano anche le chiavi di riserva
    await loginSocio(PW);
    await unlockAi('password-ai-1');
    expect((await getSettings()).apiKey).toBe('AIzaMIA');
    expect((await getSettings()).riserve).toEqual({ groq: { apiKey: 'gsk_MIA' } }); // le riserve arrivano ai soci

    // il programmatore smette di condividere
    await logout();
    await loginAdmin('github_pat_OK', PW, 'Atisl-2026/SICUREZZA');
    await updateSettings({ apiKey: 'AIzaMIA' });
    await publish({ stopAi: true });
    await logout();
    await loginSocio(PW);
    await expect(unlockAi('password-ai-1')).rejects.toThrow(/non ha condiviso/);
    expect(aiAllowed(await getAccess())).toBe(false);

    // e se la condivide di nuovo con un'altra password, chi aveva la vecchia la perde
    await logout();
    await loginAdmin('github_pat_OK', PW, 'Atisl-2026/SICUREZZA');
    await updateSettings({ apiKey: 'AIzaMIA' });
    await publish({ aiPassword: 'password-ai-1' });
    await logout();
    await loginSocio(PW);
    await unlockAi('password-ai-1');
    const { setAccess, getAccess: ga } = await import('../src/lib/access');
    const { getMeta, setMeta } = await import('../src/lib/db');
    const socio = (await ga())!;
    const versioneSocio = await getMeta<string>('versione', '');
    await logout();
    await loginAdmin('github_pat_OK', PW, 'Atisl-2026/SICUREZZA');
    await updateSettings({ apiKey: 'AIzaMIA' });
    await publish({ aiPassword: 'password-ai-2' });
    // il telefono del socio (stato salvato prima) riceve l'aggiornamento
    await setAccess(socio);
    await setMeta('versione', versioneSocio);
    const res = await checkRemote();
    if (res.stato !== 'disponibile') throw new Error(res.stato);
    expect((await applyRemote(res.versione, res.records, res.ai)).avvisoAi).toMatch(/password AI è cambiata/);
  });

  it('conflitto: se su GitHub c\'è una versione più recente non sovrascrive nulla', async () => {
    const { loginAdmin } = await import('../src/lib/access');
    const { publish, PublishConflictError } = await import('../src/lib/publisher');
    const { putRecords } = await import('../src/lib/db');
    await loginAdmin('github_pat_OK', PW, 'Atisl-2026/SICUREZZA');
    // un altro telefono pubblica nel frattempo
    const key = await deriveKeyFor(PW, soci().cifrato);
    const other = await buildPublication(sample.records.slice(0, 2), key, { versione: '2099.01.01.000000' });
    repo.files['data/soci.json'] = serializeSoci(other.soci);
    await putRecords([newRecord('mia')]);
    await expect(publish()).rejects.toBeInstanceOf(PublishConflictError);
    expect(repo.commits).toHaveLength(0);
  });

  it('corsa: il ramo è cambiato durante la pubblicazione → errore, nessun file sovrascritto', async () => {
    const { loginAdmin } = await import('../src/lib/access');
    const { publish } = await import('../src/lib/publisher');
    await loginAdmin('github_pat_OK', PW, 'Atisl-2026/SICUREZZA');
    const before = repo.files['data/soci.json'];
    repo.raceOnce = true;
    await expect(publish()).rejects.toMatchObject({ kind: 'conflitto' });
    expect(repo.files['data/soci.json']).toBe(before);
  });

  it('codice GitHub non valido → errore chiaro', async () => {
    const { loginAdmin } = await import('../src/lib/access');
    await expect(loginAdmin('github_pat_SBAGLIATO', PW, 'Atisl-2026/SICUREZZA')).rejects.toMatchObject({ kind: 'token' });
  });

  it('password soci dimenticata: si riparte dalle schede demo con una nuova password', async () => {
    const { loginAdminReset, logout, loginSocio } = await import('../src/lib/access');
    const { publish, getPending } = await import('../src/lib/publisher');
    const { db, putRecords } = await import('../src/lib/db');
    await loginAdminReset('github_pat_OK', 'password-nuova-1', 'Atisl-2026/SICUREZZA');
    const nDemo = sample.records.filter((r) => r.demo).length;
    expect(await db.records.count()).toBe(nDemo);
    expect((await getPending()).nuove).toBe(nDemo);
    await putRecords([newRecord('reimportata')]);
    await publish();
    await logout();
    await expect(loginSocio(PW)).rejects.toThrow();
    await loginSocio('password-nuova-1');
    expect(await db.records.count()).toBe(nDemo + 1);
  });
});

// ------------------------------------------------------------------ estrazione (anche nel browser)

describe('estrazione dei documenti', () => {
  const ctx = (label: string, categoria = 'Prove'): ExtractContext => ({
    fileId: 'prove-file', label, fallbackTitle: 'File', warn: () => {},
    defaults: { categoria, tag: [], fonte: label, data_aggiornamento: '2026-11-01', demo: false }
  });

  it('Word di LibreOffice: titolo, elenchi e tabelle per riga', () => {
    const d = readDocx(new Uint8Array(readFileSync('tests/fixtures/prova-libreoffice.docx')));
    expect(d.title).toBe('Procedura DPI cantiere');
    expect(d.text).toContain('- Casco di protezione\n- Scarpe antinfortunistiche S3');
    expect(d.text).toContain('Casco | ogni 5 anni');
    expect(d.text).toContain("l'uso dei dispositivi di protezione individuale");
  });

  it('Excel: FAQ una scheda per riga, registro con date gg/mm/aaaa', () => {
    const faq = sheetsToRecords(readXlsx(new Uint8Array(readFileSync('sorgenti-esempio/faq/faq-helpdesk.xlsx'))), ctx('faq-helpdesk.xlsx', 'FAQ'));
    expect(faq).toHaveLength(4);
    expect(faq[0].tag).toEqual(['password', 'account']);
    const reg = sheetsToRecords(readXlsx(new Uint8Array(readFileSync('sorgenti-esempio/schede-tecniche/registro-dispositivi-sicurezza.xlsx'))), ctx('registro.xlsx'));
    expect(reg).toHaveLength(1);
    expect(reg[0].testo).toContain('Scadenza manutenzione: 31/03/2027');
  });

  it('PowerPoint: testo per diapositiva', () => {
    const d = readPptx(new Uint8Array(readFileSync('sorgenti-esempio/formazione/antincendio-punti-chiave.pptx')));
    expect(d.text).toMatch(/^Slide 1: Formazione antincendio/);
    expect(docToRecords(d, ctx('x.pptx'))).toHaveLength(1);
  });

  it('file non validi: errore comprensibile', () => {
    expect(() => readDocx(new Uint8Array([1, 2, 3]))).toThrow(/danneggiato/);
    expect(() => readXlsx(new Uint8Array(readFileSync('tests/fixtures/prova-libreoffice.docx')))).toThrow(/non è un file Excel/);
  });
});
