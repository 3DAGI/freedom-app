# Integrationsplan: Auf Buzz + Clawstr aufbauen

**Ergänzung zum Master-Whitepaper** · Version 1.0 · Juli 2026 · keine Rechtsberatung

---

## 0. Kurzfassung

**Buzz liefert die Schichten 1–4 als produktionsreifen Code** (Identität, Kommunikation, KI-Agenten, signiertes Ledger, Git) — aber mit einer Topologie, die deinem Zensurresistenz-Ziel widerspricht.
**Clawstr liefert das Zahlungsmuster** (Agenten mit eigener Lightning-Adresse, Zaps) und beweist, dass Agenten-Ökonomie auf offenen Relays funktioniert — aber sein Base-Token ist ein Negativbeispiel, kein Vorbild.
**Deine Wertschicht (Swap, Fee-Splits, Reward-Pools) hat keiner von beiden.** Genau die hast du bereits programmiert.

Leitsatz des Plans: **Buzz' Code übernehmen, nicht Buzz' Topologie.**

---

## 1. Was Buzz konkret ist (Faktenlage)

**Technisch:** Apache 2.0, `github.com/block/buzz`, Version 0.4.21. Relay in Rust, Clients TypeScript/React. Self-Hosting braucht Docker, Rust 1.88+, Node 24+, pnpm.

**Architektur:** Selbst-hostbares Nostr-Relay, NIP-01-Wire-Format, Haupt-API ist NIP-29 über WebSocket. Jede Aktion — Chat-Nachricht, Reaktion, Workflow-Schritt, Canvas-Update, Huddle-Event — ist ein signiertes Nostr-Event, identifiziert durch eine Kind-Integer. Menschen und Agenten sind gleichrangige Teilnehmer mit identischer Identitätsstruktur (Schlüsselpaar, Kanal-Mitgliedschaften, Audit-Trail).

**Crates/Module** (direkt wiederverwendbar):
| Modul | Funktion |
|---|---|
| `buzz-core` | I/O-freie Typen, NIP-01-Filter, Schnorr-Verify, **`src/kind.rs`** (Kind-Registry) |
| `buzz-relay` | Axum WebSocket + REST |
| `buzz-db` / `buzz-pubsub` / `buzz-search` | Postgres / Redis (Presence, Typing) / Postgres-FTS |
| `buzz-auth` | NIP-42/98 Schnorr-Auth, Rate-Limiting |
| `buzz-audit` | Hash-Chain-Log |
| `buzz-cli` | agenten-first CLI, JSON rein / JSON raus |
| `buzz-acp` | ACP-Harness für Goose, Codex, **Claude Code** |
| `buzz-workflow` | YAML-Automation |
| `buzz-sdk` | typisierte Event-Builder |
| `git-sign-nostr`, `git-credential-nostr` | Nostr-signierte Git-Pushes, Git Smart HTTP |

**Der entscheidende Erweiterungspfad:** Blocks eigene Entwicklerdoku schreibt vor, neue Funktionen als **neue Nostr-Event-Kinds** zu modellieren (neue Kind in `buzz-core/src/kind.rs`, Handler in `buzz-relay`) statt als neue HTTP-Endpunkte. Bestehende Clients sehen nichts davon und brechen nicht. **Das ist die Tür für unsere Wert-Events** — unsere Kinds 38001/38002 fügen sich nativ ein.

### 1.1 Das Problem, das wir lösen müssen

Buzz hat **keinen Peer-to-Peer-Austausch, kein Gossip, keine Replikation zwischen Relays** — alle Lese- und Schreibvorgänge laufen über *ein* autoritatives Relay, das die Repo-Doku selbst „single source of truth" nennt. Die Dezentralisierung liegt auf der **Deployment-Ebene** (jede Organisation kann ihr eigenes Relay betreiben), nicht auf der Netzwerkebene.

Für Blocks Zweck (Enterprise-Slack-Ersatz mit Daten-Souveränität) ist das völlig richtig. Für dein Ziel ist es **exakt der Chokepoint aus Whitepaper-Abschnitt 9**: Ein Relay = ein abschaltbarer Punkt. Wer Buzz unverändert übernimmt, importiert diesen Chokepoint stillschweigend.

**Konsequenz: Das Outbox-/Multi-Relay-Modell ist kein „nice to have", sondern die zentrale Änderung, die wir an Buzz vornehmen müssen.**

---

## 2. Was Clawstr konkret beiträgt

Nostr-basiertes, offenes Netzwerk für KI-Agenten (Anfang 2026, u. a. Alex Gleason / Derek Ross). Relevante Bausteine:

- **Agenten ohne menschlichen Aufpasser:** Jeder Agent braucht nur seine Schlüssel und das Nostr-Netz — kein verknüpftes Social-Media-Konto, keine Freigabe durch Gatekeeper.
- **Das Zahlungsmuster, das wir kopieren:** Jeder Agent bekommt automatisch eine Lightning-Adresse im Format `npub@npub.cash`; sie wird ins `lud16`-Feld des Nostr-Profils eingetragen, und damit ist der Agent zap-empfangsbereit. **Das ist die einfachste denkbare Umsetzung von „KI-Leistung erbringen und dafür bezahlt werden"** — und passt direkt in unser Multi-Adress-Profil aus Whitepaper 4.1.
- **Zensurresistenz durch Relay-Wechsel:** Lehnt ein Relay Inhalte ab, publiziert man auf einem anderen — genau das Outbox-Prinzip, das Buzz fehlt.
- **Standard-NIPs** (u. a. NIP-22 Kommentare, NIP-73 externe Content-IDs) → interoperabel mit jedem Nostr-Client.

**Was wir NICHT übernehmen:** den `CLAWSTR`-Community-Token auf Base. Er stieg nach dem Februar-2026-Launch binnen 24 Stunden um über das 33-fache auf rund 13,7 Mio. $ Spitzenmarktkapitalisierung — ein Muster, das genau die Wertpapier-/MiCA-Fragen und den Spekulationscharakter erzeugt, die unser Design bewusst vermeidet. Wir nehmen das *Zahlungsmuster*, nicht das *Token-Modell*.

---

## 3. Zielarchitektur: wer liefert was

```
┌──────────────────────────────────────────────────────────────┐
│ SCHICHT 1–4  ← BUZZ (fork/extend, Apache 2.0)                │
│ Identität (npub) · Chat/Kanäle · Agenten (ACP: Claude Code,  │
│ Codex, Goose) · signiertes Event-Ledger · Git-Forge          │
│ ⚠ ÄNDERUNG NÖTIG: Single-Relay → Multi-Relay/Outbox          │
├──────────────────────────────────────────────────────────────┤
│ SCHICHT 5  ← CLAWSTR-MUSTER + NOSTR-STANDARDS                │
│ lud16 im Profil · NIP-57 Zaps (kind 9734/9735) ·             │
│ NIP-90 DVMs für bezahlte KI-Jobs · NIP-47 Wallet Connect     │
├──────────────────────────────────────────────────────────────┤
│ SCHICHT 6  ← UNSER EIGENER CODE (Differenzierung)            │
│ swap-core (Atomic Swap LN↔SOL) · Solana-HTLC (immutable) ·   │
│ non-custodial Fee-Splits · Reward-Pools & Season-Leaderboard │
├──────────────────────────────────────────────────────────────┤
│ SCHICHT 7  ← RESISTENZ-STACK (fehlt bei beiden komplett)     │
│ Tor/I2P · Mesh-Fallback · F-Droid/IPFS-Verteilung · Mobile   │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Integrationsplan in fünf Schritten

### Schritt 1 — Buzz aufsetzen und verstehen (1–2 Wochen)
Self-Hosted-Instanz per Docker starten, `buzz-core/src/kind.rs` und `ARCHITECTURE.md` studieren, einen Claude-Code-Agenten über `buzz-acp` anbinden. Ziel: belastbares Urteil, ob Fork oder Upstream-Beitrag der bessere Weg ist.

### Schritt 2 — Wert-Events als neue Kinds einziehen (Kernarbeit, klein)
Unsere bereits implementierten Event-Typen als neue Kinds in Buzz registrieren — genau der von Block vorgesehene Erweiterungsweg:

| Kind | Zweck | Status bei uns |
|---|---|---|
| 38001 | LP-Liquiditätsangebot | ✅ implementiert (`nostr-order.ts`) |
| 38002 | Swap-Attestierung (WoT-Reputation) | ✅ implementiert |
| 38010 | Leistungs-Event (Nachricht/KI-Job/Liquidität) | ⬜ neu |
| 38011 | Season-/Reward-Ausschüttungsnachweis | ⬜ neu |

Konkret: Kind-Konstanten in `buzz-core/src/kind.rs` ergänzen, Handler in `buzz-relay`, Typen in `buzz-sdk`. Unser TypeScript-Code kann die Events schon bauen und parsen.

### Schritt 3 — Zahlungsschicht nach Clawstr-Muster (klein, hoher Nutzen)
- `lud16` ins Buzz-Profil aufnehmen → jeder Mensch *und jeder Agent* ist zap-empfangsbereit.
- NIP-57-Zaps implementieren (kind 9734 Zap-Request an den LNURL-Callback, kind 9735 Zap-Receipt mit `bolt11`-Tag zurück auf die Relays). Damit funktioniert „KI-Job liefern → in sats bezahlt werden" sofort.
- **Bonus-Erkenntnis:** Der Zap-Receipt kann laut NIP-57 einen `preimage`-Tag enthalten, der zum Payment-Hash der Invoice passt. Das ist dieselbe Preimage/Hash-Struktur wie in unserem HTLC — Zap-Belege und Swap-Belege lassen sich also mit derselben Verifikationslogik prüfen.
- Für bezahlte KI-Dienste zusätzlich NIP-90 (DVMs) und L402 prüfen; im Ökosystem existieren fertige Bausteine (`toll-booth-dvm` als NIP-90-Bridge, `402-mcp` als L402-Client für Agenten).

### Schritt 4 — Reward-Pools & Leaderboard aufsetzen
Fee-Splits an der Quelle (non-custodial), Pools pro Chain, Ausschüttung pro Leistung. Für das Leaderboard existiert ein direktes Vorbild: `Zaplife` aggregiert Zaps netzwerkweit als Zap-Ranking — das Auszählen von Zap-Receipts ist ein etabliertes Muster (auch Zap Goals summieren öffentlich prüfbare Zap-Belege). Für treuhandartige Bounties gibt es Referenzen wie `Catalax` (zap-native Escrow) und `Chama` (P2P-Escrow mit Fedimint-Ecash) — als Studienobjekte, nicht zwingend als Abhängigkeit.

### Schritt 5 — Wertschicht anschließen (unser Alleinstellungsmerkmal)
`swap-core` + Solana-HTLC anbinden: LP-Angebote laufen als Kind-38001-Events über die Buzz-Relays, der Swap selbst über unsere bereits getestete Orchestrierung. Danach: echte Adapter (LND/CLN Hold-Invoices, `@solana/web3.js`), Anchor-Programm auditieren und immutable deployen.

---

## 5. Was danach noch fehlt — die ehrliche Lückenliste

Nach Buzz + Clawstr + unserem Code ist folgendes **noch offen**, sortiert nach Wichtigkeit für dein Ziel:

| # | Lücke | Warum kritisch | Aufwand |
|---|---|---|---|
| 1 | **Multi-Relay / Outbox** statt Single-Relay | Ohne das bleibt ein abschaltbarer Punkt — der Kern deines Ziels. Clawstrs Ansatz (Ablehnung → anderes Relay) ist die Vorlage. | **hoch** |
| 2 | **Anonymer Transport** (Tor/I2P, obfs4/Snowflake) | Weder Buzz noch Clawstr haben ihn. Ohne ihn ist IP-/DPI-Blocking trivial. | mittel |
| 3 | **Mobile Client** | Buzz' Mobile-Apps sind unfertig; Desktop-only erreicht kaum Nutzer. | hoch |
| 4 | **Zensurresistente Verteilung** (F-Droid, signierte APK, PWA über IPFS, reproducible builds) | Der App-Store ist der erste Takedown-Hebel. | mittel |
| 5 | **Mesh-Fallback** (Bluetooth/Wi-Fi-Direct) für Total-Shutdowns | Fehlt komplett; Briar/Bitchat als Vorbild. | hoch |
| 6 | **Non-custodial Fee-Splits & Reward-Contracts** | Existiert nirgends fertig — muss von uns kommen. | mittel |
| 7 | **Sybil-Schutz für Rewards** (PoW NIP-13, Web-of-Trust) | Sobald Geld an Aktivität hängt, wird gefarmt. Referenz: `bray` (trust-aware Nostr-MCP für Agenten). | mittel |
| 8 | **Audits + immutable Deploy** des Solana-HTLC | Immutable = unpatchbar; Bugs sind endgültig. | hoch |
| 9 | **Betreiber-/Rechtsstruktur** (Protokoll vs. Foundation) | Bestimmt die gesamte MiCA/AMLR-Lage. | extern |
| 10 | **PTLC-Upgrade** (Unverknüpfbarkeit der Swap-Legs) | Privacy-Ausbaustufe, nicht MVP-kritisch. | hoch |

---

## 6. Risiken der Abhängigkeit

- **Buzz ist früh:** Version 0.4.21, Mobile unfertig, kein Geschäftsmodell, keine Migrationspfade — Block veröffentlicht hier offen entwickelte Software, kein poliertes Produkt.
- **Block steht wirtschaftlich unter Druck:** Q1 2026 ein Nettoverlust von 308,7 Mio. $ (gegenüber 189,9 Mio. $ Gewinn im Vorjahresquartal), Personalabbau von 10.205 auf unter 6.000. Ein Einstellen des Projekts ist denkbar.
- **Absicherung:** Apache 2.0. Der Code bleibt nutzbar und forkbar, egal was Block tut. Lizenzhinweise/NOTICE beim Fork korrekt mitführen.
- **Ökosystem-Skepsis ernst nehmen:** In der Hacker-News-Diskussion (200+ Kommentare) wurde debattiert, ob Nostr bei Buzz wirklich tragend ist oder nur Krypto-Fassade über einem Berechtigungsproblem. Für uns ist Nostr tragend — aber nur, wenn wir Lücke #1 schließen.

---

## 7. Empfohlene Reihenfolge (revidierte Roadmap)

**Phase A (neu, ersetzt altes Phase 0/1):** Buzz forken → Wert-Kinds registrieren → `lud16` + NIP-57-Zaps → erster bezahlter KI-Job über einen Agenten. *Ergebnis: Schichten 1–5 laufen, ohne dass wir sie gebaut haben.*

**Phase B:** Multi-Relay/Outbox einziehen (Lücke #1) + Tor-Transport (#2). *Ergebnis: erst hier ist es wirklich zensurresistent.*

**Phase C:** Fee-Splits + Reward-Pools + Leaderboard (#6, #7). *Ergebnis: der ökonomische Loop.*

**Phase D:** Atomic Swap live (unser `swap-core` + auditiertes, immutables Solana-HTLC, #8).

**Phase E:** Mobile + zensurresistente Verteilung (#3, #4), danach Mesh (#5) und PTLC (#10).

**Zeitersparnis grob:** Buzz nimmt uns Schicht 1–4 ab — realistisch der größte Einzelposten des Projekts. Clawstrs Muster spart die Zahlungsschicht-Konzeption. Der Preis: Wir müssen Buzz' Relay-Topologie umbauen, statt sie zu erben.

---

*Kein Rechtsrat. Lizenzpflichten (Apache 2.0) und regulatorische Fragen (MiCA/AMLR) siehe Master-Whitepaper, Abschnitt 14.*
