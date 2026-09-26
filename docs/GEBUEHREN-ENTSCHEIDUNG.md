# Gebührenmodell – Entscheidungsvorlage (Schritt 4.0)

Stand 25.09.2026. Die Entscheidung trifft der MENSCH; sie muss vor dem
Solana-Zahlkanal (4.3) fallen, weil das Programm die Empfänger bei der Eröffnung
festschreibt. **Kein Rechtsrat** – die Einordnung nach AMLR/MiCA ist eine
technische Beschreibung der Angriffsfläche, keine juristische Bewertung (siehe 9.4).

## Was der Code heute tut

| Baustein | Stand | Wo |
|---|---|---|
| **Protokollfee** | 2,5 % jeder Job-Zahlung: 2,0 % Reward-Pool, 0,5 % Werber; als „Protokoll-Invariante“ im Code festgeschrieben, von CI geprüft | `protocol/src/protocol-fee.ts`, CI-Job „Protokoll-Invarianten“ |
| **Abführen** | Der Provider zahlt aus seinem Erlös an zwei Lightning-Adressen, die **sein Knoten** per Umgebung kennt (`FEE_POOL_LUD16`, `FEE_REFERRAL_LUD16`, Standard leer); dazu ein signierter Fee-Beweis (Kind 38051) | `node/src/settlement.ts`, `main.ts`, `protocol/src/fee-proof.ts` |
| **Reward-Pool** | Ein Knoten mit `POOL_DISTRIBUTOR=1` **hält die Pool-Wallet** und verteilt je Epoche nach Knappheitsbonus; die Rechnung stützt sich auf **Selbstauskünfte** der Provider (Kind 38010); Relays sollen 15 % des Pools bekommen | `node/src/pool-distributor.ts`, `protocol/src/rewards.ts`, `disputes-relays.ts` |
| **Werben** | 0,5 % aus der Protokollfee, zwei Ebenen, dauerhaft | `protocol/src/referral.ts`, `referral-graph.ts`, `reward-claim.ts` |
| **App-Gebühr** | 2,5 % (höchstens 10 %), offen im Job deklariert, abschaltbar, von einem Fork entfernbar; der Provider prüft die Obergrenze | `protocol/src/client-fee.ts`, `app/.../agent.ts` |
| **Treasury** | Code für wöchentlich rotierende Entwickler-Adressen und einen Sweep liegt noch da, obwohl der Entwickleranteil aus der Protokollfee raus ist | `protocol/src/treasury.ts`, `treasury-sweep.ts`, `main.ts` |
| **Texte** | Startseite, FAQ, Whitepaper und App nennen „2,5 %: 2,0 % Reward-Pool, 0,5 % Werber“ | `website/index.html`, `faq.html`, `whitepaper.html`, `app/src/shell/index.html` |

Die Prüfberichte vom 23.09. nennen den Pool „zentral verwaltet und auf
Selbstauskünften beruhend“ (UEBERSICHT, offene Befunde).

## Option A (in der Karte empfohlen): Protokollgebühr 0 %

**Inhalt:**
- Das Protokoll nimmt nichts.
- Die App-Gebühr bleibt freiwillig und offen deklariert. Sie geht an einen **selbstverwahrten** Empfänger, bei SOL im Zahlkanal als eigener Anteil.
- Anreize kommen aus **gesponserten Pools** (5.1b): Wer will, zahlt in ein Programm mit offenen Regeln ein.
- Relays werden **direkt** bezahlt, von dem, der sie nutzt.
- Werben ohne Provision.

**Betroffene Dateien:**
- `protocol-fee.ts`: Wert 0; die Selbstprüfung `PROTOCOL_FEE_PPM <= 0` wirft heute, sie muss 0 erlauben.
- CI-Job „Protokoll-Invarianten“ (auf 0 umstellen, statt ihn zu löschen).
- `settlement.ts`, `fee-proof.ts` (Beweis nur noch für die App-Gebühr).
- `pool-distributor.ts`, `rewards.ts`, `referral*.ts`, `reward-claim.ts`, `treasury*.ts`: entfernen oder auf gesponserte Pools umbauen (5.1).
- `main.ts` (Umgebungsvariablen `FEE_POOL_LUD16`, `FEE_REFERRAL_LUD16`, `POOL_DISTRIBUTOR`, Sweep).
- `dvm-provider.ts` (`computeFeeSplit`).
- App: Gebührenanzeige, Tab „Verdienen“, Werben.
- Website: Startseite, FAQ, Whitepaper, Roadmap.
- Tests fallen weg, wo eine Funktion entfällt. Das wird begründet.

**Zahlkanal (4.3):** `fee_recipients` enthält höchstens die App-Gebühr, deren
Obergrenze (10 %) on-chain geprüft wird. Kein Protokoll-Empfänger ist
festgeschrieben, der Kanal bleibt einfach.

**AMLR/CASP-Angriffsfläche:**
- Es gibt keine Stelle mehr, die fremdes Geld sammelt oder verteilt: kein Pool-Wallet, keine Treasury.
- Übrig bleibt die App-Gebühr an einen erkennbaren Empfänger. Wer sie bezieht, ist als Anbieter einer Software erkennbar, verwahrt aber nichts.
- Gesponserte Pools laufen als Programm mit offenen Regeln, ohne Verwahrer.

**Einnahmen:**
- für Provider +2,5 % je Job,
- für den Pool 0 (Anreize nur, wenn jemand sponsert),
- für Werber 0,
- für den App-Anbieter unverändert die App-Gebühr.

## Option B: Pool behalten, aber offen als zentral verwaltete Belohnung

**Inhalt:**
- Der Pool bleibt und heißt ehrlich „zentral verwaltete Belohnung“.
- Er läuft **nur in SOL**, in einem Programm-Tresor mit **Mehrfachsignatur** (z. B. Squads).
- Die Regeln und Wochenberichte sind veröffentlicht.
- Lightning-Abführung an Pool und Werber entfällt oder wird auf SOL umgestellt.

**Betroffene Dateien:**
- `protocol-fee.ts` (Aufteilung bleibt).
- `settlement.ts` (SOL-Abführung an die Tresor-Adresse statt Lightning-Adressen).
- `pool-distributor.ts` (Auszahlung per Multisig-Vorschlag statt Knoten-Wallet; Berichte bleiben).
- `rewards.ts`: Selbstauskünfte durch Quittungen ersetzen, siehe 5.5.
- `main.ts`, Website und App-Texte („zentral verwaltet“).
- Neues Tresor-Programm oder Squads-Konfiguration (MENSCH: Squads, 5.9).

**Zahlkanal (4.3):**
- `fee_recipients` = Tresor-Adresse (Pool + Werber) + App-Gebühr, fest bei Eröffnung.
- Die Summe muss unter der Obergrenze bleiben.
- Jede Änderung der Tresor-Adresse braucht ein Programm-Update oder einen Parameter.

**AMLR/CASP-Angriffsfläche:**
- Es gibt **eine verwaltende Stelle**, nämlich die Unterzeichner der Mehrfachsignatur. Sie nimmt Geld Dritter entgegen und verteilt es.
- Das ist genau die Konstellation, die als „obliged entity“ in Frage kommt (Frist 10.07.2027, siehe 9.4).
- Sie muss rechtlich eingeordnet werden, bevor der Tresor echtes Geld hält.

**Einnahmen:**
- für Provider unverändert (−2,5 %),
- der Pool finanziert Knappheitsbonus und Relays,
- Werber bekommen 0,5 %,
- der App-Anbieter unverändert die App-Gebühr.

## Gegenüberstellung

| | A: 0 % | B: Pool offen, SOL, Multisig |
|---|---|---|
| Verwahrende Stelle | keine | Multisig-Unterzeichner |
| Aufwand bis 4.3 | Rückbau, Texte, Invarianten auf 0 | Tresor-Programm/Squads, Umbau Settlement und Verteiler |
| Anreiz für Provider in Randregionen | nur über gesponserte Pools | Knappheitsbonus bleibt |
| Relays bezahlt | direkt durch Nutzer (neu zu bauen) | aus dem Pool (15 %) |
| Ehrlichkeit der Texte | „Das Protokoll nimmt nichts.“ | „Ein zentral verwalteter Pool belohnt …“ |
| Offene MENSCH-Aufgaben | keine vor 4.3 | Squads einrichten, Unterzeichner, rechtliche Einordnung |

## MENSCH: bitte entscheiden

- [ ] **A – Protokollgebühr 0 %** (App-Gebühr freiwillig, gesponserte Pools, Relays direkt)
- [ ] **B – Pool offen als zentral verwaltete Belohnung** (nur SOL, Multisig, veröffentlichte Regeln und Berichte)
- [x] **A+ – feste Aufteilung direkt beim Zahlen, kein Topf** (Entscheidung 26.09.2026, siehe unten)

## Entscheidung 26.09.2026: A+

Der MENSCH wollte eine Gebühr mit voreingestellter Aufteilung, damit **alle
Teile** von FreedomStack sofort belohnt werden – Provider, Hosting, Werben,
Liquidität –, aber ohne Topf, auf den jemand Zugriff hat. Ein schlüsselloser
Topf löst die Verwahrung, nicht die Verteilung (Umverteilung bräuchte Angaben,
die die Kette nicht prüfen kann; in Sats gibt es keinen Topf ohne Verwahrer).
Darum **A+**: Die Anteile gehen **beim Zahlen direkt** an die, die den Auftrag
getragen haben. Nichts liegt herum, nichts wird verteilt. Die Quote hat der
MENSCH dem Agenten übertragen („für eine effektive und stabile Entwicklung“).

> **Korrigiert am selben Tag (MENSCH):** Die erste Fassung (95 % Provider, 3 %
> Entwicklung, 2 % Relays, „keine Werbeprovision“) ließ das Werben weg. Es gibt
> einen Werbeanteil – die Entscheidung betraf nur „nichts verwahren“. Es gilt
> die Aufteilung unten.

### Aufteilung einer KI-Zahlung

| Anteil | Empfänger | Wie |
|---:|---|---|
| **94 %** | Provider | wie bisher |
| **2,5 %** | Entwicklung | an selbstverwahrte Adressen des Projekts (Lightning über einen eigenen Knoten, z. B. `lnurl-server.ts`; SOL an eine Mehrfachsignatur), im Auftrag offen deklariert |
| **1,5 %** | Relays | an die Relays, über die der Auftrag lief und deren Betreiber eine Zahladresse nennt (NIP-11 `pubkey` → Profil), zu gleichen Teilen, höchstens drei |
| **0,5 %** | Werber des Kunden | wer den Kunden geworben hat (aus dem Einladungslink, nur in der App des Kunden bekannt) |
| **0,5 %** | Werber des Providers | wer den Provider geworben hat (nennt der Provider in seinem Angebot) |
| **1 %** | Hosting | der App-Spiegel, von dem die App geladen wurde (Zahladresse im signierten Spiegel-Verzeichnis, 5.3) |

**Warum diese Zahlen:**
- **Zusammen 6 %** (bisher 5 %: 2,5 % Protokollgebühr + 2,5 % App-Gebühr).
  Provider behalten 94 % statt 95 %; dafür geht jeder Anteil direkt an Arbeit
  statt in einen Topf, und jeder Teil verdient mit.
- **2,5 % Entwicklung:** so viel wie die bisherige App-Gebühr; eine stetige
  Einnahme, die mit der Nutzung wächst (Weiterentwicklung, Prüfungen, Betrieb).
- **1,5 % Relays:** Sie tragen jeden Auftrag. Bisher war ihnen nur ein Anteil von
  15 % am Pool versprochen, der auf Selbstauskünften beruhte und ohne gesetzte
  Pool-Adresse leer blieb.
- **1 % Werben** (doppelt so viel wie bisher 0,5 %): je Seite eine Ebene, für
  jeden Auftrag, solange der Geworbene die App nutzt. Bisher ging der
  Werbeanteil an **eine** feste Adresse aus der Knoten-Konfiguration
  (standardmäßig leer) – beim tatsächlichen Werber kam nichts an.
- **1 % Hosting:** Wer einen Spiegel der App betreibt, verdient an den
  Aufträgen, die über seinen Spiegel laufen.

### Regeln

1. **Direkt beim Zahlen, kein Topf.** Die App des Kunden zahlt jeden Anteil
   direkt an seinen Empfänger; der Provider bekommt seine 94 %. Bei Lightning
   ist jeder Anteil eine eigene Zahlung. Bei SOL teilt das Programm des
   Zahlkanals (4.3) jede Abrechnung selbst auf (`fee_recipients`, fest bei
   Eröffnung) – sofort und vom Programm erzwungen.
2. **Nicht zuordenbar heißt: an den Provider.** Fehlt ein Empfänger (kein
   Werber, kein Spiegel mit Zahladresse, kein Relay mit Zahladresse), bekommt
   den Anteil der Provider. Nie ein Topf, nie die Entwicklung.
3. **Kleine Beträge bündeln, ohne Verwahrung.** Lightning-Anteile unter
   100 sats je Empfänger sammelt die App des Zahlenden und zahlt sie
   gebündelt. Bis dahin bleibt das Geld beim Zahlenden, niemand sonst hält es.
   Bei SOL gibt es die Schwelle nicht.
4. **Fest voreingestellt.** Alle Anteile gelten für jeden Auftrag; keiner ist
   einzeln abschaltbar. Die Werte stehen ab 5.1 fest im Code und werden als
   Protokoll-Invariante von CI geprüft; ändern nur mit einem signierten Release
   (5.2) und vorher angekündigt. Obergrenze für alle Anteile außer dem Provider
   zusammen: 10 % (prüft der Provider, bei SOL das Programm). Ehrlich bleibt:
   Bei Lightning zahlt die App die Anteile – ein veränderter Fork könnte sie
   weglassen; bei SOL erzwingt es das Programm.
5. **Werben: eine Ebene je Seite, keine Stufen.** Die bisherigen Stufen
   (Bronze bis „Anker“) hingen an gezählten „aktiven Geworbenen“ –
   Selbstauskunft, also fälschbar; eine zweite Ebene bräuchte öffentliche
   Werbebeziehungen, die es seit 8.1b nur mit Zustimmung gibt. Belohnt wird nur
   ein Anteil an echtem Umsatz, nichts fürs bloße Anwerben (kein Rechtsrat,
   9.4). Selbst-Werbung lässt sich nicht verhindern, ist aber harmlos: Wer sich
   selbst wirbt, spart 0,5 %.
6. **Keine Anteile auf:** Zaps und Trinkgeld zwischen Menschen, Tausch (der LP
   nimmt die Gebühr seines Angebots), Relayer (Erstattung und eigene Gebühr),
   Speicher (direkt je Upload), Prüfer (direkt je Fall).
7. **Anreize darüber hinaus,** etwa für Provider in Randregionen: gesponserte
   Pools (5.1b) mit offenen Regeln, ohne Verwahrer.

### Wer woran verdient – sofort

| Teil | Einnahme |
|---|---|
| Provider | 94 % je Auftrag |
| Relays | 1,5 % je Auftrag; dazu bezahlter Zugang (5.4c/8.4) |
| Werben | 0,5 % je Auftrag des geworbenen Kunden, 0,5 % je Auftrag des geworbenen Providers |
| Hosting (App-Spiegel) | 1 % je Auftrag über den eigenen Spiegel |
| Entwicklung | 2,5 % je Auftrag |
| Liquiditätsgeber | Gebühr des eigenen Angebots, atomar im Tausch |
| Relayer | eigene Gebühr in der Erstattung (4.6e) |
| Speicher | direkt je Upload |
| Prüfer | direkt je Streitfall |
| Randregionen, Sonderanreize | gesponserte Pools (5.1b) |

### Folgen

- **5.1:** Die Protokollgebühr wird zur festen Aufteilung (Provider,
  Entwicklung, Relays, Werber beider Seiten, Hosting). Wegfallen:
  Pool-Verteiler, Reward-Claims und Belohnungen aus Selbstauskunft, die feste
  Werbe-Adresse im Knoten, Werbe-Stufen und zweite Ebene, Treasury und Sweep.
  Settlement und Fee-Beweis laufen auf die neuen Anteile; Werbelink trägt die
  Zahladressen des Werbers; Angebote nennen den Werber des Providers; das
  Spiegel-Verzeichnis (5.3) nennt die Zahladresse je Spiegel. Texte in App und
  Website werden angepasst.
- **4.3:** `fee_recipients` = Entwicklung, bis zu drei Relays, die beiden
  Werber und der Spiegel; Summe ≤ 10 %, geprüft im Programm.
- **AMLR:** Keine Stelle sammelt oder verteilt fremdes Geld. Kein Rechtsrat,
  siehe 9.4.
- **MENSCH (vor 5.1 live):** Empfänger-Adressen der Entwicklung, d. h. eine
  Lightning-Adresse über einen eigenen Knoten und eine SOL-Mehrfachsignatur
  (Squads, 5.9).
