# Consulta

App per consultare **normativa, procedure, schede tecniche e FAQ** dal telefono, **anche senza connessione**,
con risposte in linguaggio naturale generate da **Google Gemini** quando sei online.

- Si installa come un'app su **Android** e **iPhone** (è una PWA: niente store).
- Funziona **offline**: database e ricerca restano sul dispositivo.
- **Costo zero**: hosting gratuito su GitHub Pages, nessun server, piano gratuito di Gemini.

**Indirizzo dell'app: https://atisl-2026.github.io/SICUREZZA/**

---

## Indice

1. [Installare l'app sul telefono](#1-installare-lapp-sul-telefono)
2. [Ottenere e inserire la chiave Gemini](#2-ottenere-e-inserire-la-chiave-gemini)
3. [Come si usa](#3-come-si-usa)
4. [Aggiornare il database](#4-aggiornare-il-database)
5. [Pubblicare l'app su GitHub Pages (deploy)](#5-pubblicare-lapp-su-github-pages-deploy)
6. [Backup e sicurezza dei dati](#6-backup-e-sicurezza-dei-dati)
7. [Risoluzione dei problemi](#7-risoluzione-dei-problemi)
8. [Per sviluppatori](#8-per-sviluppatori)

---

## 1. Installare l'app sul telefono

L'indirizzo dell'app è `https://<utente-github>.github.io/<nome-repository>/` (vedi [sezione 5](#5-pubblicare-lapp-su-github-pages-deploy)).
**Apri l'app la prima volta con la connessione attiva**: in quel momento vengono salvati sul dispositivo l'app
e il database, che da lì in poi funzionano anche offline.

### Android (Chrome)

1. Apri l'indirizzo dell'app in **Chrome**.
2. Tocca il menu **⋮** in alto a destra → **Installa app** (su alcune versioni: **Aggiungi a schermata Home** → **Installa**).
   In alternativa usa il pulsante **Installa** nella scheda *Impostazioni* dell'app.
3. L'icona **Consulta** compare tra le app e nella schermata Home.

### iPhone e iPad (Safari)

1. Apri l'indirizzo dell'app in **Safari**.
2. Tocca **Condividi** (il quadrato con la freccia verso l'alto, in basso al centro o in alto a destra su iPad).
3. Scorri e tocca **Aggiungi alla schermata Home** → **Aggiungi**.
4. Apri l'app **dall'icona sulla schermata Home** (non da Safari): così si apre a schermo intero e i dati sono più al sicuro (vedi [sezione 6](#6-backup-e-sicurezza-dei-dati)).

> Dalla versione 16.4 di iOS si può installare anche da Chrome o Edge per iPhone (menu Condividi → Aggiungi alla schermata Home).

### Aggiornamenti dell'app

Quando pubblichi una nuova versione, l'app la scarica in background e mostra
**«È disponibile una nuova versione dell'app» → Aggiorna**. Non serve reinstallare nulla.

---

## 2. Ottenere e inserire la chiave Gemini

La chiave è gratuita e non richiede carta di credito.

1. Vai su **[Google AI Studio → API keys](https://aistudio.google.com/app/apikey)** e accedi con un account Google.
2. Tocca **Create API key** (*Crea chiave API*), accetta i termini se richiesto e scegli/crea un progetto.
3. **Copia** la chiave (inizia con `AIza…`).
4. Nell'app apri **Impostazioni → Intelligenza artificiale (Gemini)**, incolla la chiave e tocca **Verifica chiave**.
   Deve comparire «Chiave valida. Modello disponibile: …».

Dove finisce la chiave:

- resta **solo su quel dispositivo** (nel database locale del browser): va inserita su ogni telefono;
- viene inviata **solo a Google**, nell'intestazione della richiesta (`x-goog-api-key`), mai nell'indirizzo;
- **non è nel codice, non va su GitHub e non è inclusa nei backup**;
- si cancella con **Rimuovi chiave**.

> ⚠️ **Riservatezza** — sul piano gratuito Google può usare le domande e i contenuti inviati (inclusi i blocchi del
> database) per migliorare i propri servizi, anche con revisori umani. **Non usare l'AI con dati personali, sensibili
> o riservati.** Offline e senza chiave l'app non invia nulla a nessuno.

**Modello**: il predefinito è `gemini-2.5-flash`. Nomi dei modelli e limiti gratuiti cambiano nel tempo:
se un modello smette di funzionare o esaurisce spesso la quota, scrivine un altro in *Impostazioni → Modello*
(per esempio `gemini-2.5-flash-lite`, più leggero) scegliendolo tra quelli elencati in AI Studio.

---

## 3. Come si usa

L'app ha tre schede in basso.

### Chiedi

1. Scrivi la domanda nel campo in alto (es. *«Come chiedo le ferie?»*) e premi **Invio** o la freccia.
2. L'app cerca **sul dispositivo** i 6–8 brani più pertinenti (funziona anche offline e con errori di battitura).
3. Cosa vedi:

| Situazione | Risultato |
|---|---|
| **Offline** o senza chiave | i brani trovati come schede, con titolo, fonte e parole evidenziate + avviso «Risposta AI disponibile quando sei online» |
| **Online con chiave** | sezione **Dal database**: risposta di Gemini basata **solo** sui brani trovati, con i numeri delle fonti cliccabili e l'elenco dei record citati; i brani restano consultabili |
| Interruttore **Verifica anche sul web** attivo | in più, sezione separata **Dal web**: risposta con la Ricerca Google e link alle fonti |

Le due sezioni non vengono mai mescolate: *Dal database* = i tuoi documenti, *Dal web* = internet.
Se Gemini non è disponibile (quota esaurita, rete assente, chiave errata…) l'app lo spiega in una riga e mostra
comunque i risultati trovati sul dispositivo. Se la verifica sul web fallisce per quota o perché il modello non la
supporta, l'interruttore si disattiva da solo.

Le ultime domande restano in **Domande recenti** (solo sul dispositivo; si possono cancellare).

### Database

Elenco dei record con filtro per testo e categoria; tocca un record per leggerlo, **modificarlo** o **eliminarlo**.
Da qui si **crea** un nuovo record, si **importa** un file JSON/CSV, si **controllano gli aggiornamenti** e si
**esporta il backup**.

### Impostazioni

Installazione, chiave e modello Gemini, URL del database remoto, controllo automatico degli aggiornamenti,
spazio occupato e archiviazione persistente.

---

## 4. Aggiornare il database

### Com'è fatto un record

| Campo | Contenuto |
|---|---|
| `id` | identificativo univoco e stabile (es. `procedure-richiesta-ferie`) |
| `titolo` | titolo del documento o della domanda |
| `testo` | contenuto completo |
| `categoria` | es. Normativa, Procedure, Schede tecniche, FAQ |
| `tag` | elenco di parole chiave |
| `fonte` | riferimento o URL del documento originale |
| `data_aggiornamento` | data in formato `AAAA-MM-GG` |

L'app divide i testi lunghi in blocchi di ~800–1200 caratteri (con 150 caratteri di sovrapposizione) collegati al record:
la ricerca e Gemini lavorano sui blocchi, le schede mostrano sempre titolo e fonte del record.

### Metodo consigliato: dai tuoi file a `data/db.json`, poi pubblicazione

Sul tuo computer, nella cartella del progetto (serve [Node.js](https://nodejs.org) 22.18 o successivo):

1. Metti i documenti nella cartella **`sorgenti/`**. Le sottocartelle sono le **categorie**; quelle più interne diventano **tag**.
   ```
   sorgenti/
     normativa/        regolamento.docx   2025-03-12_circolare.pdf
     procedure/        ferie.pdf          rifiuti.md
     schede-tecniche/  stampante.html     dispositivi.xlsx
     faq/              faq-helpdesk.xlsx  faq-badge.txt
     metadati.csv      (facoltativo)
   ```
   La cartella `sorgenti/` **non viene pubblicata** (è esclusa da git): online va solo il testo estratto in `data/db.json`.
2. Genera il database:
   ```bash
   npm install
   npm run build-db
   ```
   Lo script mostra un riepilogo per file e gli eventuali avvisi (es. PDF scansionati senza testo).
3. Pubblica `data/db.json` (vedi sotto). Alla successiva apertura online, l'app chiede
   **«Aggiornamento del database disponibile» → Aggiorna**.

Per provare lo script con i file di esempio inclusi: `npm run build-db -- sorgenti-esempio`.

**Regole di conversione**

| File | Risultato |
|---|---|
| Word `.docx`, PDF con testo, PowerPoint `.pptx`, pagine `.html`, `.txt`, `.md` | un record per file |
| Excel `.xlsx` o `.csv` con colonne *Titolo/Domanda* e *Testo/Risposta* | un record per riga; le colonne *Tag*, *Categoria*, *Fonte*, *Data*, *Id* vengono riconosciute, le altre finiscono nel testo |
| Excel `.xlsx` o `.csv` con altre colonne (tabelle, registri) | un record per file, una riga di testo per riga della tabella |
| File in una cartella o con nome contenente **faq** | un record per domanda (righe che terminano con `?`, anche nel formato `D:`/`R:`) |
| Vecchi formati `.doc` `.xls` `.ppt` `.rtf` `.odt` | convertiti automaticamente se sul computer c'è LibreOffice, altrimenti vanno salvati nel formato moderno |
| PDF scansionati (solo immagini) | segnalati: serve prima un OCR (es. «Riconosci testo» di Adobe o del tuo scanner) |

- **id**: ricavato dal percorso del file (`procedure/ferie.pdf` → `procedure-ferie`), quindi resta uguale tra un aggiornamento e l'altro.
- **titolo**: primo titolo del documento (Word, HTML, Markdown, PowerPoint) o titolo del PDF; altrimenti il nome del file.
- **data_aggiornamento**: data all'inizio del nome del file (`2025-03-12_circolare.pdf`), altrimenti data di modifica del file.
- **fonte**: il percorso del file, a meno che non sia indicata in `metadati.csv`.
- **versione**: data e ora di generazione. Se i contenuti non cambiano, il file non viene riscritto e l'app non propone aggiornamenti inutili.

**`metadati.csv`** (facoltativo, separatore `;`, tag separati da `|`) per correggere i dati di singoli file:

```
file;titolo;tag;fonte;data_aggiornamento
normativa/regolamento.docx;Regolamento veicoli aziendali;veicoli|auto;https://intranet.esempio.it/regolamento;2025-01-10
procedure/2025-03-12_circolare.pdf;Circolare ferie 2025;ferie;;
```

### Pubblicare il nuovo `data/db.json`

- **Da terminale**:
  ```bash
  git add data/db.json
  git commit -m "Aggiornamento database"
  git push
  ```
- **Dal sito GitHub** (senza terminale): apri il repository → cartella `data` → **Add file → Upload files** →
  trascina il nuovo `db.json` → **Commit changes**.

In entrambi i casi GitHub Actions ripubblica il sito in 1–2 minuti; i telefoni ricevono l'aggiornamento alla prima
apertura online (o con **Database → Controlla aggiornamenti**).

**Cosa succede ai dati sul telefono**: i record che arrivano da GitHub vengono aggiunti, aggiornati o rimossi come nel
nuovo file. I record **creati o modificati sul telefono non vengono mai sovrascritti** (l'app indica quanti ne ha conservati).

### Altri due modi

- **Import manuale** (*Database → Importa JSON/CSV*): accetta `db.json`, backup dell'app, un elenco JSON di record o un CSV
  (separatore `;` o `,`, codifica UTF-8 o quella di Excel, intestazioni come `titolo;testo;categoria;tag;fonte;data_aggiornamento`,
  anche `domanda;risposta`). Se un record esiste già vince quello con la data di aggiornamento più recente.
- **Direttamente nell'app** (*Database → Nuovo record*, oppure apri un record → *Modifica* / *Elimina*).
  Questi record restano solo su quel telefono: esporta un backup per non perderli o per passarli ad altri.

Un database diverso da quello pubblicato con l'app si imposta in *Impostazioni → Database remoto → URL del file db.json*
(deve essere raggiungibile via HTTPS e consentire richieste da browser, come `raw.githubusercontent.com`).

---

## 5. Pubblicare l'app su GitHub Pages (deploy)

Serve un account GitHub gratuito. Con il piano gratuito **il repository deve essere pubblico**: chiunque potrà leggere
il codice e `data/db.json`. **Non pubblicare documenti riservati.** (La chiave Gemini non è mai nel repository.)

### Prima pubblicazione

1. Su GitHub crea un repository vuoto, per esempio `consulta` (**New repository**, visibilità *Public*,
   senza README né `.gitignore`).
2. Dalla cartella del progetto:
   ```bash
   git remote add origin https://github.com/<utente>/consulta.git
   git push -u origin main
   ```
3. Nel repository vai su **Settings → Pages → Build and deployment → Source** e scegli **GitHub Actions**.
4. Apri la scheda **Actions**: il workflow **Deploy su GitHub Pages** esegue i test, la build e la pubblicazione
   (se era già partito prima del punto 3 e ha fallito, rilancialo con **Re-run jobs**).
5. L'app è online su **`https://<utente>.github.io/consulta/`**: aprila dal telefono e installala ([sezione 1](#1-installare-lapp-sul-telefono)).

Il percorso del sito si adatta da solo al nome del repository. Se il repository si chiama `<utente>.github.io`,
l'app viene pubblicata direttamente su `https://<utente>.github.io/`.

### Pubblicazioni successive

Ogni `git push` sul ramo `main` (codice o `data/db.json`) ripubblica tutto automaticamente.
Se un test fallisce la pubblicazione si ferma e il sito resta alla versione precedente.
Il workflow si può avviare anche a mano: **Actions → Deploy su GitHub Pages → Run workflow**.

### Costi

| Servizio | Costo |
|---|---|
| GitHub Pages + GitHub Actions (repository pubblico) | gratuito |
| Gemini API (piano gratuito, con limiti di richieste) | gratuito |
| Store, server, database cloud | non servono |

---

## 6. Backup e sicurezza dei dati

I dati stanno nel browser del telefono (IndexedDB). L'app chiede al sistema l'**archiviazione persistente**
(lo stato è in *Impostazioni → Archiviazione locale*).

- **iPhone**: Safari cancella i dati salvati dai siti web che non apri per 7 giorni; le app **aggiunte alla schermata Home**
  sono escluse da questa regola. Usa sempre l'icona sulla Home.
- I record scaricati da GitHub si possono sempre riscaricare. **Quelli creati o modificati sul telefono no**:
  esporta regolarmente un backup con **Database → Esporta backup** (su iPhone si apre il menu Condividi → *Salva su File*).
- Per ripristinare: **Database → Importa JSON/CSV** e scegli il file di backup.

---

## 7. Risoluzione dei problemi

| Problema | Soluzione |
|---|---|
| L'app non si apre offline | aprila almeno una volta online e attendi il messaggio «App pronta: ora funziona anche offline» |
| Non compare «Installa app» su Android | usa Chrome (non la navigazione in incognito) e ricarica la pagina; oppure menu ⋮ → *Aggiungi a schermata Home* |
| Su iPhone manca «Aggiungi alla schermata Home» | apri il link in Safari (non dentro WhatsApp, Mail ecc.: usa «Apri in Safari») |
| «Quota gratuita di Gemini esaurita» | attendi (i limiti si azzerano ogni minuto o ogni giorno) o prova un modello più leggero; la ricerca locale funziona comunque |
| «La chiave API Gemini non è valida» | ricopia la chiave da AI Studio senza spazi e tocca *Verifica chiave* |
| «Modello Gemini non trovato» | il nome del modello è cambiato: scegline uno disponibile in AI Studio |
| «L'API Gemini non è disponibile nel paese» | Google non offre l'API nella tua zona: l'app funziona solo con la ricerca locale |
| La verifica sul web si è disattivata | quota esaurita o modello senza Ricerca Google: riattivala più tardi o cambia modello |
| Il database non si aggiorna | *Database → Controlla aggiornamenti*; verifica che il workflow su GitHub sia verde e che la `versione` nel nuovo `db.json` sia cambiata |
| Il workflow fallisce su «Manca data/db.json» | esegui `npm run build-db` e fai commit di `data/db.json` |
| La pagina su GitHub dà 404 | controlla *Settings → Pages → Source: GitHub Actions* e che il workflow sia terminato |

---

## 8. Per sviluppatori

### Stack

Vite + TypeScript + Preact · vite-plugin-pwa (Workbox) · Dexie (IndexedDB) · MiniSearch · API REST Gemini dal browser.
Nessun backend.

### Comandi

```bash
npm install
npm run dev            # sviluppo su http://localhost:5173
npm test               # test automatici (Vitest)
npm run typecheck      # controllo dei tipi
npm run build          # build di produzione in dist/
npm run preview        # anteprima della build con service worker attivo
npm run check:offline  # verifica end-to-end del funzionamento offline (dopo la build; usa Playwright)
npm run build-db       # sorgenti/ → data/db.json
npm run icons          # rigenera le icone PNG da public/icons/icon.svg (usa Playwright)
```

`check:offline` e `icons` usano Playwright, che non è tra le dipendenze (non serve per la build né su GitHub):
installalo solo se ti servono, con `npm i -D playwright && npx playwright install chromium`.

Per provare la build con lo stesso percorso di GitHub Pages: `BASE_PATH=/consulta/ npm run build && BASE_PATH=/consulta/ npm run preview`.

### Struttura

```
src/
  shared/        logica pura, condivisa da app, script Node e test
    types.ts       schema dei record
    normalize.ts   normalizzazione record, date, tag, versioni
    csv.ts         parser CSV e decodifica UTF-8 / Windows-1252
    chunk.ts       suddivisione in blocchi con sovrapposizione
    merge.ts       regole di import manuale e aggiornamento remoto
    search.ts      analisi del testo in italiano, indice MiniSearch, estratti ed evidenziazione
    gemini.ts      richieste, parsing delle risposte, errori, citazioni
    markdown.ts    markdown delle risposte senza HTML grezzo
  lib/           database Dexie, indice persistente, AI, impostazioni, aggiornamento remoto
  components/    componenti dell'interfaccia
  pages/         Chiedi, Database (elenco, dettaglio, modifica), Impostazioni
scripts/         build-db.mjs, gen-icons.mjs, check-offline.mjs
data/db.json     database pubblicato con l'app (non messo in cache dal service worker)
sorgenti-esempio/  file di esempio in tutti i formati supportati
tests/           test di ricerca, Gemini, database, import, build-db
.github/workflows/deploy.yml   test + build + pubblicazione su GitHub Pages
```

### Ricerca locale

- testo normalizzato in minuscolo e senza accenti; stopword italiane rimosse;
- stemmer leggero: singolare/plurale e maschile/femminile coincidono (*veicolo/veicoli*, *banca/banche*);
- errori di battitura tollerati (1 dai 5 caratteri, 2 dai 9); l'ultima parola vale anche come prefisso;
- pesi: titolo ×2, tag ×1,5, testo ×1, categoria ×0,5;
- risultati: almeno i primi 6 blocchi pertinenti, al massimo 8, al massimo 3 dallo stesso record;
- l'indice è salvato in IndexedDB e ricostruito solo quando i dati cambiano.

### Note di compatibilità

Obiettivo Safari iOS 15+ e Chrome Android recenti: build `es2020`, nessuna regex con lookbehind,
input a 16px (niente zoom automatico su iOS), margini per notch e barra Home, tema chiaro/scuro automatico.
