# ATISL Security

<img src="public/brand/logo-completo.png" alt="ATISL – CONFSAL" width="160">

**ATISL – Associazione Tecnici e Ispettori per la Sicurezza sul Lavoro**

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
3. L'icona **ATISL** compare tra le app e nella schermata Home.

### iPhone e iPad (Safari)

1. Apri l'indirizzo dell'app in **Safari**.
2. Tocca **Condividi** (il quadrato con la freccia verso l'alto, in basso al centro o in alto a destra su iPad).
3. Scorri e tocca **Aggiungi alla schermata Home** → **Aggiungi**.
4. Apri l'app **dall'icona sulla schermata Home** (non da Safari): così si apre a schermo intero e i dati sono più al sicuro (vedi [sezione 6](#6-backup-e-sicurezza-dei-dati)).

> Dalla versione 16.4 di iOS si può installare anche da Chrome o Edge per iPhone (menu Condividi → Aggiungi alla schermata Home).

### App per Android (APK)

In alternativa all'installazione da Chrome, su Android si può scaricare l'app:

1. Apri l'indirizzo dell'app dal telefono Android e tocca **📱 Scarica l'app per Android (APK)**
   (nella pagina di benvenuto o in *Impostazioni*), oppure usa direttamente
   `https://atisl-2026.github.io/SICUREZZA/download/atisl-security.apk`.
2. Apri il file scaricato; la prima volta Android chiede di **consentire l'installazione da questa fonte**
   (Chrome o «File»): consentila e tocca **Installa**.

L'APK è una *Trusted Web Activity*: apre l'app pubblicata con il motore di Chrome, quindi funziona offline,
usa la fotocamera e **si aggiorna da sola** come la versione installata dal browser (contenuti e app web non
richiedono di reinstallare l'APK). Serve Chrome aggiornato sul telefono.

Per nascondere la barra dell'indirizzo in alto, il sito deve dichiarare l'app: il file `android/assetlinks.json`
va pubblicato su `https://atisl-2026.github.io/.well-known/assetlinks.json`, cioè in un repository pubblico
chiamato `Atisl-2026.github.io` (con un file vuoto `.nojekyll` e GitHub Pages attivo).

L'APK viene compilato e firmato da GitHub Actions (workflow *App Android (APK)*, parte quando cambia la
cartella `android/`) e consegnato sul ramo `apk`; da lì va copiato in `public/download/`. La chiave di firma
è usa-e-getta: una nuova versione dell'APK si installa dopo aver disinstallato la precedente (i dati restano in
Chrome) e richiede di aggiornare l'impronta in `assetlinks.json`.

### iPhone

Apple non permette di installare app fuori dall'App Store senza l'abbonamento Apple Developer (99 $/anno) e un Mac:
su iPhone l'app si installa gratis da **Safari → Condividi → Aggiungi alla schermata Home** (sopra) e funziona
come un'app normale, anche offline.

### Aggiornamenti dell'app

Quando pubblichi una nuova versione, l'app la scarica in background e mostra
**«È disponibile una nuova versione dell'app» → Aggiorna**. Non serve reinstallare nulla.

---

## 2. Ottenere e inserire la chiave Gemini

La chiave è gratuita e non richiede carta di credito.

1. Vai su **[Google AI Studio → API keys](https://aistudio.google.com/app/apikey)** e accedi con un account Google.
2. Tocca **Create API key** (*Crea chiave API*), accetta i termini se richiesto e scegli/crea un progetto.
3. **Copia** la chiave (inizia con `AIza…`).
4. Entra come **programmatore**, apri **Impostazioni → Intelligenza artificiale (Gemini)**, incolla la chiave e tocca **Verifica chiave**.
   Deve comparire «Chiave valida. Modello disponibile: …».

Dove finisce la chiave:

- resta **solo su quel dispositivo** (nel database locale del browser);
- ai soci scelti arriva **cifrata con la password AI**: solo chi la conosce può usare le risposte AI;
- viene inviata **solo a Google**, nell'intestazione della richiesta (`x-goog-api-key`), mai nell'indirizzo;
- **non è nel codice, non va su GitHub e non è inclusa nei backup**;
- si cancella con **Rimuovi chiave**.

> ⚠️ **Riservatezza** — sul piano gratuito Google può usare le domande e i contenuti inviati (inclusi i blocchi del
> database) per migliorare i propri servizi, anche con revisori umani. **Non usare l'AI con dati personali, sensibili
> o riservati.** Offline e senza chiave l'app non invia nulla a nessuno.

**Modello**: il predefinito è `gemini-flash-latest` (l'ultimo Gemini Flash). Google ritira periodicamente i modelli:
se quello impostato non esiste più, l'app chiede a Google l'elenco dei modelli disponibili per la chiave, sceglie da
sola il più adatto (un Flash stabile e recente), ripete la domanda e lo salva. In *Impostazioni → Mostra i modelli
disponibili* puoi anche sceglierlo tu (per esempio un «Flash-Lite», più leggero, se la quota si esaurisce spesso).
Alla pubblicazione successiva il modello aggiornato arriva anche ai soci con la password AI.

**«Quota gratuita esaurita» ma nell'app Gemini funziona?** Sono due cose diverse: l'app Gemini (gemini.google.com)
ha limiti suoi, mentre la chiave API ha limiti propri **per modello**, al minuto e al giorno, **condivisi da tutti i
soci** che usano la chiave. Il messaggio ora dice quale limite è stato raggiunto (al minuto, al giorno, modello non
incluso nel piano gratuito) e quanto aspettare; l'app prova da sola un altro modello Gemini (ha una quota separata)
e poi le AI di riserva.

**Più modelli con la stessa chiave Gemini.** Ogni modello ha una quota gratuita propria (alcuni Flash recenti solo 20
richieste al giorno). Quando un modello la esaurisce l'app prova da sola gli altri modelli Gemini e poi i modelli
**Gemma** di Google (stessa chiave, limiti gratuiti molto più alti, leggono le foto), senza cambiare il modello impostato.
I modelli esauriti vengono ricordati, anche chiudendo l'app, fino all'azzeramento delle 9 del mattino. Nell'analisi
foto il primo passaggio (capire cosa c'è nella foto) usa un modello leggero, così la quota del modello principale
resta per l'analisi.

### AI gratuite di riserva (Groq, Mistral, OpenRouter)

In *Impostazioni → AI gratuite di riserva* il programmatore può aggiungere altre AI gratuite. Se Gemini non risponde
(limite raggiunto, sovraccarico, lentezza) l'app passa da sola alla successiva, nell'ordine
**Gemini → Groq → Mistral → OpenRouter**, e lo dice («Gemini: troppe richieste… Provo con Groq…»); sotto ogni risposta
è indicata l'AI che l'ha scritta. Chi ha esaurito la quota viene saltato finché il limite non si azzera.

| Servizio | Dove si crea la chiave (gratuita) | Note |
|---|---|---|
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | molto veloce, senza carta di credito; limiti al minuto e al giorno |
| **Mistral** | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) | piano «Experiment» gratuito (verifica del telefono); sul piano gratuito i dati possono essere usati per migliorare i modelli |
| **OpenRouter** | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | modelli «:free», circa 50 richieste al giorno |

1. Crea la chiave, incollala nel riquadro del servizio e tocca **Verifica**: l'app mostra quali modelli userà per le
   domande e per le foto (scelti da sola; puoi cambiarli dal menu **Modello**).
   **OpenRouter**: alla creazione della chiave lascia vuoto il limite di credito («Credit limit»): con un limite a 0 $
   la chiave rifiuta anche i modelli gratuiti. **Groq** oggi non ha modelli gratuiti che leggono le foto (va bene per
   le domande); per le foto usa **Mistral**.
2. Se la verifica dice «connessione non riuscita… servizio che non accetta richieste dirette dall'app», quel servizio
   non si può usare da un'app senza server: rimuovilo e usa gli altri.
3. **Pubblica** perché le chiavi arrivino ai soci con la password AI (cifrate, come quella di Gemini).

Le chiavi seguono le stesse regole di quella di Gemini: solo sul dispositivo, mai su GitHub né nei backup, cancellate
uscendo. La **verifica sul web** resta solo con Gemini. Le AI di riserva, soprattutto sulle foto, possono essere meno
precise di Gemini: per questo la risposta dice sempre chi l'ha scritta.

---

## 3. Come si usa

### I tre accessi

Alla prima apertura (e dopo **Esci**) l'app mostra la pagina di **benvenuto**; con **Entra** si passa alla scelta dell'accesso.
Chi ha già effettuato l'accesso apre l'app direttamente sui contenuti.

| Accesso | Come si entra | Cosa vede e cosa può fare |
|---|---|---|
| **Demo** | *Prova la demo*, senza password | solo le schede segnate come **visibili in demo**; ricerca, niente AI |
| **Socio** | **password soci** | tutto l'archivio, in sola lettura; ricerca. Le risposte AI solo con la **password AI** (*Impostazioni → Risposte AI*) |
| **Programmatore** | *Accesso programmatore*: **codice di accesso GitHub** + password soci | tutto, più creare, modificare, eliminare e **caricare documenti**, scegliere cosa è visibile in demo, **pubblicare** per tutti, cambiare **password soci** e **password AI**, chiave Gemini |

Come sono protetti i contenuti:

- le schede dei soci sono pubblicate **cifrate** (AES-256, chiave ricavata dalla password con PBKDF2):
  senza la password soci il file `data/soci.json` è illeggibile, anche per chi lo scarica da GitHub;
- le schede **demo** sono pubblicate **in chiaro** (`data/demo.json`): chiunque può leggerle;
- la chiave Gemini condivisa è cifrata a parte con la **password AI**: un socio che non la conosce non può usarla;
- se la password soci cambia, ogni socio la deve reinserire (l'app la chiede da sola); chi non la conosce
  continua a vedere solo i contenuti già scaricati, senza aggiornamenti;
- **Esci** (*Impostazioni → Accesso*) cancella dal telefono contenuti, indice di ricerca, cronologia e chiavi.

La password soci è unica e condivisa: per escludere un socio si cambia la password e la si comunica solo agli altri.

#### Creare il codice di accesso GitHub (programmatore, una volta sola)

1. Apri **[GitHub → Fine-grained token](https://github.com/settings/personal-access-tokens/new)** e accedi.
2. **Token name**: per esempio `App telefono`; **Expiration**: la durata più lunga disponibile.
3. **Repository access** → *Only select repositories* → scegli il repository dell'app.
4. **Permissions** → *Repository permissions* → **Contents**: *Read and write*.
5. **Generate token**, copia il codice (inizia con `github_pat_`) e incollalo nell'app.

Il codice resta solo sul telefono del programmatore e serve a pubblicare. Alla scadenza se ne crea uno nuovo allo stesso modo.

### Chiedi

1. Scrivi la domanda nel campo in alto (es. *«Come chiedo le ferie?»*) e premi **Invio** o la freccia.
2. L'app cerca **sul dispositivo** i 6–8 brani più pertinenti (funziona anche offline e con errori di battitura).
3. Cosa vedi:

| Situazione | Risultato |
|---|---|
| Demo, socio senza password AI, **offline** | i brani trovati come schede, con titolo, fonte e parole evidenziate |
| **Online con AI** (programmatore o socio con password AI) | sezione **Dal database**: risposta di Gemini basata **solo** sui brani trovati, che compare mentre Gemini la scrive, con i numeri delle fonti cliccabili e l'elenco delle schede citate; i brani restano consultabili |
| Interruttore **Verifica anche sul web** attivo | in più, sezione separata **Dal web**: risposta con la Ricerca Google e link alle fonti |

Le due sezioni non vengono mai mescolate: *Dal database* = i tuoi documenti, *Dal web* = internet.
Se Gemini non è disponibile (quota esaurita, rete assente, chiave errata…) l'app lo spiega in una riga e mostra
comunque i risultati trovati sul dispositivo. Se la verifica sul web fallisce per quota o perché il modello non la
supporta, l'interruttore si disattiva da solo.

Le ultime domande restano in **Domande recenti** (solo sul dispositivo; si possono cancellare).

### Cercare con precisione

In cima alla scheda **Chiedi** si sceglie il tipo di ricerca.

**Domanda** (ricerca normale, con risposta AI se disponibile):

- prima compaiono i passaggi che contengono **tutte** le parole importanti, poi quelli che ne contengono solo alcune;
- `"frase esatta"` tra virgolette: solo i passaggi con quelle parole in quell'ordine;
- `-parola` (o `-"frase"`) per **escludere** le schede che la contengono.
  Esempio: `ponteggio "tavola fermapiede" -trabattello`.

**Tutti i risultati nell'archivio** (sotto la risposta, in entrambe le modalità): come «Trova» in Word, ma su tutto
l'archivio. Dice quante volte compare la parola e in quante forme (es. *«preposto» compare 699 volte — preposto 347 ·
preposti 344 · preposte 7 · preposta 1*), poi elenca **tutti** i passaggi, raggruppati per documento (prima quelli
dove la parola compare di più) e nell'ordine del testo, 10 alla volta con **Mostra altri**. I passaggi più pertinenti
mostrati sopra sono quelli che legge l'AI (al massimo 8).

Parole simili e errori di battitura: solo se la parola cercata **non esiste** nell'archivio (e l'app lo dice: «prepsto
non compare nell'archivio: mostro le parole più simili»). Se la parola esiste, si cercano solo le sue forme
(singolare/plurale, maschile/femminile): «preposto» non trova più «proposta». Le parole attaccate ai numeri, frequenti
negli indici dei PDF («preposto253», «art.18»), vengono trovate.

**Ricerca dettagliata** (solo ricerca nell'archivio, funziona offline):

| Campo | Significato |
|---|---|
| Tutte queste parole | il passaggio deve contenerle tutte |
| Frasi esatte (una per riga) | ogni frase deve comparire così com'è |
| Almeno una di queste parole | basta una |
| Escludi queste parole | scarta le schede che le contengono |
| Solo parole esatte | niente plurali, varianti o errori di battitura («ponteggio» non trova «ponteggi») |

**Documento di Normativa** (sotto «Cerca in», solo per la categoria Normativa): menu a tendina per cercare in un solo
documento (es. *D.lgs. 81/08*). Vale anche per le risposte AI. Gli altri argomenti scelti restano interi; togliendo
la Normativa dagli argomenti la scelta si azzera.

**Articoli evidenziati e collegati**: su ogni passaggio trovato compare in **verde chiaro** l'articolo in cui c'è la
parola cercata (es. *Art. 19 – Obblighi del preposto*), anche se il passaggio inizia a metà articolo; la parola cercata è
in **giallo**. Lo stesso nella risposta dell'AI: i riferimenti «Art. 19, comma 1» sono in verde e **cliccabili**.
- clic sull'articolo → si apre il **documento trasmesso** proprio su quell'articolo, con la parola evidenziata e i
  pulsanti *articolo precedente/successivo*;
- **↗** accanto all'articolo → il **testo ufficiale online** su Normattiva (per il D.Lgs. 81/2008 automaticamente; per
  gli altri provvedimenti incolla il link Normattiva nel campo **Fonte** della scheda). Il collegamento online c'è solo
  per gli articoli del provvedimento principale: l'indice iniziale del PDF e i decreti riportati in appendice (che
  hanno una loro numerazione, es. altri «Art. 19») restano collegati solo al documento trasmesso.

**Cerca in** (sotto la casella, in entrambe le modalità): spunte per scegliere gli argomenti —
*Normativa, FAQ, Formazione, Generale, Procedure, Schede tecniche* e le altre categorie presenti — oppure **Tutti**.
La scelta resta memorizzata sul telefono e vale anche per le risposte AI; il numero accanto a ogni argomento è quello
delle schede. Per avere argomenti coerenti, usa questi nomi come *categoria* quando carichi i documenti.

### Analisi foto (con l'AI)

Per il programmatore e i soci con la password AI, nella scheda **Chiedi** c'è **📷 Analizza una foto**:

1. **Scatta foto** o sceglile **Dalla galleria** (fino a 3, più angolazioni aiutano) e, se vuoi, scrivi cosa stai
   controllando (es. *«ponteggio facciata nord, terzo impalcato»*).
2. **Analizza**: l'app
   - riduce le foto (lato lungo 1280 px, più una copia da 640 px) e **toglie i dati nascosti** (posizione GPS,
     modello del telefono);
   - con le copie piccole chiede all'AI, in pochi secondi, che cosa si vede e quali sono le **possibili criticità**
     (es. «parapetto mancante sul ponteggio», «deposito di materiali sull'impalcato»);
   - cerca **ogni criticità separatamente** nell'archivio, con i sinonimi tecnici della normativa (impalcato →
     impalcature, mantovana → parasassi, casco → elmetto/DPI…), e passa all'AI fino a 12 brani;
   - chiede a Gemini di confrontare le foto con i brani trovati: **la risposta compare mentre viene scritta**,
     come nell'app di Gemini, senza aspettare la fine.
3. La risposta ha sempre quattro parti: **Cosa si vede**, **Possibili non conformità** (con gravità e riferimento
   preciso: **articolo e comma – documento**, per esempio *«Art. 126, comma 1 – D.Lgs. 81/2008 – Titolo IV»*; il numero
   apre la scheda dell'archivio; se la norma non è nell'archivio lo dice, senza inventare articoli),
   **Non valutabile dalle immagini**, **Verifiche consigliate sul posto**. Sotto, i **documenti citati** con gli articoli
   dei brani consultati e la fonte; ogni brano consultato mostra l'articolo a cui appartiene.
   Se una criticità resta «non presente nell'archivio», l'app cerca comunque da sola gli articoli che la riguardano e
   li mostra sotto la risposta in **Possibili riferimenti nell'archivio (da verificare)**, in verde e cliccabili.
4. **Copia / condividi il testo** per incollarlo in un verbale o in un messaggio.

Da sapere:

- serve la connessione (l'analisi delle immagini avviene su Google Gemini); le foto non vengono salvate nell'app;
- velocità: l'app chiede a Gemini di «ragionare» poco (risposte più rapide) e mostra il testo man mano che arriva;
  il messaggio «Gemini non ha risposto in tempo» compare solo se Gemini resta in silenzio per 45 secondi. Se la prima
  lettura rapida non riesce, l'analisi prosegue comunque cercando nell'archivio con la tua nota. Per la massima
  rapidità usa un modello «Flash» (Impostazioni → Modello), non «Pro»;
- le violazioni vengono citate solo se la norma è nell'archivio: per i ponteggi, per esempio, carica le parti del
  D.Lgs. 81/2008 sui ponteggi e le vostre procedure;
- **articoli**: l'app riconosce da sola le intestazioni «Art. 126 – Parapetti», «Articolo 122», «Allegato XVIII» nel
  testo dei documenti e indica a Gemini a quale articolo appartiene ogni brano, anche quando il brano inizia a metà
  articolo. Perché funzioni, nei documenti caricati ogni articolo deve iniziare su una riga nuova con «Art.» o
  «Articolo» seguito dal numero (come nei testi coordinati ufficiali); nel campo **Fonte** conviene scrivere il
  riferimento della norma (es. «D.Lgs. 81/2008, testo coordinato»);
- è un **supporto**: l'AI può non vedere tutto o sbagliare e non sostituisce il sopralluogo né la valutazione del tecnico;
- ⚠️ sul piano gratuito Google può usare le foto inviate: evita volti riconoscibili, targhe e documenti.

### Archivio

Elenco delle schede con filtro per testo e categoria; tocca una scheda per leggerla.
Il programmatore può anche **creare**, **modificare**, **eliminare** e **caricare documenti**, scegliere se le schede
sono **visibili in demo**, **importare** file JSON/CSV, **esportare il backup** e **pubblicare** (vedi sezione 4).

### Impostazioni

Accesso ed **Esci**, installazione, risposte AI (password AI per i soci; chiave e modello Gemini per il programmatore),
password soci e condivisione dell'AI (programmatore), controllo automatico degli aggiornamenti, spazio occupato
e archiviazione persistente.

---

## 4. Aggiornare il database

### Com'è fatta una scheda

| Campo | Contenuto |
|---|---|
| `id` | identificativo univoco e stabile (es. `procedure-richiesta-ferie`) |
| `titolo` | titolo del documento o della domanda |
| `testo` | contenuto completo |
| `categoria` | es. Normativa, Procedure, Schede tecniche, FAQ |
| `tag` | elenco di parole chiave |
| `fonte` | riferimento o URL del documento originale |
| `data_aggiornamento` | data in formato `AAAA-MM-GG` |
| `demo` | `true` se la scheda è visibile anche nell'accesso demo |

L'app divide i testi lunghi in blocchi di ~800–1200 caratteri (con 150 caratteri di sovrapposizione) collegati alla scheda:
la ricerca e Gemini lavorano sui blocchi, le schede mostrano sempre titolo e fonte.

### Dal computer: dai tuoi file ai file da pubblicare

Sul computer, nella cartella del progetto (serve [Node.js](https://nodejs.org) 22.18 o successivo):

1. Metti i documenti nella cartella **`sorgenti/`**. Le sottocartelle sono le **categorie**; quelle più interne diventano **tag**.
   ```
   sorgenti/
     normativa/        regolamento.docx   2025-03-12_circolare.pdf
     procedure/        ferie.pdf          rifiuti.md
     schede-tecniche/  stampante.html     dispositivi.xlsx
     faq/              faq-helpdesk.xlsx  faq-badge.txt
     metadati.csv      (facoltativo: titoli, tag, fonti, schede demo)
   ```
   La cartella `sorgenti/` **non va mai su GitHub** (è esclusa da git).
2. Estrai i testi:
   ```bash
   npm install
   npm run build-db
   ```
   Lo script scrive `sorgenti/db-generato.json` (**in chiaro**, resta sul computer) e mostra un riepilogo per file
   con gli eventuali avvisi (es. PDF scansionati senza testo).
3. Prepara i file da pubblicare:
   ```bash
   npm run cifra-db
   ```
   Chiede la password soci e scrive `data/demo.json` (solo schede demo, in chiaro) e `data/soci.json` (tutto, cifrato).
   Con la stessa password già pubblicata i soci non devono reinserirla e l'eventuale AI condivisa resta attiva;
   per cambiarla: `npm run cifra-db -- --nuova-password`.
4. Pubblica i due file (vedi sotto). Alla successiva apertura online, l'app chiede
   **«Aggiornamento dei contenuti disponibile» → Aggiorna**.

Per provare con i file di esempio inclusi: `npm run build-db -- sorgenti-esempio`, poi `npm run cifra-db -- sorgenti-esempio/db-generato.json`.

**Regole di conversione**

| File | Risultato |
|---|---|
| Word `.docx`, PDF con testo, PowerPoint `.pptx`, pagine `.html`, `.txt`, `.md` | una scheda per file |
| Excel `.xlsx` o `.csv` con colonne *Titolo/Domanda* e *Testo/Risposta* | una scheda per riga; le colonne *Tag*, *Categoria*, *Fonte*, *Data*, *Id*, *Demo* vengono riconosciute, le altre finiscono nel testo |
| Excel `.xlsx` o `.csv` con altre colonne (tabelle, registri) | una scheda per file, una riga di testo per riga della tabella |
| File in una cartella o con nome contenente **faq** | una scheda per domanda (righe che terminano con `?`, anche nel formato `D:`/`R:`) |
| Vecchi formati `.doc` `.xls` `.ppt` `.rtf` `.odt` | convertiti automaticamente se sul computer c'è LibreOffice, altrimenti vanno salvati nel formato moderno |
| PDF scansionati (solo immagini) | segnalati: serve prima un OCR (es. «Riconosci testo» di Adobe o del tuo scanner) |

- **id**: ricavato dal percorso del file (`procedure/ferie.pdf` → `procedure-ferie`), quindi resta uguale tra un aggiornamento e l'altro.
- **titolo**: primo titolo del documento (Word, HTML, Markdown, PowerPoint) o titolo del PDF; altrimenti il nome del file.
- **data_aggiornamento**: data all'inizio del nome del file (`2025-03-12_circolare.pdf`), altrimenti data di modifica del file.
- **fonte**: il percorso del file, a meno che non sia indicata in `metadati.csv`.

**`metadati.csv`** (facoltativo, separatore `;`, tag separati da `|`) per correggere i dati di singoli file
e scegliere le schede **demo**:

```
file;titolo;tag;fonte;data_aggiornamento;demo
normativa/regolamento.docx;Regolamento veicoli aziendali;veicoli|auto;https://intranet.esempio.it/regolamento;2025-01-10;
faq/faq-helpdesk.xlsx;;;;;sì
```

### Pubblicare i file

- **Da terminale**:
  ```bash
  git add data/demo.json data/soci.json
  git commit -m "Aggiornamento contenuti"
  git push
  ```
- **Dal sito GitHub** (senza terminale): apri il repository → cartella `data` → **Add file → Upload files** →
  trascina `demo.json` e `soci.json` → **Commit changes**.

In entrambi i casi GitHub Actions ripubblica il sito in 1–2 minuti; i telefoni ricevono l'aggiornamento alla prima
apertura online (o con **Archivio → Controlla aggiornamenti**).

> ⚠️ Non pubblicare mai `sorgenti/db-generato.json` né altri file in chiaro: il repository è pubblico e GitHub
> conserva anche le versioni passate dei file.

**Cosa succede ai dati sul telefono**: le schede pubblicate vengono aggiunte, aggiornate o rimosse come nel nuovo file.
Sul telefono del programmatore le schede **modificate e non ancora pubblicate non vengono sovrascritte**.

### Dal telefono (programmatore)

Tutto si fa dalla scheda **Archivio** e dalle **Impostazioni**, senza computer.

1. **Aggiungi o correggi**:
   - **Nuova scheda**, oppure apri una scheda → **Modifica** / **Elimina**;
   - **Carica documenti**: scegli uno o più file (Word `.docx`, Excel `.xlsx`, PowerPoint `.pptx`, PDF con testo,
     HTML, `.txt`, `.md`, `.csv`, `.json`), la categoria e se devono essere **visibili nella demo**. Il testo viene
     estratto sul telefono con le stesse regole di `build-db`: prima di aggiungerle puoi correggere i titoli ed
     escludere le schede che non vuoi;
   - **Importa JSON/CSV** per un backup, un `db-generato.json` o un CSV.

   Le schede cambiate restano **da pubblicare**: le vedi solo tu.
2. **Pubblica**: il riquadro in cima all'Archivio mostra quante modifiche sono in attesa (nuove, modificate, eliminate).
   Tocca **Pubblica**: l'app cifra l'archivio e invia `demo.json` e `soci.json` su GitHub in un'unica modifica.
   In 1–2 minuti il sito si aggiorna e tutti i telefoni ricevono le novità.
3. **Impostazioni → Password e condivisione**:
   - **Cambia password soci**: pubblicata subito; ogni socio dovrà inserire la nuova (per escludere qualcuno basta non dirgliela);
   - **Risposte AI per i soci**: con una **password AI** la tua chiave Gemini viene condivisa, cifrata, con chi la conosce;
     **Cambia password AI** per toglierla a qualcuno, **Smetti di condividere l'AI** per toglierla a tutti.
     Se cambi chiave o modello Gemini, la nuova arriva ai soci alla pubblicazione successiva.

**Categorie** (*Archivio → Categorie*): aggiungi, rinomina (tutte le sue schede vengono aggiornate), cambia
l'ordine con ↑ ↓ o elimina una categoria (se contiene schede scegli dove spostarle). L'elenco viene pubblicato
con le schede: soci e demo vedono le stesse spunte «Cerca in», nello stesso ordine. Quando carichi un documento o
crei una scheda la categoria si sceglie dall'elenco, con **＋ Nuova categoria…** per aggiungerne una al volo.

Sicurezza della pubblicazione:

- se nel frattempo su GitHub è comparsa una versione più recente (per esempio pubblicata da un altro tuo telefono),
  l'app **non sovrascrive** nulla e ti chiede prima di aggiornare: le tue modifiche non vanno perse;
- se il codice GitHub è scaduto, l'app lo dice: creane uno nuovo (sezione 3), esci e rientra.

**Password soci dimenticata**: nell'accesso programmatore, dopo una password errata compare
**Ho dimenticato la password soci**. Con il codice GitHub imposti una nuova password; le schede riservate pubblicate
con la vecchia non sono recuperabili (sono cifrate): ripartirai dalle schede demo e reimporterai le altre
da un backup o da `db-generato.json`. Alla prima pubblicazione la nuova password vale per tutti.

### Assistenza

Per password dimenticate, password AI o problemi con l'app: **inlispettori@gmail.com** · **349 866 9025**
(gli stessi contatti compaiono nella schermata di accesso e in *Impostazioni → Assistenza*).

---

## 5. Pubblicare l'app su GitHub Pages (deploy)

Serve un account GitHub gratuito. Con il piano gratuito **il repository deve essere pubblico**: chiunque potrà leggere
il codice, le schede demo e il file cifrato dei soci (illeggibile senza password). La chiave Gemini non è mai nel repository
in chiaro.

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

Ogni `git push` sul ramo `main` (codice o file in `data/`) ripubblica tutto automaticamente.
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
- Le schede pubblicate si possono sempre riscaricare. **Quelle create o modificate sul telefono del programmatore e non
  ancora pubblicate no**: esporta un backup con **Archivio → Esporta backup** (su iPhone si apre il menu Condividi →
  *Salva su File*). Il backup è **in chiaro**: conservalo in un posto sicuro e non pubblicarlo.
- Per ripristinare: **Archivio → Importa JSON/CSV** e scegli il file di backup.

---

## 7. Risoluzione dei problemi

| Problema | Soluzione |
|---|---|
| L'app non si apre offline | aprila almeno una volta online e attendi il messaggio «App pronta: ora funziona anche offline» |
| Non compare «Installa app» su Android | usa Chrome (non la navigazione in incognito) e ricarica la pagina; oppure menu ⋮ → *Aggiungi a schermata Home* |
| Su iPhone manca «Aggiungi alla schermata Home» | apri il link in Safari (non dentro WhatsApp, Mail ecc.: usa «Apri in Safari») |
| «Quota gratuita di Gemini esaurita» | attendi (i limiti si azzerano ogni minuto o ogni giorno) o prova un modello più leggero; la ricerca locale funziona comunque |
| «La chiave API Gemini non è valida» | ricopia la chiave da AI Studio senza spazi e tocca *Verifica chiave* |
| «Modello Gemini non trovato» | l'app sceglie da sola un modello disponibile; se l'errore resta, *Impostazioni → Mostra i modelli disponibili* e toccane uno |
| «L'API Gemini non è disponibile nel paese» | Google non offre l'API nella tua zona: l'app funziona solo con la ricerca locale |
| La verifica sul web si è disattivata | quota esaurita o modello senza Ricerca Google: riattivala più tardi o cambia modello |
| I contenuti non si aggiornano | *Archivio → Controlla aggiornamenti*; verifica che il workflow su GitHub sia verde |
| «La password dei soci è cambiata» | chiedi la nuova password al programmatore e inseriscila nel riquadro |
| «Password non corretta» all'accesso | controlla maiuscole/minuscole; la password soci è unica per tutti i soci |
| «Codice di accesso GitHub non valido o scaduto» | crea un nuovo codice (sezione 3) |
| Il workflow fallisce su «Manca data/demo.json» o «soci.json» | esegui `npm run cifra-db` e pubblica i due file |
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
npm run build-db       # sorgenti/ → sorgenti/db-generato.json (in chiaro, resta sul computer)
npm run cifra-db       # db-generato.json → data/demo.json + data/soci.json (cifrato)
npm run icons          # rigenera le icone PNG da public/icons/icon.svg (usa Playwright)
```

`check:offline` e `icons` usano Playwright, che non è tra le dipendenze (non serve per la build né su GitHub):
installalo solo se ti servono, con `npm i -D playwright && npx playwright install chromium`.

Per provare la build con lo stesso percorso di GitHub Pages: `BASE_PATH=/consulta/ npm run build && BASE_PATH=/consulta/ npm run preview`.

### Struttura

```
src/
  shared/        logica pura, condivisa da app, script Node e test
    types.ts       schema delle schede
    crypto.ts      cifratura con password (PBKDF2 + AES-GCM, Web Crypto)
    publish.ts     formato di demo.json e soci.json
    github.ts      API di GitHub: verifica del codice, lettura e pubblicazione dei file (un commit)
    extract.ts     estrazione del testo da Word, Excel, PowerPoint, PDF, HTML (computer e telefono)
    normalize.ts   normalizzazione record, date, tag, versioni
    csv.ts         parser CSV e decodifica UTF-8 / Windows-1252
    chunk.ts       suddivisione in blocchi con sovrapposizione
    merge.ts       regole di import manuale e aggiornamento remoto
    search.ts      analisi del testo in italiano, indice MiniSearch, estratti ed evidenziazione
    gemini.ts      richieste, parsing delle risposte, errori, citazioni
    vision.ts      analisi foto: richieste a Gemini (descrizione, analisi con i brani) e lettura delle risposte
    markdown.ts    markdown delle risposte senza HTML grezzo
  lib/           database Dexie, indice persistente, AI, impostazioni, aggiornamento remoto
  components/    componenti dell'interfaccia
  pages/         Chiedi, Database (elenco, dettaglio, modifica), Impostazioni
scripts/         build-db.mjs, cifra-db.mjs, gen-icons.mjs, check-offline.mjs
data/demo.json   schede demo, in chiaro
data/soci.json   tutte le schede, cifrate (i file di data/ non sono nel precache del service worker)
sorgenti-esempio/  file di esempio in tutti i formati supportati
tests/           test di ricerca, Gemini, accessi e cifratura, database, import, build-db
.github/workflows/deploy.yml   test + build + pubblicazione su GitHub Pages
```

### Ricerca locale

- testo normalizzato in minuscolo e senza accenti; stopword italiane rimosse;
- stemmer leggero: singolare/plurale e maschile/femminile coincidono (*veicolo/veicoli*, *banca/banche*);
- lettere e cifre attaccate separate («preposto253» → preposto, 253);
- errori di battitura tollerati (1 dai 5 caratteri, 2 dai 9) e ultima parola come prefisso **solo per le parole che
  non esistono nell'archivio**;
- pesi: titolo ×2, tag ×1,5, testo ×1, categoria ×0,5;
- per l'AI: almeno i primi 6 blocchi pertinenti, al massimo 8, al massimo 3 dallo stesso record;
- «Tutti i risultati»: ogni blocco che contiene le parole, raggruppato per documento, con il conteggio delle forme;
- l'indice è salvato in IndexedDB e ricostruito solo quando i dati cambiano.

### Personalizzare nome, logo e colori

- **Nome e contatti**: `src/branding.ts` (nome, sottotitolo, email e telefono di assistenza) e `vite.config.ts` (nome nel manifest).
- **Logo**: sostituisci `public/brand/logo-atisl.png` (triangolo, sfondo trasparente) e `public/brand/logo-completo.png`
  (logo con CONFSAL), poi rigenera le icone con `npm run icons`.
- **Colori**: variabili `--primary` (blu CONFSAL `#1E5C86`) e `--accent` (giallo ATISL `#EDC336`) in `src/styles.css`.

### Note di compatibilità

Obiettivo Safari iOS 15+ e Chrome Android recenti: build `es2020`, nessuna regex con lookbehind,
input a 16px (niente zoom automatico su iOS), margini per notch e barra Home, tema chiaro/scuro automatico.
