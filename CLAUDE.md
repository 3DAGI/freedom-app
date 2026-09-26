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
| `packages/app` | Web-App; `src/shell/app.ts` (Einstieg: `boot()`, `switchTab()`, Identität, Onboarding), `state.ts` (Zustand, Pools), `ui.ts` (Hilfsfunktionen), `datenschutz.ts` (Bericht), `tresor.ts` (Tresor-Dialoge; Krypto in `src/vault.ts`), `bunker.ts` (Anmelden per NIP-46), `tabs/` (je Tab ein Modul: `kommunikation.ts`, `agent.ts` + `agent-netz.ts`, `waehrung.ts`, `earn.ts`, `profil.ts`, `settings.ts`); Build → `dist/freedom.html` |
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
python3 scripts/check-wiring.py --streng
python3 scripts/check-website.py
python3 scripts/check_innerhtml.py packages/app/src --ausnahmen scripts/innerhtml-ausnahmen.txt --streng
python3 scripts/smoke_test.py packages/app/dist         # braucht playwright + chromium
bash scripts/build-site.sh /tmp/site                     # Website bauen (Ziel wird gelöscht!)
```

Stand 26.09.2026 (nach 8.7): protocol 1117 grün (6 übersprungen), node 226 grün
(6 übersprungen, mit Internet – ohne Netz überspringen sich zusätzlich Live-Tests
in `tools.test.ts`), app 332 grün, Leak-Tests 48 grün + 2 `todo` (heutige Lecks,
je mit dem Schritt, der sie schließt – dort wird aus `todo` ein normaler Test;
Ausnahme: gesendete SOL-Zahlungen von frischen Adressen, eine bewusste Grenze
nach Entscheidung 4.9 A – im Datenschutzbericht unter „Bewusste Grenzen“).

## Arbeitsweise

1. `docs/ausbau/FORTSCHRITT.md` lesen, den nächsten offenen Schritt **der eigenen
   Spur** nehmen (Abschnitt „Zwei Spuren“) – **nur einen pro Sitzung**. Dann die passende Karte `docs/ausbau/phase-N.md`.
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

## Zwei Agenten parallel (seit 26.09.2026)

Zwei Agenten arbeiten gleichzeitig in getrennten Spuren (Tabelle in
`docs/ausbau/FORTSCHRITT.md`). Damit sie sich nicht gegenseitig brechen:

1. **Nur Schritte der eigenen Spur.** Muss ein Schritt Code der anderen Spur
   ändern, klein halten und im Pull Request nennen.
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
5. **Knoten-Stand:** Ein Update des GX10-Knotens auf `main` deckt beide Spuren
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
  Inline-Handler, kein `eval`. WASM bräuchte `'wasm-unsafe-eval'` → vorher fragen.
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
  Lightning nur mit Preimage + Rechnung, die dessen Knoten signiert hat
  (`leseBolt11()`), Solana nur mit der Kette (`verifyFeeProofMitKette`). Ein
  Preimage allein oder eine bloße Signatur ist „angekündigt“. Rechnungen von
  LNURL-Servern vor dem Zahlen auf den Betrag prüfen.
- **Kurse und Umrechnung nur über `kurs.ts`** (seit 4.4): Marktkurs mit
  `marktKurs()` (eine Stimme je Absender), msat ↔ Lamports mit
  `msatZuLamports()`/`lamportsZuMsat()` (BigInt). 1 SOL = 1e9 Lamports =
  Kurs · 1000 msat – bis 4.4 stand im Knoten eine Tausend zu viel im Nenner.
  Ohne Kurs keinen SOL-Preis erfinden. In der App zeigen Preise beide Einheiten
  über `preis-anzeige.ts` mit `aktuellerKurs()` (`shell/marktkurs.ts`).
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
  Warteschlange, nie `transport.send()` am Konto vorbei.
- **Keine fest verdrahteten Relays** (seit 5.4a): Die Startliste steht nur in
  `STARTRELAYS` (`protocol/src/relay-start.ts`, `startUrls()`); die App baut den
  Pool mit `poolRelays()` (eigener Satz + wechselnd weitere). Eigene Listen
  (Kind 10002/10050) nur über `eigeneListenAbgleichen()` – die veröffentlichte
  NIP-65-Liste gilt, nie neu würfeln, wenn zu wenige Relays antworteten.
  Direktnachrichten nur an den Posteingang des Empfängers (`veroeffentlicheAn()`).
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
