# App (`packages/app`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter `packages/app/`
gelesen wird. Hier steht, was man nur in der App (Oberfläche, Shell, App-Bausteine)
falsch macht – verschoben aus der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag
mit „Weitere Teile“ geht in der Wurzel oder einem anderen Bereich weiter. Neue
Fallstricke dieses Bereichs unten anhängen.

## Fallstricke

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
- **Direktnachrichten nur nach NIP-17** (`buildPrivateDm`, Kind 1059). Nie Kind 4
  senden – `app/test/dm-verdrahtung.test.ts` prüft das.
- **Signieren nur über den Signer:** `await signiere(ev)` (`shell/state.ts`),
  Ver-/Entschlüsseln über `state.signer.nip44…` – sonst funktioniert der Pfad
  mit einem entfernten Signer (NIP-46) nicht. `state.keypair` hat seit 1.3e nur
  noch `pk`; den rohen Schlüssel gibt es nur über `mitRohemSchluessel(wofuer, fn)`
  und nur für das, was ohne ihn nicht geht (Sicherung, Nachfolge, Swap-Adressen,
  Export) – synchron, die Kopie wird danach genullt. Mit Bunker (`mitBunker()`)
  gibt es ihn nicht: solche Funktionen sperren, nicht scheitern lassen.
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
- **Solana-RPC:** Die App spricht standardmäßig Mainnet an; für Devnet-Tests in
  den Settings `https://api.devnet.solana.com` eintragen.
- **Gebühren nur über `aufteilung.ts`** – Die App zahlt seit
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
  Die App
  liest die Kanäle des eigenen Knotens (seit 4.5b, `verdienst.ts`) nur im
  geöffneten Earn-Tab (`zeigeSolEinnahmen()`), nie beim Start – die Abfrage
  nennt dem RPC-Anbieter die Adresse.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/node/CLAUDE.md`.)*
- **Kurse und Umrechnung nur über `kurs.ts`** – In der App zeigen Preise beide Einheiten
  über `preis-anzeige.ts` mit `aktuellerKurs()` (`shell/marktkurs.ts`). Welche
  zuerst steht, bestimmt seit 12.1 nur `anzeigeEinheit()` (`standard-schiene.ts`:
  eigene Wahl `freedom.anzeigeEinheit`, sonst SOL bei SOL als Standard-Schiene,
  sonst jeder Betrag in seiner Einheit); Umgerechnetes trägt immer „≈“, der
  genaue Betrag steht dabei. Gewählt wird sie (seit 12.1 C) nur über
  `#anzeige-einheit` in Währung › Zahlen – „automatisch“ entfernt die Wahl.
  Einnahmen (seit C-2) in der Einheit ihrer Kette über `einnahmeText()` – das
  Leistungs-Event nennt nur msat, SOL also nur „≈“ mit dem Kurs von jetzt.
  *(Weitere Teile: Wurzel (`CLAUDE.md`).)*
- **Zahlkanal nur nach `docs/ZAHLKANAL.md`** – In der App (seit 4.3d1) nur über `KanalBuch` (`zahlkanal.ts`, Tresor
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
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/node/CLAUDE.md`, `contracts/CLAUDE.md`.)*
- **HTLC-Transaktionen nur mit `htlcSigner()`** (`tabs/waehrung.ts`, seit 4.6c):
  Wallets nach dem Wallet Standard haben kein `publicKey`-Feld – `solWallet.provider`
  direkt als `WalletSigner` brach Einlösen, Deposit und Rückholen ab. Jede neue
  Sperre vor dem Anlegen mit `rememberLock()` merken, damit der Rückhol-Wächter sie kennt.
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
- **Mesh nur verschlüsselt** – In der App (seit 7.4c2)
  KI über Funk nur über `shell/ki-ueber-funk.ts`: Gateway nur aus einem
  Angebot mit `["funk","gateway"]`, gemerkt im Tresor (`freedom.funk.gateway`);
  bezahlt nur per Zahlkanal-Gutschrift zum gemerkten Kurs oder gratis – nie
  Lightning; Antworten aus dem Funk erst `nimmFunkAntwort()`, dann weiterverteilen.
  Gesendet wird (seit 7.4c3) nur die Frage, erst nach `funkGeraetVerbunden()` –
  sonst wäre eine Gutschrift gemerkt, die nie hinausgeht.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/node/CLAUDE.md`.)*
- **Keine fest verdrahteten Relays** – Der Relay-Stand in der Navigation kommt seit C-16 nur aus `WebSocketRelay.verbunden`
  (nur lesend, offene Leitung) – nie die Zahl im Pool als „verbunden“ ausgeben; eine
  Verbindung entsteht erst beim ersten Gebrauch.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `scripts/CLAUDE.md`.)*
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
- **MLS-Baustein** – In der App (seit 2.2b-b) nur
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
  *(Weitere Teile: `packages/mls/CLAUDE.md`.)*
- **Streitfall-Prüfer nur aus dem eigenen Netz** (seit 5.6): Prüfer über
  `netzPruefer()` (Kontakte, eigene Provider) – nie aus einer Rangliste; die
  Reklamation nennt ihn, und nur sein Urteil zählt (`resolveDispute()`).
  Frage und Antwort nur mit Zustimmung und nur über `materialFuerPruefer`.
  Das Urteil nur versiegelt (`buildPrivateUrteil()`), an Sitzungsschlüssel und
  Provider. Eigene Reklamationen tragen den Sitzungsschlüssel – nur im Tresor
  (`freedom.reklamationen`, in `SICHERUNG_NIE`). Prüfaufträge kommen über den
  Posteingang (`alsPruefauftrag()`); ihr Inhalt bleibt nur im Speicher.
- **Abdeckungskarte nur mit Wegwerfschlüssel** (seit 5.10a): Einträge über
  `baueCoverageEintrag()` (eigener Schlüssel je Eintrag, NIP-40-Ablauf), nie mit
  `signiere()`/der Identität; Widerruf nur über `baueCoverageWiderruf()`, der
  Schlüssel liegt nur im Tresor (`freedom.coverage.eintrag`). Die k-Schwelle
  schützt nur die Anzeige – Texte dürfen nichts anderes versprechen.
- **Relay-Rolle nur nach den Regeln aus `relay-zugang.ts`** – In der App (seit 8.4c)
  Relay-Verbindungen nur über `relayVerbindung()` (`shell/state.ts`): anmelden
  nur auf Verlangen und nur, wo `darfAnmelden()` es erlaubt (eigene Relays,
  gekaufter Zugang), über `signiere()` – nie mit einem Sitzungsschlüssel. Kauf
  nur über `kaufeRelayZugang()` (Angebot geprüft und gemerkt, bevor gezahlt wird).
  Verlängern (seit E11 B) nur auf Klick über denselben Kauf mit Rückfrage und
  derselben Schiene (`schieneZumVerlaengern()`); erinnert wird über
  `zuErinnern()` nur aus dem Gemerkten, einmal am Tag – nie automatisch zahlen
  (ein Abo über den Zahlkanal erst nach dem Devnet-Deploy, E11 A).
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/node/CLAUDE.md`.)*
- **Verkehrsmuster** (seit 6.4): Direktnachrichten (NIP-17) nur über
  `versendeVerzoegert()` (`shell/versand.ts`) – jede Kopie einzeln, nie alle
  im selben Augenblick (Regel „kopien-entkoppelt“); was wartet, steht als
  „wird gesendet“ im Verlauf (`unterwegs`) und geht beim Verlassen der Seite
  sofort hinaus. Periodische Abrufe nur über `abrufTakt.melde()` (Zufall im
  Abstand, gebündelt), kein neues `setInterval` fürs Netz. Zufall für
  Datenschutz nur aus `sichererZufall()`, nie `Math.random`.
- **Texte nur über Schlüssel** (seit 8.16a): Sichtbare Texte stehen in
  `app/src/texte/<bereich>.ts` mit `de` und `en` (beide Pflicht), im HTML über
  `data-i18n` (`-ph`, `-title`, `-aria`), im Code über `t("schlüssel", { wert })`.
  Nur Deutsch und Englisch. `app/test/i18n.test.ts` findet rohen Text in
  `index.html` und in jeder Datei des Codes – seit 8.16g2a streng: überall 0,
  auch in neuen Dateien (keine Tabelle offener Stellen mehr). Was Daten
  sind (gesendet oder gespeichert, z. B. Kanalnamen eines Raums), trägt am
  Zeilenende `// kein UI-Text`. Zahlen und Daten mit `gebietsschema()`, nie
  fest `"de-DE"`. Der Smoke-Test läuft mit `locale="de-DE"`.
  In Tests
  ist die Sprache Englisch; wer Meldungen wörtlich auf Deutsch prüft, setzt
  `setLang("de")`. Kennungen, die der Code vergleicht (z. B. Ergebnis einer
  Einladung), bleiben Daten – übersetzt wird erst die Anzeige
  (`einladungsText()`); nie an einem deutschen Text erkennen, was geschah
  (`BrowserKannNicht` statt `startsWith("Dieser Browser")`). Die Sprache setzt
  `boot()` vor allem anderen – der Entsperr-Dialog kommt vor `starte()`.
  *(Weitere Teile: Wurzel (`CLAUDE.md`).)*
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
- **Ruf nur aus Quittungen** – In der App (seit 5.5b) nur über `shell/quittungen.ts`: Quittungsbuch
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
  `freedom.ruf.kontakte` (Tresor, `SICHERUNG_NIE`).
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/website/CLAUDE.md`.)*
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
- **Barrierefreiheit gemessen** (seit C-4): Jedes Bedienelement braucht einen
  Namen für Vorleser – ein Platzhalter oder Tooltip allein reicht nicht, dazu
  `data-i18n-aria` (gern derselbe Schlüssel). Schrift mit Kontrast nach WCAG AA
  (4,5:1, groß 3:1): Rot als Schrift ist `--red-text`, nicht `--red`; Lesbares
  nie über `opacity` dämpfen (sie trifft auch die Schrift darin), sondern über
  die Farbe. Was anklickbar ist, geht mit der Tastatur (Knopf oder
  `role="button"` + `tabindex="0"` + Enter/Leertaste), kein `tabindex > 0`.
  `zugang.test.ts` prüft `index.html`, der Smoke-Test („zugang“) jede Seite und
  jeden Unterreiter auf Desktop und Handy.
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
- **Repos in öffentlichen Räumen** – In der App
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
  In der App (seit C-17b1) Reiter
  „Issues“ in `shell/tabs/issues-reiter.ts`: Karten bekommen Issues nur über
  `mitIssues()` – öffentliche nur an öffentliche Karten, private nur aus ihrer
  Gruppe, nie gemischt; anlegen öffentlich signiert, privat nur über
  `sendeInRaum()`; gezeigt nur als Text. Kommentieren (seit C-17b2/C-17c,
  Issues und Patches) nur über `diskussion()` (`shell/tabs/diskussion.ts`),
  Status nur über `setzeIssueStatus()` und nur, wo `darfStatus` gilt –
  beides privat nur `sendeInRaum()`; Kommentare an Patches nur aus
  `mitIssues()` (`patchKommentare`). Zwei Status-Wechsel im Test mindestens
  eine Sekunde auseinander – Status zählen nach Sekunden.
  In der App (seit C-20g2) nur über `shell/tabs/review-ui.ts` (`reviewAnsicht()`),
  Daten nur aus `mitIssues()` (`patchReviews`); die Knöpfe „+“ an den Zeilen erst mit
  „Zeilen kommentieren“ (`display: none` vorher – sonst wären mobil alle Zeilen 40 px hoch).
  In der App (seit C-20h2) Reiter „Releases“ nur über `shell/tabs/releases-reiter.ts`:
  geladen nach Repo-Adresse wie Issues, an die Karte nur über `mitIssues()` (`releases`);
  veröffentlichen und zurückziehen nur mit `darfAnnehmen()`, privat nur `sendeInRaum()`.
  In der App (seit C-20i2) nur über `labelLeiste()` (`shell/tabs/labels-ui.ts`) auf
  Issue- und Patch-Seite; der Stand kommt nur aus `mitIssues()` (ersetzt die `t`-Tags,
  `patchLabels`), ändern nur mit `darfAnnehmen()`, privat nur `sendeInRaum()`.
  In der App (seit C-20j2) nur über `shell/tabs/repo-sterne-ui.ts`: Stern erst nach
  `bestaetige()`, Beobachten nur nach frischem, strengem `ladeBeobachtet(pool, true)` (auch ein
  Fehler beim Entschlüsseln bricht ab – sonst überschriebe man
  eine Fassung eines anderen Geräts), Daten an die Karten nur über `mitSternen()` – nur
  öffentliche Repos. Beobachtete Repos zählen in `beteiligt()` mit.
  Forks in der App (seit C-20j3) nur über `forkZeile()` (`shell/tabs/fork-ui.ts`): nie das
  eigene Repo, nie über ein eigenes gleicher Kennung (`eigeneKennungen()`), das Bundle nur
  als Verweis auf denselben Blob (nichts neu hochladen); Daten nur über `mitForks()`.
  *(Weitere Teile: Wurzel (`CLAUDE.md`).)*
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
- **Datenexport nur über `datenexport.ts`** (seit B-6): hinein nur
  `waehleExport()` (die Liste der Sicherung plus `EXPORT_ZUSAETZLICH`), zurück
  nur `filtereExport()` – nie Schlüssel, Zugänge, Geld-Geheimnisse, Anteile,
  Gruppenschlüssel, auch nicht aus einer fremden Datei. Verschlüsselt nur mit
  `verschluesseleMitPassphrase()` (Format und Parameter des Tresors), die
  Passphrase nur im Dialog (`verdeckt: true`). Was nie auf ein Relay darf
  (Quittungen, KI-Verläufe), steht in `EXPORT_ZUSAETZLICH`, nicht in
  `SICHERUNG_EINTRAEGE`.
- **Kein Vergleichen für Kunden** – Ausgeführt (seit P5c2) nur über
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
  beim Öffnen des Reiters.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/website/CLAUDE.md`.)*
- **Offene Räume nur über die Adresse des Gründers** – In der App (seit B-20b)
  „Kanal anlegen“ offen nur mit `darfKanaele()` und nur über `baueRaumKanal()`
  – nie eine neue Definition (34700) dafür.
  Neues anderer (seit B-25, Nutzertest R-9) nur über `lauscheImRaum()`: ein Abo je
  gewähltem offenen Raum, ab dem Öffnen (`since`), Nachrichten (42, `#space`) und
  Maßnahmen (34551/34552, `#h`), beendet beim Wechsel (`beendeLiveAbo()`) – nie ein
  Abfragetakt dafür. Den Kanal zeichnet `zeichneLiveNeu()` nur neu, wenn man ihn sieht
  (sonst spränge der Lesestand); im Smoke-Test („raum“, `live`) über `ProbeRelay.zustellen()`.
  Anlegen (seit B-26, Nutzertest R-6/R-5): „+“ in der Leiste fragt erst die Art (`waehleRaumArt()`,
  auch ohne Raum; ohne Tresor öffentlich vorgewählt), den Namen dann `legeRaumAn()` wie aus dem
  Menü; privat nur nach `privatMoeglich()` – ohne Tresor erst sagen und `richteTresorEin()`
  anbieten, nie erst nach dem Namen scheitern.
  *(Weitere Teile: Wurzel (`CLAUDE.md`).)*
- **Umfragen und Termine nur in der Gruppe** – In der App (seit B-15b) nur über `shell/raum-planung-ui.ts`: gesendet nur
  mit `mlsSendeEvent(raum.gruppe, …)`, gezeigt nur als Text über dem Verlauf
  des Kanals (`zeigePlanung()`), die Knöpfe nur privat und mit Schreibrecht.
  *(Weitere Teile: Wurzel (`CLAUDE.md`).)*
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
- **Knoten mit Besitzer koppeln nur über `kopplung.ts`** – In der App (seit B-8c) nur
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
  In der App (seit B-11b) nur über `zeigeKnotenStatus()`
  (`shell/knoten-status-ui.ts`): nur auf Klick, nur gekoppelt, über
  `wegZumKnoten()`; gezeigt nur `statusZeilen()` als Text (Rollen über
  `ROLLEN_TEXT`, Beträge über `ausMsat()`). Nichts davon wird gemerkt.
  In der App (seit B-12d2) nur über den Haken „Wecken“ (`shell/wecken-ui.ts`):
  nur auf Klick, nie beim Start; der VAPID-Schlüssel nur aus dem Status des
  eigenen Knotens (`frageKnotenStatus()`), angemeldet nur über `wegZumKnoten()`
  mit `baueWeckAnmeldung()` – Schlüssel aus `weckSchluesselFuer()` (Person und
  Geräte wie bei `auchFuer`). Bestätigt der Knoten nicht, wird alles lokal
  wieder abgemeldet; der Haken zeigt nur, ob es ein Abo gibt (nichts gemerkt).
  `serviceWorker.register(` steht nur dort (`notfall.test.ts`); Entkoppeln und
  Notfall-Löschung rufen `weckerAbmelden()`. Auf die Antwort des eigenen
  Knotens nur über `warteAufKnoten()` (`shell/knoten-weg-ui.ts`) warten.
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
  Bunker; die öffnet seit A-15a das Abo für Post, je Umschlag einmal). Klingeln `KLINGELN_SEK` = 180, immer kürzer als `ANRUF_GRENZEN.ablaufSek`.
  Im Smoke-Test kommt das Angebot nur über `ProbeRelay.zustellen()` (offene Abos).
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/node/CLAUDE.md`.)*
- **App vom Knoten nur mit Prüfsumme** – In der App (seit B-10b) vorher `verschluesselungMoeglich()`
  (`sicherer-kontext.ts`): `richteTresorEin()` zeigt dann nur den Hinweis,
  Bundles werfen `BundleFehler("unsicher")` – neues, das `crypto.subtle`
  braucht, prüft ebenso und sagt es, statt mit einer fremden Meldung zu
  scheitern. Im Smoke-Test („unsicher“) nachgestellt per Init-Skript.
  *(Weitere Teile: `packages/node/CLAUDE.md`, Wurzel (`CLAUDE.md`).)*
- **Sprachnachrichten nur über `SprachAufnahme`** (seit C-7, `sprachnachricht.ts`,
  Oberfläche `shell/sprachnachricht-ui.ts`): das Mikrofon nur aus `starte()` auf
  Klick, nie beim Laden; nach jedem Ende alle Spuren stoppen (beendet, verworfen,
  Grenze, Fehler, späte Erlaubnis). Die Aufnahme ist ein Anhang wie jede Datei –
  nur über `handleChatFiles()` (Regel „Anhänge nur verschlüsselt“), nie eigene
  Uploads. Abspielen nur mit geprüftem Typ (`istAudioTyp()`); im Smoke-Test ersetzt
  eine Attrappe (Oszillator) das Mikrofon und zählt jede Anfrage.
- **Gratis-Start nur nach `gratis.ts`** – In der App (seit A-14b1) Gratis-Fragen (Gebot 0)
  nur an `gratisKandidaten()` (gerade `free`, Bits machbar), Rechenarbeit nur über
  `powFuerAnfrage()` (nie beim eigenen Knoten); das Kontingent je Gerät (20 Antworten oder
  20 000 Tokens am Tag) nur über `geraeteKontingent` (`gratis-kontingent.ts`,
  `freedom.gratis.kontingent` in `geheim`, nie in der Sicherung) – vor dem Senden prüfen,
  nach der Antwort aus `usage` zählen. Texte nennen es eine Fairness-Regel, keine Sperre.
  `gratis-leer` nur am Tag `fall` erkennen (`waitForAnswer()` liefert `fall`); wer es heute
  meldete, bekommt bis morgen keine Gratis-Frage (`merkeGratisLeer()`, `gratisAnbieter()`).
  Tarif „Automatisch“ (Vorgabe seit A-14b2) entscheidet nur `waehleAuto()`: gratis, solange
  Kontingent und Gratis-Anbieter da sind; sonst bezahlt – an jedem Tag erst nach
  `bestaetige()` (seit A-14b3, MENSCH 09.10.: gemerkt wird der Tag in
  `freedom.gratis.bezahlenOk`, gelesen nur über `zustimmungGilt()`), ohne Schiene
  (`eineSchieneDa()`) nie; über Funk nur gratis. Nie still bezahlen. Smoke-Test „gratis_auto“.
  *(Weitere Teile: Wurzel (`CLAUDE.md`).)*
- **OpenTimestamps nur über `ots.ts`** – In der App (seit B-17b3a, K1–K3 A) nur über `shell/zeitanker-takt.ts`: vorgemerkt wird ein
  eigenes Mandat nach dem Veröffentlichen (`ankereMandat()`) und eine Quittung nach dem Ablegen
  (`ankereQuittung()`, Wert `quittungsDigest()` ohne Stand); gestempelt, nachgereicht und das
  Mandat als 1040 veröffentlicht nur im Abruftakt (`zeitankerTakt()`, ohne Anker kein Netz) – als
  Gerät nie. Beweise nur in `freedom.zeitanker` (`geheim`, `SICHERUNG_NIE`, im Export); der zur
  Quittung geht nie hinaus. Grenze „zeitanker“ im Bericht nennt dieselben Kalender wie `OTS_KALENDER`.
  *(Weitere Teile: `packages/protocol/CLAUDE.md`.)*
- **Persönliche Angaben in KI-Fragen nur über Platzhalter** – In der App nur über `shell/ki-platzhalter.ts`:
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
  *(Weitere Teile: Wurzel (`CLAUDE.md`).)*
- **Desktop-Hülle nur über das eigene Schema** – In der App (seit 6.1a3c) nur über `shell/oberflaeche-huelle.ts`: die Hülle nur an
  `__FREEDOM_NATIVE__` plus Tauri-Aufruf erkennen (`huellenAufruf()`), laden nur
  `ladeOberflaeche()` (Quelle für Quelle, nur die angebotene Datei), übergeben nur
  `uebergibHuelle()` nach `bestaetige()` – nie ein Kommando am Modul vorbei. In der
  Hülle unter Linux lässt die CSP kein `fetch` auf `freedom://` zu: die Prüfsumme der
  eigenen Datei dort aus `oberflaeche_stand`, Selbst-Export geht nicht (H1, MENSCH).
  In der App (seit 6.1b1b) nur über `shell/netz-huelle.ts`: Schalter `#huelle-tor` nur in der
  Hülle (`huellenArt()`, seit 6.1b2b auch Android) und nur mit `verfuegbar`, umschalten nur nach
  `bestaetige(torRueckfrage())` mit Neustart (`setzeTor()`; Android: „App schließen“); Texte sagen „es geht nichts hinaus“ statt Ausweichen, Anrufe nicht über Tor.
  *(Weitere Teile: `packages/launcher/CLAUDE.md`, Wurzel (`CLAUDE.md`).)*
- **Meshtastic nur über `meshtastic.ts`** – USB (seit 7.5b) nur über `erkenneSerielleStrecke()` (`meshtastic-strecke.ts`, aus
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
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/node/CLAUDE.md`, `scripts/CLAUDE.md`.)*
- **Formularfelder in einer Reihe nur mit eigener Breite** (seit C-28, Nutzertest C-1/C-13):
  Die Grundregel `input, textarea, select { width: 100% }` (`app.css`) macht jedes Feld so
  breit wie sein Kasten. In einer Flex-Reihe, deren Kinder nicht schrumpfen
  (`.chat-composer > * { flex-shrink: 0 }`), nimmt so ein Feld die ganze Zeile – so wurde das
  Textfeld 22 px schmal und „Senden“ lag am Handy außerhalb. Felder in Reihen bekommen
  `width: auto` (und `margin-bottom: 0`). Die Eingabe einer offenen Unterhaltung misst der
  Smoke-Test „composer“ (Desktop, Handy hoch und quer).
- **Post sofort nur über `lauscheAufPost()`** (seit A-15a, `post-live.ts`, Befund C-12): ein Abo an
  den eigenen Schlüssel ohne `since` – Chat-Umschläge sind bis zu zwei Tage zurückdatiert, ein Abo
  „ab jetzt“ sähe sie nie – mit `limit: 1`, gestartet erst am Ende eines Abgleichs (was lag, ist dann
  geöffnet; die MLS-Engine lädt nicht früher als bisher). Geöffnet nur über `ordneEin()` →
  `oeffneUmschlag()`, dieselbe Kette wie der Abgleich, je Umschlag einmal (`dmCache`), höchstens
  `POST_LIVE_JE_MINUTE` je Minute (Flut, Bunker) und nie Anrufe (die hat `lauscheAufAnrufe()`).
  Kein Zeitgeber dafür. Im Smoke-Test („post_live“) kommt die Nachricht über `ProbeRelay.zustellen()`
  und zusätzlich in `relay.events` – die offene Unterhaltung lädt danach vom Relay nach.
  MLS in der offenen Unterhaltung (seit A-15b) nur über `lauscheAufGruppe()` (`shell/gruppe-live.ts`,
  aus `loadChatMessages()` der offenen): je eine Gruppe, Filter aus `mlsGruppenAbo()` (`limit: 1`) und
  nur an deren Relays über `abonniereAn()` – nie `pool.subscribe()` mit `#h`, das nennte die Gruppe
  allen Relays. Ein Treffer stößt nur an; empfangen wird über `mlsAbgleichen()` hinter `Nachziehen`
  (nie zwei Läufe zugleich – sonst „MLS beschäftigt“).
- **Relays außerhalb des Pools nur über Nebenverbindungen** (seit A-16, `neben-verbindungen.ts`, Befund
  N-1): `frageAn()`, `veroeffentlicheAn()` und `abonniereAn()` teilen die Ziele mit `teileZiele()` – Relays
  des Pools über dessen Verbindung (`queryAn()`, `publishAn()`, `subscribeAn()`), die übrigen über `neben`
  (je Identität und Adresse eine, nach `NEBEN_GRENZEN.ruheMs` ohne Gebrauch zu, höchstens `max`). Keine
  Verbindung je Aufruf mehr (`autoReconnect: false` + `close()`), ein Test findet das. Wer eine holt
  (`hole()`), gibt sie zurück (`gib()`, sonst bleibt sie offen) – am einfachsten über `mit()`. `frageAn()`
  gibt nur gültig Signiertes weiter, auch von fremden Relays.
- **Ersatzschlüssel nur über `ersatz-datei.ts`** (seit B-28, Nutzertest T-2): „Diebstahl
  vorbeugen“ fragt vor dem Erzeugen nach einer Passphrase (nur mit `verschluesselungMoeglich()`);
  mit ihr entsteht die Datei nur über `baueErsatzDatei()` im Format des Tresors
  (`verschluesseleMitPassphrase()`, JSON mit `art`, der private Schlüssel nie im Klartext), ohne
  sie wie bisher als Text. Der Widerruf liest Hex oder diese Datei nur über `leseErsatz()` – vor
  `fromHex()`; eine falsche Passphrase meldet einen festen Text, nie die Meldung des Browsers.
- **Agenten auf dem Gerät nur über `agenten-buch.ts`** (seit 11.3c1, Entwurf
  `docs/AGENTEN-RAUM-ENTWURF.md`): Schlüssel und Persona nur in `freedom.agenten` (`geheim`,
  `SICHERUNG_NIE`), angelegt erst nach `verlangeTresor()` (`legeGeraeteAgentAn()`), als Gerät nie.
  Ein Agent zahlt nur, was `reicht()` durchlässt (je Raum Monat und Tag, UTC, in der Einheit der
  Schiene), verbucht mit `buche()`; „Budget erreicht“ sagt er je Zeitraum einmal (`meldeEinmal()`).
  In offene Räume nur über `ladeAgentInOffenenRaum()` (`shell/agenten.ts`): nur mit
  `rollen_vergeben`, die Rolle `agent` legt nur der Gründer an und nur mit Grundrechten
  (`mitAgentRolle()`), die Karte signiert der Agent, die Liste 30000 nennt nur Agenten offener Räume
  (`inOffenenRaeumen()`, Agenten anderer Geräte bleiben), der Pflicht-Hinweis im Raum ohne
  Erwähnung – sonst löste er den Agenten aus. Die Persona verlässt das Gerät nur versiegelt im Auftrag.
  Beantwortet (seit 11.3c2) nur über `shell/agenten-lauschen.ts`: ein Abo ab jetzt auf 42 mit `#p` der
  Agenten dieses Geräts (`starteGeraeteAgenten()`, im Abruftakt nur geprüft), je Agent eine Erwähnung nach der
  anderen; erst `entscheide()` (seit 11.3d1a aus `agent-raum.ts` im Protokoll, Stand des Raums, Schalter der Ketten nur aus der Definition des
  Gründers), dann `reicht()` mit dem Gebot in der Einheit des Budgets (msat nur Lightning, Lamports nur mit Zahlkanal),
  dann der Auftrag: versiegelt vom Sitzungsschlüssel je Agent und Raum (`AgentSitzungen`), Platzhalter je Auftrag
  (`maskiereEinzeln()`), nie mit Verweis auf den Raum oder der Identität, bezahlt nur über `ki-zahlung.ts`; verbucht
  höchstens das Gebot. An den Provider gehen Absender nur als „Person 1“/„Agent 1“ (`agentPrompt()`).
  In privaten Räumen (seit 11.3c3a) hat jeder Agent ein eigenes MLS-Konto (`agentKonto()`, `shell/agent-mls.ts`,
  IndexedDB `freedom-agenten-mls` je Agent ein Eintrag, in `WIPE_DATENBANKEN`) – nie das der Identität. Eingeladen
  wird nur über `ladeAgentInPrivatenRaum()` → `mlsLadeAgentEin()`: KeyPackage vom Gerät (erst sichern, dann
  einladen), die Einladung reicht `uebergib` direkt seinem Konto – nie an ein Relay, nur der Commit geht an die
  Gruppe. Danach nur innere Events: Raumstand, Karte vom Agenten, Liste des Besitzers, Hinweis ohne Erwähnung.
  Beantwortet (seit 11.3c3b) nur über `setzePrivatAuf()` (`shell/agenten-lauschen.ts`) – die Engine lädt dafür erst im
  Abruftakt (`agentenImTakt`), nie beim Start: je Agent und Gruppe ein Abo an die Relays der Gruppe, vorher alles
  nachholen (`agentAbgleichen()`, auch Commits – wer einen auslässt, liest danach nichts mehr; Verlauf vor dem Zustand),
  beantwortet nur, was nach dem Abo kam. Agenten im privaten Raum erkennt man an ihrer Karte (`agentRaum().agenten`),
  nicht an einer Rolle; geschrieben wird nur über `agentSendet()` (inneres Event, gleich in den eigenen Verlauf).
  Auftrag und Bezahlung teilen offene und private Räume (`frageUndZahle()`).
  Erwähnt wird (seit 11.3d1b1) auch über „@Name“ im Text – nur über `erwaehnteAgenten()` mit den Karten des
  Raums (offen `agentKartenIm()`: Rolle `agent`, gültige Karte; privat `raumAgentKarten()`), nie aus dem Text allein.
  Agenten auf dem Knoten fragt die App (seit 11.3d1b2) nur über `frageKnotenAgenten()` (`shell/knoten-agent-fragen.ts`)
  nach dem Senden im offenen Raum: nur wen `zuBezahlen()` nennt (Karte: Knoten, „wer fragt, zahlt“, `provider`), erst
  Zahlweg und Wallet prüfen, dann den Preis bestätigen lassen – ohne Bestätigung kein Auftrag. Der Auftrag nur über
  `bezahlterAuftrag()`: frische `KiSitzungen` je Frage, feste Eingabe, der Verweis (`auftragsVerweisTags()`) nur in
  `extraTags` des Kerns; Ablehnungen nur über ihre Kennung (`ablehnungsText()`), nie Text vom Knoten. Kein
  zweiter Versuch von selbst – im Zahlkanal hielte die offene erste Gutschrift die zweite um ein Gebot höher.
  Privat (seit 11.3d2c) ebenso nach `sendePrivat()` – es liefert die Id des inneren Events (`mlsSendeEventId()`),
  und die steht als `erwaehnung` im Verweis, die Gruppe als `raum`; nie die Id eines Relay-Events. Einen Agenten,
  dessen Karte `knoten` nennt (`knotenAgentKarte()`), lädt `ladeEin()` nur nach `bestaetige()` mit der Warnung
  ein; danach schreibt `meldeKnotenAgentImRaum()` den Pflicht-Hinweis als inneres Event in den ersten Kanal.
- **Anhänge im Chat nur über `handleChatFiles()`** (seit C-29, `anhang-warte.ts`): Jeder Upload
  meldet sich bei `anhangWarte` an, und `sendChatMessage()` wartet auf alle, bevor es Text und
  Anhänge liest. Ein neuer Weg, Dateien anzuhängen (Einfügen, Ziehen, Sprachnachricht), geht durch
  `handleChatFiles()` – sonst schickt „Senden“ während des Uploads den Text allein, und der Anhang
  hängt an der nächsten Nachricht. Scheitert ein Upload, geht nichts hinaus.
