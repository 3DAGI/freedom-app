# Änderungen dieser Arbeitsrunden

Chronologisch, mit Begründung. Was **nicht** erledigt ist, steht am Ende —
vollständig, damit niemand ein Loch für geschlossen hält.

## Sicherheit

| Was | Vorher | Jetzt |
|---|---|---|
| Session-Prüfung | „Toleranter Modus" behandelte jede ungültige Session als Gratis-Job → eine erfundene ID reichte für unbegrenzte kostenlose Inferenz | Rückfall nur auf das **gemessene** Free-Tier-Kontingent |
| DM-Verschlüsselung | secp256k1-Keys durch X25519 → beide Seiten leiteten verschiedene Secrets ab, **jede DM unlesbar** | echtes NIP-44 v2, geprüft gegen den offiziellen Referenzvektor |
| XSS im Wallet-Tab | `onclick="startSwap('${offerId}')"` mit Daten aus fremden Relays → Nostr-Secret-Key abziehbar | escapte `data`-Attribute + `addEventListener` |
| SSRF im Browser-Tool | jede URL wurde abgerufen, inkl. `169.254.169.254`, LND-REST, Router | `url-guard.ts`: DNS-Auflösung, private Bereiche gesperrt, Prüfung bei jeder Weiterleitung |
| Datei-Sandbox | Präfix-Kollision: `/tmp/ws-evil` passierte die Basis `/tmp/ws` | Trennzeichen in der Prüfung, absolute Pfade abgelehnt |
| SOL-Deposit | nur Event-Konsistenz geprüft → beliebiger Betrag behauptbar | `verifyDepositOnChain`; fehlende Prüfmöglichkeit = abgelehnt, nicht durchgewunken |
| Gate-Server | kein Rate-Limit, lieferte `.bak` und `.py` mit aus | IP-Bremse, Sperrliste, `Secure`-Flag, `unquote_plus` |

## Geld

- **Fee wird ausgezahlt** (`settlement.ts`) statt nur geloggt. Kleinbeträge
  werden gesammelt — 0,5 % Referral auf 1.200 msat sind 6 msat, und eine
  Lightning-Zahlung darunter ist technisch unmöglich.
- **Fee-Beweis** (kind 38051) mit `verifyFeeProof()`. Lightning ohne Preimage
  gilt ehrlich als *angekündigt*, nicht als *belegt*.
- **Fee-Höhe** auf 5 % festgelegt, aus einer Quelle abgeleitet. Vorher drei
  widersprüchliche Werte; 5.000 ppm waren als „5 %" bezeichnet und sind 0,5 %.
- **Treasury-Sweep** leitete sein Keypair aus dem *öffentlichen* Schlüssel ab
  und konnte nie Geld bewegen. Behoben, mit Tests.
- **HTLC-Lock im Client**: beide Locks in einer atomaren Transaktion, Wallet
  signiert, App hält nie einen Solana-Key.
- **Swap-Client** prüft die Gegenleistung, bevor der Zahl-Link freigegeben wird.
- **Bootstrap-Phase**: `PROVIDER_SINCE` wurde bei jedem Start neu gesetzt — ein
  täglich neu startender Provider blieb dauerhaft im Gratismodus.

## Robustheit

- `publish()` schlägt nicht mehr still fehl (`PublishError`).
- Dauer-Abos statt Abfrage-Schleife; `autoReconnect` implementiert statt nur
  deklariert, inklusive Wiederanmeldung aller Abos.
- `seen`-Set begrenzt, `MemoryRelay.limit` beachtet.

## Neu

Redundanz-Konsens, Zwei-Geräte-Cluster, NWC (Lightning auf jedem Gerät),
Solana-Connect für Mobile, Live-Dashboard, Ein-Zeiler-Installer, CI.

## Anreize (letzte Runde)

- **Knappheitsbonus** (`scarcity.ts`): Vergütung nach unterversorgter Region und
  gemessener Auslastung, nicht nach Uhrzeit. Topf wird nie überschritten,
  Bonus nur gegen nachgewiesene Arbeit, `unknown` bekommt nichts.
- **Referral neu**: 20 % der ersten 1.000 sats statt ewiger Bruchteile,
  Mindestauszahlung 10 sats, Obergrenze offen ausgewiesen.
- **Zweites Fee-Modell entfernt**: `splitProviderPayment()` rechnete mit
  hartkodierten 1 %, während `protocol-fee.ts` 5 % vorgab.
- **Kein Staking** — bei fremdem Geld wäre es Verwahrung.
- **Automatischer Rückfluss** (`refund-watcher.ts`): fällige Sperren werden
  ohne Zutun des Nutzers zurückgeholt.
- **Region im Leistungsnachweis** + Installer-Abfrage + Dashboard-Ansicht
  „wo Kapazität fehlt", mit derselben Kurve wie die Auszahlung.

## Anreizkette vollständig

- **Referral dauerhaft**, zwei Ebenen, fünf Stufen — bezahlt aus der
  Protokollfee, kostet den Provider nichts. Kein Cent fürs Anwerben.
- **Referral-Graph** (kind 38052): der Geworbene signiert die Beziehung,
  früheste Angabe gewinnt, Kreise werden aufgelöst.
- **Reward-Pool-Verteiler** (kind 38053): rechnet, zahlt, veröffentlicht einen
  nachprüfbaren Bericht. Opt-in, idempotent, Topf nie überschritten.

## Tests

| Paket | vorher | jetzt |
|---|---|---|
| protocol | 74 | 252 |
| node | 35 (5 rot) | 81 |
| app | 1 | 98 |

## Offen

1. **Devnet-Test des geänderten HTLC-Programms.** `[u8; 32]` statt `Vec<u8>`
   und `close = initiator` sind nur im Quelltext. Borsh kodiert ein festes
   Array ohne Längenpräfix — altes Programm plus neuer Client passt nicht
   zusammen. Beides muss in einem Schritt ausgerollt werden.
2. **Anchor-Upgrade-Authority** noch nicht auf `none` gesetzt.
3. **`shell/app.ts`** bleibt DOM-verwoben. Der Weg dorthin ist weiter
   extrahieren, nicht ein Browser-Testframework aufsetzen.
4. **Antwort-Polling in der App** (3 s) unverändert — funktioniert, hat aber
   komplexe Zwischenzustände, deren Umbau mehr riskiert als gewinnt.
5. **LP-Daemon, Relay-, Storage-Rolle, Arweave-Mirror** weiterhin ohne Tests.
