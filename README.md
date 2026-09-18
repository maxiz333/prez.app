# Rattazzi — Cartellini Prezzi

Applicazione web per la gestione dei listini di ferramenta con articoli a rotazione lenta.
Pensata per desktop e iPhone/tablet, funziona **offline** dopo il primo caricamento.

## 🚀 Come usarla

### Su PC
Apri il link della tua GitHub Pages nel browser.

### Su iPhone (installazione come app)
1. Apri il link in **Safari**
2. Tocca il pulsante **Condividi** (quadrato con freccia)
3. Tocca **Aggiungi a Home**
4. L'icona gialla "RZ" apparirà sulla schermata iniziale
5. Si aprirà a schermo intero, come un'app nativa

## 💾 Sicurezza dei dati

- I dati sono salvati **localmente nel browser** (localStorage)
- **3 backup automatici** a rotazione ad ogni salvataggio
- **Verifica integrità** ad ogni scrittura
- **Recupero automatico** da backup in caso di dati corrotti

### ⚠️ Regola d'oro: BACKUP JSON SETTIMANALE

**Una volta a settimana**:
1. Clicca il pulsante **⬇** in alto a destra
2. Salva il file `.json` su Google Drive / Dropbox / chiavetta USB

Il file JSON è l'unica vera rete di sicurezza se si cancella la cache del browser
o se cambi dispositivo.

### Ripristinare un backup
1. Clicca il pulsante **⬆** in alto a destra
2. Seleziona il file `.json` scaricato in precedenza
3. Conferma

## 🎯 Funzionalità principali

- **Settori merceologici** (tab) con articoli a misura
- **Lotti multipli** per articolo con costo ultimo e medio ponderato
- **Prezzo suggerito** in base al margine target del settore
- **Sconti quantità** (es. da 10 pz → -5%)
- **Giro in magazzino** (walkthrough a schermo intero, bloccato di default)
- **Undo / Redo** (Ctrl+Z / Ctrl+Y) per le ultime 15 modifiche
- **Foto articolo** con compressione automatica
- **Unità di misura** (pz / m / m² / kg / lt / cf)
- **Fornitore + codice articolo fornitore**
- **Stampa A4 pulita** con colonna "Nuovo prezzo ✏️" per la matita
- **Ricerca globale** su articolo, fornitore, codice, note
- **Filtri urgenza** (>6 mesi, >12 mesi)

## 🔧 Stack tecnico

- HTML5 + CSS3 + JavaScript vanilla
- localStorage con tripla ridondanza
- PWA installabile (manifest + service worker)
- Nessuna dipendenza esterna

## 📄 Licenza

Uso privato — Rattazzi