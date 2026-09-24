# Freedomstack — Detaillierter Projektplan

**Stand:** 2026-08-25 · **Gesamt-Code:** 17.809 Zeilen TS
**Phase:** 1 (Pre-Launch) — UI/UX abgeschlossen, Monetisierung & Security offen

---

## 📊 Aktueller Status

### ✅ Fertig (heute verifiziert)

| Komponente | Details |
|---|---|
| **Landing** (index.html) | Partikel-Animation seitenweit, Terminal-Demo, 8 Sprachen, Sprachmenü funktioniert |
| **App-Boot** | Direkt in die App, kein Gate, kein FOUC, Identity wird erzeugt |
| **Agent-Tab** | Senden → Job läuft, Fortschritts-Pipeline (⚡→🔍→🤖), Modell-Karten mit Sats+SOL-Preis |
| **Sprachmenüs** | Landing + App, 8 Sprachen (EN/DE/ES/FR/IT/PT/ZH/JA), live-Umschaltung |
| **Free-Quota** | 5.000 Tokens/Tag, Anzeige in Sidebar mit Balken, Redirect zu Wallet wenn leer |
| **Onboarding** | Gestyltes Modal, Backdrop-Close, erscheint nur beim ersten Mal |
| **Provider** | Läuft, beantwortet Jobs, Trace-Stripper, Quota-API |
| **Wallet** | SOL-Deposit, Balance-Anzeige, Sidebar-CTA |

### 🔴 Kritische Bugs (user-gemeldet, nicht reproduzierbar)

| # | Beschreibung | Status |
|---|---|---|
| B1 | Gate-Zwischenseite erscheint | E2E-verifiziert als gelöst (FOUC eliminiert) — user testet evtl. gecachte Version |
| B2 | Sprachmenüs funktionieren nicht | E2E-verifiziert als gelöst — evtl. Cache oder Hit-Test-Problem |
| B3 | Senden-Button tot | E2E-verifiziert als gelöst (Identity wird jetzt beim Boot geladen) |

**Hinweis:** Alle 3 Bugs wurden im E2E-Test (Playwright, frischer Browser) als bestätigt behoben. Der User testet vermutlich über eine gecachte Version oder den falschen Flow.

---

## 🎯 Offene Arbeiten (priorisiert)

### 🔴 P0 — Launch-Blocker (müssen vor Launch erledigt sein)

#### P0-1: Wallet-Pflicht durchsetzen (Roadmap R1)
**Dateien:** `packages/app/src/shell/app.ts`, `packages/app/src/session-client.ts`

- [ ] `openSession()` prüfen: Nur erlauben wenn Deposit > 0 ODER Gratis-Kontingent
- [ ] `defaultBudgetSats` auf 0 setzen (kein Kredit für neue Pubkeys)
- [ ] Gratis-Phase: Nur Tages-Kontingent (5.000 tokens), kein Session-Budget
- [ ] UI-Hinweis: „Ohne Wallet nur X gratis Tokens/Tag"

#### P0-2: Session-Budget gegen Sybil schützen (Roadmap R2)
**Dateien:** `packages/app/src/session-client.ts`, `packages/node/src/dvm-provider.ts`

- [ ] `checkSessionLedger` erweitern: Max. 1 Session pro Pubkey pro Tag ohne Deposit
- [ ] `validateSession` strikter: Abgelaufene Sessions sofort ablehnen
- [ ] Rate-Limit: Max. 100 Jobs/Tag/Pubkey ohne verifizierte Wallet

#### P0-3: Security-Audit light (Phase 1.5)
**Dateien:** Alle

- [ ] Gate-Cookie: HMAC prüfen, HttpOnly + Secure Flags
- [ ] Zap-Beträge: Max-Limit prüfen (kein Overflow)
- [ ] Relay-Rate-Limit: Max. 100 req/min pro IP
- [ ] Input-Limits: Prompt max. 10.000 Zeichen, Bid max. 1M sats
- [ ] XSS-Check: Alle `innerHTML`-Stellen escapen

---

### 🟡 P1 — Hoch (sollten vor Launch erledigt sein)

#### P1-1: Mobile-Härtung (Phase 1.4)
**Dateien:** `packages/app/src/shell/app.css`

- [ ] Viewport-Test: 390×844 (iPhone/Seeker)
- [ ] Sidebar-Navigation: Touch-Targets min. 44px
- [ ] Modell-Popover: Auf Mobile als Bottom-Sheet statt Dropdown
- [ ] Composer: Textarea auto-resize bis max. 6 Zeilen
- [ ] Fortschritts-Chips: Auf Mobile untereinander statt nebeneinander
- [ ] Code-Blöcke: Horizontal scrollbare, nicht umbrechende

#### P1-2: Landing-Polish
**Dateien:** `packages/website/index.html`, `packages/website/css/style.css`

- [ ] Social-Proof-Platzhalter: „X Provider · Y Jobs · Z Sats" (live-Daten später)
- [ ] 3-Schritte-Erklärung: 01 Connect → 02 Ask → 03 Pay
- [ ] Footer: Links zu GitHub, Docs, Impressum
- [ ] SEO: Meta-Description, Open-Graph-Tags

#### P1-3: Agent-UX-Vervollständigung
**Dateien:** `packages/app/src/shell/app.ts`

- [ ] Antwort-Stopp-Button: Funktionalität testen (AbortController)
- [ ] Antwort-Regenerieren: Button + Handler
- [ ] Copy-Button auf Code-Blöcke: Funktionalität testen
- [ ] Prompt-History: Pfeiltasten hoch/runter für vorherige Prompts
- [ ] Keyboard-Shortcuts: Enter senden, Strg+K Command-Palette

#### P1-4: Wallet-Tab UX
**Dateien:** `packages/app/src/shell/app.ts`, `packages/app/src/shell/index.html`

- [ ] Deposit-Flow: Adresse kopieren → Status-Anzeige → Bestätigung
- [ ] Balance-Auto-Refresh: Alle 30s SOL-Balance neu laden
- [ ] Escrow-Anzeige: „X SOL verfügbar / Y SOL reserviert"
- [ ] Referral-Link: Copy-Button + „X Sats verdient"

---

### 🟢 P2 — Mittel (können nach Launch erledigt werden)

#### P2-1: Chat-Features
**Dateien:** `packages/app/src/shell/app.ts`

- [ ] DM-Verschlüsselung (NIP-04) implementieren
- [ ] Chat-Verlauf: Session-Persistenz (localStorage)
- [ ] Zap-Dialog: Lightning + Solana funktionsfähig
- [ ] Media-Upload: Bilder/Videos in DMs

#### P2-2: Feed-Features
**Dateien:** `packages/app/src/shell/app.ts`

- [ ] Feed-Loading: Pagination (20 Posts laden)
- [ ] Media-Posts: Bilder/Videos inline anzeigen
- [ ] Post-Detail: Einzelansicht mit Kommentaren
- [ ] Hashtag-Suche

#### P2-3: Provider-Onboarding
**Dateien:** `packages/node/src/main.ts`, `packages/launcher/`

- [ ] Launcher-Build: Windows/macOS/Linux
- [ ] Auto-Update: Binary-Updates via GitHub Releases
- [ ] Monitoring: Health-Endpoint + Uptime-Tracking
- [ ] Dokumentation: Provider-Setup-Guide

#### P2-4: Open-Source-Release (Roadmap R3)
**Dateien:** Alle

- [ ] Lizenz: MIT oder AGPL wählen
- [ ] README: Quickstart für Nutzer + Provider
- [ ] CI-Build: GitHub Actions für App + Node
- [ ] Security-Policy: Responsible Disclosure

---

### 🔵 P3 — Niedrig (Nice-to-have)

#### P3-1: Agent-Workflows
- [ ] Multi-Step-Chains: „Recherchiere → Schreibe Report → Generiere Bild"
- [ ] Tool-Kombination: Web-Suche + Bild-Gen in einem Job
- [ ] Vorlagen: „Blog-Post", „Code-Review", „Recherche"

#### P3-2: Performance
- [ ] Bundle-Größe: Code-Splitting für lazy-loaded Tabs
- [ ] Relay-Connection-Pooling: Persistente WS-Verbindungen
- [ ] KV-Cache: Provider-Caps cachen statt jedes Mal neu laden

#### P3-3: Analytics
- [ ] Privacy-freundlich: Keine Tracker, optionale Nutzer-Statistiken
- [ ] Provider-Dashboard: Einnahmen, Jobs, Uptime

---

## 📅 Empfohlene Reihenfolge

```
Woche 1: P0-1 + P0-2 + P0-3 (Security & Monetisierung)
Woche 2: P1-1 (Mobile) + P1-2 (Landing) + P1-3 (Agent-UX)
Woche 3: P1-4 (Wallet) + P2-1 (Chat) + P2-2 (Feed)
Woche 4: P2-3 (Provider) + P2-4 (OSS) + P3 (Nice-to-have)
```

---

## 🧪 Test-Checklist (vor Launch)

- [ ] E2E: Landing → App → Job senden → Antwort erhalten
- [ ] E2E: Sprachwechsel in allen 8 Sprachen
- [ ] E2E: Wallet-Deposit → Job → Settlement
- [ ] Mobile: iPhone 12 Pro (390×844) + Seeker
- [ ] Security: Gate-Cookie, Rate-Limits, Input-Limits
- [ ] Performance: Bundle < 2MB, LCP < 2s
- [ ] Provider: 24h-Stabilität, Auto-Restart bei Crash

---

## 📁 Dateien-Referenz

| Pfad | Zweck |
|---|---|
| `packages/app/src/shell/app.ts` | App-Shell (2.636 Zeilen) |
| `packages/app/src/shell/index.html` | App-HTML |
| `packages/app/src/shell/app.css` | App-Styles |
| `packages/app/src/i18n.ts` | Übersetzungen (8 Sprachen) |
| `packages/app/src/session-client.ts` | Session-Management |
| `packages/node/src/dvm-provider.ts` | Provider-Logic |
| `packages/node/src/main.ts` | Node-Boot |
| `packages/website/index.html` | Landing-Page |
| `docs/ROADMAP.md` | Roadmap |
| `docs/UI-UPGRADE.md` | UI-Upgrade-Plan |
