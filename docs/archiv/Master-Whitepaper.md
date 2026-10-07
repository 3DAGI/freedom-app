# Master-Whitepaper & Bau-Grundlage
## Ein betreiberloses Protokoll für unzensierbare Kommunikation, KI-Nutzung und Werttransfer

**Arbeitstitel:** *[PLATZHALTER]* · **Version:** 1.0 (konsolidiert) · **Datum:** Juli 2026
**Status:** Technisches Konzept- und Baupapier. Keine Rechts- oder Anlageberatung, keine Aufforderung zur Umgehung geltenden Rechts.

> Dieses Dokument fasst die vorherigen Einzeldateien (dApp-Konzept, Resistenz-Techstack, Whitepaper) zu **einer** Bau-Grundlage zusammen und ergänzt die beiden fehlenden technischen Referenzen: das Solana-HTLC-Programm und den Nostr-LP-Orderbook.

---

## Inhalt

1. Abstract
2. Problemstellung
3. Designprinzipien
4. Systemarchitektur
5. Kern: Atomic Swap Lightning ↔ Solana
6. Referenz A — Solana-HTLC-Programm (Anchor)
7. Referenz B — LP-Orderbook über Nostr
8. Fee-, Reward- & Season-Mechanik
9. Zensur- & Beeinflussungsresistenz (voller Stack)
10. Keyless- & Immutable-Checkliste
11. Detaillierter Tech-Stack
12. Roadmap
13. Repo- & Bau-Struktur
14. Risiko- & Rechtsregister
15. Offene Probleme

---

## 1. Abstract

Ein **Protokoll** — kein Unternehmen, keine Plattform —, über das Menschen (1) zensurresistent kommunizieren, (2) KI-Leistung nutzen und dafür bezahlen bzw. verdienen und (3) chainübergreifend Wert übertragen, **ohne dass eine Partei Gelder verwahrt oder das System abschalten kann**.

Leitidee: **Koordination und Settlement trennen.** Identität, Nachrichten und Leistungsabrechnung sind chain-agnostische, signierte Events (Nostr). Werttransfer läuft über Bitcoin/Lightning als Basis und wird per **Atomic Swaps** (Lightning ↔ Solana, hier vollständig ausgearbeitet) erweitert — ohne Bridge, ohne Mint-Keys, ohne Custodian. Alle On-chain-Komponenten sind **unveränderlich und einmal deploybar**.

---

## 2. Problemstellung

Kommunizieren, Rechnen/KI und Bezahlen laufen heute über Infrastruktur mit **kontrollierbaren Einzelpunkten**, die jeweils Zensur-, Ausfall- oder Druckhebel sind:

- **Kommunikation:** Konten-Sperren, Inhalte-Removal, App-Store-Takedowns; „dezentrale" Ansätze scheitern oft an einem abschaltbaren Server oder einer beschlagnahmbaren Domain.
- **KI/Compute:** Konzentration auf wenige Cloud-/Modellanbieter; Bezahlung über dieselben Finanz-Gatekeeper.
- **Wert:** Zahlungsdienstleister und zentral emittierte Stablecoins können Adressen einfrieren; Cross-Chain-Bridges bündeln Wert an einem Punkt und sind der größte Hack-Vektor der Branche.
- **Regulatorik (nüchtern):** In der EU regeln MiCA, AMLR (ab Juli 2027; KYC ab 1.000 €; Einschränkungen anonymitätswahrender Instrumente auf regulierten Plattformen) und der AI Act, wer welche Dienste anbieten darf. Ob Schutz oder Überregulierung — politische Frage, hier offengelassen. Technisch zählt nur: **Diese Pflichten treffen identifizierbare *Betreiber*, nicht ein betreiberloses Protokoll.**

**Kernproblem:** Ein System bauen, das **keinen kontrollierbaren Einzelpunkt** hat — technisch (Server, Domain, Bridge, Keys) wie organisatorisch (Betreiber, Treasury, Governance) — und trotzdem nutzbar bleibt.

---

## 3. Designprinzipien

1. **Protokoll, nicht Plattform** — offener Standard + Open-Source-Clients, selbst betreibbar; überlebt jede Einzelperson.
2. **Non-custodial ausnahmslos** — nie hält das Protokoll fremde Gelder.
3. **Keyless & immutable** — On-chain-Logik einmal deployt, ohne Admin/Upgrade/Mint-Authority in Menschenhand.
4. **Koordination ≠ Settlement** — Identität/Nachrichten/Abrechnung als signierte Events; nur Wertbewegung berührt eine Chain.
5. **Kein Bridge, wo ein Swap genügt** — Cross-Chain-Wert per Atomic Swap statt gebrücktem Token.
6. **Resistenz mit Fallbacks** — abgestufte Modi zwischen bequem und maximal resistent.
7. **Kein eigener Token als Voraussetzung** — Basis funktioniert mit BTC/SOL; ein Token ist optional und rechtlich belastet (Abschnitt 14).

---

## 4. Systemarchitektur

```
   IDENTITÄT            KOMMUNIKATION           KI / COMPUTE
   Nostr-Keypair  ───►  Nostr-Relays      ───►  DVMs (NIP-90) +
   (npub/nsec)          (Outbox, .onion)        dezentrale GPU /
   chain-agnostisch     verschlüsselte DMs      lokale Inferenz
        │                     │                      │
        └─────────────┬───────┴──────────────────────┘
                      ▼
             ABRECHNUNG / LEDGER
             signierte Leistungs-Events → Leaderboard, Reward-Pools
                      │
                      ▼
             WERT / SETTLEMENT
             Lightning (BTC)  ◄── Atomic Swap ──►  Solana / weitere
             non-custodial · keyless · immutable
```

**4.1 Identität.** Jeder Nutzer = Nostr-Schlüsselpaar (`npub`/`nsec`). Kein KYC, kein Passwort-Reset. Das Profil (`kind:0`) trägt mehrere Auszahladressen (Lightning, Solana, …), vom Nutzer signiert → Identität ist von Natur aus chain-agnostisch.

**4.2 Kommunikation.** Nostr-Relays (austauschbar, selbst-hostbar, auch `.onion`); clientseitige Signatur; Outbox-Modell; verschlüsselte DMs (NIP-17/44); Spam-Schutz via PoW (NIP-13) + Web-of-Trust + Mini-Fee pro Nachricht.

**4.3 KI/Compute.** DVMs (NIP-90): Job-Request als signiertes Event, Anbieter liefern gegen Lightning-Zahlung. Backends auf Akash/io.net/Nosana/Bittensor oder lokal (`llama.cpp`/`ollama`). Wer Leistung erbringt, verdient pro Job + Anteil an Reward-Pools.

**4.4 Abrechnung.** Jede abrechenbare Aktion erzeugt ein signiertes Leistungs-Event (wer, was, Betrag, Chain) → Rohstoff für Leaderboard und Reward-Verteilung; fälschungssicher, öffentlich prüfbar.

**4.5 Wert/Settlement.** Lightning als Basisschiene; Cross-Chain per Atomic Swap (Abschnitt 5). Non-custodial, keyless, immutable.

---

## 5. Kern: Atomic Swap Lightning ↔ Solana

### 5.1 Warum Swap statt Bridge
Eine Bridge münzt eine Repräsentation und braucht dafür Mint-Keys oder Restvertrauen (Relayer/Watchtower). Ein Atomic Swap **tauscht native Assets direkt** zwischen zwei Parteien: nichts zu münzen, kein gemeinsamer Topf, kein Mint-Key — keiner der klassischen Bridge-Angriffsvektoren. Die Gegenpartei ist **Liquiditätsgeber, kein Verwahrer**.

### 5.2 Primitive
- **HTLC:** bedingte Zahlung mit *Hashlock* (Empfänger legt Preimage `R` offen, `SHA256(R)=H`) und *Timelock* (Frist abgelaufen → Refund an Sender).
- **Lightning** nutzt HTLCs nativ; der *Payment-Hash* der Invoice **ist** `H`; Hash = **SHA-256**.
- **Solana** kann denselben HTLC als Programm ausdrücken (Escrow-PDA mit `H`, Timelock, Empfänger, Refund). Solana hat einen **SHA-256-Syscall** → prüft exakt dasselbe `H`. Diese Hash-Kompatibilität macht den Swap atomar: *ein Geheimnis entsperrt beide Seiten.*
- **Hold-Invoice:** Lightning-Zahlung wird „gehalten" statt sofort abgerechnet, bis `R` vorliegt. Pflichtbaustein.

### 5.3 Ablauf (Nutzer zahlt sats → erhält SOL)
Akteure: **Nutzer** (sats, will SOL), **LP** (SOL, will sats). LP verwahrt nichts.

```
1  Nutzer erzeugt Preimage R, berechnet H = SHA256(R).
2  Nutzer sendet nur H an den LP (R bleibt geheim).
3  LP sperrt SOL im Solana-HTLC:
     → einlösbar durch Nutzer mit R (zu H), vor T_sol
     → rückzahlbar an LP nach T_sol
4  LP stellt Lightning-HOLD-Invoice mit Payment-Hash H aus → an Nutzer.
5  Nutzer zahlt die Hold-Invoice → Lightning-HTLC „in flight", auf H
     gesperrt, aber noch NICHT abgerechnet.
6  Nutzer löst SOL ein, indem er R in der Claim-Tx offenlegt
     → R wird auf Solana öffentlich.
7  LP liest R von Solana und rechnet die Hold-Invoice ab → LP erhält sats.
```
Kein Dritter hielt je Gelder. Beide Legs verknüpft durch dasselbe `H`.

### 5.4 Sicherheit
- **Atomizität:** Um SOL zu erhalten, *muss* der Nutzer `R` offenlegen; ist `R` öffentlich, *kann* der LP die sats holen. Legt der Nutzer nie offen: Lightning-Zahlung wird zurückerstattet, SOL nach `T_sol` an LP zurück.
- **Keine Verwahrung:** Keine Seite kann nehmen, ohne die andere freizugeben.
- **Timelock-Ordnung (kritisch):** Die zuerst eingelöste Seite (Solana, Offenlegung von `R`) hat die **kürzere** Timelock, die zweite (Lightning) die **längere**: `T_lightning > T_sol`. So bleibt dem LP nach Offenlegung garantiert Zeit zur Lightning-Abrechnung.

### 5.5 Gegenrichtung (SOL → sats)
Symmetrisch: Nutzer sperrt SOL im HTLC, LP zahlt Lightning-Invoice mit `H`; wer zuerst einlöst, legt `R` offen, Gegenseite folgt; Timelock-Ordnung entsprechend.

### 5.6 Schwächen & Gegenmaßnahmen
| Problem | Gegenmaßnahme |
|---|---|
| **Liquidität** (jeder Swap braucht Gegenpartei) | LP-Orderbook über Nostr (Abschnitt 7); Reward-Anreize; später LP-Pools (Trust-Tradeoff bewusst) |
| **Griefing** (sperren, nicht vollziehen) | kurze Timelocks; Reputation/WoT; kleine Sicherheitsleistung/Fee |
| **Free-Option** (zuletzt Einlösende steigt je nach Preis aus) | sehr kurze Timelocks; Prämie/Fee; Preis-Feeds |
| **Timelock-Umrechnung** (LN in Blöcken, Solana in Zeit) | konservativ mit Puffer, `T_ln` real ≫ `T_sol` |
| **Verkettbarkeit** (gleiches `H` beidseitig korrelierbar) | **PTLC**-Upgrade (5.7) |

### 5.7 Privacy-Upgrade: PTLC / Adaptor-Signaturen
Statt Hash-Preimage nutzt man Adaptor-Signaturen; die Entsperrung ist ein Skalar, der auf jeder Kette anders aussieht → Legs on-chain unverknüpfbar. Lightning bewegt sich ohnehin Richtung PTLC; Solana-Seite via Schnorr/ed25519-Adaptoren.

---

## 6. Referenz A — Solana-HTLC-Programm (Anchor)

> **Referenz-Skizze, nicht auditierter Produktionscode.** Vault-/PDA-Handling und Lamport-Buchhaltung sind vereinfacht dargestellt und vor jedem Mainnet-Einsatz zu härten und **unabhängig zu auditieren**. Für SPL-Token statt nativem SOL: Vault als Token-Account (PDA) + CPI ins Token-Programm.

```rust
// htlc_swap — Referenz-Skizze (Anchor)
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash; // SHA-256

declare_id!("HTLC1111111111111111111111111111111111111111");

#[program]
pub mod htlc_swap {
    use super::*;

    /// Sperrt Lamports in einem PDA-Vault, gebunden an hashlock + timelock.
    pub fn initialize(
        ctx: Context<Initialize>,
        hashlock: [u8; 32],
        timelock: i64,   // Unix-Zeit, ab der Refund möglich ist
        amount: u64,
    ) -> Result<()> {
        let s = &mut ctx.accounts.swap;
        s.initiator = ctx.accounts.initiator.key();
        s.recipient = ctx.accounts.recipient.key();
        s.hashlock  = hashlock;
        s.timelock  = timelock;
        s.amount    = amount;
        s.claimed   = false;

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.initiator.key(),
            &ctx.accounts.vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.initiator.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        Ok(())
    }

    /// Empfänger löst ein: sha256(preimage) == hashlock.
    /// Die Preimage wird durch diese Instruktion on-chain öffentlich,
    /// wodurch der LP anschließend die Lightning-Hold-Invoice abrechnen kann.
    pub fn claim(ctx: Context<Claim>, preimage: Vec<u8>) -> Result<()> {
        let s = &mut ctx.accounts.swap;
        require!(!s.claimed, HtlcError::AlreadyClaimed);
        require!(hash(&preimage).to_bytes() == s.hashlock, HtlcError::InvalidPreimage);
        require_keys_eq!(ctx.accounts.recipient.key(), s.recipient, HtlcError::WrongRecipient);

        s.claimed = true;
        let amt = s.amount;
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()?     -= amt;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amt;
        emit!(Claimed { swap: s.key(), preimage });
        Ok(())
    }

    /// Nach Ablauf der Timelock: Rückzahlung an den Initiator.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let s = &mut ctx.accounts.swap;
        require!(!s.claimed, HtlcError::AlreadyClaimed);
        require!(Clock::get()?.unix_timestamp >= s.timelock, HtlcError::TimelockNotExpired);
        require_keys_eq!(ctx.accounts.initiator.key(), s.initiator, HtlcError::WrongInitiator);

        s.claimed = true;
        let amt = s.amount;
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()?     -= amt;
        **ctx.accounts.initiator.to_account_info().try_borrow_mut_lamports()? += amt;
        Ok(())
    }
}

#[account]
pub struct Swap {
    pub initiator: Pubkey,
    pub recipient: Pubkey,
    pub hashlock:  [u8; 32],
    pub timelock:  i64,
    pub amount:    u64,
    pub claimed:   bool,
}

#[error_code]
pub enum HtlcError {
    #[msg("Swap wurde bereits eingelöst oder zurückerstattet")] AlreadyClaimed,
    #[msg("Preimage passt nicht zum Hashlock")]                  InvalidPreimage,
    #[msg("Falscher Empfänger")]                                 WrongRecipient,
    #[msg("Falscher Initiator")]                                 WrongInitiator,
    #[msg("Timelock noch nicht abgelaufen")]                     TimelockNotExpired,
}
// Initialize/Claim/Refund-Context-Structs (Accounts, PDA-Seeds, Vault) hier ausgelassen.
```

**Immutabilität:** Nach dem Deploy Upgrade-Authority auf `None` setzen
(`solana program set-upgrade-authority <PROGRAM_ID> --final`). Danach ist das Programm nicht mehr änderbar — deshalb: minimaler Umfang, formale Verifikation wo möglich, mehrere Audits, langes Testnet + Bug-Bounty **vor** dem finalen Deploy.

---

## 7. Referenz B — LP-Orderbook über Nostr

Kein zentrales Orderbook, kein Matching-Server — nur **signierte Events auf Relays**. LPs sind keine privilegierten Betreiber; jeder kann LP werden.

**7.1 LP-Angebot** (addressierbares Event, ersetzbar; App-spezifische Kind-Nr., hier `38001` als Beispiel):
```json
{
  "kind": 38001,
  "pubkey": "<LP-pubkey hex>",
  "tags": [
    ["d", "ln-sol-1"],
    ["pair", "LN-BTC/SOL"],
    ["direction", "sell-sol"],
    ["min_sats", "10000"],
    ["max_sats", "5000000"],
    ["fee_ppm", "3000"],
    ["t_sol_secs", "600"],
    ["t_ln_min_delta", "..."],
    ["expiry", "1730000000"]
  ],
  "content": "optionaler Hinweis",
  "sig": "<sig>"
}
```

**7.2 Ablauf**
1. **Discovery:** Client fragt Relays nach `kind:38001` für das gewünschte Paar/Richtung.
2. **Handshake:** Nutzer schickt dem LP per verschlüsselter DM (NIP-17, gift-wrapped) die Parameter + `H` (nur den Hash, nie `R`).
3. **Ausführung:** Beide folgen dem HTLC-Flow aus 5.3 (LP sperrt SOL, stellt Hold-Invoice; Nutzer zahlt, löst SOL ein; LP rechnet ab).
4. **Attestierung:** Nach Abschluss veröffentlichen beide ein signiertes „Swap-Complete"-Event (Beispiel-Kind `38002`), das die Gegenpartei-Pubkey + Swap-ID referenziert → baut Web-of-Trust-Reputation auf.

**7.3 Reputation/Anti-Griefing:** Clients gewichten LPs nach abgeschlossenen, attestierten Swaps (WoT); LPs ohne Historie erhalten strengere Timelocks/Limits.

---

## 8. Fee-, Reward- & Season-Mechanik

- **Protokoll-Fee pro Aktion** (Nachricht, KI-Job, Swap), klein, an der Quelle abgeführt.
- **Non-custodial Split** direkt bei der Zahlung (Lightning-Splits bzw. Solana-Programm); **nie** zentraler Topf, **kein** Mixing.
- **Reward-Pools pro Chain** aus einem Fee-Anteil, ausgeschüttet **pro Leistung** (Nachricht/KI-Job/bereitgestellte Liquidität — sauberste Form) und/oder **saisonal + Leaderboard** (Ranking aus signierten Leistungs-Events).
- **Verteilung immer non-custodial** (Programm-/Contract-gesteuert).
- **Sybil-/Gaming-Schutz:** PoW (NIP-13), WoT-Gewichtung, Stake-Voraussetzung, Qualitätsvalidierung von KI-Ergebnissen.
- **Rechtlicher Hinweis:** *pay-for-work* bevorzugen; Preistopf-Season nähert sich Glücksspiel, handelbarer Reward-Token wirft Wertpapier-/MiCA-Fragen auf.

---

## 9. Zensur- & Beeinflussungsresistenz (voller Stack)

| Schicht | Chokepoint | Resistente Wahl |
|---|---|---|
| Client-Verteilung | App-Stores | F-Droid, signierte APK, PWA über IPFS, reproducible builds |
| Transport | ISP/DPI/Shutdown | Tor (`arti`) + I2P, obfs4/Snowflake, Mesh-Fallback (Briar-Modell) |
| Naming | DNS-Beschlagnahme | Public-Key-Adressierung (npub), ENS, `.onion`, IPNS |
| Daten | zentrale Server | Nostr-Relays (auch `.onion`), IPFS/Arweave, alles signiert |
| Compute/KI | Cloud-Kündigung | Akash/io.net/Nosana/Bittensor + lokale Inferenz |
| Wert | frozen Stablecoins, Bridge-Hacks | BTC/Lightning-Basis, Atomic Swaps, keine zentralen Stablecoins |
| Contracts | Admin/Upgrade-Backdoor | immutable, keyless, deploy-once |
| Governance/Treasury | Verklag-/Einfrierbarkeit | keine akkumulierende Treasury, keine änderbaren Kernregeln |
| Mensch/Org | Betreiberhaftung | Open-Source-Protokoll, Protokoll ≠ Betreiber, ggf. Pseudonymität |

**Ehrliche Grenze:** Kein Protokoll macht einen *Menschen* rechtlich immun. Identifizierbare Betreiber einzelner Komponenten (gehostetes Frontend, gewerblicher Relay-/LP-Betrieb) bleiben von EU-Recht erreichbar. Erreichbar ist: *Das System überlebt jede Einzelperson und hat keinen zentralen Abschaltpunkt.*

---

## 10. Keyless- & Immutable-Checkliste

- [ ] Kein Proxy / kein Upgrade-Mechanismus
- [ ] Upgrade-Authority nach Deploy auf `None` (`--final`)
- [ ] Keine Admin-/Pause-/Fee-Setter-Funktionen
- [ ] Keine Mint-Authority in Menschenhand (falls Token: Mint nur per Beweis/Programm)
- [ ] Bytecode verifiziert & reproduzierbar
- [ ] Keine externen Abhängigkeiten mit Keys (kein austauschbarer Verifier/Oracle-Admin)
- [ ] Feste Parameter im Code eingebrannt
- [ ] Mehrere Audits + Bug-Bounty + langes Testnet vor finalem Deploy

---

## 11. Detaillierter Tech-Stack

| Bereich | Vorschlag |
|---|---|
| Schlüssel/Identität | Nostr (NIP-06-Ableitung), NIP-07-Signer, NIP-46 Remote-Signing |
| Kommunikation | Nostr; Relays `strfry`/`nostr-rs-relay`; DMs NIP-17/44; Gruppen NIP-29 |
| KI | DVMs (NIP-90); Backends Akash/io.net/Nosana/Bittensor; lokal `llama.cpp`/`ollama` |
| Lightning | `LND`/`CLN`/embedded `LDK`; Hold-Invoices (LND `holdinvoice`/CLN-Plugin); Mobile `phoenixd`/`LDK` |
| Solana | HTLC als `Anchor`-Programm (Rust), `sha256`-Syscall, SPL-Support, Upgrade-Authority `None` |
| Swap-Koordination | LP-Angebote & Matching als Nostr-Events; WoT-Reputation |
| Weitere Chains | gleiches HTLC-Muster (Polygon/TON); optional PTLC-Upgrade |
| Client | React Native/Flutter (Mobile), Tauri (Desktop); Keys lokal; LDK eingebettet |
| Verteilung | F-Droid, direkte APK, PWA über IPFS, reproducible builds (Nix) |
| Netzwerk | Tor (`arti`), I2P, Snowflake; Mesh-Fallback |
| Speicher (Blobs) | IPFS (temporär), Arweave (permanent); Events auf Nostr |

---

## 12. Roadmap

**Phase 0 — Fundament (betreiberlos ab Start).** Protokollspezifikation offen; Nostr-Identität + verschlüsselte Kommunikation; Client über Tor; reproducible builds via F-Droid/IPFS. → sofort hohe Zensurresistenz, null Settlement-Risiko.

**Phase 1 — Wert & KI auf einer Schiene.** Lightning-Micropayments; DVMs; non-custodial Fee-Splits; erste Season + Leaderboard. → ökonomischer Loop mit echter Nutzung beweisen.

**Phase 2 — Cross-Chain via Atomic Swap (Kern).** Immutable Solana-HTLC (Referenz A); Hold-Invoice-Integration; LP-Orderbook über Nostr (Referenz B); Lightning ↔ Solana live.

**Phase 3 — Breite & Privacy.** Weitere Chains (Polygon/TON) über dasselbe Muster; PTLC-Upgrade; LP-Liquidität skalieren.

**Phase 4 — Verhärtung.** Governance/Treasury final minimieren (Immutabilität, Renounce); Relay-/LP-Netz verbreitern; Sicherheits-Reviews; ggf. Foundation/DAO für Restkoordination.

*Grundsatz:* erst an **einem** Ort kritische Masse, dann streuen. Frühe Projekte sterben an fehlender Konzentration, nicht an zu wenig Chains.

---

## 13. Repo- & Bau-Struktur (Vorschlag)

```
/protocol         Spezifikation (NIPs, Event-Kinds, Swap-Ablauf) — Markdown
/contracts
  /solana-htlc    Anchor-Programm (Referenz A) + Tests + Audit-Notes
/clients
  /mobile         React Native/Flutter, LDK eingebettet, Nostr, Swap-UI
  /desktop        Tauri
/services
  /lp-node        LP-Software: Hold-Invoices, Solana-HTLC-Calls, Nostr-Angebote
  /relay          optionale eigene strfry-Instanz (.onion)
/infra
  /reproducible   Nix-Builds, F-Droid-Metadaten, IPFS-Publish-Skripte
/docs             dieses Whitepaper + Betriebsanleitungen
```

**Empfohlener erster Meilenstein (MVP):** Phase 0 + Phase 1 auf Lightning — Nostr-Client mit Identität, Kommunikation, einer DVM-Integration und non-custodial Fee-Split. Der Atomic-Swap-Teil (Phase 2) folgt, sobald der Loop steht; er ist unabhängig testbar (Devnet-Solana + Lightning-Regtest).

---

## 14. Risiko- & Rechtsregister

- **AMLR (ab Juli 2027):** KYC ab 1.000 € für CASPs; Einschränkungen anonymitätswahrender Instrumente auf regulierten Plattformen. Bindet Betreiber/„obliged entities", nicht betreiberlose Protokolle — aber jede gewerbliche Komponente (Frontend, Relay-/LP-Geschäft ab Größenordnung) kann erfasst sein.
- **MiCA:** relevant bei eigenem Token oder betriebenem Krypto-Dienst. Basisdesign vermeidet beides.
- **LP-Frage:** Gelegentlicher Einzel-Swap ≠ gewerblicher LP im großen Stil; Letzterer kann selbst reguliert sein — Sache der LPs, nicht des Protokolls.
- **Immutabilität:** Bugs sind endgültig → Audits/formale Verifikation/Testnet/Bug-Bounty vor Deploy.
- **Reward-Design:** pay-for-work bevorzugen; Preistopf-/Token-Modelle nur mit Rechtsprüfung.
- **Missbrauch:** ein unzensierbares System kann auch für Schädliches genutzt werden (s. 15).

*Kein Rechtsrat. Einordnung stark jurisdiktions- und ausgestaltungsabhängig; spezialisierte Krypto-/AML-Beratung einholen.*

---

## 15. Offene Probleme

1. **LP-Liquidität im Kaltstart** — härtestes praktisches Problem; Anreizdesign entscheidend.
2. **Timelock-Umrechnung** Lightning↔Solana unter Realzeit-Sicherheitspuffer.
3. **PTLC auf Solana** — Reifegrad der Adaptor-Signaturen.
4. **Free-Option-Minimierung** ohne UX-Bruch.
5. **Betreiberstruktur** der Restkoordination (reines Protokoll vs. Foundation/DAO) — bestimmt die Rechtslage.
6. **Missbrauchs-/Moderationsfrage** in einem unzensierbaren System — technisch bewusst offen, gesellschaftlich real; ehrlich zu adressieren statt zu ignorieren.

---

*Ende Version 1.0. Technisches Konzept- und Baupapier; benennt seine Grenzen ausdrücklich. Keine Rechts- oder Anlageberatung.*
