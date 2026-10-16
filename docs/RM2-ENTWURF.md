# Einmal zahlen, viele Nachrichten – mit Lightning (RM2) – Entwurf

Stand 11.10.2026, Spur A. Freizugeben sind die Vorschläge V1–V9 und die Antworten auf die
Fragen W1–W5 am Ende. „Wie vorgeschlagen“ genügt; jede Frage lässt sich einzeln anders
entscheiden. **Freigegeben am 14.10.2026 (MENSCH): wie vorgeschlagen** (Abschnitt
„Entscheidungen vom 14.10.2026“ am Ende).

## Worum es geht

- **09.10.2026 (MENSCH): RM2 B.** Keine Sitzung mehr auf Kredit. Heute bekommt jede neue
  Sitzung 100 sats Kredit (`DEFAULT_SESSION_CONFIG`, `session-client.ts`). Die App zahlt
  erst nach den Antworten, in Fenstern von 20 sats. Schlüssel kosten nichts, also bekäme
  jeder neue Schlüssel wieder 100 sats.
- **11.10.2026 (MENSCH):** Die Vorschläge B1 (Vorauszahlung an den eigenen LND des Knotens)
  und B2 (keine Sitzungen mehr) passen nicht. „Einmal zahlen, viele Nachrichten schreiben“
  bleibt auf jeden Fall. Gelöst werden soll es „gleich wie bei der Solana-Zahlschiene“.

## Was der Solana-Zahlkanal macht (4.3, `docs/ZAHLKANAL.md`)

1. **Einzahlen:** Der Kunde zahlt einmal SOL in einen Kanal ein.
2. **Je Antwort:** Er gibt eine Gutschrift, also eine Signatur über den bisher geschuldeten
   Gesamtbetrag. Der Knoten prüft sie ohne Kette (`KanalKasse.nimmAn()`: Deckung,
   abgerechnet plus Gebot).
3. **Einlösen:** Der Provider löst die letzte Gutschrift vor Ablauf ein
   (`loeseFaelligeEin()`).
4. **Rest:** Nach Ablauf geht der Rest an den Kunden; seit Z1 darf jeder das auslösen.
5. **Kein Kredit:** Ohne deckende Gutschrift antwortet der Provider nicht.

## Warum Lightning das nicht von selbst kann

- **Lightning ist selbst ein Netz aus Kanälen.** Ein eigener Kanal zwischen Kunde und
  Provider hieße:
  - eine Öffnung auf der Bitcoin-Kette;
  - auf beiden Seiten ein eigener Lightning-Knoten.

  Für Kunden im Browser ist das zu schwer.
- **Ob eine Lightning-Zahlung ankam, weiß nur der Knoten des Empfängers.** Ein Provider mit
  fremder Lightning-Adresse kann eine Vorauszahlung deshalb nicht selbst prüfen. Daran
  scheiterte B1.

## Befunde (recherchiert am 11.10.2026)

| Weg | Wer nutzt es | Wie | Passt? |
|---|---|---|---|
| **Cashu mit Sperre auf den Empfänger (NUT-10, NUT-11, NUT-12)** | Nutzaps auf Nostr (NIP-61); NUT-11 nennt als Zweck ausdrücklich Zahlungen an Empfänger ohne Netz, „die sich nicht doppelt ausgeben lassen“ | Token mit P2PK-Sperre auf den Schlüssel des Empfängers, mit Frist (`locktime`) und Rückweg (`refund`). Mit DLEQ (NUT-12) prüft der Empfänger die Signatur der Mint ohne Mint. Ausgeben kann sie vor der Frist nur er | **ja** – nur verabschiedete Spezifikationen |
| Cashu-Zahlkanal nach Spilman (NUT-XX, cashubtc/nuts PR 296) | MONAD (Onion-Routing, bezahlt je Knoten), OpenTollGate | eine 2-von-2-Einzahlung; jeder neue Stand ist eine Signatur des Zahlers, ohne Mint geprüft; die Mint nur bei Öffnen und Schließen | **später** – der PR ist offen (70 Commits, letzte Änderung Oktober 2026), `cdk-spilman` 0.2.0 ist „Early Alpha“, den Rückweg gibt es nur in Rust; die Signatur SIG_ALL ändert sich noch (nuts PR 404); laut Autor setzen einige Mints `locktime` falsch um |
| Guthaben beim Knoten (Routstr) | Routstr: dezentrale KI über Nostr | Cashu-Token beim Knoten einzahlen; der Knoten führt ein Guthaben und zahlt den Rest als eCash zurück | **nein** – der Knoten verwahrt und zahlt aus; das schließt 5.1.2 aus |
| L402 (Lightning Labs, Aperture) | Lightning Loop | Rechnung des Servers bezahlen, das Preimage plus ein Macaroon gilt als Zugang | **nein** – der Server braucht einen eigenen Lightning-Knoten (wie B1), der Rest verfällt |
| Hold-Rechnungen in Stücken | RoboSats (Pfand bei Trades) | Der Provider hält mehrere kleine Zahlungen offen, löst die genutzten ein und gibt den Rest frei | **nein** – nur mit eigenem LND (wie B1); offene Zahlungen binden Geld auf der ganzen Route (Jamming); Wallets zeigen die Zahlung so lange als hängend |
| eigener Lightning-Kanal zum Provider | – | Öffnung auf der Kette | **nein** – zu schwer (siehe oben) |

Schon entschieden ist E4b D (09.10., freigegeben 11.10.): die App bekommt eine eingebaute
Spark-Wallet, dazu Cashu für kleine Beträge (NUT-11, NUT-12), immer mit der Mint genannt und
„verwahrt“. Der Baustein dafür ist A-17c.

## Vorschlag: Cashu-Pfand – der Zahlkanal für Lightning

### V1 – Ablauf

1. **Einmal zahlen.** Die App lädt ein Guthaben bei einer Mint (NUT-04): eine einzige
   Lightning-Zahlung aus der Spark-Wallet oder über NWC. Nur diese Zahlung bestätigt der
   Nutzer. Der Betrag ist das Budget wie heute (Vorgabe 100 sats).
2. **Ein Fenster sperren.** Für einen Provider macht die App aus einem Fenster (Vorgabe
   20 sats) kleine Token, die nur er einlösen kann:
   - Sperre P2PK (NUT-11) auf seinen Pfand-Schlüssel aus dem Angebot;
   - `locktime` ist der Ablauf (Vorgabe eine Stunde, wie `ttlSecs`);
   - `refund` ist ein frischer Schlüssel der App je Unterhaltung (wie D1b2);
   - jedes Token mit DLEQ (NUT-12).

   Das ist ein Tausch bei der Mint je Fenster, nicht je Nachricht.
3. **Je Anfrage übergeben.** Die nächsten Token liegen im versiegelten Kern der Anfrage,
   nie offen. Übergeben ist dann mindestens so viel wie abgerechnet plus Gebot dieser
   Anfrage (dieselbe Regel wie `KanalKasse.nimmAn()`). Ohne Deckung antwortet der Provider
   nicht – kein Kredit.
4. **Der Provider prüft ohne Mint:**
   - die Signatur der Mint (DLEQ gegen ihre gemerkten Schlüssel);
   - die Sperre auf seinen Schlüssel;
   - eine Frist, die noch weit genug weg ist;
   - die Mint steht in seiner Liste;
   - das Token hat er noch nie gesehen (in einer Datei, nie nur im Speicher).

   Das genügt: Vor der Frist kann nur er die Token ausgeben, der Kunde also nicht doppelt.
5. **Der Provider löst ein,** gesammelt bei der Mint, spätestens zehn Minuten vor der Frist
   (wie `claimAllowed()` bei Swaps, wie `loeseFaelligeEin()` beim Zahlkanal). Danach behält
   er das Geld als Token oder zieht es an seine eigene Lightning-Adresse ab. Er bezahlt nur
   sich selbst – 5.1.2 bleibt.
6. **Der Rest:**
   - Was die App nicht übergeben hat, hat der Kunde nie aus der Hand gegeben.
   - Gesperrte Token holt die App nach der Frist über den Rückweg zurück.
   - Das übrige Guthaben bleibt einfach im Cashu-Topf, auch für den nächsten Provider, der
     dieselbe Mint annimmt.

### V2 – Gleich wie beim Zahlkanal

| | Solana-Zahlkanal | Cashu-Pfand |
|---|---|---|
| Einzahlen | einmal SOL in den Kanal | einmal Lightning an die Mint, dann je Fenster auf den Provider gesperrt |
| Je Antwort | Gutschrift: Signatur über den Gesamtbetrag | die nächsten gesperrten Token |
| Prüfen beim Provider | ohne Kette | ohne Mint (DLEQ, Sperre, Frist, nicht doppelt) |
| Kein Kredit | Deckung = abgerechnet + Gebot | dieselbe Regel |
| Einlösen | `settle` vor Ablauf | Tausch bei der Mint vor der Frist |
| Rest | `refund` nach Ablauf, jeder darf | Rückweg nach der Frist, nur die App; ungesperrtes Guthaben bleibt frei |
| Wer hält das Geld | das Programm auf der Kette | die Mint – „verwahrt von <Mint>“ |
| Gebühren A+ | das Programm teilt auf | die App (V4) |

### V3 – Mints

- **Der Provider nennt im Angebot, welche Mints er annimmt** (`["mint", <url>]`, wie
  `CASHU_MINTS` bei Routstr und die Liste 10019 bei NIP-61), dazu seinen Pfand-Schlüssel.
- **Die App nimmt die Mint, die der Nutzer gewählt hat** (E4b V3), wenn der Provider sie
  nennt. Sonst gibt es mit diesem Provider kein Pfand; die App fragt dann mit Gebot je
  Auftrag und zahlt nach der Antwort, wie heute ohne Sitzung (Kredit höchstens eine Antwort).
- **Nur Mints, die NUT-11 und NUT-12 melden** (`info`, NUT-06). Bei einer Mint ohne NUT-11
  wären gesperrte Token für jeden ausgebbar.
- **Nur Mints, die die Frist richtig umsetzen:** Der Autor des Spilman-Entwurfs fand Mints,
  bei denen das nicht stimmt. Geprüft wird das gegen eine Mint auf dem Rechner (Tests) und
  vom Betreiber vor dem Eintrag in seine Liste.

### V4 – Gebühren nach A+

- Gesperrt wird nur der Anteil des Providers (`providerAnteilMsat()` aus `aufteilung.ts`).
- Die anderen Anteile (Entwicklung, Relays, Werber, Hosting) zahlt die App wie heute nach
  der Antwort, gesammelt in Fenstern. Sie zahlt sie aus demselben Guthaben, per Lightning an
  die Adressen der Empfänger (NUT-05). Eine eigene Rückfrage braucht es dafür nicht: Das
  Guthaben ist schon bestätigt.
- Das Prüfbudget bleibt wie bisher in der App.
- Später: Nutzaps (NIP-61) an Empfänger, die eine Liste 10019 haben.

### V5 – Datenschutz

- **Die Mint sieht:**
  - die Lightning-Einzahlung;
  - die Einlösungen des Providers;
  - nicht, wer gezahlt hat – Blind-Signaturen trennen beides.
  - Mit P2BK (NUT-28, seit 2026 verabschiedet, in cdk und Nutshell) sieht sie nicht einmal
    den Schlüssel des Providers. Die App nutzt es, wenn die Mint es kann.
- **Vor dem Einlösen wird die DLEQ entfernt** (NUT-12), sonst könnte die Mint verbinden.
- **Der Provider sieht** einen frischen Rückweg-Schlüssel je Unterhaltung. Die Leak-Regeln
  bekommen ein Szenario: Token nur im versiegelten Kern.
- **Neue Grenze im Bericht, „cashu-pfand“:** Während es dort liegt, ist das Geld „verwahrt
  von <Mint>“. Wer das Gerät ohne Sicherung verliert, verliert den Rest, wie Bargeld. Neue
  Aussagen nur mit Szenario (`privacy-facts.test.ts`).

### V6 – Grenzen und Stückelung

- **Cashu-Topf:** höchstens 10 000 sats (E4b V3).
- **Fenster und Frist:** 20 sats und eine Stunde wie heute.
- **Stückelung:**
  - Ein Fenster wird in Zweierpotenzen gesperrt.
  - Übergeben wird so, dass die Summe die Deckung erreicht und höchstens um ein Gebot
    übersteigt.
  - Unter einem Sat sammelt der Provider auf.
- **Gebühren der Mint je Token** (NUT-02, `input_fee_ppk`): Die App bevorzugt Mints ohne
  diese Gebühr und zeigt sie sonst vor dem Laden an.

### V7 – Was wegfällt, was bleibt

- **Es fällt weg:**
  - die Sitzung auf Kredit (38021 ohne Zahlung, `defaultBudgetSats` ohne Deckung);
  - der Modus „Beleg-only“ – das ist RM2 B.
- **Das Format ändert sich** (STOPP-Punkt nach `CLAUDE.md`, deshalb dieser Entwurf):
  - Pfand-Tags im Kern der Anfrage;
  - Mint-Liste, Pfand-Schlüssel und Fassung im Angebot.
- **Alte Knoten** nennen keine Mint; mit ihnen fragt die App mit Gebot je Auftrag.
- **Es bleiben:** der Zahlkanal für SOL, das Gebot je Auftrag und die Gratis-Fragen (A-14).

### V8 – Später: Spilman-Kanal

- Sobald der Spilman-Kanal als NUT verabschiedet ist und verbreitete Mints ihn können,
  ersetzt er die vielen gesperrten Token:
  - eine Einzahlung;
  - jeder Stand nur eine Signatur, genau auf die Millisat;
  - die Mint nur beim Öffnen und Schließen.
- Für App und Knoten bleibt der Ablauf gleich; es wechselt nur das Format der Übergabe
  (Fassung im Angebot).

### V9 – Aufteilung

| Schritt | Inhalt | Spur | Umfang |
|---|---|---|---|
| RM2a | Protokoll: Pfand-Tags, Prüfung `pruefePfand()` ohne Mint (DLEQ, Sperre, Frist), Angebot mit Mints und Fassung; Tests mit den Vektoren der Spezifikation | A | ~300 – **fertig** (16.10.: `protocol/src/pfand.ts`, `docs/PROTOCOL.md` §38) |
| RM2b1 | Knoten: `PfandKasse` (annehmen, Datei 0600, einlösen vor der Frist, absturzsicher); Tests gegen eine Mint auf dem Rechner (Nutshell ohne echtes Lightning), wie beim Zahlkanal gegen den Validator | A | ~300 – **fertig** (16.10.: `node/src/pfand-kasse.ts`) |
| RM2b2 | Knoten: verdrahten – Provider (Deckung, Buchung), `main.ts` (`PFAND=1`, `PFAND_MINTS`), Angebot, Selbstprüfung der Mints | A | ~200 – **fertig** (16.10.) |
| RM2b3 | Knoten: Mint-Abrufe über Tor (`TOR_SOCKS`), Erlös an die eigene Lightning-Adresse (NUT-05, `NODE_LUD16`) | A | ~200 |
| RM2c | App: Fenster sperren, übergeben, Rest zurückholen über den Cashu-Topf aus A-17c; die Sitzung auf Kredit fällt weg | A | ~350 |
| RM2d | Oberfläche: „Guthaben laden“ statt Budget-Sitzung, Mint und „verwahrt“ sichtbar | C | ~200 |

- **Reihenfolge:** nach A-17c (Cashu-Baustein).
- **Neue Abhängigkeit im Knoten:** `@cashu/cashu-ts` 4.11.0, MIT oder Apache-2.0, rund 2 MB
  entpackt, Abhängigkeiten `@noble`/`@scure`. Für die App ist sie schon mit E4b freigegeben.
- **Die Prüfung ohne Mint (RM2a)** geht mit `@noble/curves`, das schon im Protokoll ist.
- **Bis RM2c** bleibt die heutige Sitzung, wie sie ist.

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| W1 | Wie geht „einmal zahlen, viele Nachrichten“ mit Lightning? | A Cashu-Pfand jetzt (V1–V9) · B auf den Spilman-Kanal warten · C Hold-Rechnungen in Stücken (nur Provider mit eigenem LND) · D Guthaben beim Provider (L402, Routstr – der Provider verwahrt) | **A** – nur verabschiedete Spezifikationen, Ablauf wie beim Zahlkanal, kein Kredit; später B als Fassung 2 |
| W2 | Wer wählt die Mint? | A der Nutzer (E4b), der Provider nennt seine Liste, es gilt die Schnittmenge · B der Provider schreibt sie vor | **A** – das Geld des Nutzers, sein Risiko; die App nennt die Mint immer |
| W3 | Fenster und Frist | Vorgabe 20 sats und eine Stunde, wie heute | so |
| W4 | Anteile der übrigen Empfänger | A nach der Antwort aus dem Guthaben per Lightning, gesammelt · B auch gesperrt (Nutzaps) | **A** – B erst, wenn Empfänger eine Liste 10019 haben |
| W5 | E4b V3 sagt: Cashu „nie Vorgabe“. Mit W1 A wird Cashu der Weg für Lightning-Sitzungen | A so ändern: jede Ladung bestätigt der Nutzer, die Mint steht immer dabei; wer keine Mint will, fragt mit Gebot je Auftrag · B Cashu bleibt nie Vorgabe – Sitzungen nur, wenn der Nutzer Cashu selbst einschaltet | **A** – sonst bliebe „einmal zahlen“ für Lightning versteckt |

Quellen (11.10.2026):
- Cashu:
  - [NUT-11 (P2PK)](https://cashubtc.github.io/nuts/11/);
  - [NUT-12 (DLEQ)](https://cashubtc.github.io/nuts/12/);
  - [NIP-61 (Nutzaps)](https://github.com/nostr-protocol/nips/blob/master/61.md);
  - [Spilman-Kanal, NUT-XX (PR 296)](https://github.com/cashubtc/nuts/pull/296);
  - [cashu_spilman_channels](https://github.com/SatsAndSports/cashu_spilman_channels);
  - [SIG_ALL-Änderung (Issue 33)](https://github.com/SatsAndSports/cashu_spilman_channels/issues/33);
  - [MONAD](https://github.com/SatsAndSports/MONAD);
  - [NUT-28 (P2BK)](https://blog.cashu.space/q2-2026-highlights/).
- Andere Wege:
  - [Routstr](https://blog.cashu.space/routstr/);
  - [L402](https://docs.lightning.engineering/the-lightning-network/l402);
  - [Hold-Rechnungen](https://www.spark.money/glossary/hold-invoice).

## Entscheidungen vom 14.10.2026 (MENSCH)

„Ja zu allen deinen Vorschlägen für die offenen Entscheidungen.“

| Nr. | Entscheidung |
|---|---|
| V1–V9 | wie vorgeschlagen |
| W1 | **A** – Cashu-Pfand jetzt, Spilman-Kanal später als Fassung 2 |
| W2 | **A** – der Nutzer wählt die Mint, der Provider nennt seine Liste, es gilt die Schnittmenge |
| W3 | **So** – 20 sats und eine Stunde, wie heute |
| W4 | **A** – Anteile der übrigen Empfänger nach der Antwort aus dem Guthaben per Lightning, gesammelt |
| W5 | **A** – E4b V3 geändert: Cashu ist der Weg für Lightning-Sitzungen; jede Ladung bestätigt der Nutzer, die Mint steht immer dabei; wer keine Mint will, fragt mit Gebot je Auftrag |

Reihenfolge: A-17c (Cashu-Baustein, freigegeben mit derselben Antwort), dann RM2a–RM2d.
`@cashu/cashu-ts` kommt mit A-17c, im Knoten mit RM2b – je mit Größe und Lizenz im Pull Request.
