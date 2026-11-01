# Consulta

PWA installabile e utilizzabile offline per consultare normativa, procedure, schede tecniche e FAQ, con risposte AI tramite Google Gemini. Costo zero: hosting statico su GitHub Pages, nessun backend.

> README completo (installazione su Android/iPhone, chiave Gemini, deploy) in arrivo nella fase 5.

## Sviluppo

```bash
npm install
npm run dev            # server di sviluppo
npm run build          # build di produzione in dist/
npm run preview        # anteprima della build (service worker attivo)
npm test               # test automatici
npm run check:offline  # verifica automatica del funzionamento offline (dopo una build)
npm run icons          # rigenera le icone PNG da public/icons/icon.svg
```

## Database

Ogni record ha: `id`, `titolo`, `testo`, `categoria`, `tag[]`, `fonte`, `data_aggiornamento` (AAAA-MM-GG).
Nell'app i testi lunghi vengono divisi in blocchi di ~800–1200 caratteri con 150 di sovrapposizione, collegati al record.

### Generare `data/db.json` dai tuoi file

1. Metti i file in `sorgenti/` (cartella esclusa da git: i documenti originali restano sul tuo PC).
   Le sottocartelle di primo livello sono le **categorie**; quelle più interne diventano **tag**.
   ```
   sorgenti/
     normativa/        regolamento.docx, 2025-03-12_circolare.pdf
     procedure/        ferie.pdf, rifiuti.md
     schede-tecniche/  stampante.html, dispositivi.xlsx
     faq/              faq-helpdesk.xlsx, faq-badge.txt
     metadati.csv      (facoltativo)
   ```
2. Esegui:
   ```bash
   npm run build-db
   ```
   Per provare con i file di esempio: `npm run build-db -- sorgenti-esempio`.

Regole di conversione:

| Formato | Risultato |
|---|---|
| Word `.docx`, PDF (con testo), PowerPoint `.pptx`, HTML, `.txt`, `.md` | un record per file |
| Excel `.xlsx` / `.csv` con colonne *Titolo/Domanda* + *Testo/Risposta* | un record per riga (le altre colonne finiscono nel testo, *Tag* e *Data* vengono riconosciute) |
| Excel `.xlsx` / `.csv` con altre colonne | un record per file, una riga di testo per riga |
| File in una cartella o con nome contenente “faq” | un record per domanda (righe che finiscono con `?`) |
| `.doc` `.xls` `.ppt` `.rtf` `.odt` | convertiti automaticamente se è installato LibreOffice |
| PDF scansionati (solo immagini) | segnalati: serve prima l'OCR |

- **id**: ricavato dal percorso (`procedure/ferie.pdf` → `procedure-ferie`), quindi stabile tra un aggiornamento e l'altro.
- **data_aggiornamento**: data all'inizio del nome (`2025-03-12_circolare.pdf`), altrimenti data di modifica del file.
- **versione**: data e ora di generazione; se i contenuti non cambiano il file non viene riscritto.
- **metadati.csv** (separatore `;`, tag separati da `|`) per correggere titolo, tag, fonte, data o id di singoli file:
  ```
  file;titolo;tag;fonte;data_aggiornamento
  normativa/regolamento.docx;Regolamento veicoli;veicoli|auto;https://intranet/…;2025-01-10
  ```

### Aggiornare il database nell'app

1. **Import manuale** (scheda Database → *Importa JSON/CSV*): accetta `db.json`, backup dell'app, array di record o CSV
   (`;` o `,`, UTF-8 o Windows-1252, intestazioni come `titolo;testo;categoria;tag;fonte;data_aggiornamento`).
   Se un id esiste già vince il record con la data di aggiornamento più recente.
2. **Aggiornamento remoto**: pubblica il nuovo `data/db.json` su GitHub. All'avvio, se online, l'app confronta il campo
   `versione` e chiede conferma prima di aggiornare. I record creati o modificati nell'app non vengono mai sovrascritti.
3. **Modifica nell'app**: crea, modifica ed elimina record dalla scheda Database.

**Backup**: *Esporta backup* salva un JSON con tutti i record (su iPhone si apre il foglio di condivisione → *Salva su File*);
lo stesso file si reimporta con *Importa JSON/CSV*.

## Ricerca locale (offline)

La ricerca usa [MiniSearch](https://github.com/lucaong/minisearch) direttamente sul dispositivo, senza rete:

- **italiano**: minuscole, accenti ignorati (*perché* = *perche*), stopword italiane rimosse,
  singolare/plurale e maschile/femminile unificati (*veicolo* = *veicoli*, *banca* = *banche*);
- **errori di battitura**: 1 errore tollerato dalle 5 lettere, 2 dalle 9 (*pasword* → *password*);
- **parole incomplete**: l'ultima parola vale anche come prefisso (*stamp* → *stampante*);
- **pesi**: titolo ×2, tag ×1,5, testo ×1, categoria ×0,5;
- **risultati**: i 6–8 blocchi più pertinenti (max 3 dallo stesso record, per dare spazio a fonti diverse),
  mostrati come schede con titolo, categoria, fonte ed estratto con i termini evidenziati.

L'indice viene salvato sul dispositivo e ricostruito solo quando i dati cambiano.
Le ultime 20 domande restano nella cronologia locale (cancellabile).

## Risposte AI con Gemini

Con connessione e chiave API, dopo la ricerca locale l'app chiama Gemini (API REST `generateContent`,
direttamente dal browser, nessun server):

1. **Dal database**: i blocchi trovati vengono inviati come contesto con l'istruzione di rispondere in italiano
   *solo* sulla base di quei blocchi, dire chiaramente se l'informazione manca, citare gli id dei record e non inventare.
   Le citazioni `[id]` diventano numeri cliccabili che aprono il record; sotto c'è l'elenco dei record citati.
2. **Dal web** (interruttore *Verifica anche sul web*): seconda chiamata con lo strumento `google_search`;
   la risposta compare in una sezione separata con i link alle fonti (`groundingMetadata`) e i suggerimenti di ricerca Google.
   Le due sezioni non vengono mai mescolate.

Offline o senza chiave si vedono solo i blocchi locali. Se Gemini risponde con un errore l'app lo spiega in una riga
e mostra comunque i risultati locali:

| Errore | Comportamento |
|---|---|
| 429 quota esaurita | messaggio + risultati locali; per il web l'interruttore viene disattivato |
| chiave non valida / 403 | invito a controllare la chiave nelle Impostazioni |
| modello inesistente / ricerca Google non supportata | messaggio; per il web l'interruttore viene disattivato |
| timeout (40 s, 60 s per il web), rete assente, 500/503 | messaggio + pulsante *Riprova* |

La chiave si inserisce in **Impostazioni** (link guidato a Google AI Studio), è salvata solo nel dispositivo
(IndexedDB), viene inviata solo a Google nell'intestazione `x-goog-api-key` e non compare mai nel codice,
nel repository o nei backup. Anche il nome del modello è configurabile (predefinito `gemini-2.5-flash`).

> ⚠️ Sul piano gratuito Google può usare i contenuti inviati per migliorare i propri servizi:
> non inserire dati personali o riservati.
