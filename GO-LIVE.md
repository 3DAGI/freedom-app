# Go-Live — Schritt für Schritt

Zum Abhaken. Die Reihenfolge ist nicht beliebig: Jeder Abschnitt setzt voraus,
dass der vorige bewiesen ist. Wer Abschnitt 3 beginnt, bevor Abschnitt 1 grün
ist, sucht später Fehler an der falschen Stelle.

**Zeitangaben** sind für eine Person, nebenberuflich.

---

## 0 — Bevor irgendetwas live geht (1 Tag)

- [ ] **Release-Signierschlüssel erzeugen und offline legen.**
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      Auf Papier und auf einen Stick, nicht in eine CI-Variable, nicht in
      einen Passwortmanager mit Cloud-Sync. Dieser Schlüssel ist eure
      Richtungsmacht — wer ihn hat, kann Releases im Namen des Projekts
      ausgeben.
- [ ] **Pubkey daraus in `TRUSTED_SIGNERS` eintragen** (`packages/app/src/shell/app.ts`).
      Solange die Liste leer ist, prüft die App gegen niemanden und meldet
      ehrlich „nicht prüfbar".
- [ ] **Steuerberater kontaktieren.** Vor dem ersten Sat, nicht danach. Frage:
      Wie erfasse ich Krypto-Zuflüsse aus einer Client-Gebühr laufend?
      Die Fee-Beweis-Events sind bereits eine signierte, zeitgestempelte
      Aufzeichnung — das erleichtert das Gespräch erheblich.
- [ ] **AMLR-Frage mit dem Anwalt klären — Frist 10. Juli 2027.**
      Verordnung (EU) 2024/1624, Artikel 79 verbietet „Anbietern von
      Kryptowerte-Dienstleistungen" den Umgang mit anonymitätsverstärkenden
      Kryptowährungen und anonymen Konten. Artikel 2 Nummer 25 erfasst
      ausdrücklich auch Werte mit **optionaler** Verschleierung.

      Die Frage ist nicht, ob Monero legal ist (Besitz und Selbstverwahrung
      bleiben erlaubt), sondern **ob ihr ein CASP im Sinne der Verordnung
      seid**. Non-custodial und betreiberlos spricht dagegen; eine App mit
      Gebühr, die Swaps vermittelt, ist eine Grauzone. Das entscheidet auch
      darüber, ob eine dritte Zahlungsschicht je in Frage kommt.

- [ ] **Entscheiden: Firma oder privat?** Eine GmbH ist für den Anfang
      überdimensioniert; ein Einzelunternehmen reicht, bis relevante Beträge
      fließen. Das ist eine Entscheidung, keine Formalität — sie bestimmt,
      wer haftet.

---

## 1 — Beweisen, dass es funktioniert (2–3 Wochen)

**Ziel: ein echter Sat fließt und der Beweis lässt sich prüfen.**

### 1.1 Anchor auf Devnet

- [ ] `solana config set --url devnet`, Wallet anlegen, Airdrop holen
- [ ] `anchor build` — muss ohne Warnungen durchlaufen
- [ ] `anchor deploy --provider.cluster devnet`
- [ ] Program-ID aus dem Deploy in `HTLC_PROGRAM_ID` eintragen
      (`packages/app/src/sol-htlc.ts` **und** `packages/protocol/src/solana-adapter.ts`)
- [ ] `anchor test` — die Tests in `contracts/solana-htlc/tests/` laufen lassen
- [ ] **Prüfen: Mietbefreiung kommt zurück.** Kontostand des Initiators vor
      und nach dem Claim vergleichen. Wenn die Miete nicht zurückfließt, ist
      `close = initiator` nicht wirksam.

> ⚠ **Programm und Client müssen zusammen raus.** Borsh kodiert `[u8; 32]`
> ohne Längenpräfix, `Vec<u8>` mit. Altes Programm plus neuer Client ergibt
> abgelehnte Transaktionen ohne verwertbare Fehlermeldung. Wer nur eine Seite
> ausrollt, sucht tagelang.

### 1.2 Lightning-Kreis

- [ ] LND im Testnet aufsetzen (Polar oder eigene Instanz)
- [ ] Kanal öffnen, ein paar Test-Sats hineinbringen
- [ ] `LND_REST_URL` und `LND_MACAROON_HEX` setzen
- [ ] Die übersprungenen LIVE-Tests laufen lassen:
      `cd packages/protocol && LIVE=1 npm test`
- [ ] **Hold-Invoice-Pfad prüfen:** erstellen, zahlen, mit Preimage settlen
- [ ] **Refund-Pfad prüfen:** erstellen, zahlen, abbrechen — die Sats müssen
      zurückkommen

### 1.3 Ein vollständiger Job

- [ ] Provider lokal starten (Container-Paket, `NODE_LUD16` auf eine
      Testnet-Adresse)
- [ ] App lokal öffnen, Wallet verbinden
- [ ] Eine Frage stellen, bezahlen, Antwort bekommen
- [ ] **„Diese Zahlung prüfen" drücken.** Alle Legs müssen „belegt" zeigen,
      nicht nur „angekündigt".
- [ ] Wenn ein Leg „angekündigt" bleibt: Der Provider hat kein Preimage
      veröffentlicht. Nachsehen in `settlement.ts`, nicht ignorieren.

**Meilenstein 1: ✅ wenn ein Fremder eine Frage stellen, bezahlen und den Beweis prüfen kann.**

---

## 2 — Mainnet und erster öffentlicher Stand (1–2 Wochen)

- [ ] **Anchor auf Mainnet deployen.** Kostet ein paar SOL.
- [ ] **Upgrade-Authority auf `none` setzen:**
      `solana program set-upgrade-authority <PROGRAM_ID> --final`
      Danach kann niemand mehr etwas ändern — auch ihr nicht. Vorher
      dreimal prüfen, dass das Programm tut, was es soll.
- [ ] **AI-Act-Transparenz** (Art. 50, seit 2. August 2026 in Kraft):
      Hinweis im Chat, dass mit einem KI-System interagiert wird;
      C2PA-Metadaten bei Bild- und Videoerzeugung. Billig und erledigt eine
      bestehende Pflicht.
- [ ] **Erstes Release veröffentlichen:**
      ```
      cd packages/app && node build.mjs
      RELEASE_SECRET_KEY=<hex> RELEASE_SOURCES="https://…,magnet:…" \
        node scripts/publish-release.mjs 0.1.0
      ```
- [ ] **Prüfsumme an drei Orte:** Website, Release-Manifest auf den Relays,
      und ein Ort außerhalb eurer Kontrolle (Nostr-Post von eurem Account).
- [ ] **In der App „eigene Echtheit prüfen" drücken** — muss „geprüft" sagen.
- [ ] Dashboard öffentlich erreichbar machen
- [ ] Repository öffentlich schalten. **Ohne Contribution-Guide** — noch
      nimmt niemand Pull Requests an.

**Meilenstein 2: ✅ wenn jemand die App von eurer Seite lädt, ihre Echtheit prüft und einen Job bezahlt.**

---

## 3 — Provider sammeln (4–8 Wochen)

**Das ist die schwierige Seite. Ein Kunde ohne Provider bekommt nichts; ein
Provider ohne Kunden geht wieder.** Deshalb zuerst Provider — und zwar
Menschen, die ihr kennt.

### 3.1 Die ersten fünf

- [ ] **Fünf Leute persönlich fragen**, die eine GPU haben. Nicht posten —
      fragen. Die ersten fünf kommen über Beziehung, nicht über Reichweite.
- [ ] Jeden **selbst beim Aufsetzen begleiten** (Videocall, 20 Minuten).
      Dabei mitschreiben, wo es hakt — das ist die wertvollste Information
      dieser Phase.
- [ ] Nach jedem Aufsetzen: Was war unklar? Dann sofort ausbessern.
- [ ] `PROVIDER_SINCE` prüfen: Überlebt es einen Neustart? Sonst bleibt der
      Provider dauerhaft im Gratismodus und verdient nie etwas.

### 3.2 Reibung messen

- [ ] Wie lange dauert es vom Entschluss bis zum ersten verdienten Sat?
      **Über 30 Minuten ist zu lang.**
- [ ] Wie viele brechen ab? Wo genau?
- [ ] Container-Paket gegen Installer: Was nehmen die Leute?

### 3.3 Erste Auszahlung

- [ ] Reward-Pool füllen (Fee fließt automatisch dorthin)
- [ ] `POOL_DISTRIBUTOR=1` und `POOL_BALANCE_MSAT` auf **einem** Knoten setzen
- [ ] Erste Verteilung im Probelauf (`dryRun`) ansehen, dann echt laufen lassen
- [ ] **Verteilungsbericht prüfen** — jeder muss ihn nachrechnen können
- [ ] Provider fragen, ob das Geld angekommen ist. Nicht annehmen: fragen.

**Meilenstein 3: ✅ wenn ein Job läuft, ohne dass ihr beteiligt seid, und der Provider bezahlt wurde.**

---

## 4 — Nutzer sammeln (parallel zu 3, 4–8 Wochen)

- [ ] **Free-Tier-Kontingent großzügig setzen.** In dieser Phase ist ein
      Nutzer mehr wert als die Sats, die er kostet.
- [ ] **Nostr zuerst.** Dort sitzt die Nutzerschaft, die heute sucht: Leute,
      die NIP-44-DMs, Communities und Zahlungen auf jedem Gerät wollen.
      Die KI-Seite ist dort ein Bonus, kein Aufhänger.
- [ ] Beitrag schreiben: **was es tut**, nicht was es bedeutet. Kein
      „unzensierbar", kein „für immer" — beides zieht die falschen Leute an
      und macht Behörden aufmerksam.
- [ ] **Auf jede Rückmeldung persönlich antworten.** In dieser Phase ist das
      eure wichtigste Tätigkeit.
- [ ] Erste zehn Nutzer: Wo brechen sie ab? Onboarding entsprechend ändern.

### Was ich nicht tun würde

- ❌ Product Hunt, Hacker News, Reddit-Launch. Zu früh. Ein Ansturm auf ein
      System mit fünf Providern erzeugt schlechte Erfahrungen, die man nicht
      zurücknehmen kann.
- ❌ Bezahlte Werbung. Ihr wisst noch nicht, wer eure Nutzer sind.
- ❌ „Wir sind das dezentrale ChatGPT." Ihr seid es nicht und wollt es nicht
      sein.

**Meilenstein 4: ✅ wenn zehn Nutzer, die ihr nicht kennt, in einer Woche
mehrfach zurückkommen.**

---

## 5 — Die Geschichte (nach Meilenstein 3+4, 4–6 Wochen)

Erst jetzt. Eine Ausfall-Geschichte auf einer Zahlungsschicht, die nie
gelaufen ist, wäre eine Ankündigung — und davon hat das Projekt genug hinter
sich.

- [ ] Zwei LoRa-Geräte kaufen (Meshtastic-kompatibel, ~40 € das Stück)
- [ ] Echten Nachrichtenversand über Funk testen
- [ ] **Eine Solana-Transaktion über Funk einreichen.** Das ist das Bild,
      das die Geschichte trägt.
- [ ] Video aufnehmen: Flugmodus an, Nachricht kommt trotzdem an
- [ ] Erst dann breiter kommunizieren: „Kommunikation und Zahlungen, die
      weiterlaufen, wenn das Netz ausfällt."

**Meilenstein 5: ✅ wenn ein Video existiert, in dem eine Zahlung ohne Internet ankommt.**

---

## 6 — Mitentwickler (nach Meilenstein 5)

**Nicht früher.** Ein Projekt, das noch nie gelaufen ist, zieht Leute an, die
Ideen haben, nicht Lösungen. Ihr verbringt dann Monate mit Pull Requests für
ein System, das nicht funktioniert.

### 6.1 Vorbereitung

- [ ] `CONTRIBUTING.md`: Was ihr annehmt, was nicht, wie ihr entscheidet
- [ ] **Richtung schriftlich festhalten.** Was ist dieses Projekt, was nicht.
      Drei Absätze reichen. Ohne das diskutiert ihr jede Woche neu.
- [ ] Anteil der App-Gebühr für Beitragsrunden festlegen (Vorschlag: 10–20 %)
      und **öffentlich nennen**

### 6.2 Mit Kopfgeldern anfangen

Ein Kopfgeld ist ein Vertrag; offene Mitarbeit ist eine Beziehung — und die
kostet Zeit, die ihr vorher nicht habt.

- [ ] Drei bis fünf klar beschriebene Aufgaben als Kopfgeld ausschreiben
- [ ] Beträge, die ernst gemeint sind. 50 € für zwei Tage Arbeit ist eine
      Beleidigung, keine Einladung.
- [ ] Erledigte Kopfgelder **sofort** auszahlen. Die erste Auszahlung
      entscheidet, ob eine zweite Person mitmacht.

### 6.3 Erste rückwirkende Runde

- [ ] Erst wenn zwei bis drei Leute mehrere Kopfgelder erledigt haben
- [ ] Zeitraum, Topf und Herkunft öffentlich ankündigen
- [ ] Vorschlag rechnen lassen (`suggestAllocations`), aber **selbst
      entscheiden** — eine Kennzahl sieht nicht, dass eine einzelne Änderung
      mehr wert war als monatelange Kleinarbeit
- [ ] Jede Zuteilung mit Begründung veröffentlichen

**Meilenstein 6: ✅ wenn jemand, den ihr nicht kennt, einen Fehler behoben hat und dafür bezahlt wurde.**

---

## Dauerbetrieb

- [ ] **Wöchentlich:** Dashboard ansehen. Wie viele Provider, wo fehlt
      Abdeckung, gibt es gefährdete Modelle?
- [ ] **Monatlich:** Fee-Beweise stichprobenartig prüfen. Zahlt jeder
      Provider ab?
- [ ] **Quartalsweise:** Beitragsrunde
- [ ] **Bei jedem Release:** Manifest veröffentlichen, Prüfsumme an drei Orte

---

## Die drei Fehler, die dieses Projekt am ehesten scheitern lassen

**1. Zu früh Reichweite.** Ein Ansturm auf ein System mit fünf Providern
erzeugt hunderte schlechte erste Eindrücke. Die bekommt man nicht zurück.

**2. Der Schlüsselverlust beim ersten Nutzer.** Jemand löscht seine
Browserdaten, verliert alles und schreibt darüber. Deshalb ist der
erzwungene Backup-Dialog eingebaut — nehmt ihn nicht wieder raus, auch wenn
er beim Testen nervt.

**3. Zu viele Baustellen gleichzeitig.** Discord + Replit + GitHub +
OpenRouter + Wallet sind fünf Produkte. Solange ihr allein seid, darf immer
nur eines davon aktiv verbessert werden. Die anderen bleiben in ihrer
einfachen Form — **aber sie müssen funktionieren.** Eine Funktion, die zu
40 % läuft, ist schlimmer als eine, die es noch nicht gibt.
