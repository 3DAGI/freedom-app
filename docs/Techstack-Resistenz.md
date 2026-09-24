# Tech-Stack: Maximale Zensur-, Rechts- & Kaputte-Beeinflussungs-Resistenz

**Ergänzung/Revision zu „dApp-Konzept.md"** · Entwurf 0.1 · keine Rechtsberatung

Dieses Dokument macht zwei Dinge:
- **Teil A:** ersetzt die custodiale WUFFI-Bridge durch ein **keyless, einmal deploybares** Settlement-Modell.
- **Teil B:** definiert den vollständigen Tech-Stack für maximale Resistenz — Schicht für Schicht, jeweils mit *Bedrohung → resistente Wahl → ehrlicher Preis*.

---

## Grundprinzip

Resistenz = **jeden einzelnen Punkt entfernen, auf den jemand Druck ausüben kann.** Das sind mehr, als die meisten denken: Server, Domains, App-Stores, Entwickler, Schlüssel, Treasury, Governance, Stablecoin-Emittenten. Ein System ist nur so zensurresistent wie sein schwächstes kontrollierbares Glied.

Zweite Wahrheit, die man akzeptieren muss: **Man kann kein Protokoll bauen, das einen Menschen rechtlich immun macht.** Man kann nur ein System bauen, das *ohne jeden konkreten Menschen weiterläuft* und keinen kontrollierbaren Chokepoint hat. Das ist das realistische Ziel — nicht persönliche Unangreifbarkeit, sondern Überleben des Protokolls unabhängig von jeder Einzelperson.

---

# TEIL A — Keyless, einmal deploybares Settlement

## A.1 Die ehrliche Ausgangslage

| Chain-Paar | Wie nah an „keyless"? |
|---|---|
| EVM ↔ EVM/Solana/TON | Sehr nah: ZK-Light-Client-Bridge, unveränderliche Contracts, Mint nur per Beweis. |
| Bitcoin/Lightning ↔ Rest | **Nicht** vollständig keyless möglich. Beste Option: BitVM2/BitVM3 („1-of-N ehrlich", Setup-Keys gelöscht) — oder ganz ohne Bridge via Atomic Swaps. |

## A.2 Zwei Wege — und die Empfehlung

### Weg 1 (empfohlen, wirklich keyless): Atomic Swaps statt Bridge
Kein gebrückter Token, keine gemünzte Repräsentation, **keine Bridge-Contracts, keine Keys.** Wert wird direkt zwischen nativen Assets getauscht über **HTLCs / Submarine Swaps**:

- Zwei Parteien sperren Gelder auf ihren jeweiligen Chains hinter demselben Hash-Lock.
- Wer das Geheimnis offenlegt, um die eine Seite einzulösen, gibt damit zwangsläufig die andere Seite frei.
- Klappt der Swap nicht, laufen beide Sperren per Timelock zurück. **Atomar: entweder ganz oder gar nicht.**
- Lightning ↔ On-Chain-BTC ↔ EVM/Solana funktioniert so bereits produktiv (Submarine Swaps).

**Vorteil:** null Bridge-Angriffsfläche, kein Betreiber, kein Mint-Key, kein einheitlicher Token, der gehackt werden kann. **Preis:** kein einzelner „kanonischer" Token über alle Chains; Liquidität muss auf beiden Seiten existieren; UX ist komplexer. Für ein zensurresistentes System ist das der sauberste Weg.

### Weg 2 (wenn du EINEN kanonischen Token willst): ZK-Light-Client Burn-Mint, immutable
Für Solana/Polygon/TON (nicht Bitcoin):

```
Chain A                     On-chain Beweisprüfung        Chain B
────────                    ──────────────────────        ────────
1. User burnt X Token  ──►  2. ZK-Proof des Burn-      ──► 3. Contract minted X,
   im Burn-Contract            Events wird auf B            NUR wenn Proof gültig.
   (immutable)                 verifiziert                  Kein Admin, kein Key.
```

- **Autorisierung durch Beweis, nicht durch Signer.** Der Mint-Contract akzeptiert ausschließlich einen gültigen ZK-Light-Client-Beweis, dass auf Chain A wirklich gebrannt wurde. Es gibt keine Mint-Authority, die ein Mensch hält.
- **Für Bitcoin gilt das nicht** (s. o.): Dort brauchst du BitVM-artige Konstruktionen. Reale, heutige Umsetzungen dieser Idee sind u. a. Citreas *Clementine*, sowie BOB und Bitlayer — alle auf BitVM2/BitVM3. Ihr Sicherheitsmodell ist „1-of-N ehrlich" mit im Setup gelöschten Keys, Watchtowers und Challengern, **nicht** vollständige Keyless-Trustlosigkeit. Ehrlich einordnen: das ist das derzeitige Maximum an BTC-Bridge-Vertrauensminimierung, kein Nullvertrauen.

## A.3 „Deploy once, no keys" — die Checkliste

Ein Contract ist erst dann wirklich einmal-deploybar & keyless, wenn **alle** Punkte erfüllt sind:

- [ ] **Kein Proxy / kein Upgrade-Mechanismus** (keine `delegatecall`-Upgradebarkeit).
- [ ] **Ownership renounced** — `owner` auf die Null-Adresse gesetzt, nachweislich.
- [ ] **Keine Admin-Funktionen** (kein `pause`, kein `setFee`, kein `withdraw` für einen Privilegierten).
- [ ] **Keine Mint-Authority in Menschenhand** — Mint nur durch On-chain-Beweisprüfung.
- [ ] **Bytecode verifiziert & reproduzierbar** (jeder kann Source→Bytecode nachbauen).
- [ ] **Keine externen Abhängigkeiten mit Keys** (keine Oracle mit Admin, kein austauschbarer Verifier).
- [ ] **Feste Parameter** (Fees, Splits, Season-Logik) im Code eingebrannt, nicht nachträglich änderbar.

**Konsequenz, die du akzeptieren musst:** Immutable heißt *unpatchbar*. Ein Bug ist für immer drin. Deshalb: minimaler Contract-Umfang, mehrfache unabhängige Audits, formale Verifikation wo möglich, langes Testnet + Bug-Bounty **vor** dem finalen Deploy. Nach dem Deploy gibt es kein Zurück — das ist der Punkt, aber auch das Risiko.

---

# TEIL B — Der Resistenz-Stack, Schicht für Schicht

## B.1 Client-Verteilung *(der meistübersehene Chokepoint)*
**Bedrohung:** Apple/Google App Store können die App jederzeit entfernen (Damus wurde in China aus dem App Store geworfen). Das ist oft der *erste* Angriffspunkt.
**Resistente Wahl:**
- Verteilung über **F-Droid**, direkte signierte APKs, **Obtainium** (Auto-Update direkt aus dem Source-Repo).
- **PWA / Web-Client**, ausgeliefert über **IPFS/IPNS** (content-adressiert, nicht domainabhängig).
- **Reproducible Builds**: jeder kann verifizieren, dass die Binary exakt dem offenen Quellcode entspricht — kein untergeschobener Backdoor.
**Preis:** Ohne App-Store verlierst du enorm an Reichweite/Bequemlichkeit. Größter Adoptions-Tradeoff des ganzen Stacks.

## B.2 Netzwerk / Transport
**Bedrohung:** ISP-/Staats-Blocking, DPI (Deep Packet Inspection), IP-Sperren, komplette Shutdowns.
**Resistente Wahl:**
- Relay-Verbindungen über **Tor** (.onion) und **I2P**.
- **Pluggable Transports** gegen DPI: obfs4, **Snowflake**, meek — Traffic sieht aus wie normales HTTPS/WebRTC.
- **Mesh / offline-first** für Total-Shutdowns: Bluetooth-Mesh, Wi-Fi-Direct, LoRa, lokale Sync à la **Briar** — Nachrichten hüpfen ohne Internet von Gerät zu Gerät.
**Preis:** Tor/I2P sind langsam; Mesh hat geringe Reichweite/Bandbreite. Resistenz kostet Latenz.

## B.3 Naming / Discovery
**Bedrohung:** DNS-Domains werden beschlagnahmt/gesperrt — klassischster Takedown überhaupt.
**Resistente Wahl:**
- **Kein Verlass auf DNS.** Nutzer- und Dienst-Adressierung direkt über **Public Keys** (Nostr `npub` ist schon genau das).
- **ENS** / dezentrale Namen, **.onion**-Adressen, IPNS. Discovery von Relays/Diensten über signierte, replizierte Listen statt zentraler Verzeichnisse.
**Preis:** Schlüssel-Adressen sind menschenunfreundlich; Namensauflösung wird komplexer.

## B.4 Daten / Inhalte
**Bedrohung:** Zentrale Server werden abgeschaltet; einzelne Relays zensieren.
**Resistente Wahl:**
- **Nostr-Relays**: viele, permissionless, selbst-hostbar, auch als **.onion-Relays**. Outbox-Modell → blockt einer, publizierst du auf andere.
- **IPFS/Arweave** für größere/dauerhafte Inhalte (Arweave = permanente Speicherung).
- **Alles clientseitig signiert** → kein Relay kann Inhalte fälschen, nur (temporär) vorenthalten.
**Preis:** Redundanz kostet Speicher/Bandbreite; „permanent" heißt auch: unlöschbar (auch eigene Fehler).

## B.5 Compute / KI
**Bedrohung:** Ein Cloud-Anbieter (AWS/Azure) kündigt dir → KI-Schicht tot.
**Resistente Wahl:**
- **Dezentrale GPU-Netze** (Akash, io.net, Nosana, Bittensor) als Backend für DVMs — kein einzelner Provider kann abschalten.
- **On-Device-Inferenz** (lokale kleine Modelle) als ultimativer Fallback, der ganz ohne Netzwerk läuft.
**Preis:** Dezentrale Compute ist teurer/langsamer/heterogener; lokale Modelle sind schwächer.

## B.6 Wert / Settlement
**Bedrohung:** Zentral emittierte Stablecoins (USDT/USDC) können **einzelne Adressen einfrieren** — ein direkter Zensur-Hebel mitten in deinem System.
**Resistente Wahl:**
- **Bitcoin/Lightning** als Kern-Wertschiene (dezentralste, am schwersten stoppbare Basis).
- **Non-custodial immer**; Cross-Chain via **Atomic Swaps** (Teil A).
- **Zentrale Stablecoins meiden** — sie sind ein eingebauter Chokepoint. Wenn Preisstabilität nötig ist, eher dezentral besicherte Alternativen, und selbst die mit Vorsicht.
**Preis:** BTC ist volatil; ohne Stablecoin schwankt der Reward-Wert stark.

## B.7 Contracts / Logik
**Bedrohung:** Upgradebare Contracts = Hintertür, über die (freiwillig oder unter Zwang) die Regeln geändert werden.
**Resistente Wahl:** **Immutable, keyless, deploy-once** (Checkliste A.3). Keine Admin, keine Pause, keine nachträgliche Änderung.
**Preis:** Unpatchbar (s. A.3).

## B.8 Governance / Treasury *(größter Politik-Beeinflussungs-Hebel)*
**Bedrohung:** Eine Treasury oder Foundation ist verklagbar, sanktionierbar, einfrierbar. Ein Governance-Token mit Whales ist käuflich/lobbyierbar. Genau hier greift „politische Beeinflussung".
**Resistente Wahl:**
- **Keine akkumulierende Treasury.** Fees fließen non-custodial *durch* das Protokoll, es sammelt sich kein einfrierbarer Topf an.
- **Keine änderbare Governance** über Kernregeln — Immutabilität *ist* Beeinflussungsresistenz: was nicht geändert werden kann, kann nicht unter Druck geändert werden.
- Falls Koordination nötig: über mehrere unabhängige, jurisdiktionsübergreifend verteilte Parteien, ohne dass eine allein etwas erzwingen kann.
**Preis:** Du kannst das Protokoll später nicht mehr „lenken" oder Notfälle zentral beheben. Genau das ist der Punkt.

## B.9 Menschen / Organisation *(die ehrlich schwierigste Schicht)*
**Bedrohung:** Entwickler sind das letzte, weichste Ziel. Jedes identifizierbare Frontend, jeder Relay-*Betrieb*, jede Bridge mit Restvertrauen, jeder Token-Emittent ist von EU-Recht (MiCA, AMLR, DSA) erreichbar.
**Resistente Wahl:**
- **Reines Open-Source-Protokoll** unter permissiver Lizenz → überlebt jede Einzelperson, ist von jedem selbst-hostbar (das Nostr-/Bitcoin-Modell).
- **Trennung** von „Protokoll" (unkontrolliert, publiziert) und etwaigen „Betreiber-Komponenten" (Frontend/Relay/Bridge — die bleiben angreifbar; halte sie minimal oder überlasse sie Dritten).
- **Pseudonymität** der Kernentwickler (fiatjaf/Satoshi-Modell) verlagert Druck vom Menschen aufs Protokoll. Ehrlich: operativ sehr schwer durchzuhalten, keine Rechtsberatung, und schützt das *Protokoll*, nicht garantiert die *Person*.
**Preis:** Anonyme, betreiberlose Projekte sind schwerer zu monetarisieren, zu finanzieren und zu koordinieren.

## B.10 Finanzierung
**Bedrohung:** Ein zentrales Finanzierungskonto/-entity kann eingefroren werden.
**Resistente Wahl:** **Value-for-Value / Spenden / Grants**, direkt und verteilt, statt zentraler Kriegskasse. Entwicklung durch mehrere unabhängige Beitragende.
**Preis:** Unzuverlässiger Cashflow, schwerer planbar.

---

## B.11 Stack-Übersicht (kompakt)

| Schicht | Resistente Wahl |
|---|---|
| Client-Verteilung | F-Droid, APK, PWA über IPFS, reproducible builds |
| Transport | Tor + I2P, obfs4/Snowflake, Mesh (Briar-Modell) |
| Naming | Public Keys (npub), ENS, .onion, IPNS — kein DNS-Zwang |
| Daten | Nostr (.onion-Relays), IPFS/Arweave, alles signiert |
| Compute/KI | Akash/io.net/Nosana/Bittensor + On-Device-Fallback |
| Wert | BTC/Lightning, non-custodial, Atomic Swaps, keine zentralen Stablecoins |
| Contracts | Immutable, keyless, deploy-once |
| Governance/Treasury | keine akkumulierende Treasury, keine änderbaren Kernregeln |
| Mensch/Org | Open-Source-Protokoll, Pseudonymität, Protokoll ≠ Betreiber |
| Finanzierung | V4V/Spenden/Grants, verteilt |

---

## Was sich NICHT resistent machen lässt (ehrlich)

1. **Kein Protokoll macht einen Menschen rechtlich immun.** Identifizierbare Betreiber jeder Komponente bleiben von EU-Recht erreichbar. Resistenz heißt: das *System* überlebt jede Einzelperson — nicht, dass die Person unangreifbar ist.
2. **Bitcoin-Bridging ist nicht vollständig keyless** (Teil A.1). Das Beste ist „1-of-N ehrlich".
3. **Maximale Resistenz ⟂ maximale Usability.** Tor ist langsam, kein App-Store kostet Reichweite, immutable ist unpatchbar, ohne Stablecoin schwankt der Wert, Pseudonymität ist mühsam. Jede Resistenz-Entscheidung hat einen realen Nutzungspreis.
4. **AMLR (ab Juli 2027):** Sobald du eine kontrollierbare Betreiber-Komponente hast (Frontend, Relay-Betrieb, Bridge mit Restvertrauen, Token-Emission), giltst du potenziell als „obliged entity" mit KYC-Pflicht. Wirklich betreiberlose, dezentrale Teile fallen tendenziell heraus — die Grenze verläuft exakt entlang „gibt es hier jemanden, der es kontrolliert?".

---

## Empfohlene Reihenfolge

1. **Phase 0:** Protokoll open-source, Identität + Nostr-Kommunikation über Tor, reproducible client via F-Droid/IPFS. → sofort sehr zensurresistent, kein Settlement-Risiko.
2. **Phase 1:** Lightning-Micropayments + DVMs, non-custodial Fee-Splits. Wert bewegt sich, ohne dass du etwas verwahrst.
3. **Phase 2:** Cross-Chain via **Atomic Swaps** (keyless) statt Bridge. Native Pools pro Chain.
4. **Phase 3 (nur wenn wirklich nötig):** kanonischer Token via ZK-Light-Client Burn-Mint auf Solana/Polygon/TON, immutable & keyless. Bitcoin bleibt über Swaps angebunden, nicht über eine vertrauensvolle Bridge.
