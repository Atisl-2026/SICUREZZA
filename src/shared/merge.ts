import { pickSchema, sameContent } from './normalize.ts';
import type { DbRecord, Origine, StoredRecord } from './types.ts';

export interface IncomingRecord {
  record: DbRecord;
  /** Se il file importato è un backup dell'app, conserva la provenienza originale. */
  origine?: Origine;
  modificato?: boolean;
}

export interface ImportPlan {
  toPut: StoredRecord[];
  stats: { aggiunti: number; aggiornati: number; invariati: number; saltati: number };
  /** Record non importati perché la versione locale è più recente. */
  saltati: string[];
}

/**
 * Import manuale (JSON/CSV): se l'id esiste già vince il record con data_aggiornamento più recente
 * (a parità o con date mancanti vince il file importato).
 */
export function planImport(existing: Map<string, StoredRecord>, incoming: IncomingRecord[], now = Date.now()): ImportPlan {
  const plan: ImportPlan = { toPut: [], stats: { aggiunti: 0, aggiornati: 0, invariati: 0, saltati: 0 }, saltati: [] };
  for (const inc of incoming) {
    const r = inc.record;
    const ex = existing.get(r.id);
    if (ex) {
      if (sameContent(ex, r)) { plan.stats.invariati++; continue; }
      if (ex.data_aggiornamento && r.data_aggiornamento && ex.data_aggiornamento > r.data_aggiornamento) {
        plan.stats.saltati++;
        plan.saltati.push(r.id);
        continue;
      }
    }
    const origine: Origine = inc.origine ?? (ex?.origine === 'remoto' ? 'remoto' : 'locale');
    const modificato = inc.origine ? inc.modificato : ex?.origine === 'remoto' ? true : undefined;
    plan.toPut.push({ ...pickSchema(r), origine, ...(modificato ? { modificato } : {}), salvato_il: now });
    if (ex) plan.stats.aggiornati++;
    else plan.stats.aggiunti++;
  }
  return plan;
}

export interface RemotePlan {
  toPut: StoredRecord[];
  toDelete: string[];
  stats: { aggiunti: number; aggiornati: number; rimossi: number; invariati: number; conservati: number };
  /** Record modificati o creati nell'app che il db remoto avrebbe cambiato: restano nella versione locale. */
  conservati: string[];
}

/**
 * Aggiornamento dai contenuti pubblicati (demo.json / soci.json):
 * - i record 'remoto' non modificati vengono aggiunti/aggiornati/rimossi come nel file remoto;
 * - i record creati nell'app ('locale') o modificati nell'app non vengono mai toccati.
 */
export function planRemote(existing: StoredRecord[], remote: DbRecord[], now = Date.now()): RemotePlan {
  const plan: RemotePlan = {
    toPut: [],
    toDelete: [],
    stats: { aggiunti: 0, aggiornati: 0, rimossi: 0, invariati: 0, conservati: 0 },
    conservati: []
  };
  const byId = new Map(existing.map((r) => [r.id, r]));
  const remoteIds = new Set<string>();

  for (const r of remote) {
    remoteIds.add(r.id);
    const ex = byId.get(r.id);
    if (!ex) {
      plan.toPut.push({ ...pickSchema(r), origine: 'remoto', salvato_il: now });
      plan.stats.aggiunti++;
    } else if (ex.origine === 'locale' || ex.modificato) {
      if (!sameContent(ex, r)) {
        plan.stats.conservati++;
        plan.conservati.push(r.id);
      } else plan.stats.invariati++;
    } else if (sameContent(ex, r)) {
      plan.stats.invariati++;
    } else {
      plan.toPut.push({ ...pickSchema(r), origine: 'remoto', salvato_il: now });
      plan.stats.aggiornati++;
    }
  }

  for (const ex of existing) {
    if (ex.origine === 'remoto' && !ex.modificato && !remoteIds.has(ex.id)) {
      plan.toDelete.push(ex.id);
      plan.stats.rimossi++;
    }
  }
  return plan;
}
