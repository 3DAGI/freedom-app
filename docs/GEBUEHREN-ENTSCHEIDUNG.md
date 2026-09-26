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

Der MENSCH wollte eine Gebühr mit voreingestellter Aufteilung, damit alle Teile
von FreedomStack belohnt werden – aber ohne Topf, auf den jemand Zugriff hat.
Ein schlüsselloser Topf löst die Verwahrung, nicht die Verteilung (Umverteilung
bräuchte Angaben, die die Kette nicht prüfen kann; in Sats gibt es keinen Topf
ohne Verwahrer). Darum **A+**: Die Anteile gehen **beim Zahlen direkt** an die,
die den Auftrag getragen haben. Nichts liegt herum, nichts wird verteilt.
Die Quote hat der MENSCH dem Agenten übertragen („einmalig, für eine effektive
und stabile Entwicklung“); sie steht hier und gilt ab 5.1.

### Aufteilung einer KI-Zahlung

| Anteil | Empfänger | Wie |
|---:|---|---|
| **95 %** | Provider | wie bisher |
| **3 %** | Entwicklung | an selbstverwahrte Adressen des Projekts (Lightning über einen eigenen Knoten, z. B. `lnurl-server.ts`; SOL an eine Mehrfachsignatur), im Auftrag offen deklariert |
| **2 %** | Relays | an die Relays, über die der Auftrag lief und deren Betreiber eine Zahladresse nennt (NIP-11 `pubkey` → Profil), zu gleichen Teilen, höchstens drei |

**Warum diese Zahlen:**
- **Zusammen 5 %, wie bisher** (2,5 % Protokollgebühr + 2,5 % App-Gebühr).
  Kunden zahlen dasselbe, Provider behalten dieselben 95 %. Nur geht das Geld
  jetzt direkt an Arbeit statt in einen Topf.
- **3 % Entwicklung:** eine stetige Einnahme, die mit der Nutzung wächst, ohne
  Topf und ohne Werbeprovision. Das ist mehr als die bisherige App-Gebühr
  (2,5 %), weil der Pool wegfällt – Weiterentwicklung, Prüfungen und Betrieb
  (Website, Spiegel, Test-Knoten) müssen davon leben.
- **2 % Relays:** Sie tragen jeden Auftrag. Bisher war ihnen nur ein Anteil von
  15 % am Pool versprochen, der auf Selbstauskünften beruhte und ohne gesetzte
  Pool-Adresse leer blieb. 2 % je Auftrag sind echtes Geld für echte Zustellung. Wer eigene Relays betreibt (auch ein
  Provider), verdient mit.

### Regeln

1. **Direkt beim Zahlen, kein Topf.** Bei Lightning zahlt die App jeden Anteil
   als eigene Rechnung. Bei SOL teilt das Programm des Zahlkanals (4.3) jede
   Abrechnung selbst auf (`fee_recipients`, fest bei Eröffnung).
2. **Nicht zuordenbar heißt: an den Provider.** Nennt kein Relay eine
   Zahladresse, bekommt der Provider die 2 %. Nie an einen Topf und nie an
   die Entwicklung.
3. **Kleine Beträge bündeln, ohne Verwahrung.** Lightning-Anteile unter
   100 sats je Empfänger sammelt die App des Zahlenden und zahlt sie
   gebündelt. Bis dahin bleibt das Geld beim Zahlenden, niemand sonst hält es.
   Bei SOL gibt es die Schwelle nicht, der Kanal teilt bei jeder Abrechnung.
4. **Obergrenze 10 %.** Alle Anteile außer dem Provider zusammen höchstens
   10 %. Das prüft der Provider, bei SOL das Programm. Die Werte 3 % und 2 %
   stehen ab 5.1 fest im Code und werden als Protokoll-Invariante von CI geprüft.
   Ändern nur mit einem signierten Release (5.2) und vorher angekündigt.
5. **Entwicklungsanteil: voreingestellt an, abschaltbar.** Er steht in jedem
   Auftrag und ist in den Settings abschaltbar – freiwillig wie in A. Ein Fork
   kann ihn ohnehin entfernen; das ist gewollt.
6. **Keine Anteile auf:** Zaps und Trinkgeld zwischen Menschen, Tausch (der LP
   nimmt die Gebühr seines Angebots), Relayer (Erstattung und eigene Gebühr),
   Speicher (direkt je Upload), Prüfer (direkt je Fall). Werben bekommt keine
   Provision.
7. **Anreize darüber hinaus,** etwa für Provider in Randregionen: gesponserte
   Pools (5.1b) mit offenen Regeln, ohne Verwahrer.

### Wer woran verdient

| Teil | Einnahme |
|---|---|
| Provider | 95 % je Auftrag |
| Relays | 2 % je Auftrag; dazu bezahlter Zugang (5.4c/8.4) |
| Entwicklung | 3 % je Auftrag (abschaltbar) |
| Liquiditätsgeber | Gebühr des eigenen Angebots |
| Relayer | eigene Gebühr in der Erstattung (4.6e) |
| Speicher | direkt je Upload |
| Prüfer | direkt je Streitfall |
| Randregionen, Sonderanreize | gesponserte Pools (5.1b) |

### Folgen

- **5.1:** Die Protokollgebühr wird zur festen Aufteilung (Provider, Entwicklung,
  Relays). Wegfallen: Pool-Verteiler, Reward-Claims und Belohnungen aus
  Selbstauskunft, Werbeprovision, Treasury und Sweep. Settlement und Fee-Beweis
  laufen auf die neuen Anteile. Texte in App und Website werden angepasst.
- **4.3:** `fee_recipients` = Entwicklung (3 %) + bis zu drei Relays (2 %),
  Summe ≤ 10 %, geprüft im Programm.
- **AMLR:** Keine Stelle sammelt oder verteilt fremdes Geld. Der
  Entwicklungsanteil geht an einen erkennbaren Empfänger, als Entgelt für die
  Software. Kein Rechtsrat, siehe 9.4.
- **MENSCH (vor 5.1 live):** Empfänger-Adressen der Entwicklung, d. h. eine
  Lightning-Adresse über einen eigenen Knoten und eine SOL-Mehrfachsignatur
  (Squads, 5.9).
