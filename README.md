# Rattazzi — Cartellini Prezzi

App web leggera per listini ferramenta. PWA installabile su iPhone.
Funziona offline dopo il primo caricamento.

## 🚀 Uso

- **PC**: apri il link nel browser.
- **iPhone**: Safari → Condividi → Aggiungi a Home.

## 💾 Sicurezza dati

- Salvataggio locale (localStorage) con 3 backup a rotazione
- Verifica integrità ad ogni scrittura
- Auto-recovery su storage pieno
- Backup JSON manuale settimanale (pulsante ⬇)

## 📋 Funzioni

- Settori (tab) con articoli a misura
- Lotti multipli con costo ultimo/medio
- Prezzo suggerito da margine target
- Sconti quantità (es. da 10 pz → -5%)
- Giro in magazzino (solo prezzo visibile, no costo né margine)
- Undo/Redo (Ctrl+Z / Ctrl+Y)
- Foto articolo
- Fornitore + codice articolo
- Stampa A4 pulita con nome, codice e spazio per il prezzo a matita
- Ricerca globale + filtri urgenza (>6 / >12 mesi)
- Rubrica articoli (`rubrica.js`) per inserimento rapido

## 📄 Stampa A4

Il foglio stampato contiene:
- Titolo "RATTAZZI — Cartellini Prezzi"
- Settore
- Numero articoli
- Etichetta "Data: ______" (da scrivere a matita)
- Per ogni articolo: nome grande + codice + spazio vuoto per il prezzo

**Niente costo, niente margine, niente data precompilata.**

## 🔧 Stack

HTML5 + CSS3 + JS vanilla + PWA + localStorage.

## 📄 Licenza

Uso privato — Rattazzi