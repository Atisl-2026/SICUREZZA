# Consulta

PWA installabile e utilizzabile offline per consultare normativa, procedure, schede tecniche e FAQ, con risposte AI tramite Google Gemini. Costo zero: hosting statico su GitHub Pages, nessun backend.

> README completo (installazione su Android/iPhone, chiave Gemini, aggiornamento database, deploy) in arrivo nella fase 5.

## Sviluppo

```bash
npm install
npm run dev          # server di sviluppo
npm run build        # build di produzione in dist/
npm run preview      # anteprima della build (service worker attivo)
npm run check:offline  # verifica automatica del funzionamento offline
npm run icons        # rigenera le icone PNG da public/icons/icon.svg
```
