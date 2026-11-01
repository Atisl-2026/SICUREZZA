// Identità dell'app: nome, marchio e contatti. Unico punto da modificare per personalizzarla.
export const BRAND = {
  nome: 'ATISL Security',
  nomeBreve: 'ATISL',
  sottotitolo: 'Associazione Tecnici e Ispettori per la Sicurezza sul Lavoro',
  logo: 'brand/logo-atisl.png',
  logoCompleto: 'brand/logo-completo.png',
  /** Contatti per chi ha dimenticato la password (soci e password AI). */
  contatti: {
    email: 'inlispettori@gmail.com',
    telefono: '349 866 9025',
    telefonoLink: '+393498669025'
  }
} as const;

/** Argomenti (categorie) proposti nei filtri di ricerca e nei moduli, in questo ordine. */
export const ARGOMENTI = ['Normativa', 'FAQ', 'Formazione', 'Generale', 'Procedure', 'Schede tecniche'];

export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Argomenti standard + quelli già presenti (senza doppioni, ignorando maiuscole e accenti). */
export function withStandardTopics(existing: string[]): string[] {
  const norm = (c: string) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const seen = new Set(ARGOMENTI.map(norm));
  return [...ARGOMENTI, ...existing.filter((c) => !seen.has(norm(c)) && seen.add(norm(c)))];
}
