# FreedomStack – Anweisungen für Claude Code

Diese Datei liest Claude Code bei jeder Sitzung. Sie gilt vor allen anderen
Dokumenten. Sprache im Projekt: Deutsch (Kommentare, Commits, Berichte,
Oberfläche über `packages/app/src/i18n.ts`, wo vorhanden).

## Das Projekt in fünf Sätzen

FreedomStack ist eine App plus Protokoll für Nachrichten, Zahlungen und
KI-Anfragen ohne Betreiber: Kommunikation über Nostr, Bezahlung über Lightning
(Sats) und Solana (SOL). Die Web-App ist eine einzige HTML-Datei, veröffentlicht
auf GitHub Pages. Provider betreiben Knoten, die KI-Aufträge (NIP-90) gegen
Bezahlung ausführen. Ziel des laufenden Ausbaus: (1) Sats und SOL gleichwertig,
(2) offen und dezentral, (3) alles Ende-zu-Ende-verschlüsselt, (4) jeder Schritt
vollständig fertig. Ausführlich: `docs/ausbau/UEBERSICHT.md`.

## Aufbau

| Ort | Inhalt |
|---|---|
| `packages/protocol` | Protokollbausteine (TypeScript), Tests in `test/` |
| `packages/node` | Provider-Knoten (TypeScript), Tests in `test/` |
| `packages/app` | Web-App; `src/shell/app.ts` (Einstieg: `boot()`, `switchTab()`, Identität, Onboarding), `state.ts` (Zustand, Pools), `ui.ts` (Hilfsfunktionen), `datenschutz.ts` (Bericht), `tresor.ts` (Tresor-Dialoge; Krypto in `src/vault.ts`), `bunker.ts` (Anmelden per NIP-46), `tabs/` (je Tab ein Modul: `kommunikation.ts` + `raeume.ts`, `agent.ts` + `agent-netz.ts`, `waehrung.ts`, `earn.ts`, `profil.ts`, `settings.ts`); Build → `dist/freedom.html` |
| `packages/website` | Startseite, Whitepaper, FAQ, Roadmap, Dashboard |
| `contracts/solana-htlc` | Anchor-Programm (Rust) für Swaps und Deposits |
| `scripts/` | Build, Prüfungen, `smoke_test.py`, `check_innerhtml.py` |
| `docs/ausbau/` | Ausbauplan: Fortschritt, Aufgabenkarten je Phase, Vorlagen |
| `STATUS.md` | Entwicklungsprotokoll – nach jedem Schritt ein Abschnitt |

## Befehle

```bash
npm ci                                                   # einmal pro Sitzung
cd packages/protocol && npx tsc -p tsconfig.json --noEmit && npm test && cd ../..
cd packages/node     && npx tsc -p tsconfig.json --noEmit && npm test && cd ../..
cd packages/app      && npx tsc -p tsconfig.json --noEmit && npm test && npm run test:leak && node build.mjs && cd ../..
cd packages/mls      && npx tsc -p tsconfig.json && npm test && cd ../..     # MLS (MDK als WASM, aus dist/)
python3 scripts/check-wiring.py --streng
python3 scripts/check-website.py
python3 scripts/check_innerhtml.py packages/app/src --ausnahmen scripts/innerhtml-ausnahmen.txt --streng
python3 scripts/smoke_test.py packages/app/dist         # braucht playwright + chromium
bash scripts/build-site.sh /tmp/site                     # Website bauen (Ziel wird gelöscht!)
bash scripts/repro-build.sh --pruefen                    # reproduzierbar? zwei frische Builds, eine Summe (~2 min)
bash packages/mls/bauen.sh --pruefen                     # nur bei Änderungen an packages/mls: nachbauen + vergleichen (Rust, clang)
bash contracts/solana-channel/pruefen.sh --werkzeuge     # nur bei Änderungen am Zahlkanal: bauen + Tests gegen Validator (Agave 3.1.10)
```

Stand 28.09.2026 (nach 8.2c, 5.5a–c, 8.15, 11.1a, C.3c2, 11.1b, 5.9a–b und 6.3a–b2): protocol 1104 grün (6 übersprungen), node 263 grün
(6 übersprungen, mit Internet – ohne Netz überspringen sich zusätzlich Live-Tests
in `tools.test.ts`), app 608 grün, mls 13 grün, Zahlkanal 7 grün (gegen Validator), Leak-Tests 65 grün + 1 `todo` (heutige Lecks,
je mit dem Schritt, der sie schließt – dort wird aus `todo` ein normaler Test;
Ausnahme: gesendete SOL-Zahlungen von frischen Adressen, eine bewusste Grenze
nach Entscheidung 4.9 A – im Datenschutzbericht unter „Bewusste Grenzen“).

## Arbeitsweise

1. `docs/ausbau/FORTSCHRITT.md` lesen, den nächsten offenen Schritt **der eigenen
   Spur** nehmen (Abschnitt „Spuren“) – **nur einen pro Sitzung**. Dann die passende Karte `docs/ausbau/phase-N.md`.
2. Vor jeder Änderung die Stellen mit `grep -rn` finden und lesen. Große Dateien
   (`tabs/agent.ts`, `tabs/kommunikation.ts`) nur in Ausschnitten lesen (Zeilenbereiche).
3. Kleine, gezielte Änderungen; keine Umformatierung unbeteiligter Stellen.
4. Tests schreiben, auch Negativfälle; alle Befehle oben ausführen.
5. `docs/ausbau/FORTSCHRITT.md` und `STATUS.md` aktualisieren.
6. Commit auf Deutsch: `<Schritt>: <kurz>`; Pull Request mit dem Bericht aus
   `docs/ausbau/VORLAGEN.md` als Beschreibung. Dann anhalten.
7. **Knoten-Stand (Entscheidung 25.09.2026):** Braucht die App nach einem Merge
   einen neueren Provider-Knoten, wird trotzdem gemergt, sobald CI grün ist. Der
   MENSCH bringt den GX10-Knoten danach auf den aktuellen `main`. Im PR steht,
   welcher Knoten-Stand nötig ist; bis zum Update dürfen KI-Anfragen der Live-App
   scheitern.

## Drei Agenten parallel (zwei seit 26.09.2026, drei seit 27.09.2026)

Drei Agenten arbeiten gleichzeitig in getrennten Spuren (Tabelle in
`docs/ausbau/FORTSCHRITT.md`): A Netz, Geld, Vertrauen · B Mesh und Bausteine ·
C Oberfläche (Karte `docs/ausbau/phase-10.md`). Damit sie sich nicht
gegenseitig brechen:

1. **Nur Schritte der eigenen Spur.** Muss ein Schritt Code einer anderen Spur
   ändern, klein halten und im Pull Request nennen. Spur C baut nur Oberfläche
   und baut Dateien, an denen eine andere Spur gerade arbeitet, erst danach um.
2. **Eigener Branch, eigene Pull Requests;** höchstens einer je Agent offen. Jeder
   merged seine eigenen, sobald CI grün ist.
3. **Vor dem Merge `main` holen:** Ist `main` seit dem letzten CI-Lauf weiter,
   `main` in den eigenen Branch mergen (kein Rebase), alle Befehle erneut
   ausführen, pushen, CI abwarten – erst dann mergen.
4. **Gemeinsame Dateien:** In `FORTSCHRITT.md` nur die eigenen Zeilen ändern. In
   `STATUS.md` neue Abschnitte am Ende als `## Schritt <ID> – <Titel>` (ohne
   laufende Nummer). Die Zeile „Stand …“ oben zählt, wer merged, nach dem
   Einmergen von `main` neu. Neue Fallstricke unten anhängen. Bei Konflikten in
   diesen Dateien und in Sammelstellen (`protocol/src/index.ts`,
   `node/src/main.ts`, `app/src/shell/app.ts`, `scripts/*ausnahmen*`) beide
   Seiten behalten.
5. **Knoten-Stand:** Ein Update des GX10-Knotens auf `main` deckt alle Spuren
   ab; im Pull Request steht wie bisher, welcher Stand nötig ist.

## Definition of Done – alle Punkte, sonst nicht fertig

1. **Verdrahtet:** im echten Pfad von App oder Knoten aufgerufen (Datei:Zeile im Bericht).
2. **Leak-Regeln** eingehalten; neue Datenschutz-Aussagen nur mit Szenario in
   `packages/protocol/test/privacy-facts.test.ts`.
3. **Tests grün**, Anzahl steigt oder bleibt – sinkt nur, wenn die Karte eine
   Funktion entfernt (dann begründen).
4. **Smoke-Test grün**; Geldfunktionen zusätzlich auf Devnet/Testnet (MENSCH-Checkliste).
5. **Ehrliche Texte:** App, Datenschutzbericht, Website sagen dasselbe wie der Code.
6. **Nichts von Hand veröffentlicht** – nur über `.github/workflows/pages.yml`.

## STOPP – anhalten und im Pull Request fragen, wenn

- ein Test rot ist und die Ursache unklar ist;
- eine MENSCH-Aufgabe dran ist (Schlüssel, Geld, Geräte, Entscheidungen, Konten);
- kryptografische Parameter, Zeitschlossregeln, Gebührenberechnung, Borsh-Layouts,
  Event-Formate oder Ableitungspfade geändert werden müssten, ohne dass die Karte es verlangt;
- eine neue Abhängigkeit nötig ist (Name, Zweck, Größe nennen);
- die Karte nicht zum Code passt und die Absicht unklar ist;
- ein Schritt mehr als etwa 400 geänderte Zeilen bräuchte – dann Aufteilung vorschlagen.

## Verboten

Geheimnisse in Code, Tests, Logs oder Commits · Tests löschen oder abschwächen,
damit sie grün werden · Mainnet oder echtes Geld · direktes Veröffentlichen ·
`--final` auf Solana-Programme, Upgrade-Rechte ändern · `skipPreflight` ·
einen Schritt als fertig markieren, dessen Prüfungen nicht gelaufen sind.

## Fallstricke, die schon einmal Zeit gekostet haben

- **`build-site.sh` löscht sein Zielverzeichnis** vollständig. Nie in einen Git-Checkout bauen.
- **CSP:** `build.mjs` erlaubt genau ein eingebettetes Skript (per Hash). Keine
  Inline-Handler, kein `eval`. `'wasm-unsafe-eval'` steht seit 2.2b-b drin – nur für
  die MLS-Engine; weiteres WASM oder andere Lockerungen → vorher fragen.
- **Fremddaten nie ungeprüft in `innerHTML`:** `escapeHtml()` für Text,
  `ganzeZahl()` für Zahlen, sonst `textContent`. `scripts/check_innerhtml.py` prüft
  jede HTML-Zuweisung streng (CI und `pages.yml`); neue sichere Stellen mit Begründung
  in `scripts/innerhtml-ausnahmen.txt`, eine Zeile je Stelle – nie für Fremddaten.
  `pkShort()` maskiert nicht: im HTML immer `escapeHtml(pkShort(…))`.
  Provider-Daten laufen durch `parseJobResult()` + `sanitizeUsage()`.
- **Hex aus Fremddaten vor `fromHex()` prüfen:** `fromHex()` (`Buffer.from(h, "hex")`)
  schneidet beim ersten ungültigen Zeichen still ab. Events prüft `verifyEvent()`
  seit 0.J selbst (Form nach NIP-01); jeden anderen fremden Hex-Wert (Hashlock,
  Preimage, Schlüssel aus Tags) vorher mit fester Länge prüfen.
- **Direktnachrichten nur nach NIP-17** (`buildPrivateDm`, Kind 1059). Nie Kind 4
  senden – `app/test/dm-verdrahtung.test.ts` prüft das.
- **Datenschutzbericht:** Aussagen nur über `packages/protocol/src/privacy-facts.ts`.
  Angezeigt wird er seit 8.16g2b1 über `app/src/datenschutz-bericht.ts`
  (`berichtText()`, `faktenText()`, `faktAussage()`) – jede neue Aussage und
  jeder neue Befund (`PrivacyFinding.id`) braucht dort einen Text in beiden
  Sprachen; ein Test hält die deutsche Fassung wortgleich mit dem Protokoll.
- **Swaps:** Einlösen nur bis Frist minus 10 Minuten (`claimAllowed()`), Vorabsimulation an.
  Richtung SOL → Lightning (seit 4.6): der LP zahlt nur mit `cltv_limit` nach
  `validateReverseTimelock()` – Lightning muss dort **vor** Solana enden. Regeln in `docs/SWAPS.md`.
  Dort ist die Swap-ID `rueckSwapId(bolt11)` und der Sperrbetrag `rueckSwapLamports()` –
  App und LP rechnen mit denselben Funktionen. Der LP speichert vor dem Zahlen und
  zahlt nie ein zweites Mal; nach außen nur feste Texte, nie Meldungen von LND.
  Relayer (seit 4.6e) signieren nur, was `pruefeRelayAuftrag()` durchlässt (Einlösung +
  Erstattung); Aufträge nur versiegelt – sie tragen das Preimage.
- **Anchor-Fehler-Enum:** neue Varianten nur ANS ENDE – Fehlercodes dürfen sich nicht verschieben.
- **Programm-ID ungeklärt:** Code nutzt `B6W19U…`, laut `DEPLOY.md` wurde nach
  `3UmRR…` deployt. Nicht ändern ohne MENSCH-Entscheidung (Schritt 0.G).
- **Fristen in Tests nur einmal aus der Uhr berechnen:** Kette (Stub) und
  Event bekommen dieselbe Konstante, nie zweimal `Date.now()`. Sonst ist der
  Test rot, sobald dazwischen die Sekunde umspringt – so war
  `sol-deposit-job.test.ts` bis Schritt 0.H instabil. Ein roter Test gilt seitdem
  nie als Zufall.
- **Signieren nur über den Signer:** `await signiere(ev)` (`shell/state.ts`),
  Ver-/Entschlüsseln über `state.signer.nip44…` – sonst funktioniert der Pfad
  mit einem entfernten Signer (NIP-46) nicht. `state.keypair` hat seit 1.3e nur
  noch `pk`; den rohen Schlüssel gibt es nur über `mitRohemSchluessel(wofuer, fn)`
  und nur für das, was ohne ihn nicht geht (Sicherung, Nachfolge, Swap-Adressen,
  Export) – synchron, die Kopie wird danach genullt. Mit Bunker (`mitBunker()`)
  gibt es ihn nicht: solche Funktionen sperren, nicht scheitern lassen.
- **KI-Anfragen nur privat** (seit 3.1): über `buildJobEvent()` – Autor ist der
  Sitzungsschlüssel aus `kiSitzungen` (nie `state.keypair.pk`), gesendet wird nur
  der Umschlag aus `buildPrivateJobRequest()`. Tags gehören vor dem Versiegeln in
  den Kern; nie nach der Signatur anhängen. `test/leak/ki-anfrage.test.ts` prüft das.
  Seit 3.2 ebenso zurück (Antwort, Rückmeldung) und für Sitzung und Belege; die App
  nimmt nur versiegelte Antworten. Seit 3.4 auch Reklamationen (`buildPrivateDispute`,
  an Provider und Prüfer). Neue KI-Events nie offen veröffentlichen.
- **Kein Klartext im Knoten** (seit 3.3): Prompts und Antworten nie loggen (nur
  mit `klartextProtokoll`/`LOG_KLARTEXT=1`), nie in Dateien, nicht über die
  Antwort hinaus im Speicher halten – auch nicht als Gesprächsverlauf; den
  Kontext bringt die App (`kontextPraefix()`). Fehlermeldungen können Fremdtext
  tragen (URL mit Suchanfrage) – dann nur den Fehlernamen loggen.
  `node/test/klartext.test.ts` prüft das.
- **Anhänge nur verschlüsselt** (seit 2.4): Chat-Dateien über `uploadAnhang()`
  (Blob-Netz) bzw. `verschluesseleDatei()` vor Blossom; der Schlüssel gehört nur
  in die Nachricht. Git-Bundles seit 8.9b ebenso verschlüsselt, der Schlüssel steht
  öffentlich in der Referenz (38042); `uploadBlob()` direkt nur, wenn keine
  Speicherknoten das halten sollen.
  Inline in DMs höchstens `INLINE_MAX_BYTES` – NIP-44 fasst 65.535 Byte.
- **Geld nur über die Zahlschienen** (seit 4.1): zahlen mit
  `zahle(zahlschienen(), …)`; direkte Wallet-Zugriffe nur in `rails.ts` und
  `shell/zahlschienen.ts` – `check-wiring.py --streng` prüft das (Zahlwege).
  Nie still auf die andere Währung ausweichen. Die eingebaute SOL-Wallet
  (`sol-wallet.ts`, seit 4.2a) zahlt nur über die Schiene mit `freigabe()`
  (Tageslimit, darüber Dialog); ihr Schlüssel liegt nur in `geheim`. Nach einem
  SOL-Trinkgeld geht der Beleg (Kind 9736) über `sendeTrinkgeldBeleg()` –
  versiegelt; offen nur, wenn der Nutzer es ausdrücklich wählt.
- **Geheimnisse nur über `geheim`** (`shell/tresor.ts`): Schlüssel, Wallet-Zugänge,
  Preimages, Unterhaltungen und Verläufe nie direkt in `localStorage` schreiben –
  mit Tresor landen sie sonst im Klartext. Vor neuen Geld-Geheimnissen
  `verlangeTresor()`. Neue Schlüsselnamen auch in `geheimnisse()` eintragen.
- **Uhr im Smoke-Test:** Playwrights frei laufende Uhr kann einen `fast_forward`
  verlieren; vorher `clock.pause_at(...)`. In Python liest `pause_at` eine Zahl als
  Sekunden – ein `datetime` übergeben.
- **Solana-RPC:** Die App spricht standardmäßig Mainnet an; für Devnet-Tests in
  den Settings `https://api.devnet.solana.com` eintragen.
- **„Belegt“ heißt: beim angekündigten Empfänger angekommen** (seit 4.8):
  Lightning nur mit Preimage (`preimageMatches()`) + Rechnung, die dessen
  Knoten signiert hat (`leseBolt11()`), Solana nur mit der Kette
  (`pruefeSolUeberweisung()`). Ein Preimage allein oder eine bloße Signatur
  ist „angekündigt“. Rechnungen von LNURL-Servern vor dem Zahlen auf den
  Betrag prüfen. Den Gebühren-Beleg des Knotens (38051) gibt es seit 5.1.4c
  nicht mehr – 38050/38051 nicht wiederverwenden.
- **Gebühren nur über `aufteilung.ts`** (Modell A+, seit 5.1.1): feste Anteile
  94 / 2,5 / 1,5 / 0,5 / 0,5 / 1 (CI-Invariante, ändern nur mit signiertem
  Release); nicht Zuordenbares und Rundungsreste an den Provider, nie an die
  Entwicklung; App (`teileAuf()`) und Knoten (`pruefeAufteilung()`,
  `providerAnteilMsat()`) rechnen mit denselben Funktionen. SOL-Anteile nur
  über den Zahlkanal (seit 4.3d, `kanalEmpfaenger()`). Der Knoten zahlt seit 5.1.2 nichts aus – keinen
  Pool, keinen Verteiler, keine Rücklage wieder einführen (Treasury, Sweep,
  Pool-Rangliste, Knappheitsbonus und App-Gebühr fielen mit 5.1.4a, alte
  Protokollgebühr, Gebühren-Beleg und Aufgaben-Topf mit 5.1.4c – Aufgaben sind
  nur Abzeichen; Aussagen des alten Modells auf der Website weist
  `check-website.py` ab, Liste `VERALTET`). Die App zahlt seit
  5.1.3 nur über `shell/ki-zahlung.ts`: Deklaration vor dem Versiegeln,
  Abrechnung mit den gemerkten Empfängern (`rechneAb()`, höchstens das Gebot),
  erst die Rechnung samt Betrag prüfen, dann zahlen – ein unklarer Ausgang wird
  nie von selbst wiederholt. Übrige Anteile nur über die Kasse
  (`anteile-kasse.ts`, `freedom.anteile` im Tresor). Adressen der Entwicklung
  nur in `ENTWICKLUNG` (leer bis MENSCH) – nie eine bei einem Verwahrer.
  Den Werber des Kunden nur aus dem Werbelink (`werbung.ts`, erster Werber
  bleibt, Adresse nur von ihm; die öffentliche Nennung 38052 zählt seit 5.1.4b
  nur noch – `zaehleNennungen()`, keine Stufen), Relay-Adressen nur über `RelayZahlziele`
  (NIP-11 `pubkey` → signiertes Profil), beim Senden nur schon Bekanntes.
  Einzige Ausnahme seit 4.5a: Der Knoten bringt **eigenes** Geld vom heißen
  Schlüssel an die eigene Adresse `NODE_SOL_PAYOUT` (`SolAuszahlung`, über
  der Schwelle, einmal je Abstand, Rücklage für Miete bleibt) – nie an andere,
  nie neben LP oder Relayer mit demselben `SOLANA_KEYPAIR` (deren Liquidität).
  Eine Provider-Adresse je Knoten (Entscheidung 4.5 A) – keine frischen
  Adressen je Sitzung einführen, ohne den Zahlkanal neu zu denken. Die App
  liest die Kanäle des eigenen Knotens (seit 4.5b, `verdienst.ts`) nur im
  geöffneten Earn-Tab (`zeigeSolEinnahmen()`), nie beim Start – die Abfrage
  nennt dem RPC-Anbieter die Adresse.
- **Kurse und Umrechnung nur über `kurs.ts`** (seit 4.4): Marktkurs mit
  `marktKurs()` (eine Stimme je Absender), msat ↔ Lamports mit
  `msatZuLamports()`/`lamportsZuMsat()` (BigInt). 1 SOL = 1e9 Lamports =
  Kurs · 1000 msat – bis 4.4 stand im Knoten eine Tausend zu viel im Nenner.
  Ohne Kurs keinen SOL-Preis erfinden. In der App zeigen Preise beide Einheiten
  über `preis-anzeige.ts` mit `aktuellerKurs()` (`shell/marktkurs.ts`).
- **Zahlkanal nur nach `docs/ZAHLKANAL.md`** (seit 4.3a): Client
  `channel.ts`, Programm `contracts/solana-channel` – beide folgen dem Dokument;
  ein anderes Format heißt neues Programm (Präfix `freedomstack-channel-v2`).
  Gutschriften tragen Kanal-Adresse und Ablauf (`gutschriftNachricht()`) und
  reisen nur im versiegelten Kern der Anfrage (`gutschriftTags()`); der Knoten
  nimmt sie nur über `KanalKasse.nimmAn()` an (Kanal auf der Kette, Deckung
  abgerechnet + Gebot) und löst sie nur über `loeseFaelligeEin()` ein – der
  Stand liegt in einer Datei, nie nur im Speicher. Kanäle nimmt der Knoten nur
  mit `ZAHLKANAL=1` und einem Schlüssel passend zu `NODE_SOL_ADDRESS`
  (`kanalKasseAusUmgebung()`); eine Gutschrift in einer offenen Anfrage wird
  abgelehnt. Die Programm-ID ist bis
  zum Deploy ein Platzhalter ohne Schlüssel (`KANAL_PROGRAMM_ID`) – nie einen
  erfundenen Schlüssel eintragen, das tut der MENSCH beim Deploy. Bauen und
  testen nur mit `contracts/solana-channel/pruefen.sh` (Agave 3.1.10,
  platform-tools v1.52; ältere scheitern an der Lock-Datei); die CI
  (`zahlkanal.yml`) tut dasselbe, Überspringen gilt dort als Fehler. In
  Validator-Tests Ed25519 deterministisch: dieselbe Gutschrift zweimal ist
  dieselbe Transaktion – mit eigenem Rechenlimit je Versuch unterscheiden.
  Auf Bestätigungen nur über `solangeValidator()` warten: Stirbt der
  Validator, wartet web3.js sonst endlos (`getBlockHeight` zählt als -1).
  Den Websocket am Ende mit `setAutoReconnect(false)` schließen – sonst
  verbindet er endlos neu, und der Job läuft bis zu seinem Limit.
  In der App (seit 4.3d1) nur über `KanalBuch` (`zahlkanal.ts`, Tresor
  `freedom.kanaele`, in `SICHERUNG_NIE`) und `kanalGutschrift()`/`kanalAntwort()`
  (`shell/ki-zahlung.ts`): Gutschrift statt Deklaration vor dem Versiegeln,
  gemerkt vor dem Senden; eine Kanal-Antwort zahlt Lightning nie (`perKanal()`
  aus dem Speicher, nicht aus dem Tresor). Deckt der Kanal nicht, geht nichts
  hinaus. Kanäle holt der Wächter als `kind: "kanal"` zurück. Geöffnet wird
  nur über `oeffneZahlkanal()` (`shell/zahlkanal-ui.ts`, seit 4.3d2): Angebot
  nennt diesen Kanal, Programm liegt auf der Kette, Tresor, dann merken, dann
  einzahlen; Empfänger nur über `kanalEmpfaenger()`.
- **HTLC-Transaktionen nur mit `htlcSigner()`** (`tabs/waehrung.ts`, seit 4.6c):
  Wallets nach dem Wallet Standard haben kein `publicKey`-Feld – `solWallet.provider`
  direkt als `WalletSigner` brach Einlösen, Deposit und Rückholen ab. Jede neue
  Sperre vor dem Anlegen mit `rememberLock()` merken, damit der Rückhol-Wächter sie kennt.
- **Kein `readBigInt64LE` & Co. in Code, der im Browser läuft:** Das
  Buffer-Polyfill kennt die BigInt-Methoden nicht – `DataView` nehmen
  (so scheiterte bis 4.6c jede Prüfung einer Sperre in der App, bis 4.6f die
  Selbstprüfung eines Relay-Auftrags). Das gilt auch für Protokoll-Code, den die App lädt.
- **`fetch` nie als Methode speichern** (`this.f = fetch; this.f(…)`): Im Browser
  wirft das „Illegal invocation“, Node merkt es nicht – so scheiterte bis 4.2b
  jede Abfrage des `RpcPool` in der App. Stattdessen `(i, o) => fetch(i, o)`.
- **Swap-Anfragen nur versiegelt** (seit 4.9b): über `hinAnfrage()`/`rueckAnfrage()`
  (`swap-umschlag.ts`) von einem Wegwerf-Schlüssel je Swap, Antworten nur über
  `swapAntworten()` – nie offen Kind 25001/25002 senden oder lesen, nie mit der
  eigenen Identität. LPs ohne `["versiegelt", "1"]` nicht anfragen.
- **Eingebaute Wallet hat mehrere Adressen** (seit 4.9c): Hauptadresse plus
  vergebene frische aus dem Vorrat. Guthaben über `eigeneAdressen()`, gezahlt
  von einer, die allein reicht (`waehleAbsender`) – nie zusammenlegen, das
  verbindet die Adressen auf der Kette. Einlösen nur mit dem Schlüssel der
  Empfangsadresse (`eingebauterHtlcSigner()` bzw. die verbundene Wallet).
- **SOL-Trinkgeld-Adresse nur versiegelt erfragen** (seit 4.9d): `frageAdresseAn()`
  bzw. die gemerkte Antwort (`trinkgeld-adresse.ts`); das Profilfeld `sol` nur
  nach Warnung. Antworten gibt die App nur Kontakten, mit einer Adresse je Kontakt.
- **Mesh nur verschlüsselt** (seit 7.1): Was über Funk, Bluetooth oder Datei
  geht, läuft durch `pruefeMeshInhalt()` – nur Umschläge (Kind 1059) und voll
  signierte Solana-Transaktionen, beim Senden mit `eigeneSchluessel` (die eigene
  DM-Kopie trägt den eigenen Schlüssel als Empfänger). Über Funk gilt die
  Sendezeit (`Sendezeitkonto`, 1 % je Stunde); Weiterreichen nur über die
  Warteschlange, nie `transport.send()` am Konto vorbei. KI über Funk (seit 7.4a)
  nur über ein Gateway: der Auftrag mit `kurzParam()` (höchstens 500 Zeichen,
  keine Zwischenstände – der Provider liest `leseKurzWunsch()`), das Gateway
  erfährt den Sitzungsschlüssel nur aus dem versiegelten Weiterleitungsauftrag
  (`baueWeiterleitung()`, Kind 25030) und funkt nur zurück, was
  `GatewayBuch.zurueck()` durchlässt. Fehlende Rahmen (seit 7.4b1) nur mit
  `baueNachforderung()` nachfordern (`Reassembler.faelligeNachforderungen()`)
  und nur aus dem `Sendegedaechtnis` nachsenden, über die Warteschlange
  (`MeshQueue.enqueueFrames()`) – beides begrenzt, weil es Sendezeit kostet.
  Das Gateway im Knoten (seit 7.4b2, `gateway-role.ts`, `FUNK_GATEWAY`) hat
  denselben Schlüssel wie der Provider: an ihn Versiegeltes ist nur dann eine
  Weiterleitung, wenn der Kern Kind 25030 ist – alles andere geht ins Netz.
  Zurück nur über `GatewayBuch` (Post ab dem Auftrag, `ab`) und die
  Warteschlange mit Sendezeitkonto; eine Antwort mit 500 Zeichen kostet rund
  15 s Sendezeit. Byte-Strecken zum Funkgerät (USB, Bluetooth, TCP-Brücke)
  seit 7.4c1 nur mit `mitLaenge()`/`LaengenRahmen` – zwei Byte Länge je
  Rahmen, sonst fließen Rahmen im Strom ineinander. In der App (seit 7.4c2)
  KI über Funk nur über `shell/ki-ueber-funk.ts`: Gateway nur aus einem
  Angebot mit `["funk","gateway"]`, gemerkt im Tresor (`freedom.funk.gateway`);
  bezahlt nur per Zahlkanal-Gutschrift zum gemerkten Kurs oder gratis – nie
  Lightning; Antworten aus dem Funk erst `nimmFunkAntwort()`, dann weiterverteilen.
  Gesendet wird (seit 7.4c3) nur die Frage, erst nach `funkGeraetVerbunden()` –
  sonst wäre eine Gutschrift gemerkt, die nie hinausgeht.
- **Keine fest verdrahteten Relays** (seit 5.4a): Die Startliste steht nur in
  `STARTRELAYS` (`protocol/src/relay-start.ts`, `startUrls()`); die App baut den
  Pool mit `poolRelays()` (eigener Satz + wechselnd weitere). Eigene Listen
  (Kind 10002/10050) nur über `eigeneListenAbgleichen()` – die veröffentlichte
  NIP-65-Liste gilt, nie neu würfeln, wenn zu wenige Relays antworteten.
  Direktnachrichten nur an den Posteingang des Empfängers (`veroeffentlicheAn()`).
  Was Kontakte selbst schreiben (Profil, Mandate, Vollmachten, Posteingang),
  seit 5.4b über `frageBeiAutoren()` lesen – auch an deren Schreib-Relays
  (`outboxPlan()`, fremde Relays nur mit Signaturprüfung).
  Den eigenen Satz ändert nur `setzeEigeneRelays()` (Settings, seit 5.4b2):
  erst beide Listen veröffentlichen, dann merken – nie localStorage allein.
  Im Browser-Test ersetzt Playwrights `route_web_socket` `window.WebSocket` –
  tote Relays mit einer Hülle per `Object.defineProperty` nachstellen.
- **SOL ohne Internet** (seit 7.2): nur über `zahleSolOffline()` (eingebaute
  Wallet, Tageslimit, `sol-offline-zahlung.ts`) – ein Nonce-Wert zahlt genau
  einmal und gilt danach als verbraucht, bis `frischeNonceAuf()` ihn mit Netz
  neu liest. Einreichen nur über `reicheSolOfflineEin()` nach
  `pruefeOfflineUeberweisung()`, mit Vorabsimulation.
- **Lokale Daten nur mit Präfix** (seit 8.14): Schlüssel in localStorage,
  sessionStorage und im Tresor beginnen mit `freedom.`, IndexedDB-Datenbanken
  mit `freedom` und stehen in `WIPE_DATENBANKEN` – sonst entgehen sie der
  Notfall-Löschung. Keine neue Speicherart (Cache Storage, OPFS, Cookies,
  Service Worker), ohne `loescheAllesLokal()` zu erweitern.
  `app/test/notfall.test.ts` prüft das.
- **Nachfolge nur versiegelt** (seit 8.11): Anteile gehen mit
  `baueAnteilUmschlag()` an je einen Vertrauten, Anfrage und Übergabe über
  `baueAnteilAnfrage()`/`baueAnteilUebergabe()` – nie als Datei, nie offen.
  Übergeben nur nach `darfUebergeben()`; gehaltene Anteile nur im Tresor
  (`freedom.nachfolge`), ohne Tresor nur im Speicher.
- **Zustandssicherung nur über die feste Liste** (seit 8.12): gesichert wird,
  was in `SICHERUNG_EINTRAEGE` steht (`waehleSicherung()`), zurück nur über
  `filtereWiederherstellung()`; nie Schlüssel, Zugänge, Geld-Geheimnisse,
  Anteile oder Gruppenschlüssel (`SICHERUNG_NIE`). Neue Einträge, die ein neues
  Gerät braucht, dort eintragen – und ob sie im Tresor liegen (`istGeheimnis()`).
- **Speicherknoten nur verschlüsselt** (seit 8.9a): Wer ins Blob-Netz lädt,
  was Knoten halten sollen, baut mit `buildBlob(…, { verschluesselt: true })`
  und lädt nur Chiffrat hoch; Knoten nehmen Stücke nur über `nimmAuf()` →
  `pruefeSpeicherStueck()` auf. Abruf nur versiegelt (`baueStueckAbruf()`); der
  Knoten veröffentlicht das Stück-Event erneut, statt es in den Umschlag zu
  packen (NIP-44 fasst 64 KB, ein Stück als Hex 128 KB).
- **Werkzeuge nur in den Grenzen** (seit 8.7): Ausführung nur über
  `ToolRegistry.run` (Eingabe-, Zeit-, Ausgabegrenze aus `WERKZEUG_GRENZEN`),
  Netz nur über `safeFetch` + `leseBegrenzt`. Private Adressen nur mit
  `isPrivateAddress()` aus dem Protokoll prüfen – `new URL` schreibt
  IPv4-in-IPv6 als Hex (`[::ffff:7f00:1]`), eine Suche nach Punkten übersieht das.
- **Schlüsselwechsel nur mit gemerktem Mandat** (seit 8.6a): Stand eines
  Kontakts nur über `pruefeKontakte()`/`resolveKey(…, { gemerkt })` – das
  zuerst gesehene Mandat gilt (`merkeMandate()`, Gedächtnis `freedom.mandate`
  im Tresor), nie das mit dem ältesten Zeitstempel allein. Mandate haben eine
  Adresse je Nachfolger (`rotation:<neu>`), damit ein Dieb sie nicht ersetzt.
- **Direktnachrichten an jedes Gerät** (seit 8.6b): Chat-Nachrichten mit
  `buildPrivateDm(…, { weitereEmpfaenger })` – Geräte des Kontakts und eigene
  aus `geraeteBuch.kopienFuer()`, zugestellt am Posteingang der Person. Beim
  Öffnen `auchFuer: geraeteBuch.alle(ich)` und danach `ordneDmZu()` – nie einem
  Geräteschlüssel ohne gültige Vollmacht die Person glauben. Der Zeitstempel
  eines entzogenen Geräts ist nur behauptet: „vorher geschrieben“ bleibt markiert.
- **Als Gerät spricht die App für die Person** (seit 8.6c): „wer bin ich“ im
  Chat über `sprichtFuer()`, nicht `state.keypair.pk` (das ist der
  Geräteschlüssel); `alsGeraet()` sperrt, was der Hauptidentität gehört
  (`nurHauptidentitaet()`). Die Person kommt nur aus dem Gerätecode
  (`freedom.geraet.person`), nie aus einer Vollmacht vom Relay.
- **Merkphrase nur bis zur Bestätigung und nur über `geheim`** (seit 8.1a):
  `LS_MERKPHRASE` (`freedom.merkphrase`) steht in `GEHEIM_FEST` und
  `SICHERUNG_NIE`; nach der Bestätigung `geheim.removeItem()`. Die Führung
  zeigt nur, was stimmt: keine erfundenen Zähler (Gratis-Tarif entscheidet der
  Provider), „Merkphrase anzeigen“ nur, wenn sie noch auf dem Gerät liegt.
- **Einrichtung setzt über die Bedienelemente der Settings** (seit 8.1b):
  `einrichtung-ui.ts` löst die Handler von `#net-mode` und `#kontakte-sichern`
  aus, statt localStorage selbst zu schreiben – sonst täten Einrichtung und
  Settings Verschiedenes. Öffentliche Verknüpfungen (Werbebeziehung) nur mit
  Zustimmung (`darfWerberNennen()`); Datenschutz-Sätze nur aus `PRIVACY_FACTS`.
- **LP nur mit eingeschränkter Macaroon und mit Ablage** (seit 8.3a): Der
  Knoten startet den LP nur nach `pruefeLpMacaroon()` (genau `invoices:*`,
  `offchain:*`, optional `info:read`). Hinrichtung: erst ablegen
  (`hinSpeicher`), dann sperren; nach der Frist zuerst die SOL zurückholen,
  dann die Hold-Invoice abbrechen – nie umgekehrt. Fristen aus `this.jetzt()`.
- **MLS-Baustein** (seit 2.2b-a, `packages/mls`): `dist/` nie von Hand ändern –
  nur mit `bash packages/mls/bauen.sh` (fester MDK-Stand, `mdk.patch`,
  `Cargo.lock`); die CI baut nach und vergleicht (`mls.yml`). Die Engine sieht
  den Identitätsschlüssel nie: `beweisBruecke()` signiert nur den
  Marmot-Kontobeweis (Kind 450), `signerBruecke()` nur Siegel (Kind 13) der
  eigenen Identität. Der Zustand (`zustand()`, Megabytes) nur verschlüsselt
  ablegen. Aufrufe eines Kontos nicht verschränken – ein zweiter während eines
  laufenden wird mit „MLS beschäftigt“ abgewiesen. In der App (seit 2.2b-b) nur
  über `mlsEngine()` (`mls-engine.ts`): lädt die eingebettete `.wasm.gz` erst
  bei Bedarf, nie beim Start – der Smoke-Test zählt das. `build.mjs` baut nur,
  wenn sie zu `packages/mls/dist/SHA256SUMS` passt. Zustand nur über
  `MlsZustand` (`mls-speicher.ts`, seit 2.2b-c1): eigene IndexedDB
  `freedom-mls`, AES-GCM, Schlüssel `freedom.mls.schluessel` in `geheim` – nie
  in den Tresor-Blob selbst (Megabytes) und nie in die Sicherung. Eigene
  KeyPackages nur über `veroeffentlicheKeyPackage()`: erst den Zustand sichern,
  dann senden – sonst kann der private Teil eines veröffentlichten KeyPackages
  verloren sein. Der Platz (d-Tag) ist zufällig und bleibt; fremde KeyPackages
  nur über `waehleKeyPackages()` (Form nach Marmot, je Platz das neueste).
  Über Nostr nur mit `mls-nostr.ts` (seit 2.2b-c2): Gruppennachrichten (445)
  nur an die Relays der Gruppe (`mls.routing()`, vor einem Commit festhalten),
  Einladungen nur an den Posteingang der Eingeladenen und erst, wenn der
  Commit angenommen ist (`aendereGruppe()`); nie `mls.senden()` & Co. direkt
  veröffentlichen. Nach `wartezeit` `schreiteFort()` rufen – die Engine hält
  Nachrichten nach einem Commit zurück. In Tests die Reihenfolge aus dem
  Senden nehmen, nicht aus `query()` (sortiert nach Sekunden).
  In der App nur über `shell/mls-konto.ts` (seit 2.2b-d1): `mlsKonto()` bindet
  Zustand und Verlauf an die Identität (eine andere verwirft beides samt
  Platz und KeyPackage – derselbe d-Tag verbände zwei Identitäten); gesperrt
  mit Bunker und ohne Tresor (`mlsGesperrt()`). Die Engine lädt nur bei Bedarf –
  `mlsErreichbar()` nur beim Öffnen einer 1:1-Unterhaltung, nie im Abgleich.
  Empfangene Nachrichten zuerst in den Verlauf (`merken`), dann den Zustand
  sichern: Eine MLS-Nachricht lässt sich nur einmal entschlüsseln. Die Kette
  in `oeffneUmschlag()` prüfen zwei Tests wörtlich – Neues daneben anhängen.
  Senden (seit 2.2b-d2): 1:1 über `sendeUeberMls()` → `mlsSendeAn()`; liefert
  es `gesendet: false`, geht die Nachricht per NIP-17 – der NIP-17-Pfad bleibt
  Rückfall (Kontakt oder ein Gerät ohne KeyPackage, Einladung nicht
  zustellbar, nicht Admin, mit Ablauf, Bunker, ohne Tresor) und wird nie
  entfernt. Eigene MLS-Nachrichten entschlüsselt MLS
  nicht zurück – sie gehen beim Senden in den Verlauf.
  Seit 2.2b-e1 nur mit Tresor (`mlsGesperrt()`); als Gerät ist das Konto der
  Geräteschlüssel, KeyPackage an die Schreib-Relays der Person
  (`schreibRelaysVon()`). Nur Admins laden ein und entfernen – 1:1-Gruppen mit
  `admins` gründen (alle Mitglieder), sonst kann der Kontakt nie Geräte aufnehmen.
  Geräte (seit 2.2b-e2): Mitglied sind beide Personen und ihre Geräte mit
  gültiger Vollmacht (`sollMitglieder()`, `mls-geraete.ts`); vor jedem Senden
  `gleicheAb()` – fehlende einladen, entzogene und fremde entfernen, sonst
  NIP-17. Mitglied ist nur, wer seine Einladung bekam (nicht zugestellt →
  wieder entfernen). Einladungen an Geräte an den Posteingang der Person; eine
  Einladung ist 1:1 nur über `partnerDerGruppe()` (Vollmachten der Person,
  nie der Einladende); MLS-Nachrichten im Chat über `ordneDmZu()`.
- **RPC-Anbieter nur mit Stichprobe vergleichen** (seit 5.8): `RpcPool.stichprobe()`
  – zwei Betreiber, Netz, Blockhash in beide Richtungen, ein Kontostand.
  Nie mehrere eigene Adressen in eine Stichprobe (4.9c); ohne Adresse, wo es
  nicht ums Guthaben geht. Ein eigener Devnet-Endpunkt in den Settings ergibt
  die Warnung „verschiedene Ketten“ – das ist richtig, der Pool mischt sonst
  Mainnet als Ausweichweg dazu.
- **Modellkataloge ohne Vorauswahl** (seit 5.7): Kataloge sind NIP-51-Sets
  (Kind 38080) über `baueModellKatalog()`/`leseModellKatalog()`; die App holt
  alle (`{kinds:[38080]}`, nie nach Kurator filtern – das verriete die Abos)
  und zeigt sie nur über `textContent`. Keine fest eingebaute Modell-Vorliebe
  im Dropdown – die Reihenfolge kommt aus den Abos (`katalogRangJetzt()`) und
  der Zahl der Provider.
- **Streitfall-Prüfer nur aus dem eigenen Netz** (seit 5.6): Prüfer über
  `netzPruefer()` (Kontakte, eigene Provider) – nie aus einer Rangliste; die
  Reklamation nennt ihn, und nur sein Urteil zählt (`resolveDispute()`).
  Frage und Antwort nur mit Zustimmung und nur über `materialFuerPruefer`.
  Das Urteil nur versiegelt (`buildPrivateUrteil()`), an Sitzungsschlüssel und
  Provider. Eigene Reklamationen tragen den Sitzungsschlüssel – nur im Tresor
  (`freedom.reklamationen`, in `SICHERUNG_NIE`). Prüfaufträge kommen über den
  Posteingang (`alsPruefauftrag()`); ihr Inhalt bleibt nur im Speicher.
- **`check-wiring.py --streng` scheitert auch an veralteten Ausnahmen** (5.6b):
  Wird ein ausgenommener Export verdrahtet, muss seine Zeile aus
  `scripts/wiring-ausnahmen.txt` raus – sonst meldet das Skript „veraltete
  Ausnahme“ und endet mit 1, obwohl die Zusammenfassung „0 offen“ sagt. Immer
  den Exit-Code prüfen, nicht nur die letzte Zeile.
- **Abdeckungskarte nur mit Wegwerfschlüssel** (seit 5.10a): Einträge über
  `baueCoverageEintrag()` (eigener Schlüssel je Eintrag, NIP-40-Ablauf), nie mit
  `signiere()`/der Identität; Widerruf nur über `baueCoverageWiderruf()`, der
  Schlüssel liegt nur im Tresor (`freedom.coverage.eintrag`). Die k-Schwelle
  schützt nur die Anzeige – Texte dürfen nichts anderes versprechen.
- **„IP verborgen“ nur geprüft** (seit 6.2): Die Aussage „ip“ im
  Datenschutzbericht kommt nur über `faktenDieserSitzung(onionPruefung())` –
  „verborgen“ nur, wenn `pruefeOnion()` ein .onion-Relay erreicht hat; der
  Status „geprueft“ steht nie in `PRIVACY_FACTS`. Die Prüfung läuft erst beim
  Öffnen des Berichts, nie beim Start, und nur gegen .onion-Adressen.
- **Räume als MLS-Gruppen** (seit 2.3a): Innere Events nur mit den Bausteinen
  aus `raum-gruppe.ts` über `sendenEvent()` bzw. `sendeEventInGruppe()`; den
  Raum nur über `gruppenRaum()` auswerten. Moderatoren sind die Admins der
  Gruppe (`adminsSetzen()`, ein Commit) – nie aus einem Event ableiten. Den
  Admin-Stand beim Senden (`admin`) belegt MDK nur für 4891/1985; sonst zählt
  `mls.admins()`. Der Verlauf nimmt alle Arten auf, der 1:1-Chat zeigt und zählt
  nur Art 9 (`mlsVerlauf`). Verweise auf Nachrichten (Antwort, Löschen) nur über
  die Id des inneren Events (`inneres`) – die MLS-Nachrichten-Id kennt der
  Absender nicht. Eine Gruppe mit Namen ist ein Raum, auch zu zweit – 1:1-Gruppen
  ohne Namen gründen (seit 2.3b). Private Räume stehen nur im Tresor
  (`freedom.raeume.privat`), nie in `freedom.spaces`; nach jeder Einladung den
  Raumstand erneut senden (`ladeInPrivatenRaum`). Die Crate nur mit
  `bauen.sh` neu bauen – vorher mit `--pruefen` zeigen, dass der alte Stand
  bitgleich entsteht (Rust, `wasm-bindgen` 0.2.129).
- **Moderation privater Räume nur in der Gruppe** (seit 2.3c/8.5): löschen über
  `loescheImRaum()` (4891 als Moderator, sonst 5), entfernen über
  `entferneAusRaum()` (Commit) – nie `buildHide`/`buildBan` oder andere offene
  Events für private Räume. Meldungen nur über `meldeImRaum()` →
  `baueRaumMeldung()`: je Moderator ein Umschlag an seinen Posteingang, nie in
  die Gruppe (sonst erführen es alle Mitglieder). Beim Moderator bleiben sie nur
  im Speicher (`alsRaumMeldung()`, am Ende der Kette in `oeffneUmschlag()`).
- **Relay-Rolle nur nach den Regeln aus `relay-zugang.ts`** (seit 8.4a):
  annehmen über `relayNimmtAn()` (beschränkt: vom oder an einen Schlüssel mit
  Zugang), ausliefern über `darfAusliefern()` – Umschläge (1059) nur an den
  per NIP-42 angemeldeten Empfänger, Anmeldung nur über `pruefeRelayAuth()`.
  Der Relay schickt beim Verbinden `["AUTH", challenge]` – Test-Clients, die
  Antworten zählen, überspringen sie. Abos gehören zur Verbindung (gleiche
  Ids zweier Clients überschrieben sich bis 8.4a). Zugang nur über
  `RelayKasse` (seit 8.4b): bezahlt heißt, der eigene LND meldet die Rechnung
  beglichen bzw. die Kette zeigt die Überweisung mit der Referenz des Angebots
  (`pruefeSolUeberweisung(…, { referenz })`); eine Signatur löst nur ein
  Angebot ein; nach außen nur `KasseFehler`-Texte. In der App (seit 8.4c)
  Relay-Verbindungen nur über `relayVerbindung()` (`shell/state.ts`): anmelden
  nur auf Verlangen und nur, wo `darfAnmelden()` es erlaubt (eigene Relays,
  gekaufter Zugang), über `signiere()` – nie mit einem Sitzungsschlüssel. Kauf
  nur über `kaufeRelayZugang()` (Angebot geprüft und gemerkt, bevor gezahlt wird).
- **Browser-Tests mit eigenen TLS-Hosts:** HTTPS und WSS laufen in dieser
  Umgebung über den Agent-Proxy, auch mit `--no-proxy-server`. Eigene Hosts nur mit
  `launch(proxy={"server": HTTPS_PROXY, "bypass": "relay.test,app.test"})` plus
  `--host-resolver-rules=MAP relay.test 127.0.0.1`; mit gesetztem Proxy schickt
  Playwright auch 127.0.0.1 über den Proxy (405) – die App dann unter `app.test`
  ausliefern. `pkill -f` nie mit einem Muster, das im eigenen Befehl steht.
- **Verkehrsmuster** (seit 6.4): Direktnachrichten (NIP-17) nur über
  `versendeVerzoegert()` (`shell/versand.ts`) – jede Kopie einzeln, nie alle
  im selben Augenblick (Regel „kopien-entkoppelt“); was wartet, steht als
  „wird gesendet“ im Verlauf (`unterwegs`) und geht beim Verlassen der Seite
  sofort hinaus. Periodische Abrufe nur über `abrufTakt.melde()` (Zufall im
  Abstand, gebündelt), kein neues `setInterval` fürs Netz. Zufall für
  Datenschutz nur aus `sichererZufall()`, nie `Math.random`.
- **Platzhalter für Konten** (seit 5.3a): Werte, die der MENSCH einträgt
  (`docs/KONTEN.md`), beginnen mit `PLATZHALTER:` und gelten über
  `istPlatzhalter()` als nicht gesetzt – nie einen erfundenen oder
  „Beispiel“-Wert einsetzen. Der Hosting-Anteil kommt nur aus
  `freedom-spiegel.json` neben freedom.html (`hostingZahlziel()`, eigene
  Herkunft), Quellen nur aus `spiegel/quellen.json` (`leseQuellen()`);
  `protocol/test/spiegel.test.ts` prüft, dass jedes Feld dort Platzhalter oder
  gültig ist.
- **Spiegel nur beim Release und nur geprüft** (seit 5.3b): Uploads nur im
  Job `spiegel` (`pages.yml`, Run workflow → „spiegeln“), nie bei jedem Push –
  Uploads kosten Guthaben. Secrets nur in diesem Schritt, Meldungen der
  Dienste nie ausgeben (nur Status). IPFS nur mit selbst gerechnetem CID
  (`ipfsCid()`, gleich `ipfs add --cid-version=1`); `publish-release.mjs`
  übernimmt ein Ergebnis nur bei gleicher Prüfsumme (`quellenAusErgebnis()`).
  Blossom (seit 5.3c) nur mit eigenem Spiegel-Schlüssel und einer Anmeldung je
  Datei (`blossomAuth()`), übernommen nur über `blossomQuelle()`; das
  Codeberg-Token nur in der Umgebung von git (`GIT_CONFIG_*`), nie auf der
  Befehlszeile. `check-wiring.py` zählt seit 5.3b auch `.mts`-Skripte.
- **Texte nur über Schlüssel** (seit 8.16a): Sichtbare Texte stehen in
  `app/src/texte/<bereich>.ts` mit `de` und `en` (beide Pflicht), im HTML über
  `data-i18n` (`-ph`, `-title`, `-aria`), im Code über `t("schlüssel", { wert })`.
  Nur Deutsch und Englisch. `app/test/i18n.test.ts` findet rohen Text in
  `index.html` und in jeder Datei des Codes – seit 8.16g2a streng: überall 0,
  auch in neuen Dateien (keine Tabelle offener Stellen mehr). Was Daten
  sind (gesendet oder gespeichert, z. B. Kanalnamen eines Raums), trägt am
  Zeilenende `// kein UI-Text`. Zahlen und Daten mit `gebietsschema()`, nie
  fest `"de-DE"`. Der Smoke-Test läuft mit `locale="de-DE"`.
  Fertige Sätze aus dem Protokoll (`note`, `DISPUTE_LABEL`, Kurswarnungen …)
  sind Deutsch – die App bildet sie aus den Feldern neu (seit 8.16e, gesammelt
  in `protokoll-texte.ts`; ein Test hält die deutsche Fassung wortgleich). Gründe
  aus Prüfungen tragen dafür seit 8.16g2b3a eine Kennung `fall` (samt Zahlen) neben
  `grund` – ein neuer Fall braucht Kennung und Text (`pg.*`); der Test liest die
  Fälle aus dem Quelltext des Protokolls. Fehler, die Nutzer sehen können,
  wirft das Protokoll seit 8.16i als `ProtokollFehler(kennung, meldung, werte)`
  (Meldung deutsch wie bisher); die App zeigt Fehler nur über `fehlerText(e)`,
  nie `(e as Error).message` – ein Test findet das. Neue Kennung → Text `pf.*`
  und Eintrag in `FEHLER` (`protokoll-texte.ts`). In Tests
  ist die Sprache Englisch; wer Meldungen wörtlich auf Deutsch prüft, setzt
  `setLang("de")`. Kennungen, die der Code vergleicht (z. B. Ergebnis einer
  Einladung), bleiben Daten – übersetzt wird erst die Anzeige
  (`einladungsText()`); nie an einem deutschen Text erkennen, was geschah
  (`BrowserKannNicht` statt `startsWith("Dieser Browser")`). Die Sprache setzt
  `boot()` vor allem anderen – der Entsperr-Dialog kommt vor `starte()`.
- **Navigation nur über `switchTab()` und `shell/navigation.ts`** (seit C.1a):
  Die Adresse nennt nur die Seite (`#/chat`, `#/agent/verlauf`), nie eine
  Kennung (Kontakt, Raum, Repo, Patch) – auch nicht in `history.state`: Den
  Browserverlauf leert die Notfall-Löschung nicht. Neue Seiten in `SEITEN`
  eintragen und mit `data-tab`-Knopf und `#page-<name>`; mobil nichts nur
  ausblenden, ohne einen anderen Weg zu bieten – der Smoke-Test („rahmen“)
  prüft die Erreichbarkeit auf Desktop und Handy. `#app` ist ab 1024 px ein
  Raster: neue Kinder von `#app` brauchen dort eine Zelle (sonst verdrängen sie
  `main`, so war es bis C.1a mit der Onboarding-Leiste).
- **Dialoge nur über `shell/dialog.ts`** (seit C.2b1): `dialog()`,
  `bestaetige()`, `hinweis()` statt `prompt()`/`confirm()`/`alert()` – nur DOM
  mit `textContent`, Fokus bleibt drin, Esc bricht ab. Die Räume haben keinen
  Browser-Dialog mehr (`dialog.test.ts`); andere Bereiche ziehen nach, wenn sie
  dran sind. Klassenlisten als Argument (`el("div", undefined, "modal dlg-box")`)
  brauchen einen Namen mit Bindestrich, sonst hält der Rohtext-Test sie für Text.
- **Räume im Browser-Test nur mit der Relay-Attrappe** (seit C.2b2):
  `ProbeRelay` (`scripts/smoke_test.py`) beantwortet jede REQ aus dem
  Probe-Raum, den `scripts/raum-probe.mts` mit Wegwerfschlüsseln signiert –
  nie echte Relays, nie echte Schlüssel. Den eigenen Schlüssel liest die
  Attrappe aus der Abfrage der eigenen Relay-Listen (Kind 10002, ein Autor);
  die App zeigt ihn nirgends ganz. Der Raum erscheint erst im Raum-Modus
  (`setzeKommModus("space")`), mobil nur mit `.showing-channel`.
- **Ruf nur aus Quittungen** (seit 5.5a, `quittung.ts`): Eine Quittung gibt es
  nur mit Nachweis nach 4.8 – Lightning: Rechnung + Preimage
  (`lightningQuittung()`, „belegt“ nur beim angekündigten Knoten), Zahlkanal:
  Preis + deckende Gutschrift (`kanalQuittung()`, „belegt“ erst über
  `kanalBelegt()` mit der Auszahlung auf der Kette). Quittungen nur im Tresor,
  nie auf ein Relay. Rang und Stufe nur aus `berechneRuf()` (eigene Quittungen,
  Zusammenfassungen von Kontakten) – 38010 und andere Selbstauskünfte zählen
  nicht. Die Zusammenfassung (38075) nur versiegelt über
  `baueRufUmschlaege()`, gelesen nur von Kontakten (`oeffneRufUmschlag()`).
  In der App (seit 5.5b) nur über `shell/quittungen.ts`: Quittungsbuch
  `freedom.quittungen` in `geheim` (in `SICHERUNG_NIE`), angelegt in
  `handleAnswer()` – je Stelle ein Aufruf; Provider-Auswahl nur mit
  `discoverProviders(pool, aktuellerRuf())`. 38010 nie für Rang, Stufe oder
  Relay-Gewicht abfragen. Ungeprüfte Provider bleiben wählbar, stehen aber
  hinten; die Vertrauensschwelle gilt nur bei bestätigten Reklamationen – sonst
  stünde ein einmal bezahlter hinter einem unbekannten. Zusammenfassungen
  (seit 5.5c) nur über `RufVersand` (`ruf-teilen.ts`, `shell/ruf.ts`): nur mit
  Zustimmung (`freedom.ruf.teilen`), je Schlag des Abruftakts höchstens ein
  Umschlag, an den Posteingang des Kontakts, als Gerät nie; empfangen nur über
  `alsRufZusammenfassung()` am Ende der Kette in `oeffneUmschlag()`, gemerkt in
  `freedom.ruf.kontakte` (Tresor, `SICHERUNG_NIE`). Die Status-Seite der
  Website (seit 8.15) wertet nur über `website/js/dashboard-daten.js` aus:
  Angebote nach Erneuerung, Kataloge, Abdeckung über der Schwelle,
  Nennungen als Summe – nie 38010, nie 38075, keine Rangliste
  (`check-website.py` prüft das).
  Nie eine öffentliche Rangliste; die Prüferwahl (`netzPruefer()`) bleibt ohne Ruf.
- **Provider-Einrichtung nur geprüft** (seit 8.2a): Was ein Provider zum
  Verdienen braucht, prüft `pruefeEinrichtung()` (`node/src/einrichtung.ts`) –
  beim Start ins Log (`[einrichtung]`) und über `npm run pruefen` (Installer,
  Docker). Neue Voraussetzungen dort ergänzen, nicht nur im Installer; nach
  außen nur eigene Texte und Fehlernamen. Im Installer Eingaben nur als
  Argumente an `node` geben, nie in den Code einsetzen; Schlüsseldateien mit
  `umask 077` anlegen. Leere Werte aus der Umgebungsdatei (`SOLANA_RPC_URL=`)
  mit `||` behandeln, nicht mit `??`.
  Eigener Lightning-Empfang (seit 8.2b) nur über `LnurlDienst`
  (`lnurl-server.ts`): LND nur mit einer Macaroon für Rechnungen
  (`pruefeRelayMacaroon()`), Rechnung mit `createLnurlInvoice()` (Hash der
  Metadaten, LUD-06), Beträge nur als ganze msat im Bereich, Bremse je Minute,
  nach außen feste Texte. Kein Backend bei einem verwahrenden Dienst (Blink fiel
  mit 8.2b).
  Tor (seit 8.2c): Relay-Verbindungen des Knotens entstehen nur an einer Stelle
  (`main.ts`, `new WebSocketRelay(url, { verbinde })` mit `torWebSocket()`) – keine
  weitere ohne `verbinde`, ein Test zählt das. SOCKS5 nur mit Namen
  (Adresstyp 3), nie lokal auflösen; ungültiges `TOR_SOCKS` → kein Start.
- **Git-Bundles nur über `leseBundle()`** (seit C.3c1, `git-bundle.ts`): ohne
  neue Abhängigkeit (`DecompressionStream`, `crypto.subtle`), Grenzen aus
  `BUNDLE_GRENZEN`, Prüfsumme des Packs und jede Kennung nachgerechnet, Fehler
  nur als `BundleFehler`-Kennung (nie Text aus dem Bundle). Geladen nur auf
  Knopfdruck über `holeBundle()`, gelesen nur im Speicher, gezeigt nur als
  Text. Packfiles nennen die gepackte Länge nicht: das Ende über die
  Adler-32-Summe suchen und bis dort noch einmal sauber entpacken –
  `DecompressionStream` meldet Daten nach dem Ende als Fehler, liefert den
  Inhalt aber vorher. `crypto.subtle` gibt es nur in sicheren Kontexten
  (https, localhost) – Browser-Tests nie auf `about:blank`.
- **QR-Codes nur über `shell/qr-ui.ts`** (seit 11.1b): erzeugt mit `qrCode()`
  (`protocol/src/qr.ts`, 11.1a, Bit für Bit gegen python-qrcode – die Referenz
  nur mit `scripts/qr-referenz.py` neu erzeugen), gezeigt nur als SVG über
  `setAttribute` (`qrSvg()`), in Dialogen als Feld `art: "qr"`. Was einen
  Schlüssel trägt (Gerätecode), nur mit `geheim: true`: auf Klick, Warnung
  vorher, nach `QR_SICHTBAR_MS` weg, nie speichern, nie als Bild exportieren;
  den Schlüssel vor dem Zeigen nullen. Kamera nur auf Klick über `scanKnopf()`
  (Feld `scannen: true`), erkannt nur vom Browser (`BarcodeDetector`), danach
  aus; ohne Erkennung der Hinweis zum Einfügen. Der Smoke-Test („qr“) ersetzt
  Kamera und Erkennung durch Attrappen (Canvas-Strom, `BarcodeDetector`).
- **Reproduzierbarer Build** (seit 5.9a): `freedom.html` muss aus einem
  frischen Checkout bitgleich entstehen – in `build.mjs` nichts Zeit-, Pfad-
  oder Zufallsabhängiges (kein `Date.now()`, keine absoluten Pfade im Bundle).
  Die CI baut zweimal an zwei Pfaden (`repro-build.sh --pruefen`), `pages.yml`
  veröffentlicht nur, was ein frischer Build bitgleich ergibt. Die
  Node-Hauptversion nur über `.nvmrc` ändern (CI und Pages lesen sie).
- **Nebenläufiges im Test nie mit fester Pause abwarten** (seit 5.9a): Was der
  Knoten „best effort“ ohne `await` sendet (Rückmeldungen, 7000), kommt unter
  Last später – bis es da ist warten, mit Frist (`funk-kurz.test.ts`, von
  Spur A und B unabhängig gefunden, gilt die Fassung aus 11.1b). Eine feste
  Pause von 20 ms war im vollen Lauf gelegentlich zu kurz.
- **Repository per NIP-34 nur aus dem Release-Job** (seit 5.9b): Die
  Ankündigung des Projekt-Repositorys (Kind 30617) baut nur `projektRepo()`
  (Klon-Adressen nur GitHub und die gesetzte Radicle-Kennung aus
  `spiegel/quellen.json`), signiert mit dem Spiegel-Schlüssel im Job
  „spiegel“ (`repo-ankuendigung.mts`, ganzer Verlauf für den ersten Commit).
  Upgrade-Rechte der Programme ändert nur der MENSCH nach
  `docs/SOLANA-UPGRADE-AUTHORITY.md`.
- **Lightning-Adresse und Zaps privat** (seit 6.3a): Das Profil geht nur über
  `oeffentlichesProfil(entwurf, { lightning: lnOeffentlich(localStorage) })`
  hinaus (`tabs/profil.ts`) – die Lightning-Adresse nur mit Häkchen
  (`freedom.profil.lnOeffentlich`; vor 6.3 gespeicherte gelten einmalig als
  veröffentlicht). Zap-Anfragen (9734) nur über `baueZapAnfrage()` →
  `buildAnonZapRequest()` (Wegwerf-Schlüssel je Zap, „anon“), nie mit
  `signiere()`: Der Server des Empfängers veröffentlicht sie in der Quittung.
  Leak-Regeln `keine-ln-adresse` und `zap-anonym`. Ohne öffentliche Adresse
  (seit 6.3b1) Rechnungen nur versiegelt erfragen: `frageRechnungAn()` bzw.
  `beantworteRechnungsAnfrage()` (`ln-rechnung-anfrage.ts`, Kind 25022/25023)
  – nur Kontakte, frisch, `RechnungsBremse`, Rechnung nur aus der eigenen
  Wallet (`eigeneRechnung()` in `shell/zahlschienen.ts`); der Zahler nimmt nur
  genau den Betrag (`oeffneRechnungsAntwort()`). Die Wallet-Verbindung (NWC)
  baut ihren Pool nur aus `waehleNwcRelays()` (seit 6.3b2, Einstellung
  `freedom.nwc.nurPrivat`/`.eigenesRelay`) – nie aus `conn.relays` direkt.
  BOLT12 wird nur erkannt (`bolt12Methoden()`), nicht genutzt, bis NIP-47 die
  Methoden festlegt.
