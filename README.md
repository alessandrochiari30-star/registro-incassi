# Registro incassi

PWA per registrare gli incassi del salone dal telefono: si digita l'importo e si tocca il canale (`B` bancomat, `S` Satispay, `R` contante con ricevuta, `C` cash). Zero dipendenze, funziona completamente offline, i dati restano solo sul dispositivo.

## Sviluppo

```
npm test                                    # unit test (node --test), nessuna dipendenza
powershell -File tools/make-icons.ps1       # rigenera le icone da tools/icon.svg
```

Per provare in locale serve un server statico qualsiasi sulla cartella del progetto (i moduli ES non funzionano da `file://`).

**Attenzione in sviluppo:** il service worker è cache-first. Dopo una modifica, incrementare `VERSION` in `sw.js` oppure disattivare il SW dai DevTools, altrimenti il browser serve i file vecchi.

## Pubblicazione (GitHub Pages)

La shell dell'app (solo codice, mai dati) deve stare su HTTPS perché iOS installi la PWA.

1. Creare un repository GitHub (va bene privato con Pages attivo, o pubblico: nel codice non ci sono dati).
2. `git remote add origin <url>` e `git push -u origin master`.
3. Settings → Pages → Deploy from branch → `master`, cartella `/ (root)`.
4. L'app sarà su `https://<utente>.github.io/<repo>/`.

Per gli aggiornamenti successivi: modificare il codice, **incrementare `VERSION` in `sw.js`**, push. L'app installata si aggiorna alla seconda apertura.

## Installazione su iPhone

1. Aprire l'URL in Safari.
2. Tasto Condividi → **Aggiungi alla schermata Home**.
3. Aprire l'app dall'icona: da lì in poi funziona anche senza rete.

## Dati e backup

- Ogni inserimento viene scritto subito su IndexedDB e specchiato in localStorage (backup continuo sul dispositivo, con recupero automatico all'avvio se una copia si corrompe).
- **Il telefono è l'unico posto dove vivono i dati.** L'unico backup fuori dal dispositivo è l'export manuale (schermata Mese → Export): CSV per i fogli di calcolo, JSON come backup completo. Farlo almeno una volta a settimana — l'app lo ricorda da sola.
- L'app è una prima nota gestionale, non un documento fiscale: non sostituisce la certificazione dei corrispettivi.
