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
| `packages/app` | Web-App; `src/shell/app.ts` (Einstieg: `boot()`, `switchTab()`, Identität, Onboarding), `state.ts` (Zustand, Pools), `ui.ts` (Hilfsfunktionen), `datenschutz.ts` (Bericht), `tresor.ts` (Tresor-Dialoge; Krypto in `src/vault.ts`), `bunker.ts` (Anmelden per NIP-46), `tabs/` (je Tab ein Modul: `kommunikation.ts` + `chat-anhaenge.ts` + `kontakte.ts` + `posteingang.ts` + `raeume.ts`, `agent.ts` + `modellwahl.ts` + `agent-verlauf.ts` + `agent-wege.ts` + `agent-anzeige.ts` + `agent-eingabe.ts` + `agent-netz.ts`, `waehrung.ts` + `tausch.ts` + `hinterlegen.ts`, `earn.ts`, `profil.ts`, `settings.ts` + `sicherung.ts` + `mesh.ts`); Build → `dist/freedom.html` |
| `packages/website` | Startseite, Whitepaper, FAQ, Roadmap, Dashboard |
| `packages/launcher` | Hülle (Tauri 2): Desktop seit 6.1a1, Android seit 6.1c1 (`src/lib.rs`); legt `freedom.html` bei, liefert sie über `freedom://localhost/` (Windows, Android `http://freedom.localhost/`); Tests `cargo test` |
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
python3 scripts/smoke_test.py packages/app/dist         # braucht playwright + chromium; seit C-18 auch in der CI
bash scripts/build-site.sh /tmp/site                     # Website bauen (Ziel wird gelöscht!)
bash scripts/repro-build.sh --pruefen                    # reproduzierbar? zwei frische Builds, eine Summe (~2 min)
bash packages/mls/bauen.sh --pruefen                     # nur bei Änderungen an packages/mls: nachbauen + vergleichen (Rust, clang)
bash contracts/solana-channel/pruefen.sh --werkzeuge     # nur bei Änderungen am Zahlkanal: bauen + Tests gegen Validator (Agave 3.1.10)
cd packages/launcher && cargo test --locked && cd ../..  # nur bei Änderungen an der Hülle (Linux: WebKitGTK 4.1, App vorher bauen)
```

Stand 08.10.2026 (nach 8.2c, 5.5a–c, 8.15, 11.1a, C.3c2, 11.1b, 5.9a–b, 6.3a–b2, 11.4a–b2, C.4a–b, C.5a–b, C.6b, 11.4c, C-18, C-17a–c, C-20a–j3, C-1a–f, C-2, C-3, C-4, C-5a–d, C-6a–e, C-7a–b, C-8, C-10 bis C-16, 11.2a–b, A-4 bis A-7, A-7r, Z1, 12.1–12.3, E8, P1a–b, P2a, E10a, E11, E9-Entwurf, 12.4a, P2b1–b2, P3a–b, P4, P5a–b, P5c1–c2, D1a, D1b1–b2, D1c, D2, D3-Entwurf, 12.6, 12.7a–c, 12.1 C, C-21, C-22a, C-22c, C-24, C-25, 6.1a1–a2, 6.1a3a–c, 6.1a4a, 6.1b1a–b, 6.1b2a–b, 6.1b3, 6.1c1, B-1, B-2a–c, B-3 bis B-7, B-8a–c, B-9a, B-15, B-19, B-20a–c, B-10a–b, B-9b1–b2, B-9c1–c3, B-11a–c, B-12a–d, B-13a–e, B-21, B-17a, B-17b1, B-17b2, B-17b3a, B-17b3b und 7.5a–d, B-22): protocol 1227 grün (6 übersprungen), node 317 grün
(6 übersprungen, mit Internet – ohne Netz überspringen sich zusätzlich Live-Tests
in `tools.test.ts`), app 959 grün, mls 13 grün, Zahlkanal 7 grün (gegen Validator), Leak-Tests 73 grün + 1 `todo` (heutige Lecks,
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
  die MLS-Engine; `worker-src blob: 'self'` seit B-12c (W3 A) nur für den Weck-Worker
  `freedom-sw.js`; weiteres WASM oder andere Lockerungen → vorher fragen.
- **Fremddaten nie ungeprüft in `innerHTML`:** `escapeHtml()` für Text,
  `ganzeZahl()` für Zahlen, sonst `textContent`. `scripts/check_innerhtml.py` prüft
  jede HTML-Zuweisung streng (CI und `pages.yml`); neue sichere Stellen mit Begründung
  in `scripts/innerhtml-ausnahmen.txt`, eine Zeile je Stelle – nie für Fremddaten.
  `pkShort()` maskiert nicht: im HTML immer `escapeHtml(pkShort(…))`.
  Listen und Zeilen mit Fremddaten seit C-6a als DOM über `el()` (`shell/ui.ts`) –
  eine Datei ohne `innerHTML` bleibt so (`FERTIG` in `dom-statt-html.test.ts`).
  Anhänge im Chat nur über `anhangAnsicht()` (Beschreibung, seit C-6c) und daraus
  Elemente mit Eigenschaften und `dataset` – nie wieder als HTML-Text.
  Antworten des Agenten (seit C-6d2) nur über `antwortDom()` – `markdownDom()` plus
  Code-Blöcke, gefärbt über `codeTeile()` (ohne DOM, mit Zeilengrenze).
  Seit C-6e ist `scripts/innerhtml-ausnahmen.txt` leer – eine neue Ausnahme braucht
  einen guten Grund; eigene SVG-Zeichen über `svgEl()` (`ui.ts`), nie als HTML-Text.
  Klassenlisten aus zwei Wörtern ohne Bindestrich (`"bubble ai"`) hält der
  Rohtext-Test für Text: die zweite Klasse über `classList.add()`.
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
  94 / 2 / 0,5 / 1,5 / 0,5 / 0,5 / 1 (Provider, Entwicklung, Prüfbudget seit P5b,
  Relays, Werber beider Seiten, Hosting – CI-Invariante, ändern nur mit signiertem
  Release); nicht Zuordenbares und Rundungsreste an den Provider, nie an die
  Entwicklung. Das Prüfbudget (`pruefung`) hat keinen Empfänger: Die App behält
  es (`pruefbudgetMsat` aus `teileAuf()`, gezählt nur über `PruefBudget`,
  `freedom.pruefbudget` in `geheim`). Entwicklung und Prüfbudget deklariert sie
  nur Knoten, deren Angebot die Fassung `["aufteilung", "2"]` nennt
  (`AUFTEILUNG_FASSUNG`, `Empfaenger.fassung`) – ältere lehnen unbekannte Anteile
  ab; im Zahlkanal bleibt das Prüfbudget bis P5d beim Provider; App (`teileAuf()`) und Knoten (`pruefeAufteilung()`,
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
  über `preis-anzeige.ts` mit `aktuellerKurs()` (`shell/marktkurs.ts`). Welche
  zuerst steht, bestimmt seit 12.1 nur `anzeigeEinheit()` (`standard-schiene.ts`:
  eigene Wahl `freedom.anzeigeEinheit`, sonst SOL bei SOL als Standard-Schiene,
  sonst jeder Betrag in seiner Einheit); Umgerechnetes trägt immer „≈“, der
  genaue Betrag steht dabei. Gewählt wird sie (seit 12.1 C) nur über
  `#anzeige-einheit` in Währung › Zahlen – „automatisch“ entfernt die Wahl.
  Einnahmen (seit C-2) in der Einheit ihrer Kette über `einnahmeText()` – das
  Leistungs-Event nennt nur msat, SOL also nur „≈“ mit dem Kurs von jetzt.
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
  hinaus. Kanäle holt der Wächter als `kind: "kanal"` zurück – seit Z1 ohne
  Unterschrift des Kunden (`refund` darf jeder, das Geld geht nur an den Kunden
  aus dem Kanal; Empfänger immer aus der Kette, nie die Wallet). Geöffnet wird
  nur über `oeffneZahlkanal()` (`shell/zahlkanal-ui.ts`, seit 4.3d2): Angebot
  nennt diesen Kanal, Programm liegt auf der Kette, Tresor, dann merken, dann
  einzahlen; Empfänger nur über `kanalEmpfaenger()`. Aufstocken (seit E8) nur
  über `stockeKanalAuf()`: nur mit der Wallet des Kunden und nach Rückfrage;
  die Einlage im Buch wächst erst nach der Bestätigung auf der Kette
  (`KanalBuch.aufgestockt()`). „Fast leer“ meldet die Gutschrift (`knapp`,
  `KANAL_KNAPP_ANFRAGEN`), einmal je Kanal und Sitzung. Mit SOL als
  Standard-Schiene zahlt KI seit 12.4a nur über einen Kanal (`kiZahlweg()`):
  `pruefeKiZahlweg()` vor der Gutschrift, Ziele über `zieleNachSchiene()` –
  ohne Kanal geht nichts hinaus, nie still über Lightning.
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
  Warteschlange mit Sendezeitkonto; eine Antwort mit 500 Zeichen kostet mit
  Meshtastic LongFast rund 30 s Sendezeit (16 Rahmen, seit 7.5d gerechnet) – etwa
  eine je Stunde. Byte-Strecken zum Funkgerät (USB, Bluetooth, TCP-Brücke)
  seit 7.4c1 nur mit `mitLaenge()`/`LaengenRahmen` – zwei Byte Länge je
  Rahmen, sonst fließen Rahmen im Strom ineinander. In der App (seit 7.4c2)
  KI über Funk nur über `shell/ki-ueber-funk.ts`: Gateway nur aus einem
  Angebot mit `["funk","gateway"]`, gemerkt im Tresor (`freedom.funk.gateway`);
  bezahlt nur per Zahlkanal-Gutschrift zum gemerkten Kurs oder gratis – nie
  Lightning; Antworten aus dem Funk erst `nimmFunkAntwort()`, dann weiterverteilen.
  Gesendet wird (seit 7.4c3) nur die Frage, erst nach `funkGeraetVerbunden()` –
  sonst wäre eine Gutschrift gemerkt, die nie hinausgeht.
  Offene Mesh-Pakete und Kurier-Belege (38030/38031, `mesh.ts`) fielen mit B-21 –
  die Kinds nicht wiederverwenden.
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
  Der Relay-Stand in der Navigation kommt seit C-16 nur aus `WebSocketRelay.verbunden`
  (nur lesend, offene Leitung) – nie die Zahl im Pool als „verbunden“ ausgeben; eine
  Verbindung entsteht erst beim ersten Gebrauch.
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
  `app/test/notfall.test.ts` prüft das. Service Worker und Push-Abos meldet die
  Löschung seit B-12d1 über `weckerAbmelden()` (`wecker-abmelden.ts`) ab – vor
  `loescheAllesLokal()` und im zweiten Durchgang; was nicht ging, steht im Ergebnis.
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
  Geschrieben wird seit B-5 nur zusammengeführt (`fuehreZusammen()`,
  `zustand-zusammenfuehren.ts`), erst nach `bestaetige()`: Ein neuer Eintrag,
  der eine Sammlung ist (Liste, Karte je Kontakt), braucht dort eine Regel –
  sonst gilt der eingelesene Wert, und was nur auf dem Gerät stand, ist weg.
  Die Regeln mischen Objekte (je Schlüssel) und Listen von Einträgen – eine
  Karte als Liste von Paaren (`JSON.stringify([...map])`) mischt keine Regel;
  so ging bis C-14 der Lesestand verloren (`lesestand.ts`).
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
  Ausnahme seit B-17b3b (K1/K4 A): ein Mandat mit GEPRÜFTEM Bitcoin-Anker
  (`merkeMandate(…, anker)`, Zeit aus `pruefeVerankerung()`) schlägt jedes
  unverankerte und löst ein gemerktes nur ab, wenn es mehr als
  `ANKER_SPIELRAUM_SEK` früher liegt als dessen Anker bzw. „gesehen“. Geholt und
  geprüft wird nur bei Streit (`ankerFuerStreit()`: ein alter Schlüssel, mehrere
  Nachfolger) – nie für alle Kontakte; eine bloße Höhe aus einem 1040 zählt nie.
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
  Auch mit privaten Räumen nie beim Start (seit C-11): der Start öffnet nur einen
  offenen Raum vor, private öffnen beim Antippen; Repos privater Räume erst mit
  `ladeNip34Repos({ privat: true })` (Seite Repos, privater Raum). Der Smoke-Test
  („mls_start“) zählt das mit Tresor und gemerktem privatem Raum.
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
  Verlängern (seit E11 B) nur auf Klick über denselben Kauf mit Rückfrage und
  derselben Schiene (`schieneZumVerlaengern()`); erinnert wird über
  `zuErinnern()` nur aus dem Gemerkten, einmal am Tag – nie automatisch zahlen
  (ein Abo über den Zahlkanal erst nach dem Devnet-Deploy, E11 A).
  Der Knoten liest und schreibt im eigenen Relay (seit B-9c1, L5 A) nur über
  `RelayRole.alsRelay()` – im Prozess, als mit seinem Schlüssel angemeldet,
  geschrieben über `aufnehmen()` wie über das Netz; `main.ts` ersetzt damit eine
  Verbindung zu sich selbst aus `RELAYS`. Keine zweite Annahme-Logik daneben.
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
  dran sind (Sammlung C-1). Seit C-1f gibt es keine mehr: `NOCH_OFFEN`
  (`browser-dialoge.test.ts`) ist leer, eine neue Stelle macht den Test rot. Beträge aus Eingabefeldern über `ganzeSats()`,
  nicht `Number()` (`"1e3"` wäre still 1000); öffentliche Schlüssel über
  `schluesselAusEingabe()` (npub, `nostr:`, Hex). Sätze des Protokolls, die für
  `alert()` hart umbrochen sind, im Dialog über `fliesstext()` – nie den Satz
  selbst ändern (ein Test hält ihn wortgleich). Klassenlisten als Argument (`el("div", undefined, "modal dlg-box")`)
  brauchen einen Namen mit Bindestrich, sonst hält der Rohtext-Test sie für Text.
- **Räume im Browser-Test nur mit der Relay-Attrappe** (seit C.2b2):
  `ProbeRelay` (`scripts/smoke_test.py`) beantwortet jede REQ aus dem
  Probe-Raum, den `scripts/raum-probe.mts` mit Wegwerfschlüsseln signiert –
  nie echte Relays, nie echte Schlüssel. Den eigenen Schlüssel liest die
  Attrappe aus der Abfrage der eigenen Relay-Listen (Kind 10002, ein Autor);
  die App zeigt ihn nirgends ganz. Der Raum erscheint erst im Raum-Modus
  (`setzeKommModus("space")`), mobil nur mit `.showing-channel`.
  Private Räume (seit C-12, Smoke „privatraum“): zwei Browser, je eine Attrappe
  mit gemeinsamer Ereignisliste (`rb.events = ra.events`), den eigenen Schlüssel
  erst nach `#/chat` (Abgleich des Posteingangs). MLS nur mit Tresor
  (`tresor_an()`); eine Einladung oder Meldung kommt erst mit dem nächsten Abgleich –
  im Test über `entsperre_neu()`, nicht über den Abruftakt (60 s). Den Namen eines
  privaten Raums kennt die Leiste erst, wenn er einmal offen war.
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
  Relay-Gewicht abfragen. Ungeprüfte Provider bleiben wählbar; die Reihenfolge
  macht seit P2a `ordneNachPruefung()` (unter den Neuen bekannte vor
  unbekannten); die Vertrauensschwelle gilt nur bei bestätigten Reklamationen – sonst
  stünde ein einmal bezahlter hinter einem unbekannten. Zusammenfassungen
  (seit 5.5c) nur über `RufVersand` (`ruf-teilen.ts`, `shell/ruf.ts`): nur mit
  Zustimmung (`freedom.ruf.teilen`), je Schlag des Abruftakts höchstens ein
  Umschlag, an den Posteingang des Kontakts, als Gerät nie; empfangen nur über
  `alsRufZusammenfassung()` am Ende der Kette in `oeffneUmschlag()`, gemerkt in
  `freedom.ruf.kontakte` (Tresor, `SICHERUNG_NIE`). Die Status-Seite der
  Website (seit 8.15) wertet nur über `website/js/dashboard-daten.js` aus:
  Angebote nach Erneuerung, Kataloge, Abdeckung über der Schwelle,
  Nennungen als Summe – nie 38010, nie 38075, keine Rangliste
  (`check-website.py` prüft das). Preise dort (seit C-3) in sats und SOL, SOL
  nur aus dem Kurs im Angebot (`lamportsAus()` wie `msatZuLamports()`).
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
  (https, localhost) – Browser-Tests nie auf `about:blank`. Zweige und Tags
  (seit C-20c) nur über `zweigeUndTags()` (annotierte Tags aufgelöst, nur
  Commits im Bundle); die Wahl (`refWahl`) steht nur im Speicher. Verlauf
  einer Datei und Suche im Code (seit C-20d) nur über `dateiVerlauf()` und
  `sucheImCode()` mit den Grenzen aus `SUCHE_GRENZEN` – Ergebnis nur im
  Speicher, nie in die Adresse. Neues seit dem letzten Blick (seit C-20f) nur
  über `repo-neuigkeiten.ts` (`beteiligt()`, `neuigkeiten()`), „zuletzt
  gesehen“ nur in `geheim` (`freedom.repos.gesehen`) – die Liste verrät, was
  man verfolgt; neu beteiligte Repos beginnen jetzt, nie mit allem als „neu“.
- **Abdeckungskarte nur aus `buildCoverage()`** (seit C.4a): Die Karte
  (`shell/tabs/karte.ts`) bekommt nur `r.cells`/`r.hiddenCells`, nie Events
  oder Schlüssel; Rechnung ohne DOM in `karte-ansicht.ts` (Zellkennung nur in
  der Form von `toCell()`). Gezeichnet nur mit `createElementNS` und
  `textContent`, keine Kacheln, nichts von außen. Je Gebiet nur die Stufe
  (`zellenStufe()`), nie die Zahl der Einträge. Zeiger erst beim Ziehen
  festhalten (`setPointerCapture`) – sonst trifft ein Klick nie eine Zelle.
  Den eigenen Ort (seit C.4b) nur über `rundeStandort()` speichern – die
  Südwest-Ecke der 0,5°-Zelle, nie `pos.coords` in `localStorage`; gezeichnet
  nur umrandet. Die Umrisse (`welt-umrisse.ts`) nie von Hand ändern, nur mit
  `scripts/welt-umrisse.py` aus der Quelle mit fester Prüfsumme (höchstens 40 KB).
- **Mobil nur mit Flächen ab 40 px** (seit C.5a): Unter 1024 px hat jede
  Berührfläche mindestens 40 px (Regeln am Ende von `app.css`); wo das den
  Platz sprengt, eine Reihe zum Wischen oder Umbruch – nie kleiner machen.
  Nur Höhe für alle, Breite nur einzeln: ein `min-width` für alle Knöpfe hebt
  das Mindestmaß der Flex-Elemente auf (so überlagerten sich in C.5a die
  Settings-Reiter); der Smoke-Test meldet Text, der aus Knöpfen läuft.
  Der Smoke-Test „mobil“ misst alle Seiten aus `MOBIL_SEITEN` hochkant und
  quer (keine Laufleiste, keine Fläche unter 40 px) – neue Seiten dort
  eintragen. Häkchen stehen im Label; die Kopfzeile setzt die Identität nur
  über `zeigeIdent()` und lädt nie ein Bild aus dem Netz. Die untere Leiste
  weicht beim Tippen (`tipptIn()`, `body.tippt`). Ein Tipp auf einen Knopf beim Tippen nimmt dem Feld
  den Fokus nicht (seit B-22, `navigation.ts`: `mousedown` unter 1024 px abgefangen) – sonst kehrt die
  Leiste beim Drücken zurück, alles rutscht, und das Loslassen trifft daneben; der Smoke-Test „mobil“
  prüft „Senden beim Tippen“ (Klick am Knopf, Fokus bleibt im Feld).
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
- **Barrierefreiheit gemessen** (seit C-4): Jedes Bedienelement braucht einen
  Namen für Vorleser – ein Platzhalter oder Tooltip allein reicht nicht, dazu
  `data-i18n-aria` (gern derselbe Schlüssel). Schrift mit Kontrast nach WCAG AA
  (4,5:1, groß 3:1): Rot als Schrift ist `--red-text`, nicht `--red`; Lesbares
  nie über `opacity` dämpfen (sie trifft auch die Schrift darin), sondern über
  die Farbe. Was anklickbar ist, geht mit der Tastatur (Knopf oder
  `role="button"` + `tabindex="0"` + Enter/Leertaste), kein `tabindex > 0`.
  `zugang.test.ts` prüft `index.html`, der Smoke-Test („zugang“) jede Seite und
  jeden Unterreiter auf Desktop und Handy.
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
  `oeffentlichesProfil(entwurf, { lightning: lnOeffentlich(localStorage), sol: solOeffentlich(localStorage) })`
  hinaus (`tabs/profil.ts`) – die Lightning-Adresse nur mit Häkchen
  (`freedom.profil.lnOeffentlich`; vor 6.3 gespeicherte gelten einmalig als
  veröffentlicht), die SOL-Adresse (Feld `sol`, seit 12.6) ebenso
  (`freedom.profil.solOeffentlich`, Standard aus, eingeschaltet erst nach
  `bestaetige()`; ohne `sol: true` gehen weder `sol` noch `chains` hinaus). Zap-Anfragen (9734) nur über `baueZapAnfrage()` →
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
- **Repos in öffentlichen Räumen** (seit 11.4a): Der Verweis ist das `a`-Tag
  `34700:<besitzer>:space:<kennung>` (`raumAdresse()`); zum Raum gehört ein
  Repo nur über `mitRaumRechten()` (Eigentümer hat `repos_pflegen`), den
  Zustand nur über `raumZustandFuer()` bauen – nie `buildSpaceState()` direkt
  mit fremden Definitionen derselben Kennung. Karten werten Raum-Rechte in
  `repoKarten(…, raumEvents)` aus; `darfAnnehmen()`/`patchStatus()` bleiben
  unverändert und bekommen das erweiterte Repo. In privaten Räumen (seit
  11.4b1) Repo-Events nur als innere Events über `raumRepo…()` – nie
  `publish()`, auch nicht den Bundle-Verweis (er trägt den Schlüssel);
  gelesen über `raumReposPrivat()`. Leak-Regel `raum-repo-privat`. In der App
  (seit 11.4b2) tragen Karten privater Räume `privatRaum`; jede Aktion daran
  nur über `sendeInRaum()` (`shell/raum-repos.ts`) – nie mit `publish()`
  daneben, nie ausweichen, wenn die Gruppe nicht erreichbar ist.
  Im Raum (seit 11.4c) zeigt die Liste nur `reposImRaum()`: öffentlich nur, was
  bestätigt zu genau der Adresse des Raums gehört (ein bloßes `a`-Tag zählt
  nicht), privat nur die Karten der Gruppe. Die Repos eines öffentlichen Raums
  lädt die Liste erst, wenn er in der Sitzung offen war (`merkeRaumAdresse()`
  nur aus `oeffneRaum()`) – nie alle eigenen Räume in einer Abfrage. Beim Start
  lädt die Repo-Liste gar nicht (seit C-15) – erst die Seite Repos oder ein Raum. „Repo
  anlegen“ im Raum-Menü nur mit `repos_pflegen`; öffentlich mit Verweis, privat
  über `sendeInRaum()`.
  Issues und Kommentare (seit C-17a, `docs/PROTOCOL.md` 19) nur über
  `baueIssue()`/`baueIssueStatus()` (NIP-34, 1621) und `baueKommentar()`
  (NIP-22, 1111, nur an Issues und Patches); gelesen nur über `leseIssue()`,
  `issueStatus()` (Autorin, Eigentümer, Maintainer) und `kommentareZu()`. Im
  privaten Raum nur `raumRepoIssue()`, `raumRepoIssueStatus()`,
  `raumRepoKommentar()` – Bezüge sind die Ids der inneren Events; die
  Leak-Regel bekommt sie als `innere`. In der App (seit C-17b1) Reiter
  „Issues“ in `shell/tabs/issues-reiter.ts`: Karten bekommen Issues nur über
  `mitIssues()` – öffentliche nur an öffentliche Karten, private nur aus ihrer
  Gruppe, nie gemischt; anlegen öffentlich signiert, privat nur über
  `sendeInRaum()`; gezeigt nur als Text. Kommentieren (seit C-17b2/C-17c,
  Issues und Patches) nur über `diskussion()` (`shell/tabs/diskussion.ts`),
  Status nur über `setzeIssueStatus()` und nur, wo `darfStatus` gilt –
  beides privat nur `sendeInRaum()`; Kommentare an Patches nur aus
  `mitIssues()` (`patchKommentare`). Zwei Status-Wechsel im Test mindestens
  eine Sekunde auseinander – Status zählen nach Sekunden.
  Reviews (seit C-20g1, `review.ts`): Zeilenkommentare und Bewertungen sind
  NIP-22-Kommentare am Patch mit einem Tag mehr (`zeile`, `bewertung`) – nur
  über `baueZeilenKommentar()`/`baueBewertung()`, gelesen nur über
  `zeilenKommentareZu()`/`bewertungenZu()` (je Person die neueste, die des
  Patch-Autors zählt nicht); privat nur `raumRepoZeilenKommentar()`/
  `raumRepoBewertung()`. Eine Bewertung ändert den Status nie – annehmen
  bleibt `darfAnnehmen()`; die Diskussion lässt Review-Teile aus (`istReviewTeil()`).
  In der App (seit C-20g2) nur über `shell/tabs/review-ui.ts` (`reviewAnsicht()`),
  Daten nur aus `mitIssues()` (`patchReviews`); die Knöpfe „+“ an den Zeilen erst mit
  „Zeilen kommentieren“ (`display: none` vorher – sonst wären mobil alle Zeilen 40 px hoch).
  Releases (seit C-20h1, `repo-release.ts`, Kind 30063 nach NIP-51) nur über
  `baueRepoRelease()`/`baueRepoReleaseRueckzug()`, gelesen nur über `repoReleasesZu()`
  (Eigentümer und Maintainer, je Version die neueste); das Bundle steht samt Schlüssel
  im Release selbst, nie nur über den ersetzbaren Verweis 38042. Privat nur
  `raumRepoRelease()`. `release.ts` ist das Release-Manifest der App (38054) – ein
  anderes Ding; vor dem Anlegen einer Datei nachsehen, ob es sie schon gibt.
  In der App (seit C-20h2) Reiter „Releases“ nur über `shell/tabs/releases-reiter.ts`:
  geladen nach Repo-Adresse wie Issues, an die Karte nur über `mitIssues()` (`releases`);
  veröffentlichen und zurückziehen nur mit `darfAnnehmen()`, privat nur `sendeInRaum()`.
  Labels ändern und Zuständige (seit C-20i1, `repo-labels.ts`, NIP-32 Kind 1985) nur über
  `baueLabelStand()` (ganzer Stand je Namensraum, genau ein Ziel), gelesen nur über
  `labelStandZu()` (neueste Aussage von Eigentümer oder Maintainern); Zuständige nie als
  `p`-Tag. Privat nur `raumRepoLabels()`.
  In der App (seit C-20i2) nur über `labelLeiste()` (`shell/tabs/labels-ui.ts`) auf
  Issue- und Patch-Seite; der Stand kommt nur aus `mitIssues()` (ersetzt die `t`-Tags,
  `patchLabels`), ändern nur mit `darfAnnehmen()`, privat nur `sendeInRaum()`.
  Forks, Sterne, Beobachten (seit C-20j1): Fork nur über `forkVon` in
  `baueRepoAnkuendigung()` (`["a", …, "", "fork"]`); Sterne nur über `baueStern()`/
  `baueSternWeg()`, gezählt nur über `sterneZu()`; Beobachten ist privat – die Liste
  10018 nur über `baueBeobachtungsListe()` mit Chiffrat (NIP-44 an sich selbst über den
  Signer), nie mit offenen Tags, gelesen über `leseBeobachtungsInhalt()`. Keine Zahl
  der Beobachter versprechen – es gibt keine.
  In der App (seit C-20j2) nur über `shell/tabs/repo-sterne-ui.ts`: Stern erst nach
  `bestaetige()`, Beobachten nur nach frischem, strengem `ladeBeobachtet(pool, true)` (auch ein
  Fehler beim Entschlüsseln bricht ab – sonst überschriebe man
  eine Fassung eines anderen Geräts), Daten an die Karten nur über `mitSternen()` – nur
  öffentliche Repos. Beobachtete Repos zählen in `beteiligt()` mit.
  Forks in der App (seit C-20j3) nur über `forkZeile()` (`shell/tabs/fork-ui.ts`): nie das
  eigene Repo, nie über ein eigenes gleicher Kennung (`eigeneKennungen()`), das Bundle nur
  als Verweis auf denselben Blob (nichts neu hochladen); Daten nur über `mitForks()`.
- **Markdown nur über `markdownDom()`** (seit C-20a, `shell/markdown-ui.ts`):
  gelesen von `leseMarkdown()` (`markdown.ts`, ohne DOM), gezeichnet nur mit
  `createElement`/`textContent` – rohes HTML bleibt Text, Links nur über
  `sicheresZiel()` (https ohne Zugangsdaten, `noopener noreferrer nofollow`),
  Bilder nie als `<img>` (ein fremdes Bild verriete, wer liest). Neue Regeln
  im Leser nur mit Grenze: `MD_GRENZEN` (Länge, Tiefe, Suchweite) und die
  Schrittgrenze je Text – sonst wird ein böser Text quadratisch langsam.
  Relative Ziele (seit C-20b) sind Verweise ins Repo: aufgelöst nur mit
  `loesePfad()` (nie über die Wurzel), geöffnet nur über `oeffne` im Reiter
  „Code“ – nie als `href`, nie in die Adresse; ohne `oeffne` bleiben sie Text.
- **Smoke-Test auch in der CI** (seit C-18): Job „Browser-Test (Smoke)“ in
  `ci.yml` – Python-Playwright fest auf 1.56.0 (lokal dieselbe Version),
  Chromium mit `--with-deps`. Rot dort heißt rot wie ein Unit-Test; eine neue
  Prüfung vorher lokal laufen lassen und nie auf feste Pausen bauen, wo sich
  auf einen Zustand warten lässt (`wait_for_function` mit Frist) – der Runner
  ist langsamer als die Sitzung.
  Kontrast erst messen, wenn Einblendungen fertig sind (`ANIMATIONEN_FERTIG`,
  `document.getAnimations()`): Seiten und Unterreiter blenden sich über `opacity`
  ein (`fs-in`), mitten darin maß „zugang“ 2,92:1 (P5c2, beim Einmergen von `main`).
- **Werbelink mit eigener Adresse nur geprüft** (seit 11.2a): Die Adresse
  nur über `pruefeEigeneAdresse()` (https, ohne Zugangsdaten, nicht lokal),
  gemerkt nur das Ergebnis (`freedom.werben.adresse`). Eine fremde Adresse
  fragt die App nur auf Knopfdruck ab (`pruefeKopie()`, der Server sieht die
  IP) und nennt sie nur „geprüft“, wenn k vertraute Signierer die Datei
  bestätigen – die Liste steht nur in `release-signierer.ts`
  (`TRUSTED_SIGNERS`, leer bis MENSCH).
  Ein kurzer Name statt des Schlüssels (seit 11.2b) nur über `nip05.ts`
  (`leseNip05()`, `loeseNip05()`: https, öffentliche Domain, keine
  Weiterleitung, Antwort begrenzt); übernommen nur zum eigenen Schlüssel
  (`merkeWerbeName()`). Beim Geworbenen fragt `loeseWerberName()` die Domain
  genau einmal – sie sieht die IP (Grenze „werbe-name“ im Bericht) – und
  vergisst den Namen danach, gleich wie es ausging; nie ein zweiter Versuch.
- **Senden aus der Wallet** (seit 12.7a, `shell/senden-ui.ts`): Ziel nur über
  `leseSendeZiel()` (`senden.ts`), Betrag nur über `geltenderBetrag()` – die
  Schiene folgt dem Ziel, eine Rechnung ohne Betrag wird abgewiesen, ein
  getippter Betrag gegen den des Ziels auch. Erst `bestaetige()` mit ganzer
  Adresse, dann `zahle(zahlschienen(), … zweck: "senden")`; nie von selbst
  wiederholen. Empfangen (seit 12.7b, `shell/empfangen-ui.ts`): Lightning nur
  `eigeneRechnung()`, SOL nur `eigeneSolAdresse()` (frisch aus dem Vorrat, sonst
  ausdrücklich die verbundene; nie die Hauptadresse, nie ausweichen); gezeigt
  über `empfangsLink()`, nichts an ein Relay. Verlauf (seit 12.7c): jede
  Zahlung über `zahlschienen()` landet über `mitBuch()` im Zahlungsbuch
  (`zahlungsbuch.ts`, `freedom.zahlungen` nur in `geheim`, `SICHERUNG_NIE`,
  im Export) – erst nach dem Zahlen, ein Fehler beim Merken stoppt keine
  Zahlung; der Wallet-Verlauf (NWC `list_transactions`) nur auf Klick und nur
  über `leseWalletBuchungen()`.
- **Zahlung im Chat anfordern** (seit A-5): Die Anforderung ist eine
  gewöhnliche Direktnachricht mit `lightning:`/`solana:`-Adresse
  (`zahlungs-anforderung.ts`) – kein eigenes Event, gesendet nur über das
  Eingabefeld wie jede Nachricht. sats nur mit einer Rechnung der eigenen
  Wallet (`eigeneRechnung()`), SOL nur mit der eigenen Adresse je Kontakt
  (`eigeneAdresseFuer()`, 4.9d). Bezahlt wird nur nach `bestaetige()` über
  `zahle(zahlschienen(), … zweck: "anforderung")`; erkannt wird nur
  Zahlbares (`leseAnforderung()`: Betrag, lesbare Rechnung, natives SOL).
- **KI auf diesem Gerät nur über `ki-lokal.ts`** (seit B-1, Sammlung
  Neuordnung): nur Adressen dieses Rechners (`lokaleKiAdresse()`: localhost,
  127.0.0.1, [::1] – kein Heimnetz, kein Internet), Anfrage und Antwort nur über
  `lokaleKiAnfrage()`/`leseLokaleAntwort()` (OpenAI-kompatibel: Ollama,
  llama.cpp, LM Studio). Gesucht wird erst auf Klick (`freedom.lokal.aktiv`) –
  der Browser fragt beim ersten Zugriff auf den eigenen Rechner um Erlaubnis,
  also nie beim Start. Der Wahlwert `lokal:<modell>` geht in `askAi()` hinter
  dem gewählten Funk, vor Kontingent und Netz an `frageAufDiesemGeraet()`: kein
  Pool, kein Auftrag, keine Zahlung, nie still ins Netz ausweichen. In Node
  hält `AbortSignal.timeout` die Ereignisschleife nicht offen – Tests mit
  Zeitablauf halten sie mit einem Timer.
- **Flutschutz im Relay nur über `FLUTSCHUTZ`** (seit B-3, `relay-role.ts`):
  Grenzen je Verbindung (Events, Abfragen und Anmeldungen, offene Abos), je
  Schlüssel (gespeicherte Events, mit Zugang das Zehnfache) und für die Zahl der
  Verbindungen – über den `RateLimiter` aus `antispam.ts`, Fenster eine Minute,
  nach außen nur feste Texte nach NIP-01 (`rate-limited:`, `error:`), zu viele
  Verbindungen schließt der Relay mit 1013. Die Grenzen müssen einen Upload in
  Stücken durchlassen (Test mit 200 Stücken) – nie so eng, dass Anhänge und
  Bundles scheitern. Umschläge (1059) kommen von Wegwerf-Schlüsseln: sie bremst
  nur die Grenze je Verbindung. Zählstände vergisst `aufraeumen()`.
- **Kontakt prüfen nur über `sicherheitscode()`** (seit B-4,
  `sicherheitscode.ts`): Code aus beiden Schlüsseln der Personen
  (`sprichtFuer()`, nie der Geräteschlüssel), Fassung im Hash – eine andere
  Rechnung braucht eine neue Fassung. Der Code reist nie über ein Relay, der
  QR-Code trägt nur die Ziffern. Als geprüft gemerkt wird erst nach dem
  Vergleich (`merkeGeprueft()`), nur in `freedom.kontakte.geprueft` im Tresor
  (die Liste verrät, wen man getroffen hat), je Schlüssel – ein neuer Schlüssel
  ist ungeprüft.
- **Datenexport nur über `datenexport.ts`** (seit B-6): hinein nur
  `waehleExport()` (die Liste der Sicherung plus `EXPORT_ZUSAETZLICH`), zurück
  nur `filtereExport()` – nie Schlüssel, Zugänge, Geld-Geheimnisse, Anteile,
  Gruppenschlüssel, auch nicht aus einer fremden Datei. Verschlüsselt nur mit
  `verschluesseleMitPassphrase()` (Format und Parameter des Tresors), die
  Passphrase nur im Dialog (`verdeckt: true`). Was nie auf ein Relay darf
  (Quittungen, KI-Verläufe), steht in `EXPORT_ZUSAETZLICH`, nicht in
  `SICHERUNG_EINTRAEGE`.
- **Kein Vergleichen für Kunden** (A-7 zurückgenommen 04.10.2026, MENSCH):
  Auf der Agent-Seite gibt es keinen Haken „vergleichen“ mehr – nicht wieder
  einbauen (Max und Swarm bleiben, wie sie sind). Verfügbarkeit und Qualität
  der Provider prüft die App automatisch nach `docs/FREEDOM-PRUEFUNG.md` (E7,
  OpenRouter-Vorbild). **Keine Prüfer** (Entscheidung 05.10.2026, P5a): keine
  Prüfer-Rolle im Knoten, keine synthetischen Prüffragen, keine Messberichte –
  38081 nicht wiederverwenden, Prüfer nicht wieder einführen. Geprüft wird in
  Pflicht-Prüfrunden (P5c/P5d; mit Lightning seit P5c2, über Zahlkanäle ab P5d): die echte Anfrage an drei
  Provider statt an einen, etwa jede 400. Antwort (MENSCH 06.10.2026 – Antwort,
  nicht Zahlung), ohne Schalter, bezahlt aus dem Prüfbudget (0,5 % aus dem
  Anteil der Entwicklung, seit P5b) in der Währung des
  Nutzers; ausgenommen nur Gerät, eigener Knoten, Funk. `consensus.ts` bleibt
  Baustein dafür (Ausnahmen in `wiring-ausnahmen.txt` mit diesem Grund).
  Auswahl seit P2a nur über `matchProviders()` → `ordneNachPruefung()`
  (`pruefung.ts`): eigene Provider zuerst, dann normale, Neue (bekannte vor
  unbekannten), Ausreißer, Herabgestufte, gerade und länger Ausgefallene; vorn
  zufällig mit 1/Preis² aus `sichererZufall()` – in Tests immer `zufall`
  übergeben, sonst würfelt der Test. Die Stufe kommt nur aus der eigenen
  Messung (ab 20 Anfragen, sonst „neu“), die Qualität nur aus Prüfrunden
  (`Messpunkt.einig`, ab drei Vergleichen `MessStand.qualitaet`). Fällig ist
  eine Runde nur über `PruefBudget.faellig()`/`beginneRunde()` (`PRUEFRUNDE`),
  die zwei zusätzlichen Provider nur aus `waehleZusatz()` (nie eigene Knoten,
  Zufall aus `sichererZufall()`), ausgewertet nur über `werteRundeAus()` – bei
  Streit keine Aussage, nie „richtig“ versprechen. Ausgeführt (seit P5c2) nur über
  `shell/pruefrunde-lauf.ts` aus `askWithFailover()`: `starteRunde()` erst nach dem
  ersten Senden, `messeLauf()` an jedem Ende des Laufs (schließt die Runde ab, zählt
  die Antwort, nie den eigenen Knoten); die zwei nur über `buildJobEvent()`, still
  abgeholt (`waitForAnswer(…, { still: true })`), bezahlt wie jede Antwort, nie
  angezeigt – nie eigene Knoten, bis P5d nie über einen Zahlkanal. Die eigene Messung nur über `MessBuch`
  (`messbuch.ts`, `freedom.messungen` in `geheim` und `SICHERUNG_NIE`),
  geschrieben nur aus `askWithFailover()` über `ergebnisDesLaufs()`:
  Ablehnungen und Abbrüche zählen nicht (oft Fehler des Nutzers), eine
  verpasste Frist und ein kaputtes Ergebnis schon. Gezeigt (seit P2b2) nur auf
  der Seite Netz › Prüfung (`shell/tabs/pruefung-ui.ts`) über `pruefZeilen()`
  aus `providerMitStand()` – derselben Quelle wie die Auswahl –, geladen erst
  beim Öffnen des Reiters. Die FAQ der Website beschreibt Auswahl und Probezeit
  wie der Code; `check-website.py` weist „steht aber hinten“ und Aussagen über
  Prüfer (Messbericht, `PRUEFER=1`, Prüfern folgen) ab.
- **Offene Räume nur über die Adresse des Gründers** (seit B-7): gemerkt
  (`freedom.spaces`, `oeffentliche-raeume.ts`) und weitergegeben wird
  `34700:<gründer>:space:<kennung>`; den Raum baut nur `raumZustandFuer()` –
  nie `buildSpaceState()` mit Events aus dem Netz (dort gewinnt die neueste
  Definition, gleich von wem). Eine bloße Kennung bindet die App nur, wenn
  `gruenderZurKennung()` eindeutig ist (`bindeKennung()`). Tags (`space`)
  tragen weiter die Kennung (`offeneKennung()`), nie die Adresse.
  Ausblenden und Sperren (34551/34552) im offenen Raum zählen seit B-19 nur
  über `raumModeration()` (Recht „moderieren“, nur gegen Niedrigere, den
  Gründer trifft keine Maßnahme eines anderen) – nie über die Liste 34550 der
  Communities; die Lücke bleibt sichtbar, „anzeigen“ nur für die Sitzung.
  Kanäle (seit B-20a) auch von Berechtigten, nur über Kanal-Events (34703,
  `baueRaumKanal()`/`baueKanalEntfernung()`) an die Adresse des Raums;
  ausgewertet nur über `mitRaumKanaelen()` in `raumZustandFuer()` – je Kanal
  die neueste Aussage, von anderen als dem Gründer nur mit
  „kanaele_verwalten“ (heutiger Stand) und nur für Kanäle bis zum eigenen
  Rang, nichts aus der Zukunft (`KANAL_GRENZEN`). Kanäle im offenen Raum sind
  immer „offen“ – nie „verschlüsselt“ versprechen. In der App (seit B-20b)
  „Kanal anlegen“ offen nur mit `darfKanaele()` und nur über `baueRaumKanal()`
  – nie eine neue Definition (34700) dafür. Moderatoren offener Räume sind die
  mit der Rolle „mod“ (34702, `MOD_RECHTE`), ernannt über
  `ernenneModeratoren()` – nie mehr die Liste 34550, sie zählt in Räumen nicht.
  Ändern und entfernen (seit B-20c) nur über `aendereKanal()`: offen vorher
  `darfKanalAendern()` (dieselbe Regel wie `mitRaumKanaelen()`), privat
  `aenderePrivatenKanal()`; nie den letzten Kanal. Zwei Kanal-Events derselben
  Sekunde entscheidet die Id – im Test eine Sekunde dazwischen.
  Wer beitritt, schreibt mit (seit B-22, MENSCH 08.10.: wie @everyone) über die
  Rolle für alle in der Rollenliste des Gründers (`JEDER_ROLLE`) – sie bringt nur
  `JEDER_RECHTE` (lesen, schreiben, Threads), nie Moderieren, Vergeben oder
  Verwalten; Kanäle mit Schreibrollen (#ankündigungen) bleiben beschränkt. Neue
  offene Räume legt die App mit ihr an, umgeschaltet wird nur über
  `stelleSchreibrechtEin()` (Gründer, neue Rollenliste, übrige Rollen bleiben).
- **Umfragen und Termine nur in der Gruppe** (seit B-15a, `raum-planung.ts`):
  NIP-88 (1068/1018) und NIP-52 (31922/31923/31925) nur als innere Events
  privater Räume über `raumUmfrage()`, `raumStimme()`, `raumTermin()`,
  `raumTerminAntwort()` – nie offen veröffentlichen; ausgewertet nur über
  `raumUmfragen()`/`raumTermine()` mit dem `GruppenRaum` (Schreibrecht im Kanal,
  je Mitglied die letzte Stimme, `geloescht`). Bezüge sind Ids innerer Events.
  In der App (seit B-15b) nur über `shell/raum-planung-ui.ts`: gesendet nur
  mit `mlsSendeEvent(raum.gruppe, …)`, gezeigt nur als Text über dem Verlauf
  des Kanals (`zeigePlanung()`), die Knöpfe nur privat und mit Schreibrecht.
- **Repos nur auf diesem Gerät nur über `LokaleRepos`** (seit B-2a,
  `lokale-repos.ts`, Ablage `shell/lokale-repos-ablage.ts`): Angaben und Bundle
  bleiben auf dem Gerät – nie `publish()`, nie `uploadAnhang()`, nie in die
  Sicherung (`SICHERUNG_NIE`: `freedom.repos.lokal`). Das Bundle nur
  verschlüsselt (`legeBundleAb()`: frischer Schlüssel je Version, erst das
  Chiffrat ablegen, dann merken, dann die alte Version löschen); die Liste mit
  den Schlüsseln nur in `geheim`, die Chiffrate nur in der IndexedDB
  `freedom-repos` (in `WIPE_DATENBANKEN`). Gelesen wird streng
  (`leseLokaleRepos()`), ein lokales Repo hat nie einen Raum. Karten
  (`lokaleKarten()`) tragen `lokal` und einen eigenen Schlüssel `lokal:…` –
  nie mit einem öffentlichen Repo gleicher Kennung vermischen, auch nicht in
  `mitIssues()`. In der App (seit B-2b): anlegen über „Wo: nur dieses Gerät“
  beim Ankündigen (ohne Rückfrage – nichts geht hinaus), neue Versionen über
  `ladeBundleHoch(…, lokal)` (vor dem Blob-Netz, höchstens
  `BUNDLE_GRENZEN.bytes`), Code und Commits nur über die `BundleQuelle`
  (`quelleVon()` in `repo-seite.ts`, das Netz über `netzQuelle()`). Lokale Repos
  zeigen nur Code, Commits und Einstellungen – Issues, Patches und Mitwirkende
  gibt es erst im Netz. Ohne Relays bleiben sie in der Liste. Veröffentlicht
  wird (seit B-2c) nur über `veroeffentlicheLokal()`: Rückfrage (nennt ein
  ersetztes öffentliches Repo gleicher Kennung), Ankündigung, Bundle über
  `ladeBundleHoch()` – erst dann `entferne()`; scheitert etwas, bleibt die
  Kopie auf dem Gerät.
- **Knoten mit Besitzer koppeln nur über `kopplung.ts`** (seit B-8a, L1 A):
  Kopplungscode `freedom-kopplung:1:<knoten>:<geheimnis>` nur aus
  `neueKopplung()`/`leseKopplungscode()`. In einer Anfrage an den eigenen
  Knoten steht nur der Nachweis (`mitBesitzerNachweis()`: HMAC über
  Sitzungsschlüssel und Zeit) – nie das Geheimnis, nur im Kern vor dem
  Versiegeln, nur an den gekoppelten Knoten. Der Knoten erkennt den Besitzer
  nur über `istBesitzer()` und nur bei Anfragen aus einem Umschlag (Leak-Regel
  `besitzer-versiegelt`). Ein neues Geheimnis widerruft alle bisher
  gekoppelten Geräte. Im Knoten (seit B-8b) liegt das Geheimnis nur in
  `~/.freedom/kopplung.json` (0600, `kopplung-datei.ts`), erzeugt und gezeigt
  nur über `npm run koppeln` (QR fürs Terminal mit `kopplungImTerminal()`),
  nie ins Log; der Provider liest es je Anfrage (`besitzer` in der
  Konfiguration) und rechnet den Besitzer gratis, ohne Gebot und Kontingent –
  eine offene Anfrage mit Nachweis lehnt er ab. In der App (seit B-8c) nur
  über `shell/mein-knoten.ts`: der Code nur in `geheim`
  (`freedom.knoten.kopplung`, `SICHERUNG_NIE`), eingegeben verdeckt;
  `buildJobEvent()` setzt den Nachweis nur für `kopplungFuer(ziel)` – dann
  ohne Gebot, Anteile, Kanal und Sitzung, höchstens 0 msat. In der Modellwahl
  (seit B-9a) „Mein Knoten“ nur gekoppelt (`zeigeKnotenBereich()`, Modelle aus
  `angebotVon()`, nur Text), Wahlwert `knoten:<modell>` (`knoten-wahl.ts`);
  `askAi()` → `frageMeinenKnoten()` nach Funk und Gerät, vor Kontingent und
  Netz – nur an diesen Knoten, nie ein anderer Provider, nie still ins Netz.
  Der Stopp-Fall in `askAi()` steht vor der Prüfung des Prompts (nach dem
  Senden ist das Feld leer).
  Halten beim eigenen Knoten (seit B-9b1, L4 A) nur über `baueHalteAuftrag()`
  (Kind 5076, versiegelt, Nachweis, Manifest-Id): Der Knoten hält nur mit
  `istBesitzer()` aus einem Umschlag, nur genau das genannte Manifest
  (`halteManifest()` – `parseBlobManifest()` prüft nichts) und nur Stücke von
  dessen Autor; gehaltene Stücke (`nimmAuf(…, { halten: true })`,
  `gehalten.json`) verdrängt die LRU nie, sie zählen zur Quota. Antworten nur
  über `leseHalteAntwort()`. Leere Füllstücke teilen sich einen Hash – im
  Test je Hash zählen, nicht je Index.
  In der App (seit B-9b2) nur über `halteBeiMeinemKnoten()`
  (`shell/knoten-halten-ui.ts`) nach einem verschlüsselten Upload, nur gekoppelt und
  mit Haken (`haltenAn()`, `freedom.knoten.halten`, Standard an), mit frischem
  Sitzungsschlüssel – nie für die Kopie nur auf dem Gerät; `uploadAnhang()`
  nennt dafür die Manifest-Id. Gezeigt wird nur ein fester Text. Nie in
  `mein-knoten.ts`: Dort liegt der Kopplungscode, und ein Test hält das Modul
  frei von `localStorage` und `publish`.
  Aufträge an den eigenen Knoten (KI, Halten) seit B-9c2 nur über
  `wegZumKnoten()` (`shell/knoten-weg-ui.ts`): mit Haken „Alles über meinen
  Knoten“ (`freedom.knoten.nurUeber`, Standard aus) eine eigene Verbindung zu
  seinem Relay (`knotenRelay()`: eigener Ursprung nur mit seinem Schlüssel in
  NIP-11, sonst seine NIP-65-Liste), angemeldet mit dem Sitzungsschlüssel des
  Auftrags – die einzige Stelle mit `baueRelayAuth()` außer `state.ts`, ein
  Test zählt das; liefert sie `null`, geht nichts hinaus. Antworten über den Weg
  nur nach dessen `sitzungPk` abfragen: Das Relay liefert Umschläge nur, wenn
  jeder Schlüssel im `#p`-Filter angemeldet ist, sonst still nichts.
  Sein Relay in den eigenen Satz (seit B-9c3, L7 A) nur über
  `satzMitKnotenRelay()` (angehängt, nie ersetzt; Heimnetz-`ws://` und ohne
  eigenen Satz nicht) und nach Rückfrage über `setzeEigeneRelays()` – als Gerät nie.
  Den Status des eigenen Knotens (seit B-11a, L6 A) nur über
  `baueStatusAuftrag()` (Kind 5077, versiegelt, Nachweis) und
  `leseKnotenStatus()`; der Knoten antwortet nur mit `istBesitzer()` aus einem
  Umschlag und nur in der Form von `knotenStatusText()` – Zahlen, feste
  Kennungen (`STATUS_ROLLEN`), Modellnamen, nie Text aus Aufträgen. Rollen
  meldet `main.ts` erst, wenn sie gestartet sind (`statusRollen.add()`). Nur
  lesen – Steuern ist eine eigene Entscheidung (L6 B).
  In der App (seit B-11b) nur über `zeigeKnotenStatus()`
  (`shell/knoten-status-ui.ts`): nur auf Klick, nur gekoppelt, über
  `wegZumKnoten()`; gezeigt nur `statusZeilen()` als Text (Rollen über
  `ROLLEN_TEXT`, Beträge über `ausMsat()`). Nichts davon wird gemerkt.
  Befunde der Selbstprüfung (seit B-11c) tragen `fall` und `werte` (nur Zahlen
  und Fehlernamen, nie Adressen) neben dem Satz fürs Log – ein neuer Befund
  braucht eine Kennung und einen Text in `EINRICHTUNG_TEXT`
  (`knoten-status-ansicht.ts`), ein Test vergleicht die Listen.
  Wecken (seit B-12a, W1 A, W2 A): Push-Adressen nur über
  `baueWeckAnmeldung()` (Kind 5078, versiegelt, Nachweis) und
  `pruefeWeckEndpunkt()` (https, öffentlicher Host); der Knoten nimmt sie
  nur über `leseWeckAnmeldung()` und `WeckBuch` an (`~/.freedom/wecken.json`,
  0600, höchstens 10), VAPID-Schlüssel nur aus `ladeVapid()` (`vapid.json`,
  0600, `node:crypto`). Die Push-Adresse ist ein Zugang zum Browser: nie
  offen, nie ins Log. Geweckt wird nur ohne Inhalt und Absender.
  Geweckt wird (seit B-12b) nur über `WeckDienst`: leer, mit `vapidKopf()`
  (ES256, `node:crypto`, `Topic`, TTL) und `sendePush()` (`checkUrlSafe()`,
  keine Weiterleitung); neu ist ein Umschlag nach Kennung, nicht nach Zeit –
  Umschläge sind bis zu zwei Tage zurückdatiert –, und was schon lag, als ein
  Schlüssel dazukam, weckt nie. Im eigenen Relay nur über `umschlaegeAn()`
  (Kennung, Zeit, Empfänger, nie Inhalt) – `alsRelay()` bleibt beim
  Knotenschlüssel. 404/410 → `vergiss()`; ins Log nie Adresse oder Meldung.
  Der Weck-Worker (seit B-12c, `src/sw/freedom-sw.ts` → `dist/freedom-sw.js`)
  zeigt nur den festen Text aus `texte/wecken.ts` (Sprache aus `?sprache=` seiner
  Adresse), liest nichts aus dem Push, hat keinen Cache und keinen `fetch`-Handler –
  der Build bricht sonst ab. Er gehört zu jeder Auslieferung: `build-site.sh`
  kopiert ihn, `repro-build.sh` vergleicht beide Dateien, `pages.yml` veröffentlicht
  nur mit `--vergleiche-ordner site`, das Release-Manifest nennt ihn. Meldungen
  zeigt im Smoke-Test nur das volle Chromium (`channel="chromium"`) – die
  Headless-Shell verweigert die Erlaubnis immer. Einen Push per CDP
  direkt nach der Aktivierung verliert Chromium gelegentlich (C-20h1: 3 von 40) – bis zur
  Meldung neu zustellen (begrenzt), nie eine feste Pause.
  In der App (seit B-12d2) nur über den Haken „Wecken“ (`shell/wecken-ui.ts`):
  nur auf Klick, nie beim Start; der VAPID-Schlüssel nur aus dem Status des
  eigenen Knotens (`frageKnotenStatus()`), angemeldet nur über `wegZumKnoten()`
  mit `baueWeckAnmeldung()` – Schlüssel aus `weckSchluesselFuer()` (Person und
  Geräte wie bei `auchFuer`). Bestätigt der Knoten nicht, wird alles lokal
  wieder abgemeldet; der Haken zeigt nur, ob es ein Abo gibt (nichts gemerkt).
  `serviceWorker.register(` steht nur dort (`notfall.test.ts`); Entkoppeln und
  Notfall-Löschung rufen `weckerAbmelden()`. Auf die Antwort des eigenen
  Knotens nur über `warteAufKnoten()` (`shell/knoten-weg-ui.ts`) warten.
  TURN (seit B-13a, T1 A, T2 A): Zugänge nur über `baueTurnAnfrage()` (Kind
  5079, versiegelt, Nachweis) und `leseTurnZugang()`; der Knoten vergibt sie
  nur mit `turnAusUmgebung()` (`TURN_URLS`, `TURN_SECRET` ab 32 Zeichen, nie
  halb) über `turnZugang()` (TURN-REST, HMAC-SHA1 wie coturn) – je Anfrage ein
  neuer, nie ins Log. Der Vermittler ist coturn als eigener Dienst, keine
  npm-Abhängigkeit. Unbekannte Rollen im Status bleiben seit B-13a unbeachtet.
  coturn (seit B-13b) nur mit der Datei aus `scripts/turn-einrichten.sh`
  (0600, `use-auth-secret`, `denied-peer-ip` für jeden privaten Bereich, kein
  Log) – das Geheimnis nie auf der Befehlszeile von coturn, `turnserver.conf`
  und `.env` nie einchecken. In `docker-compose.yml` kein `${…:?}`: Compose
  liest die ganze Datei, auch ohne das Profil – ein fehlender Wert bräche jedes `up`.
  Anruf-Aufbau (seit B-13c) nur über `baueAnrufNachricht()`/`oeffneAnrufNachricht()`
  (innen Kind 25040, je Empfänger ein Umschlag, Ablauf fünf Minuten, kein
  Zeitversatz): im SDP nur Kandidaten vom Typ `relay` (`pruefeSdpNurRelay()`),
  DTLS-Fingerabdruck SHA-256 Pflicht – ein Host- oder srflx-Kandidat verriete
  dem Gegenüber die IP. Nie ein Angebot am Prüfer vorbei senden. Ein Zugang
  zum eigenen TURN im Angebot (seit B-13d1, T3 B, Feld `turn`) nur geprüft über
  `pruefeTurnZugang()` (wie `leseTurnZugang()`) und nur im versiegelten Kern;
  Leak-Regel `anruf-nur-relay` (`regelAnrufNurRelay()`, mit den inneren Events).
  In der App (seit B-13d2) nur über `shell/anruf.ts`: Verbindung nur mit
  `iceTransportPolicy: "relay"` und `iceServerAus()`, hinaus nur
  `nurRelaySdp()`/`sendbarerKandidat()` (`anruf-ablauf.ts`), gesendet nur über
  `baueAnrufNachricht()` an Person und Geräte, an deren Posteingang
  (`veroeffentlicheDm()`, nicht verzögert – ein Anruf ist jetzt). Anrufen nur
  mit eigenem Vermittler (`eigenerTurnZugang()`, 5079), dessen Zugang im
  Angebot mitreist; annehmen mit dem eigenen, sonst dem aus dem Angebot
  (`waehleVermittler()`, dann `fremderVermittler`). Nur Kontakte; Fremden
  nie eine Antwort, auch nicht „besetzt“. Empfangen über `alsAnruf()` am Ende
  der Kette in `oeffneUmschlag()`, während eines Anrufs zusätzlich über ein Abo
  an den eigenen Schlüssel – nur so lange wie der Anruf. Der Zustand nur über
  `naechsterZustand()` (Fristen `KLINGELN_SEK`, `VERBINDEN_SEK`).
  Oberfläche (seit B-13d3) nur über `shell/anruf-ui.ts` (`wireAnrufe()`): Knöpfe
  im Kopf der Unterhaltung (`.chat-kopf`), angerufen nur auf Klick und nur in 1:1;
  die Leiste nur DOM mit Text, Medien nur als Ströme. Bei `fremderVermittler` steht
  der Hinweis, wer die IP sieht, vor „Annehmen“; ohne jeden Vermittler kein
  Annehmen. Datenschutz „anruf-ip“ (belegt) und „anruf-vermittler“ (Grenze). Im
  Smoke-Test („anruf“) kommt das Angebot aus `scripts/anruf-probe.mts` über den
  Abgleich des Posteingangs (nach dem Neuladen); `getUserMedia` und
  `RTCPeerConnection` zählt eine Attrappe – ohne Annehmen bleiben beide bei 0.
  Sofort klingeln (seit B-13e, T4 A): Solange die App offen ist, ein Abo an den
  eigenen Schlüssel über `lauscheAufAnrufe()` – je Schlüssel eines, nicht mit dem
  Anruf beendet; daraus nur entschlüsseln, was `vielleichtAnruf()` am offenen
  Umschlag durchlässt (Chat-Umschläge nie – sonst je Nachricht eine Anfrage an einen
  Bunker). Klingeln `KLINGELN_SEK` = 180, immer kürzer als `ANRUF_GRENZEN.ablaufSek`.
  Im Smoke-Test kommt das Angebot nur über `ProbeRelay.zustellen()` (offene Abos).
- **App vom Knoten nur mit Prüfsumme** (seit B-10a, `node/src/app-auslieferung.ts`):
  Die Relay-Rolle liefert freedom.html nur als Ergebnis von `ladeApp()` aus –
  die Summe gibt der Betreiber vor (`APP_SHA256`), nie aus der Datei
  übernehmen; geprüft beim Start, danach nur aus dem Speicher (kein `readFile`
  beim Ausliefern). Mit `Accept: application/nostr+json` bleibt `/` NIP-11.
  Über http im Heimnetz ist die Seite kein sicherer Kontext: kein
  `crypto.subtle` (Tresor, MLS-Zustand, Suche, Git-Bundles), keine Kamera –
  sicher sind .onion (Tor Browser) und localhost; Texte versprechen dort
  nichts anderes. In der App (seit B-10b) vorher `verschluesselungMoeglich()`
  (`sicherer-kontext.ts`): `richteTresorEin()` zeigt dann nur den Hinweis,
  Bundles werfen `BundleFehler("unsicher")` – neues, das `crypto.subtle`
  braucht, prüft ebenso und sagt es, statt mit einer fremden Meldung zu
  scheitern. Im Smoke-Test („unsicher“) nachgestellt per Init-Skript.
- **In Zufallsdaten nie nach kurzen Zeichenfolgen suchen** (seit B-13a): Ein Test
  `assert.ok(!JSON.stringify(wrap).includes("5079"))` schlägt gelegentlich an – Kennung,
  Schlüssel und Signatur sind Hex, „5079“ steht dort in etwa jedem
  zweihundertsten Lauf zufällig. Was offen nicht stehen darf, über die Struktur
  prüfen (`wrap.tags`, `wrap.kind`); nach Geheimnissen ab 32 Zeichen darf man suchen.
  Ebenso: Entschlüsseln mit falschem Schlüssel wirft bei AES-CBC (NIP-04) nicht
  immer – etwa jeder 256. ergibt ein zufällig gültiges Polster und Unsinn. In Tests
  „liest den Klartext nicht“ prüfen, nie `assert.throws` allein (`nwc.test.ts`).
- **Sprachnachrichten nur über `SprachAufnahme`** (seit C-7, `sprachnachricht.ts`,
  Oberfläche `shell/sprachnachricht-ui.ts`): das Mikrofon nur aus `starte()` auf
  Klick, nie beim Laden; nach jedem Ende alle Spuren stoppen (beendet, verworfen,
  Grenze, Fehler, späte Erlaubnis). Die Aufnahme ist ein Anhang wie jede Datei –
  nur über `handleChatFiles()` (Regel „Anhänge nur verschlüsselt“), nie eigene
  Uploads. Abspielen nur mit geprüftem Typ (`istAudioTyp()`); im Smoke-Test ersetzt
  eine Attrappe (Oszillator) das Mikrofon und zählt jede Anfrage.
- **Kopfgelder nur über `kopfgeld.ts`** (seit E10a, Kind 38061): zugesagt in
  sats und/oder SOL, gebaut nur über `baueKopfgeld()`, gelesen nur über
  `leseKopfgeld()`/`aktuelleKopfgelder()` – der Stand gilt je Geldgeber und
  Kennung, nie nach der Kennung allein (sonst meldet ein Fremder ein Kopfgeld
  als erledigt). Bezahlt wird direkt vom Geldgeber an den Erlediger – kein
  Topf, keine Runde, nichts verwahrt (38059/38060 nicht wiederverwenden).
- **OpenTimestamps nur über `ots.ts`** (seit B-17a, 5.10b): Beweise lesen und
  schreiben nur mit `leseOtsDatei()`/`leseOtsZeitstempel()` und
  `schreibeOtsDatei()`/`schreibeOtsZeitstempel()` – Format wie python-opentimestamps, Grenzen
  aus `OTS_GRENZEN`, Fehler nur als `OtsFehler`-Kennung (nie Text aus dem Beweis). Bündeln
  nur über `buendele()` (je Wert eine Zufallszahl wie der ots-Client – der Kalender lernt
  keinen Wert), Kalender-Antworten nur über `fuegeEin()`. Eine ausstehende Attestierung ist
  nur ein Versprechen; „in Bitcoin verankert“ heißt erst, dass der Endwert der Merkle-Wurzel
  des Blocks gleicht – nie aus dem Beweis allein behaupten. Testvektoren nur mit
  `scripts/ots-referenz.py` neu erzeugen; die LGPL-Beispieldateien der Referenz nicht ins Repo.
  Kalender (seit B-17b1, K5 A) nur über `stempele()`/`reicheNach()` (`ots-kalender.ts`): gefragt
  wird nur `OTS_KALENDER`, nie eine Adresse aus einem Beweis; ein Stempel braucht zwei Antworten.
  Anfragen ohne Content-Type – die Kalender erlauben jede Herkunft, beantworten aber keinen
  Preflight. NIP-03 (Kind 1040) nur über `baueOtsBeweis()` (nur Bitcoin, `nurBitcoin()`) und
  `leseOtsBeweis()`; eine Höhe darin ist ungeprüft, bis der Blockkopf passt (B-17b2).
  „Verankert“ (seit B-17b2, K4 A) nur über `pruefeVerankerung()` (`ots-bitcoin.ts`): Blockkopf
  von beiden Explorern aus `OTS_EXPLORER`, nur gleich gilt er, und er prüft sich selbst
  (`leseBlockkopf()`: Hash gleich dem genannten, Arbeit, Ziel des Hauptnetzes). Fehlt einer oder
  sind sie uneinig: keine Aussage – nie auf einen Explorer allein ausweichen. Gefragt nur bei
  Bedarf; die Explorer sehen IP und Höhe. Node-`fetch` nutzt den Agent-Proxy nur mit
  `NODE_USE_ENV_PROXY=1` (und `NODE_EXTRA_CA_CERTS`) – Live-Proben sonst „nicht-erreichbar“.
  In der App (seit B-17b3a, K1–K3 A) nur über `shell/zeitanker-takt.ts`: vorgemerkt wird ein
  eigenes Mandat nach dem Veröffentlichen (`ankereMandat()`) und eine Quittung nach dem Ablegen
  (`ankereQuittung()`, Wert `quittungsDigest()` ohne Stand); gestempelt, nachgereicht und das
  Mandat als 1040 veröffentlicht nur im Abruftakt (`zeitankerTakt()`, ohne Anker kein Netz) – als
  Gerät nie. Beweise nur in `freedom.zeitanker` (`geheim`, `SICHERUNG_NIE`, im Export); der zur
  Quittung geht nie hinaus. Grenze „zeitanker“ im Bericht nennt dieselben Kalender wie `OTS_KALENDER`.
- **Persönliche Angaben in KI-Fragen nur über Platzhalter** (seit D1a,
  `docs/DATENSCHUTZ-PROVIDER.md`): Erkannt wird nur, was eine prüfbare Form hat
  (`ersetzeAngaben()`, `platzhalter.ts` im Protokoll: E-Mail, Telefon, IBAN mit
  Prüfziffer, Karte mit Luhn, IP, Nostr-Schlüssel, Lightning-Rechnung) und Namen
  aus dem eigenen Adressbuch – keine Erkennung per KI, keine Namenslisten, und
  Texte versprechen nichts anderes. In der App nur über `shell/ki-platzhalter.ts`:
  `maskiere()` in `buildJobEvent()` vor dem Versiegeln (nie beim eigenen Knoten)
  und in `sendeKiUeberFunk()`, `entmaskiere()` in `handleAnswer()`; je
  Unterhaltung eine neue `Zuordnung` (`neueZuordnung()`), nur im Speicher – nie
  in `geheim`, Verlauf oder Sicherung. Gespeichert wird nur der Schalter
  (`freedom.platzhalter`, Standard an). Grenze „ki-platzhalter“ im Bericht.
  Wie viel Verlauf mitgeht (seit D1c), bestimmt nur `VERLAUF_UMFANG`
  (`ki-kontext.ts`: aus · kurz · lang, Standard kurz) über `leseUmfang()` aus
  `freedom.verlauf` – nie mehr als „lang“; Grenze „ki-verlauf“ im Bericht.
  Zahlsitzungen gehören seit D1b1 zum Sitzungsschlüssel
  (`activeFor(provider, kundePk)`, `jobTags(…, kundePk)`): Abrechnung
  (`chargeForResult(…, kiSitzungen.fuerAuftrag(r.requestId))`) und Reklamation
  nehmen den Schlüssel des Auftrags, gemerkt in `buildJobEvent()` vor dem
  Senden (`merkeAuftrag()`) – nie den `p`-Tag des Ergebnisses, den setzt der
  Provider; den rohen Schlüssel nur je Sitzungsschlüssel (`schluesselHex(pk)`).
  Je Unterhaltung neue Schlüssel (seit D1b2) nur über `wechsleKiSchluessel()`
  (`shell/ki-wechsel.ts`, aus `neueAufgabe()` und `oeffneVerlauf()` bei einer
  anderen Unterhaltung): `neueUnterhaltung()`, alte halten `ALT_HALTEN_MS` für
  späte Antworten; was sie schulden, nur mit ihnen selbst über `begleiche()`
  (ab 1 sat, Rechnung zuerst, unklar nie von selbst, Quittung über
  `quittungNachBegleichen()`), späte Antworten an verlassene Schlüssel über
  `begleicheWennVerlassen()`. Antworten nur nach `pubkeysFuer(ids)` abfragen –
  nie die Schlüssel anderer Unterhaltungen in einer Abfrage. Grenze
  „ki-unterhaltung“ im Bericht.
  „privat“ je Unterhaltung (seit D2, `ki-privat.ts`): `askAi()` prüft vor jedem
  Weg `wegErlaubt(privatGewaehlt(), kiWeg(…))` – privat nur dieses Gerät und der
  eigene Knoten, nie Funk, nie das Netz (also auch kein Max, Schwarm, keine
  Prüfrunde), nie still ausweichen. Der Haken gehört zur Unterhaltung
  (`privat` im Verlauf, nur über `speichereVerlaeufe()`); ein neuer Weg zur KI
  gehört hinter diese Prüfung.
- **Befehle zum Kopieren nur mit Adressen des Projekts** (seit C-21): Der
  Provider-Installer kommt nur von der eigenen Pages-Auslieferung
  (`INSTALLER_URL` in `onboarding.ts`; `build-site.sh` legt `install.sh` und
  `install.sh.sha256` neben die App) oder aus dem Repo. Keine Domain in
  `curl … | bash`, die das Projekt nicht besitzt – `freedomstack.io` gehört
  niemandem von uns (NXDOMAIN). Beispiele für Provider-Einnahmen ohne
  verwahrenden Dienst (`provider@knoten.example.org`, Profil `du@example.com`).
  `check-website.py` (`FREMDE_ADRESSEN`, auch README, PROVIDER, docker-compose,
  Installer) und `onboarding.test.ts` weisen beide alten Adressen ab.
- **Desktop-Hülle nur über das eigene Schema** (seit 6.1a1, `packages/launcher`):
  Die App kommt nur über `freedom://localhost/` (Windows `http://freedom.localhost/`)
  aus `oberflaeche::antwort()` – immer derselbe Ursprung, sonst sind Tresor und
  Verläufe nach einem Update weg; nie über `tauri://` oder eine Datei-Adresse.
  Ausgeliefert wird nur `freedom.html` (sonst 404, auch keine `freedom-spiegel.json`
  – die Hülle ist kein Spiegel; einzige Ausnahme seit 6.1b2a: die feste Warteseite `/tor`
  unter Android, ohne Skript). Navigation nur über `darf_navigieren()` (eigener
  Ursprung, Blob-Adressen dieses Ursprungs), neue Fenster `Deny`; die Oberfläche darf
  nur die Kommandos aus `capabilities/oberflaeche.json` (seit 6.1a3b zwei) – ein neues
  Kommando nur über das App-Manifest in `build.rs` und mit eigener Erlaubnis dort,
  nie `core:default` oder Rechte von Tauri selbst. `window.__FREEDOM_NATIVE__` setzt nur
  `kennung_skript()`. `build.rs` bricht ohne gebaute App ab; Symbole nur über
  `scripts/launcher-symbole.py`. Unter Xvfb prüfen (`xvfb-run`): die Hülle startet,
  `isSecureContext` und `crypto.subtle` sind wahr – ein Prüf-Skript nur lokal, nie
  einchecken.
  Eine neue Oberfläche (seit 6.1a2) nur über `suchUpdate()`
  (`oberflaeche-update.ts`): signierte Events (`ladeManifestEvents()`), k von n je
  Version (alle Dateien gleich), Zeitpunkt der früheste der Signierer, nie älter als
  die laufende, Quellen nur https; eine geladene Datei nur nach `pruefeDatei()`.
  Nie `latestRelease()` für „neuer“ – das nannte auch eine ältere Version so.
  Pakete (seit 6.1a4a) nur aus `launcher.yml` als Artefakt des Laufs (`SHA256SUMS`,
  14 Tage) – unsigniert, kein Release, nirgends verlinkt; ein Release mit Download
  braucht Signierschlüssel und Freigabe (MENSCH, a4b). Der AppImage-Bau lädt
  linuxdeploy und dessen Plugin von GitHub (Tauri, nicht gepinnt).
  Installiert wird eine Oberfläche (seit 6.1a3a) nur nach `update::pruefe()` in der
  Hülle selbst – nie, weil die Oberfläche es sagt: Kennung (NIP-01) und Signatur
  (BIP-340, `k256`) je Beleg, dieselben Regeln wie `suchUpdate()`. Vertraute
  Signierer und k liest `build.rs` aus `release-signierer.ts`/`release.ts` – nie eine
  zweite Liste in Rust. Ändert sich eine Regel, beide Seiten ändern und die
  gemeinsamen Fälle mit `scripts/oberflaeche-vektoren.mts` neu erzeugen.
  Abgelegt (seit 6.1a3b) nur über `Ablage::installiere()` (`ablage.rs`: erst `neu.*`
  ganz schreiben, dann umbenennen; geladen nur, wenn die Datei zum Stand passt),
  installiert nur über `Oberflaeche::installiere()` – nie älter als die laufende und
  die abgelegte Fassung, eine neuere beigelegte schlägt eine ältere installierte.
  Zurück nur über den Start (`--oberflaeche=vorher|beigelegt`), nie ein Kommando dafür.
  In der App (seit 6.1a3c) nur über `shell/oberflaeche-huelle.ts`: die Hülle nur an
  `__FREEDOM_NATIVE__` plus Tauri-Aufruf erkennen (`huellenAufruf()`), laden nur
  `ladeOberflaeche()` (Quelle für Quelle, nur die angebotene Datei), übergeben nur
  `uebergibHuelle()` nach `bestaetige()` – nie ein Kommando am Modul vorbei. In der
  Hülle unter Linux lässt die CSP kein `fetch` auf `freedom://` zu: die Prüfsumme der
  eigenen Datei dort aus `oberflaeche_stand`, Selbst-Export geht nicht (H1, MENSCH).
  Android (seit 6.1c1): dieselbe Hülle aus `src/lib.rs` (`run()`), Paketname nur über
  `tauri.android.conf.json` (`io.github.threedagi.freedom` – Desktop behält seine Kennung,
  sonst sind dort Tresor und Verläufe weg). Ablage im Cache (`ablageordner()`): ohne
  Startargumente ist „Cache leeren“ der Rückweg. `gen/android` nie einchecken – die CI
  erzeugt es je Lauf, Symbole nur über `launcher-symbole.py --android`. Das Test-APK
  signiert ein Wegwerf-Schlüssel je Lauf; einen festen Schlüssel legt nur der MENSCH an.
  Maven Central antwortet in dieser Umgebung über den Proxy oft mit 429 – lokal ein
  Gradle-Init-Skript mit Googles Spiegel (`maven-central.storage-download.googleapis.com`),
  nie ins Repo.
  Tor in der Desktop-Hülle (seit 6.1b1a, TOR1 A) nur über arti hinter dem SOCKS5-Zugang aus
  `tor.rs` (nur 127.0.0.1, nur CONNECT, Namen nie lokal auflösen) und nur als Proxy des
  eigenen Fensters (`Netz::proxy()`); mit „Tor“ immer ein Proxy, nie still direkt. Die Wahl
  nur über `netz.json` (`schreibe_wahl()`), gilt ab dem Start. rustls braucht den
  festgelegten Anbieter (`ring`, `install_default()`) – sonst bricht arti beim Start ab.
  Das Release wickelt ab (seit 6.1b3): nie `panic = "abort"` im Profil – sonst wirken
  `catch_unwind` und `melde_ende()` um arti nicht, `netz.rs` bricht den Build dann ab.
  Prüfen unter Xvfb mit `strace -f -Y -e trace=connect` (WebKit-Sandbox dafür lokal aus:
  `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`): WebKit nur zu 127.0.0.1. Ins Tor-Netz kommt
  arti in dieser Umgebung nicht – Live-Tests macht der MENSCH.
  In der App (seit 6.1b1b) nur über `shell/netz-huelle.ts`: Schalter `#huelle-tor` nur in der
  Hülle (`huellenArt()`, seit 6.1b2b auch Android) und nur mit `verfuegbar`, umschalten nur nach
  `bestaetige(torRueckfrage())` mit Neustart (`setzeTor()`; Android: „App schließen“); Texte sagen „es geht nichts hinaus“ statt Ausweichen, Anrufe nicht über Tor.
  Unter Android (seit 6.1b2a) setzt die Hülle den Proxy nur über `android_tor.rs` (JNI,
  androidx.webkit `ProxyController`, Regel `http://127.0.0.1:<port>` – HTTP CONNECT; `socks://` hieße in
  Chromium SOCKS4, dann löste das WebView Namen selbst auf); mit Tor lädt die App erst nach dem Proxy, bis
  dahin die Warteseite – nie die App ohne Proxy. Klassen aus androidx nur über `find_class()`
  (wry, Lader der Activity); offene Java-Ausnahmen vor dem nächsten JNI-Aufruf löschen
  (`raeume_auf()`). „Neu starten“ heißt unter Android: die App schließt sich. Was nur JNI ruft,
  entfernt R8 aus dem Release-APK – Keep-Regel `proguard-tor.pro` (die CI kopiert sie nach
  `gen/android/app/` und prüft die Klassen im APK); Signaturen gegen `dexdump` prüfen.
- **Meshtastic nur über `meshtastic.ts`** (seit 7.5a, Befunde `docs/MESHTASTIC.md`):
  Format ohne Abhängigkeit, Byte für Byte gegen meshtastic 2.7.11 – die Vektoren nur
  mit `scripts/meshtastic-referenz.py` neu erzeugen. Ein Rahmen geht nur als Paket an
  alle mit Port `PRIVATE_APP` auf dem Kanal „freedom“ (`FREEDOM_KANAL`) hinaus und mit
  dem Hop-Limit aus den Einstellungen des Geräts (ohne `want_ack` bleibt 0 bei 0, das
  Paket käme nur einen Sprung weit); keine Paket-Id, die vergibt die Firmware. Der
  Schlüssel des Kanals steht öffentlich im Code – nie als Schutz versprechen, geschützt
  sind die Umschläge. Nachrichten des Geräts nur über `leseVomGeraet()` (Kaputtes `null`,
  Unbekanntes übersprungen); die Firmware flutet selbst, über Meshtastic reicht die App
  nichts weiter (7.5b). Die Region setzt die App nie selbst.
  USB (seit 7.5b) nur über `erkenneSerielleStrecke()` (`meshtastic-strecke.ts`, aus
  `connectSerial()`): Meshtastic erst nach `want_config` erkannt (alle 2 s neu, 10 s Frist),
  sonst Längenpräfix; Kanal „freedom“ nur mit unserem Schlüssel, ohne Kanal nichts senden.
  Eine Strecke mit `leitetSelbstWeiter` bekommt vom Funkknoten nichts zum Weiterreichen,
  ihre `sendezeit` (`meshtasticSendezeit()`) zählt im Sendezeitkonto – nie wieder mit
  angenommenen 200 Byte/s rechnen, wo das Gerät sein Preset nennt. Was das Gerät selbst
  funkt (Nummer, Name, Position), steht als Grenze „mesh-geraet“ im Bericht.
  Bluetooth (seit 7.5c) nur über `meshtasticBluetooth()` (Meshtastic-Dienst, sonst Nordic
  UART); USB und Bluetooth teilen `MeshtasticSitzung` – Kanäle gelten erst ab „Ende der
  Einstellungen“ (`uebernimm()`). Kanal „freedom“ anlegen nur über `baueKanalAnlegen()`, nur
  per Knopf nach `bestaetige()`, nie den Hauptkanal; ohne freien Platz nichts.
  Im Knoten (seit 7.5d) nur über `meshtasticTcp()` (`FUNK_GATEWAY=meshtastic:host[:4403]`):
  dieselbe `MeshtasticSitzung`, je Verbindung neu gefragt; was fehlt, nur ins Log
  (`meshtasticBefunde()`, Fehler nur mit Namen) – der Knoten legt nie einen Kanal an. Die
  Gateway-Rolle rechnet Sendezeit, Wartezeit und Takt nur über `zeit()` (Strecke, sonst
  200 Byte/s). Im Smoke-Test („meshtastic“) spielt eine Web-Serial-Attrappe das Gerät mit
  Bytes aus der Referenz.
