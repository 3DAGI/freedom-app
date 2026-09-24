# AGENT HANDOFF — Einstiegspunkt für den lokalen Agenten

> # ⚠️ VERALTET — Stand ca. Juli 2026. Nicht als Zustandsbeschreibung lesen.
>
> Dieses Dokument beschreibt einen Projektstand, den es nicht mehr gibt. Wer es
> als Einstieg liest, startet mit einem falschen Weltbild. Konkret falsch:
>
> - **`packages/swap-core/` existiert nicht.** Der Code liegt heute in
>   `packages/protocol/`, `packages/node/` und `packages/app/`.
> - **„41 Tests"** — real sind es 92 (protocol) + 35 (node) + 1 (app).
> - **„Das Anchor-Programm wurde nie kompiliert"** — es ist gebaut und auf
>   Devnet deployed (`B6W19UfZ1iYDoJYaSesZDiP96TpeZACQu3Xs6VSJ4kJk`).
> - **„Kein einziger echter Netzwerk-Call"** — `WebSocketRelay` läuft gegen
>   echte Relays, der Provider gegen echtes Ollama.
>
> **Aktueller Einstieg:** `README.md` → `docs/PROTOCOL.md` → `docs/ANALYSIS.md`.
>
> Weiterhin gültig und lesenswert ist ausschließlich **Abschnitt 2
> (Architektur-Invarianten)**. Abschnitt 4 („Was NICHT funktioniert") ist als
> *Haltung* vorbildlich — nur die Inhalte sind überholt.

> **Historischer Kontext:** Lies zuerst dieses Dokument, dann
> `docs/Master-Whitepaper.md` und `docs/Integrationsplan-Buzz-Clawstr.md`.
> Danach `packages/swap-core/src/`.

---

## 1. Was gebaut wird

Ein **betreiberloses Protokoll** (kein Unternehmen, keine Plattform) für:
1. zensurresistente Kommunikation,
2. KI-Nutzung, die man bezahlt bzw. mit der man verdient,
3. chainübergreifenden Werttransfer,

ohne dass eine Partei Gelder verwahrt oder das System abschalten kann.

**Zentrale Idee:** Koordination und Settlement trennen. Identität, Nachrichten und
Leistungsabrechnung sind chain-agnostische signierte Nostr-Events. Nur die
Wertbewegung berührt eine konkrete Chain. Cross-Chain per **Atomic Swap**, nicht
per Bridge.

---

## 2. Architektur-Invarianten — NICHT VERLETZEN

Diese Regeln sind das Ergebnis der Designarbeit. Wenn eine Aufgabe sie zu
verletzen scheint, ist die Aufgabe falsch verstanden — nachfragen, nicht umgehen.

1. **Non-custodial ausnahmslos.** Das Protokoll hält nie fremde Gelder. Fees
   werden AN DER QUELLE dreigeteilt (Empfänger / Reward-Pool / Protokoll). Es
   gibt keinen zentralen Topf. Niemals ein „sammeln und später auszahlen"-Design.
2. **Keyless & immutable on-chain.** Contracts werden einmal deployt: keine
   Upgrade-Authority, keine Admin-/Pause-Funktion, keine Mint-Authority in
   Menschenhand. Autorisierung durch Beweis, nicht durch Signer.
3. **Kein Mixer, kein Auto-Mixing von Fees.** Wurde bewusst verworfen (macht den
   Betreiber zum Geldwäsche-Ziel und flaggt alle Fees). Privatsphäre kommt aus
   Lightning + non-custodial P2P-Splits + frischen Adressen.
4. **Kein eigener Token als Voraussetzung.** Die Basis läuft mit BTC/SOL. Ein
   eigener Token wirft MiCA-/Wertpapierfragen auf (siehe Clawstr als Warnung).
5. **Keine Bridge, wo ein Swap genügt.** Lock-Mint/Burn-Claim-Bridges sind der
   größte Hack-Vektor und ein Chokepoint. Atomic Swaps tauschen native Assets.
6. **Neue Funktion = neue Event-Kind, kein neuer HTTP-Endpunkt.** (Buzz-Muster.)
   Kinds zentral in `src/kinds.ts` registrieren.
7. **Multi-Relay, nie Single-Relay.** Jedes Event geht an mehrere unabhängige
   Relays. Ein Relay darf Events nur vorenthalten können, nie fälschen.
8. **Rewards als pay-for-work**, nicht als Preistopf/Wette (Glücksspielnähe) und
   nicht als handelbarer Token (Wertpapierrecht).
9. **Timelock-Ordnung im Swap:** `T_lightning > T_sol` mit Sicherheitspuffer.
   Die zuerst einlösende Seite (wo die Preimage offengelegt wird) hat die
   KÜRZERE Frist. Vertauscht = Diebstahl möglich.

---

## 3. Aktueller Stand

**41 Tests grün, Type-Check sauber.** Echte secp256k1-Schnorr-Signaturen über
`@noble/curves` — keine Attrappen.

```bash
cd packages/swap-core
npm install
npm test           # 41 Tests
npm run demo       # Atomic Swap: Happy Path + Refund Path
npm run demo:full  # kompletter Loop (9 Stufen, siehe unten)
npx tsc -p tsconfig.json --noEmit   # Type-Check
```

`demo:full` durchläuft: Identität+lud16 → Outbox/Zensur → NIP-90-KI-Job →
NIP-57-Zap mit Preimage-Beweis → Fee-Split → Leistungs-Event mit PoW →
Leaderboard mit Web-of-Trust → Ausschüttung → Atomic Swap.

### Modulübersicht (`packages/swap-core/src/`)

| Datei | Inhalt | Status |
|---|---|---|
| `kinds.ts` | zentrale Kind-Registry | ✅ |
| `event.ts` | NIP-01-ID, BIP-340-Schnorr, Verifikation | ✅ |
| `profile.ts` | kind 0 mit `lud16` + Chain-Adressen | ✅ |
| `outbox.ts` | Multi-Relay-Pool, Dedup, Verfügbarkeits-Audit | ✅ |
| `pow.ts` | NIP-13 Mining/Prüfung | ✅ |
| `wot.ts` | Web-of-Trust aus Attestierungen | ✅ |
| `zap.ts` | NIP-57 (9734/9735) + Preimage-Zahlungsbeweis | ✅ |
| `dvm.ts` | NIP-90 bezahlte KI-Jobs | ✅ |
| `performance.ts` | Leistungs-Events 38010, Payouts 38011, Seasons | ✅ |
| `rewards.ts` | Fee-Splits, Pools, Leaderboard, Verteilung | ✅ |
| `nostr-order.ts` | LP-Orderbook 38001/38002 | ✅ |
| `htlc.ts` / `timelock.ts` / `swap.ts` | Atomic-Swap-Kern | ✅ |
| `adapters.ts` | Interfaces Lightning/Solana | ✅ Interface |
| `mocks.ts` | In-Memory-Lightning/-Solana | ✅ Test/Demo |

`contracts/solana-htlc/` — Anchor-Programm (initialize/claim/refund, PDA,
Events, Fehlercodes). **Vollständiger Referenzcode, aber nie kompiliert.**

### Verwendete Kind-Nummern
```
0      Profil (lud16, Chain-Adressen)
5050   DVM Job-Request (Textgenerierung)    6050  DVM Job-Result
7000   DVM Feedback
9734   Zap-Request                          9735  Zap-Receipt
38001  LP-Liquiditätsangebot                38002 Swap-Attestierung
38010  Leistungs-Event                      38011 Reward-Payout
38012  Season-Definition
```

---

## 4. Was NICHT funktioniert / nie ausgeführt wurde

Ehrlich, damit du nichts als erledigt annimmst:

- **Das Anchor-Programm wurde nie kompiliert.** Keine Solana/Anchor-Toolchain in
  der Bauumgebung. Lamport-Buchhaltung und Rent-Exemption des Swap-PDA sind
  **ungeprüft**. Vor Devnet: `anchor build` + `anchor test`.
- **Kein einziger echter Netzwerk-Call.** Kein echtes Relay, kein echter
  Lightning-Knoten, keine echte Solana-Transaktion. Alles gegen Mocks.
- **`MemoryRelay` ist ein Testdouble**, kein WebSocket-Client.
- **Buzz wurde nie lokal gestartet** — die Integration ist geplant, nicht erprobt.
- Kein Mobile-Client, kein Tor/I2P, keine Mesh-Schicht, keine reproducible builds.

---

## 5. Nächste Aufgaben, priorisiert

### A. Der entscheidende Test zuerst (klein, hoher Informationswert)
Buzz lokal starten (Docker, Rust 1.88+, Node 24+, pnpm) und prüfen:
**Akzeptiert Buzz' Relay unbekannte Event-Kinds wie 38010?**
- Wenn ja → **kein Fork nötig**, Phase A läuft rein client-seitig.
- Wenn nein → Fork, Kind in `buzz-core/src/kind.rs` + Handler in `buzz-relay`.

Diese eine Antwort bestimmt die gesamte weitere Arbeitsteilung. Vorher keinen
Fork anlegen (0.4.x-Repo → dauerhafter Merge-Schmerz).

### B. `WebSocketRelay` implementieren
Implementiert dasselbe `Relay`-Interface wie `MemoryRelay` (`outbox.ts`):
`publish(ev)` und `query(filter)` über echtes Nostr-WebSocket (`EVENT`, `REQ`,
`EOSE`, `CLOSE`). Danach läuft der komplette getestete Kern gegen echte Relays,
ohne dass eine andere Zeile geändert werden muss.

### C. DVM-Anbieter-Knoten mit lokaler Inferenz (GX10 + Hermes)
Ein Daemon, der:
1. per `REQ` auf kind 5050 lauscht,
2. den Job an das lokale Hermes-Modell gibt,
3. `buildJobResult(...)` publiziert (kind 6050),
4. Zahlung per Zap auf die eigene `lud16` erhält,
5. ein Leistungs-Event (38010) mit PoW publiziert.

Das erfüllt zugleich die „On-Device-Inferenz als Fallback"-Anforderung des
Resistenz-Stacks: KI ohne jede Cloud-Abhängigkeit.

### D. Echte Lightning-Adapter
`LightningAdapter` (in `adapters.ts`) gegen LND oder CLN implementieren.
**Kritisch: Hold-Invoices** (LND `holdinvoice` / CLN-Plugin) — ohne sie kann die
Lightning-Seite nicht „schweben", und der Swap funktioniert nicht. Gegen
Regtest testen.

### E. Solana-Adapter + Anchor
`SolanaHtlcAdapter` mit `@solana/web3.js` + Anchor-Client. Programm auf Devnet
deployen und testen. Erst danach Mainnet und `set-upgrade-authority --final`.

### F. Danach (Resistenz-Stack)
Tor-Transport, Mobile-Client, F-Droid/IPFS-Verteilung, PTLC-Upgrade.

---

## 6. Bekannte offene Probleme

1. **LP-Liquidität im Kaltstart** — das härteste praktische Problem, nicht technisch.
2. **Timelock-Umrechnung** Lightning (Blöcke) ↔ Solana (Zeit) unter Realbedingungen.
3. **Free-Option-Problem** beim Swap ohne UX-Bruch minimieren.
4. **Verkettbarkeit**: gleiches `H` auf beiden Ketten ist korrelierbar → PTLC.
5. **Betreiberstruktur** (reines Protokoll vs. Foundation) bestimmt die Rechtslage.
6. **Missbrauch/Moderation** in einem unzensierbaren System — bewusst offen.

---

## 7. Rechtlicher Rahmen (Kurzform)

Kein Rechtsrat. MiCA und AMLR (ab Juli 2027, KYC ab 1.000 € für CASPs) binden
**identifizierbare Betreiber**, nicht betreiberlose Protokolle. Die Grenze
verläuft entlang „gibt es hier jemanden, der es kontrolliert?". Deshalb sind
die Invarianten aus Abschnitt 2 keine Stilfragen, sondern das, was das Projekt
auf der richtigen Seite dieser Linie hält. Bei gewerblichem Relay-/LP-Betrieb
oder Token-Emission spezialisierten Anwalt einbeziehen.

---

## 8. Arbeitsweise

- Tests sind die Rückkopplung: **nach jeder Änderung `npm test`.**
- Neue Funktionen mit Tests liefern; die bestehenden 41 dürfen nie brechen.
- Bei Unsicherheit über eine Invariante: im Whitepaper nachschlagen, nicht raten.
- Ehrlich markieren, was nicht ausgeführt/getestet wurde (siehe Abschnitt 4 als
  Vorbild) — ungetesteter Code darf nie als fertig ausgegeben werden.
