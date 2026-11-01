import { useEffect } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';

/**
 * Registra il service worker. Quando è pronta una nuova versione dell'app
 * mostra un banner: l'aggiornamento parte solo con il consenso dell'utente.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Controllo periodico degli aggiornamenti dell'app (ogni ora, solo se online)
      if (!reg) return;
      setInterval(() => {
        if (navigator.onLine) reg.update().catch(() => {});
      }, 60 * 60 * 1000);
    }
  });

  useEffect(() => {
    if (!offlineReady) return;
    const t = setTimeout(() => setOfflineReady(false), 6000);
    return () => clearTimeout(t);
  }, [offlineReady]);

  if (needRefresh) {
    return (
      <div class="banner" role="status">
        <span>È disponibile una nuova versione dell'app.</span>
        <div class="btn-row">
          <button class="btn" onClick={() => setNeedRefresh(false)}>Dopo</button>
          <button class="btn btn-primary" onClick={() => updateServiceWorker(true)}>Aggiorna</button>
        </div>
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div class="banner" role="status">
        <span class="small">App pronta: ora funziona anche offline.</span>
        <button class="btn" onClick={() => setOfflineReady(false)}>OK</button>
      </div>
    );
  }

  return null;
}
