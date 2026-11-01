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

export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
