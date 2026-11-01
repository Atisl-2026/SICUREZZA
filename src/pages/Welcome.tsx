import { asset, BRAND } from '../branding';
import { ApkLink } from '../components/ApkLink';

/** Pagina di benvenuto, prima della scelta dell'accesso. */
export function WelcomePage({ onEnter }: { onEnter: () => void }) {
  return (
    <div class="welcome">
      <div class="logo-tile welcome-logo">
        <img src={asset(BRAND.logoCompleto)} alt="ATISL – CONFSAL" width="220" height="232" />
      </div>

      <h1 class="welcome-title">
        <span class="welcome-hello">Benvenuti in</span>
        <span class="welcome-name">{BRAND.nome}</span>
      </h1>
      <p class="welcome-sub">{BRAND.sottotitolo}</p>
      <div class="welcome-stripe" aria-hidden="true" />

      <ul class="welcome-features">
        <li><span aria-hidden="true">📚</span>Normativa, procedure e schede tecniche sempre a portata di mano</li>
        <li><span aria-hidden="true">🔎</span>Fai una domanda e trova subito i passaggi giusti</li>
        <li><span aria-hidden="true">📴</span>Funziona anche senza connessione</li>
        <li><span aria-hidden="true">✨</span>Risposte con l'intelligenza artificiale, con le fonti citate</li>
      </ul>

      <button type="button" class="btn btn-primary btn-block welcome-enter" onClick={onEnter}>
        Entra
      </button>
      <ApkLink />
    </div>
  );
}
