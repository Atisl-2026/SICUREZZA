import { isAndroid, useInstall } from '../lib/install';
import { ApkLink } from './ApkLink';

/** Invito all'installazione: pulsante su Android, istruzioni su iPhone/iPad. */
export function InstallCard() {
  const { installed, canPrompt, showIOSHint, install } = useInstall();
  if (installed) return null;

  if (canPrompt) {
    return (
      <div class="card">
        <h3>Installa l'app</h3>
        <p class="muted small">Aggiungila alla schermata Home per usarla anche senza connessione.</p>
        <button class="btn btn-primary btn-block" onClick={install}>Installa</button>
        <p class="muted small apk-or">oppure</p>
        <ApkLink variant="button" />
      </div>
    );
  }

  if (isAndroid()) {
    return (
      <div class="card">
        <h3>Installa l'app</h3>
        <p class="muted small">
          In Chrome tocca il menu ⋮ → <strong>Installa app</strong>, oppure scarica l'app per Android
          (dopo il download aprila e consenti l'installazione da questa fonte).
        </p>
        <ApkLink variant="button" />
      </div>
    );
  }

  if (showIOSHint) {
    return (
      <div class="card">
        <h3>Installa su iPhone/iPad</h3>
        <ol class="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>Apri questa pagina in <strong>Safari</strong>.</li>
          <li>Tocca <strong>Condividi</strong> (il quadrato con la freccia in su).</li>
          <li>Scegli <strong>Aggiungi alla schermata Home</strong>.</li>
        </ol>
      </div>
    );
  }

  return null;
}
