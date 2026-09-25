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

Stand 25.09.2026 (nach 4.7b): protocol 1022 grün (5 übersprungen), node 179 grün
(6 übersprungen, mit Internet – ohne Netz überspringen sich zusätzlich Live-Tests
in `tools.test.ts`), app 248 grün, Leak-Tests 36 grün + 3 `todo` (heutige Lecks,
je mit dem Schritt, der sie schließt – dort wird aus `todo` ein normaler Test).

## Arbeitsweise

1. `docs/ausbau/FORTSCHRITT.md` lesen, den nächsten offenen Schritt nehmen –
   **nur einen pro Sitzung**. Dann die passende Karte `docs/ausbau/phase-N.md`.
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
  in die Nachricht. `uploadBlob()` direkt nur für bewusst Öffentliches (Git-Bundle).
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
- **Kurse und Umrechnung nur über `kurs.ts`** (seit 4.4): Marktkurs mit
  `marktKurs()` (eine Stimme je Absender), msat ↔ Lamports mit
  `msatZuLamports()`/`lamportsZuMsat()` (BigInt). 1 SOL = 1e9 Lamports =
  Kurs · 1000 msat – bis 4.4 stand im Knoten eine Tausend zu viel im Nenner.
  Ohne Kurs keinen SOL-Preis erfinden. In der App zeigen Preise beide Einheiten
  über `preis-anzeige.ts` mit `aktuellerKurs()` (`shell/marktkurs.ts`).
- **`fetch` nie als Methode speichern** (`this.f = fetch; this.f(…)`): Im Browser
  wirft das „Illegal invocation“, Node merkt es nicht – so scheiterte bis 4.2b
  jede Abfrage des `RpcPool` in der App. Stattdessen `(i, o) => fetch(i, o)`.
