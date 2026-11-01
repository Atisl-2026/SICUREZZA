import { DEFAULT_MODEL } from '../shared/gemini.ts';
import type { Reserves } from '../shared/providers.ts';
import { getMeta, setMeta } from './db';
import { useLiveQuery } from './live';

export interface Settings {
  /** Controlla aggiornamenti del database all'avvio (se online). */
  autoCheck: boolean;
  /** Interruttore "Verifica anche sul web" della schermata Chiedi. */
  webCheck: boolean;
  /** Chiave API Gemini: salvata solo in IndexedDB su questo dispositivo, mai nel codice né nei backup. */
  apiKey: string;
  /** Nome del modello Gemini (configurabile perché nomi e limiti gratuiti cambiano). */
  model: string;
  /** Argomenti in cui cercare (vuoto = tutti). */
  categorie: string[];
  /** Documento della Normativa in cui cercare (id della scheda; vuoto = tutti i documenti). */
  documento: string;
  /** AI gratuite di riserva (Groq, Mistral, OpenRouter): chiavi salvate solo su questo dispositivo. */
  riserve: Reserves;
}

export const DEFAULT_SETTINGS: Settings = {
  autoCheck: true,
  webCheck: false,
  apiKey: '',
  model: DEFAULT_MODEL,
  categorie: [],
  documento: '',
  riserve: {}
};

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getMeta<Partial<Settings>>('impostazioni', {})) };
}

export async function updateSettings(patch: Partial<Settings>) {
  await setMeta('impostazioni', { ...(await getSettings()), ...patch });
}

export function useSettings(): Settings {
  return useLiveQuery(getSettings) ?? DEFAULT_SETTINGS;
}
