import { BRAND } from '../branding';

/** Contatti per richiedere la password (soci, password AI). */
export function Contacts({ intro }: { intro: string }) {
  const c = BRAND.contatti;
  return (
    <div class="contacts">
      <p class="small muted">{intro} Contatta l'associazione:</p>
      <div class="contacts-links">
        <a class="btn" href={`mailto:${c.email}?subject=${encodeURIComponent(`${BRAND.nome}: richiesta password`)}`}>
          ✉️ <span class="break">{c.email}</span>
        </a>
        <a class="btn" href={`tel:${c.telefonoLink}`}>📞 {c.telefono}</a>
      </div>
    </div>
  );
}
