import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, clearAll, db, deleteRecords, getMeta, putRecords } from '../src/lib/db';
import { planRemote } from '../src/shared/merge.ts';
import type { StoredRecord } from '../src/shared/types.ts';

const long = 'Frase di prova per il database locale. '.repeat(100);
const r = (id: string, testo = 'breve'): StoredRecord => ({
  id, titolo: id, testo, categoria: 'Test', tag: ['t'], fonte: '', data_aggiornamento: '2025-01-01', origine: 'locale', salvato_il: 0
});

describe('database IndexedDB (Dexie)', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('salva i record e genera i blocchi collegati', async () => {
    await putRecords([r('a', long), r('b')]);
    expect(await db.records.count()).toBe(2);
    const chunksA = await db.chunks.where('recordId').equals('a').toArray();
    expect(chunksA.length).toBeGreaterThan(2);
    expect(await db.chunks.where('recordId').equals('b').count()).toBe(1);
  });

  it('modificare un record rigenera i suoi blocchi', async () => {
    await putRecords([r('a', long)]);
    await putRecords([r('a', 'testo corto')]);
    const chunks = await db.chunks.where('recordId').equals('a').toArray();
    expect(chunks.map((c) => c.testo)).toEqual(['testo corto']);
  });

  it('eliminare un record elimina i suoi blocchi', async () => {
    await putRecords([r('a', long), r('b')]);
    await deleteRecords(['a']);
    expect(await db.chunks.where('recordId').equals('a').count()).toBe(0);
    expect(await db.records.get('b')).toBeTruthy();
  });

  it('incrementa la revisione a ogni modifica (servirà all\'indice di ricerca)', async () => {
    const before = await getMeta('revisione', 0);
    await putRecords([r('x')]);
    expect(await getMeta('revisione', 0)).toBe(before + 1);
  });

  it('il backup contiene schema + provenienza ed è reimportabile', async () => {
    await putRecords([r('a'), { ...r('b'), origine: 'remoto', modificato: true }]);
    const backup = await buildBackup();
    expect(backup.formato).toBe('consulta-backup');
    expect(backup.records).toHaveLength(2);
    expect(backup.records[1]).toMatchObject({ id: 'b', origine: 'remoto', modificato: true });
    expect(backup.records[0]).not.toHaveProperty('salvato_il');
  });

  it('applicazione di un piano remoto', async () => {
    await putRecords([{ ...r('vecchio'), origine: 'remoto' }, r('mio')]);
    const plan = planRemote(await db.records.toArray(), [{ ...r('nuovo'), tag: [] }]);
    await putRecords(plan.toPut);
    await deleteRecords(plan.toDelete);
    expect((await db.records.toArray()).map((x) => x.id).sort()).toEqual(['mio', 'nuovo']);
  });
});
