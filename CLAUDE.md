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
| `STATUS.md` | Entwicklungsprotokoll – nach jedem Schritt ein Abschnitt; abgeschlossene Monate in `docs/archiv/STATUS-<JJJJ-MM>.md` (`scripts/status-archiv.py`) |

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

Stand 09.10.2026 (nach 8.2c, 5.5a–c, 8.15, 11.1a, C.3c2, 11.1b, 5.9a–b, 6.3a–b2, 11.4a–b2, C.4a–b, C.5a–b, C.6b, 11.4c, C-18, C-17a–c, C-20a–j3, C-1a–f, C-2, C-3, C-4, C-5a–d, C-6a–e, C-7a–b, C-8, C-10 bis C-16, 11.2a–b, A-4 bis A-7, A-7r, Z1, 12.1–12.3, E8, P1a–b, P2a, E10a, E11, E9-Entwurf, 12.4a, P2b1–b2, P3a–b, P4, P5a–b, P5c1–c2, D1a, D1b1–b2, D1c, D2, D3-Entwurf, 12.6, 12.7a–c, 12.1 C, C-21, C-22a, C-22c, C-24, C-25, C-26, C-22b, 6.1a1–a2, 6.1a3a–c, 6.1a4a, 6.1b1a–b, 6.1b2a–b, 6.1b3, 6.1c1, 6.1c2a, 6.1d, B-1, B-2a–c, B-3 bis B-7, B-8a–c, B-9a, B-15, B-19, B-20a–c, B-10a–b, B-9b1–b2, B-9c1–c3, B-11a–c, B-12a–d, B-13a–e, B-21, B-17a, B-17b1, B-17b2, B-17b3a, B-17b3b und 7.5a–d, B-22, A-14a–b3, E9-3a, B-23, C-28, C-29, A-15a–b, B-24, B-25, A-16, B-26, B-27, B-28, 11.3b, 4.3e, 11.3c1, 11.3c2, B-40, B-41, 11.3c3a, C-30, 11.3c3b, L2-1, L2-2, SH1): protocol 1258 grün (6 übersprungen), node 350 grün
(6 übersprungen, mit Internet – ohne Netz überspringen sich zusätzlich Live-Tests
in `tools.test.ts`), app 1027 grün, mls 13 grün, Zahlkanal 7 grün (gegen Validator), Leak-Tests 73 grün + 1 `todo` (heutige Lecks,
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
   laufende Nummer); wer im neuen Monat den ersten anhängt, verschiebt vorher den
   abgeschlossenen Monat mit `python3 scripts/status-archiv.py` nach `docs/archiv/`.
   Die Zeile „Stand …“ oben zählt, wer merged, nach dem Einmergen von `main` neu.
   Neue Fallstricke unten in der `CLAUDE.md` des Bereichs anhängen, in dem man den
   Fehler macht (Abschnitt „Fallstricke“); betrifft er mehrere Pakete, unten in
   dieser Datei. Bei Konflikten in diesen Dateien und in Sammelstellen
   (`protocol/src/index.ts`, `node/src/main.ts`, `app/src/shell/app.ts`,
   `scripts/*ausnahmen*`) beide Seiten behalten – ein Fallstrick, der im Konflikt
   unten in der Wurzel landet, kommt in die Datei seines Bereichs.
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

Seit C-22b (09.10.2026) stehen hier die Fallstricke, die mehrere Pakete betreffen.
Was man nur in einem Bereich falsch macht, steht in der `CLAUDE.md` dieses Bereichs –
Claude Code lädt sie, sobald eine Datei darin gelesen wird: `packages/app`,
`packages/node`, `packages/protocol`, `packages/mls`, `packages/launcher`,
`packages/website`, `contracts`, `scripts` (Browser-Tests, Installer). Ein Eintrag mit
„Weitere Teile“ geht dort weiter; die Texte sind wörtlich verschoben.

- **`build-site.sh` löscht sein Zielverzeichnis** vollständig. Nie in einen Git-Checkout bauen.
- **Hex aus Fremddaten vor `fromHex()` prüfen:** `fromHex()` (`Buffer.from(h, "hex")`)
  schneidet beim ersten ungültigen Zeichen still ab. Events prüft `verifyEvent()`
  seit 0.J selbst (Form nach NIP-01); jeden anderen fremden Hex-Wert (Hashlock,
  Preimage, Schlüssel aus Tags) vorher mit fester Länge prüfen.
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
- **Programm-ID ungeklärt:** Code nutzt `B6W19U…`, laut `DEPLOY.md` wurde nach
  `3UmRR…` deployt. Nicht ändern ohne MENSCH-Entscheidung (Schritt 0.G).
  Stand 09.10.2026: `3UmRR…` lehnt jeden Aufruf ab (4100), `B6W19U…` nimmt sie
  an (Code vom Juli, `docs/SOLANA-UPGRADE-AUTHORITY.md`).
- **Fristen in Tests nur einmal aus der Uhr berechnen:** Kette (Stub) und
  Event bekommen dieselbe Konstante, nie zweimal `Date.now()`. Sonst ist der
  Test rot, sobald dazwischen die Sekunde umspringt – so war
  `sol-deposit-job.test.ts` bis Schritt 0.H instabil. Ein roter Test gilt seitdem
  nie als Zufall.
- **KI-Anfragen nur privat** (seit 3.1): über `buildJobEvent()` – Autor ist der
  Sitzungsschlüssel aus `kiSitzungen` (nie `state.keypair.pk`), gesendet wird nur
  der Umschlag aus `buildPrivateJobRequest()`. Tags gehören vor dem Versiegeln in
  den Kern; nie nach der Signatur anhängen. `test/leak/ki-anfrage.test.ts` prüft das.
  Seit 3.2 ebenso zurück (Antwort, Rückmeldung) und für Sitzung und Belege; die App
  nimmt nur versiegelte Antworten. Seit 3.4 auch Reklamationen (`buildPrivateDispute`,
  an Provider und Prüfer). Neue KI-Events nie offen veröffentlichen.
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
  `check-website.py` ab, Liste `VERALTET`).
  Eine Provider-Adresse je Knoten (Entscheidung 4.5 A) – keine frischen
  Adressen je Sitzung einführen, ohne den Zahlkanal neu zu denken.
  *(Weitere Teile: `packages/app/CLAUDE.md`, `packages/node/CLAUDE.md`.)*
- **Kurse und Umrechnung nur über `kurs.ts`** (seit 4.4): Marktkurs mit
  `marktKurs()` (eine Stimme je Absender), msat ↔ Lamports mit
  `msatZuLamports()`/`lamportsZuMsat()` (BigInt). 1 SOL = 1e9 Lamports =
  Kurs · 1000 msat – bis 4.4 stand im Knoten eine Tausend zu viel im Nenner.
  Ohne Kurs keinen SOL-Preis erfinden.
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
- **Zahlkanal nur nach `docs/ZAHLKANAL.md`** (seit 4.3a): Client
  `channel.ts`, Programm `contracts/solana-channel` – beide folgen dem Dokument;
  ein anderes Format heißt neues Programm (Präfix `freedomstack-channel-v2`).
  Gutschriften tragen Kanal-Adresse und Ablauf (`gutschriftNachricht()`) und
  reisen nur im versiegelten Kern der Anfrage (`gutschriftTags()`); der Knoten
  nimmt sie nur über `KanalKasse.nimmAn()` an (Kanal auf der Kette, Deckung
  abgerechnet + Gebot) und löst sie nur über `loeseFaelligeEin()` ein – der
  Stand liegt in einer Datei, nie nur im Speicher.
  Die Programm-ID
  (`KANAL_PROGRAMM_ID`, Devnet seit 09.10.2026, 4.3e) ist gleich `declare_id!`
  und `Anchor.toml` (`channel.test.ts` vergleicht) – ändern nur zusammen mit
  einem Deploy oder Upgrade durch den MENSCHEN, nie einen erfundenen Schlüssel.
  *(Weitere Teile: `packages/node/CLAUDE.md`, `contracts/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
- **Kein `readBigInt64LE` & Co. in Code, der im Browser läuft:** Das
  Buffer-Polyfill kennt die BigInt-Methoden nicht – `DataView` nehmen
  (so scheiterte bis 4.6c jede Prüfung einer Sperre in der App, bis 4.6f die
  Selbstprüfung eines Relay-Auftrags). Das gilt auch für Protokoll-Code, den die App lädt.
- **`fetch` nie als Methode speichern** (`this.f = fetch; this.f(…)`): Im Browser
  wirft das „Illegal invocation“, Node merkt es nicht – so scheiterte bis 4.2b
  jede Abfrage des `RpcPool` in der App. Stattdessen `(i, o) => fetch(i, o)`.
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
  Byte-Strecken zum Funkgerät (USB, Bluetooth, TCP-Brücke)
  seit 7.4c1 nur mit `mitLaenge()`/`LaengenRahmen` – zwei Byte Länge je
  Rahmen, sonst fließen Rahmen im Strom ineinander.
  Offene Mesh-Pakete und Kurier-Belege (38030/38031, `mesh.ts`) fielen mit B-21 –
  die Kinds nicht wiederverwenden.
  *(Weitere Teile: `packages/node/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
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
  *(Weitere Teile: `scripts/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
- **Speicherknoten nur verschlüsselt** (seit 8.9a): Wer ins Blob-Netz lädt,
  was Knoten halten sollen, baut mit `buildBlob(…, { verschluesselt: true })`
  und lädt nur Chiffrat hoch; Knoten nehmen Stücke nur über `nimmAuf()` →
  `pruefeSpeicherStueck()` auf. Abruf nur versiegelt (`baueStueckAbruf()`); der
  Knoten veröffentlicht das Stück-Event erneut, statt es in den Umschlag zu
  packen (NIP-44 fasst 64 KB, ein Stück als Hex 128 KB).
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
- **`check-wiring.py --streng` scheitert auch an veralteten Ausnahmen** (5.6b):
  Wird ein ausgenommener Export verdrahtet, muss seine Zeile aus
  `scripts/wiring-ausnahmen.txt` raus – sonst meldet das Skript „veraltete
  Ausnahme“ und endet mit 1, obwohl die Zusammenfassung „0 offen“ sagt. Immer
  den Exit-Code prüfen, nicht nur die letzte Zeile.
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
  Ids zweier Clients überschrieben sich bis 8.4a).
  *(Weitere Teile: `packages/node/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
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
- **Texte nur über Schlüssel** – Fertige Sätze aus dem Protokoll (`note`, `DISPUTE_LABEL`, Kurswarnungen …)
  sind Deutsch – die App bildet sie aus den Feldern neu (seit 8.16e, gesammelt
  in `protokoll-texte.ts`; ein Test hält die deutsche Fassung wortgleich). Gründe
  aus Prüfungen tragen dafür seit 8.16g2b3a eine Kennung `fall` (samt Zahlen) neben
  `grund` – ein neuer Fall braucht Kennung und Text (`pg.*`); der Test liest die
  Fälle aus dem Quelltext des Protokolls. Fehler, die Nutzer sehen können,
  wirft das Protokoll seit 8.16i als `ProtokollFehler(kennung, meldung, werte)`
  (Meldung deutsch wie bisher); die App zeigt Fehler nur über `fehlerText(e)`,
  nie `(e as Error).message` – ein Test findet das. Neue Kennung → Text `pf.*`
  und Eintrag in `FEHLER` (`protokoll-texte.ts`).
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
- **Ruf nur aus Quittungen** (seit 5.5a, `quittung.ts`): Eine Quittung gibt es
  nur mit Nachweis nach 4.8 – Lightning: Rechnung + Preimage
  (`lightningQuittung()`, „belegt“ nur beim angekündigten Knoten), Zahlkanal:
  Preis + deckende Gutschrift (`kanalQuittung()`, „belegt“ erst über
  `kanalBelegt()` mit der Auszahlung auf der Kette). Quittungen nur im Tresor,
  nie auf ein Relay. Rang und Stufe nur aus `berechneRuf()` (eigene Quittungen,
  Zusammenfassungen von Kontakten) – 38010 und andere Selbstauskünfte zählen
  nicht. Die Zusammenfassung (38075) nur versiegelt über
  `baueRufUmschlaege()`, gelesen nur von Kontakten (`oeffneRufUmschlag()`).
  Nie eine öffentliche Rangliste; die Prüferwahl (`netzPruefer()`) bleibt ohne Ruf.
  *(Weitere Teile: `packages/app/CLAUDE.md`, `packages/website/CLAUDE.md`.)*
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
- **Repos in öffentlichen Räumen** (seit 11.4a): Der Verweis ist das `a`-Tag
  `34700:<besitzer>:space:<kennung>` (`raumAdresse()`); zum Raum gehört ein
  Repo nur über `mitRaumRechten()` (Eigentümer hat `repos_pflegen`), den
  Zustand nur über `raumZustandFuer()` bauen – nie `buildSpaceState()` direkt
  mit fremden Definitionen derselben Kennung. Karten werten Raum-Rechte in
  `repoKarten(…, raumEvents)` aus; `darfAnnehmen()`/`patchStatus()` bleiben
  unverändert und bekommen das erweiterte Repo. In privaten Räumen (seit
  11.4b1) Repo-Events nur als innere Events über `raumRepo…()` – nie
  `publish()`, auch nicht den Bundle-Verweis (er trägt den Schlüssel);
  gelesen über `raumReposPrivat()`. Leak-Regel `raum-repo-privat`.
  Issues und Kommentare (seit C-17a, `docs/PROTOCOL.md` 19) nur über
  `baueIssue()`/`baueIssueStatus()` (NIP-34, 1621) und `baueKommentar()`
  (NIP-22, 1111, nur an Issues und Patches); gelesen nur über `leseIssue()`,
  `issueStatus()` (Autorin, Eigentümer, Maintainer) und `kommentareZu()`. Im
  privaten Raum nur `raumRepoIssue()`, `raumRepoIssueStatus()`,
  `raumRepoKommentar()` – Bezüge sind die Ids der inneren Events; die
  Leak-Regel bekommt sie als `innere`.
  Reviews (seit C-20g1, `review.ts`): Zeilenkommentare und Bewertungen sind
  NIP-22-Kommentare am Patch mit einem Tag mehr (`zeile`, `bewertung`) – nur
  über `baueZeilenKommentar()`/`baueBewertung()`, gelesen nur über
  `zeilenKommentareZu()`/`bewertungenZu()` (je Person die neueste, die des
  Patch-Autors zählt nicht); privat nur `raumRepoZeilenKommentar()`/
  `raumRepoBewertung()`. Eine Bewertung ändert den Status nie – annehmen
  bleibt `darfAnnehmen()`; die Diskussion lässt Review-Teile aus (`istReviewTeil()`).
  Releases (seit C-20h1, `repo-release.ts`, Kind 30063 nach NIP-51) nur über
  `baueRepoRelease()`/`baueRepoReleaseRueckzug()`, gelesen nur über `repoReleasesZu()`
  (Eigentümer und Maintainer, je Version die neueste); das Bundle steht samt Schlüssel
  im Release selbst, nie nur über den ersetzbaren Verweis 38042. Privat nur
  `raumRepoRelease()`. `release.ts` ist das Release-Manifest der App (38054) – ein
  anderes Ding; vor dem Anlegen einer Datei nachsehen, ob es sie schon gibt.
  Labels ändern und Zuständige (seit C-20i1, `repo-labels.ts`, NIP-32 Kind 1985) nur über
  `baueLabelStand()` (ganzer Stand je Namensraum, genau ein Ziel), gelesen nur über
  `labelStandZu()` (neueste Aussage von Eigentümer oder Maintainern); Zuständige nie als
  `p`-Tag. Privat nur `raumRepoLabels()`.
  Forks, Sterne, Beobachten (seit C-20j1): Fork nur über `forkVon` in
  `baueRepoAnkuendigung()` (`["a", …, "", "fork"]`); Sterne nur über `baueStern()`/
  `baueSternWeg()`, gezählt nur über `sterneZu()`; Beobachten ist privat – die Liste
  10018 nur über `baueBeobachtungsListe()` mit Chiffrat (NIP-44 an sich selbst über den
  Signer), nie mit offenen Tags, gelesen über `leseBeobachtungsInhalt()`. Keine Zahl
  der Beobachter versprechen – es gibt keine.
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
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
- **Kontakt prüfen nur über `sicherheitscode()`** (seit B-4,
  `sicherheitscode.ts`): Code aus beiden Schlüsseln der Personen
  (`sprichtFuer()`, nie der Geräteschlüssel), Fassung im Hash – eine andere
  Rechnung braucht eine neue Fassung. Der Code reist nie über ein Relay, der
  QR-Code trägt nur die Ziffern. Als geprüft gemerkt wird erst nach dem
  Vergleich (`merkeGeprueft()`), nur in `freedom.kontakte.geprueft` im Tresor
  (die Liste verrät, wen man getroffen hat), je Schlüssel – ein neuer Schlüssel
  ist ungeprüft.
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
  unbekannten), Ausreißer, Herabgestufte, veraltete Angebote (seit L2-1: zwei
  Erneuerungen verpasst, `angebotVeraltet()` – je Auswahl mit der Uhr, in Tests
  `jetzt` übergeben), gerade und länger Ausgefallene; vorn
  zufällig mit 1/Preis² aus `sichererZufall()` – in Tests immer `zufall`
  übergeben, sonst würfelt der Test. Die Stufe kommt nur aus der eigenen
  Messung (ab 20 Anfragen, sonst „neu“), die Qualität nur aus Prüfrunden
  (`Messpunkt.einig`, ab drei Vergleichen `MessStand.qualitaet`). Fällig ist
  eine Runde nur über `PruefBudget.faellig()`/`beginneRunde()` (`PRUEFRUNDE`),
  die zwei zusätzlichen Provider nur aus `waehleZusatz()` (nie eigene Knoten,
  Zufall aus `sichererZufall()`), ausgewertet nur über `werteRundeAus()` – bei
  Streit keine Aussage, nie „richtig“ versprechen.
  *(Weitere Teile: `packages/app/CLAUDE.md`, `packages/website/CLAUDE.md`.)*
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
  immer „offen“ – nie „verschlüsselt“ versprechen.
  Moderatoren offener Räume sind die
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
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
- **Umfragen und Termine nur in der Gruppe** (seit B-15a, `raum-planung.ts`):
  NIP-88 (1068/1018) und NIP-52 (31922/31923/31925) nur als innere Events
  privater Räume über `raumUmfrage()`, `raumStimme()`, `raumTermin()`,
  `raumTerminAntwort()` – nie offen veröffentlichen; ausgewertet nur über
  `raumUmfragen()`/`raumTermine()` mit dem `GruppenRaum` (Schreibrecht im Kanal,
  je Mitglied die letzte Stimme, `geloescht`). Bezüge sind Ids innerer Events.
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
- **Knoten mit Besitzer koppeln nur über `kopplung.ts`** (seit B-8a, L1 A):
  Kopplungscode `freedom-kopplung:1:<knoten>:<geheimnis>` nur aus
  `neueKopplung()`/`leseKopplungscode()`. In einer Anfrage an den eigenen
  Knoten steht nur der Nachweis (`mitBesitzerNachweis()`: HMAC über
  Sitzungsschlüssel und Zeit) – nie das Geheimnis, nur im Kern vor dem
  Versiegeln, nur an den gekoppelten Knoten. Der Knoten erkennt den Besitzer
  nur über `istBesitzer()` und nur bei Anfragen aus einem Umschlag (Leak-Regel
  `besitzer-versiegelt`). Ein neues Geheimnis widerruft alle bisher
  gekoppelten Geräte.
  Halten beim eigenen Knoten (seit B-9b1, L4 A) nur über `baueHalteAuftrag()`
  (Kind 5076, versiegelt, Nachweis, Manifest-Id): Der Knoten hält nur mit
  `istBesitzer()` aus einem Umschlag, nur genau das genannte Manifest
  (`halteManifest()` – `parseBlobManifest()` prüft nichts) und nur Stücke von
  dessen Autor; gehaltene Stücke (`nimmAuf(…, { halten: true })`,
  `gehalten.json`) verdrängt die LRU nie, sie zählen zur Quota. Antworten nur
  über `leseHalteAntwort()`. Leere Füllstücke teilen sich einen Hash – im
  Test je Hash zählen, nicht je Index.
  Den Status des eigenen Knotens (seit B-11a, L6 A) nur über
  `baueStatusAuftrag()` (Kind 5077, versiegelt, Nachweis) und
  `leseKnotenStatus()`; der Knoten antwortet nur mit `istBesitzer()` aus einem
  Umschlag und nur in der Form von `knotenStatusText()` – Zahlen, feste
  Kennungen (`STATUS_ROLLEN`), Modellnamen, nie Text aus Aufträgen. Rollen
  meldet `main.ts` erst, wenn sie gestartet sind (`statusRollen.add()`). Nur
  lesen – Steuern ist eine eigene Entscheidung (L6 B).
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
  *(Weitere Teile: `packages/node/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
- **App vom Knoten nur mit Prüfsumme** – Über http im Heimnetz ist die Seite kein sicherer Kontext: kein
  `crypto.subtle` (Tresor, MLS-Zustand, Suche, Git-Bundles), keine Kamera –
  sicher sind .onion (Tor Browser) und localhost; Texte versprechen dort
  nichts anderes.
  *(Weitere Teile: `packages/node/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
- **In Zufallsdaten nie nach kurzen Zeichenfolgen suchen** (seit B-13a): Ein Test
  `assert.ok(!JSON.stringify(wrap).includes("5079"))` schlägt gelegentlich an – Kennung,
  Schlüssel und Signatur sind Hex, „5079“ steht dort in etwa jedem
  zweihundertsten Lauf zufällig. Was offen nicht stehen darf, über die Struktur
  prüfen (`wrap.tags`, `wrap.kind`); nach Geheimnissen ab 32 Zeichen darf man suchen.
  Ebenso: Entschlüsseln mit falschem Schlüssel wirft bei AES-CBC (NIP-04) nicht
  immer – etwa jeder 256. ergibt ein zufällig gültiges Polster und Unsinn. In Tests
  „liest den Klartext nicht“ prüfen, nie `assert.throws` allein (`nwc.test.ts`).
- **Gratis-Start nur nach `gratis.ts`** (seit A-14a, G1): Ein Knoten verschenkt ein
  Budget je Tag (UTC) für alle zusammen – `gratis` in der `ProviderConfig`, nur aus
  `gratisAusUmgebung()` (ungültig → kein Start), im Angebot nur über `gratisTag()`/
  `leseGratisTag()`. Eine Gratis-Antwort höchstens `tokensJeAntwort` (`maxTokens` und
  `ohneWerkzeuge` – das Modell ruft sonst selbst Werkzeuge, jede Runde mit neuem Limit),
  Werkzeuge und Schwarm nur bezahlt, private Gratis-Anfragen mit den Bits aus dem Angebot.
  Leer → `GratisLeer` mit `["fall", "gratis-leer"]` in der Rückmeldung – nie am Text
  erkennen. Die Bootstrap-Phase bedient Gebote gratis (dieselbe Regel), Gutschriften und
  Sitzungen nie – eine Gutschrift gälte auch später. Kein Kontingent je Schlüssel
  versprechen: Schlüssel kosten nichts.
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
- **Persönliche Angaben in KI-Fragen nur über Platzhalter** (seit D1a,
  `docs/DATENSCHUTZ-PROVIDER.md`): Erkannt wird nur, was eine prüfbare Form hat
  (`ersetzeAngaben()`, `platzhalter.ts` im Protokoll: E-Mail, Telefon, IBAN mit
  Prüfziffer, Karte mit Luhn, IP, Nostr-Schlüssel, Lightning-Rechnung) und Namen
  aus dem eigenen Adressbuch – keine Erkennung per KI, keine Namenslisten, und
  Texte versprechen nichts anderes.
  *(Weitere Teile: `packages/app/CLAUDE.md`.)*
- **Befehle zum Kopieren nur mit Adressen des Projekts** (seit C-21): Der
  Provider-Installer kommt nur von der eigenen Pages-Auslieferung
  (`INSTALLER_URL` in `onboarding.ts`; `build-site.sh` legt `install.sh` und
  `install.sh.sha256` neben die App) oder aus dem Repo. Keine Domain in
  `curl … | bash`, die das Projekt nicht besitzt – `freedomstack.io` gehört
  niemandem von uns (NXDOMAIN). Beispiele für Provider-Einnahmen ohne
  verwahrenden Dienst (`provider@knoten.example.org`, Profil `du@example.com`).
  `check-website.py` (`FREMDE_ADRESSEN`, auch README, PROVIDER, docker-compose,
  Installer) und `onboarding.test.ts` weisen beide alten Adressen ab.
- **Desktop-Hülle nur über das eigene Schema** – Eine neue Oberfläche (seit 6.1a2) nur über `suchUpdate()`
  (`oberflaeche-update.ts`): signierte Events (`ladeManifestEvents()`), k von n je
  Version (alle Dateien gleich), Zeitpunkt der früheste der Signierer, nie älter als
  die laufende, Quellen nur https; eine geladene Datei nur nach `pruefeDatei()`.
  Nie `latestRelease()` für „neuer“ – das nannte auch eine ältere Version so.
  Pakete (seit 6.1a4a) aus `launcher.yml` als Artefakt des Laufs (`SHA256SUMS`, 14 Tage).
  Zum Herunterladen (seit 6.1c2a, Freigabe MENSCH 08.10.) nur über den Job
  „veroeffentlichen“ (Run workflow mit Haken, nur `main`): feste Dateinamen, auf die die
  Website zeigt (`check-website.py` vergleicht sie mit dem Job), Desktop unsigniert; das
  APK nur mit dem festen Schlüssel aus den Secrets (`ANDROID_KEYSTORE` …, nur im Schritt,
  der signiert) – ohne ihn kein APK, nie der Wegwerf-Schlüssel im Release. Der
  AppImage-Bau lädt linuxdeploy und dessen Plugin von GitHub (Tauri, nicht gepinnt).
  Installiert wird eine Oberfläche (seit 6.1a3a) nur nach `update::pruefe()` in der
  Hülle selbst – nie, weil die Oberfläche es sagt: Kennung (NIP-01) und Signatur
  (BIP-340, `k256`) je Beleg, dieselben Regeln wie `suchUpdate()`. Vertraute
  Signierer und k liest `build.rs` aus `release-signierer.ts`/`release.ts` – nie eine
  zweite Liste in Rust. Ändert sich eine Regel, beide Seiten ändern und die
  gemeinsamen Fälle mit `scripts/oberflaeche-vektoren.mts` neu erzeugen.
  *(Weitere Teile: `packages/launcher/CLAUDE.md`, `packages/app/CLAUDE.md`.)*
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
  *(Weitere Teile: `packages/app/CLAUDE.md`, `packages/node/CLAUDE.md`, `scripts/CLAUDE.md`.)*
- **Modelle laden nur geprüft** (seit E9-3a, V3 A aus `docs/E9-ENTWURF.md`): Ein Manifest
  (38057) wählt der Knoten nur über `vertrautesManifest()` (`modell-ollama.ts`) – bis E9-4 nur
  der eigene Schlüssel (Freigabe 08.10.: Kuratoren nur über Kataloge, keine zweite Liste daneben),
  kein voreingestellter Kurator; bei Streit keine Wahl, das eigene geht vor. Ein eigenes legt nur
  `--aus-registry` an (`festhalten()`: signiert, was die Registry jetzt nennt, veröffentlicht über
  den Pool). Für Ollama: `model` = Name bei Ollama mit Tag, `upstream` = `ollama:<derselbe>`,
  Dateien heißen `sha256-<hex>` (Schichten und Konfiguration, `ollamaDateien()`).
  *(Weitere Teile: `packages/node/CLAUDE.md`.)*
- **Rückfall nur nach Stille, Ergebnisse vor Rückmeldungen** (seit L2-2, Lauf 2 des lokalen Agenten):
  Der Knoten meldet „processing“ (7000, versiegelt wie Zwischenstände), sobald er einen Auftrag
  angenommen hat (`meldeBearbeitung()`, nach allen Ablehnungen, vor Werkzeugen; über Funk nie). Die
  App fragt den nächsten nur nach `HEDGE_AFTER_MS` ohne Lebenszeichen (`stummNachMs` in
  `waitForAnswer()`), nur wenn es einen nächsten gibt und nie mit Gutschrift im Zahlkanal
  (`perKanal()`) – ein zweiter Provider bekäme eine zweite. `waitForAnswer()` liest Ergebnisse vor
  Rückmeldungen und eine Ablehnung vor Zwischenständen – bis L2-2 hielt jede Rückmeldung ein
  fertiges Ergebnis bis zur Frist (5 min) auf. Neue Rückmeldungen nie vor Ergebnisse stellen.
- **Nachfolge-Anteile nur über `teileGeheimnis()`** (seit SH1, entschieden 09.10.2026): neue
  Anteile in Fassung 2 mit der auditierten Bibliothek von Privy (`shamir-secret-sharing` 0.0.4,
  exakt gepinnt, Cure53 und Zellic) – ein Anteil ist das Geheimnis plus ein Byte mit seiner Stelle,
  `index` nur die Nummer des Vertrauten. Im Anteil (38077) und in der Übergabe (38079) steht
  `["fassung", "2"]`; ohne Tag ist es Fassung 1 (eigenes GF(256), `splitSecret()` – nur noch für
  Tests). Zusammengesetzt wird nur über `setzeGeheimnisZusammen()` bzw. `setzeNachfolgeZusammen()`
  (beide Fassungen, nie gemischt, async). Die Bibliothek nimmt nur ein echtes `Uint8Array` – kein
  `Buffer` (sie prüft `constructor`); `teileGeheimnis()` kopiert und nullt die Kopie.
