# Offen – alle offenen Punkte und Entscheidungen

Stand 14.10.2026, `main` bei `1a52c7a` (nach 11.5b, Entscheidungen vom 14.10.). Zusammengetragen von Spur B
auf Wunsch des MENSCHEN („so dass alle Agents es sehen können“).

**Zweck:** eine Übersicht über alles, was noch offen ist – Entscheidungen, Aufgaben
des MENSCHEN, Bauschritte je Spur. Die Einzelheiten stehen weiter dort, wo sie
hingehören: [`FORTSCHRITT.md`](FORTSCHRITT.md) (Schritte und Pull Requests),
[`SAMMLUNG.md`](../neuordnung/SAMMLUNG.md) (Punkte A-, B-, C-, Entscheidungen in
Abschnitt 5, MENSCH in Abschnitt 6) und die Entwürfe in `docs/`. Diese Datei
verweist nur; bei Widerspruch gilt die Quelle.

**Pflege (alle Spuren):**

1. Wer einen Punkt fertigstellt, löscht seine Zeile hier im selben Pull Request –
   nicht durchstreichen, die Geschichte steht in `STATUS.md`.
2. Wer eine Entscheidung des MENSCHEN einträgt, löscht die Frage in Abschnitt 1
   und gibt den Bauschritten in Abschnitt 3 den neuen Stand.
3. Ein neuer offener Punkt kommt in seine Quelle und als Zeile hierher.
4. Jede Spur ändert nur ihre eigenen Zeilen in Abschnitt 3; Abschnitte 1 und 2
   ändert, wer die Antwort des MENSCHEN bekommt oder den Punkt erledigt.

---

## 1. Entscheidungen des MENSCHEN

Am 14.10.2026 entschieden (MENSCH: „Ja zu allen deinen Vorschlägen“): VK-W1n C, VK-W6
bis VK-W9, W3a, W6a, W7 und RM2 W1–W5 – eingetragen in den Entwürfen (Abschnitte
„Entscheidungen vom 14.10.2026“). Am 18.10.2026 entschieden: VKd-W1 (wie Claude und OpenAI,
ohne Fragen), VKg-W1 (Vorschau wie Replit), VKg-W2 (ja) – eingetragen in
[`VIBECODEN-ENTWURF.md`](../VIBECODEN-ENTWURF.md). Ebenfalls am 18.10.2026 (Spur B, Entscheidungsvorlage): MC1-Größe B, NG2 A,
AG-W1–W4 A, PT2 A, PT3 A, RN-W1–W5 A, LK2–LK4 A, MCO-W2 B – eingetragen in den Entwürfen; MCO-W1 zurückgestellt
(1.2). Am 19.10.2026 entschieden (Spur B, MENSCH: „alle nach deinen Empfehlungen“): AG-W5 A, LK5 A, SP-W1–W6
(A, A, A, C, A, A), RN-W6 A – eingetragen in den Entwürfen. Offen sind nur noch die Punkte unten.

### 1.0 Telegram-Mini-App (TMA-1, 14.10.2026)

Die Mini-App kam ohne Pull Request auf `main`. Spur A hat sie repariert (eigener Build,
Signatur nur an den TMA-Server, CSP nur für die Datei des SDK, `/tma/` nachgebaut). Stars
und TON bleiben unverdrahtet, bis diese Fragen beantwortet sind:

| Nr. | Frage | Empfehlung |
|---|---|---|
| T1 | Wofür zahlen Sterne? Sie sind verwahrt beim Bot-Besitzer und passen nicht zu A+ und RM2. | B – Guthaben nur für KI an den eigenen Knoten des Bot-Besitzers, als „verwahrt“ benannt |
| T2 | TON als dritte Kette? | B – weglassen, Sterne reichen |
| T3 | Das SDK von `telegram.org` im Mini-App-Build | A – so lassen, eigene Brücke später prüfen |
| T4 | Lightning und SOL in der Mini-App (Telegram erlaubt dort für Krypto nur TON) | A – dort ausblenden, falls T1 B |
| T5 | Grenze „telegram“ im Datenschutzbericht | ja, mit T1 |

Quelle: [`MINI-APP-TMA.md`](../MINI-APP-TMA.md), „Offen“.

### 1.4 Solana über kit (Spur A, 17.10.2026)

| Nr. | Frage | Empfehlung |
|---|---|---|
| W4 | Wallets, die nur `window.solana` bieten (ohne Wallet Standard), verlangen ein `Transaction`-Objekt von web3.js. Mit A-21f geht web3.js. A den Weg streichen · B web3.js nur dafür behalten (rund 760 KB) · C ein Objekt nachbauen | **A** – Phantom, Solflare und Backpack sprechen den Wallet Standard, den die App schon zuerst nimmt |

Quelle: [`KIT-PLAN.md`](../KIT-PLAN.md), „Fragen“.

### 1.5 Werkbank-Knoten (VKj, Spur A, 23.10.2026)

| Nr. | Frage | Empfehlung |
|---|---|---|
| VKj-W1 | Wie reden GX10 und Werkbank? A ContextVM-Format (Art 25910 im Umschlag, CEP-4), selbst gebaut, über die Relays · B eigenes Format über einen direkten Kanal (WebRTC über den eigenen TURN) · C Tor-Dienst auf der Werkbank | **A** – offener Standard, keine Abhängigkeit (das SDK ist LGPL/GPL), durch jedes NAT; große Antworten in Stücken (CEP-22); B nur für die Vorschau |
| VKj-W2 | Wer koppelt die Werkbank mit dem GX10? A der Besitzer mit dem Handy · B die Werkbank direkt mit einem Code des GX10 | **A** – das Handy ist schon der Schlüssel für beide |
| VKj-W3 | Was darf der Agent auf der Werkbank ohne Rückfrage? A nur Werkzeuge der Liste, alle wie Befehle · B lesen ohne Frage, ändern mit Frage · C alles aus der Liste ohne Frage | **B** – auf der Werkbank gibt es keine Sandbox |
| VKj-W4 | Womit anfangen? A Unity unter Windows · B Xcode und iOS auf dem Mac · C Android Studio auf x86-Linux | **A** – größter Bedarf, `unity-mcp` (MIT) fertig |

Quelle: [`WERKBANK-ENTWURF.md`](../WERKBANK-ENTWURF.md), „Fragen an den MENSCHEN“.

### 1.3 Oberfläche (Spur C, 15.10.2026)

| Nr. | Frage | Empfehlung |
|---|---|---|
| OR1 | Schrift Inter in `freedom.html` einbetten (OFL-1.1, rund 50 KB nur Latin, 130 KB mit Latin-Erweiterung, neue Abhängigkeit) oder bei der Systemschrift bleiben (SF, Segoe, Roboto)? C-42 baut ohne Einbetten. | Systemschrift – nichts Neues im Bundle, sieht auf jedem Gerät heimisch aus |

Quelle: [`OBERFLAECHE-REVIEW.md`](OBERFLAECHE-REVIEW.md), Sammlung C-42.

### 1.1 Bestätigungen und Zuteilungen

| Punkt | Offen | Quelle |
|---|---|---|
| Phase 9, Teil der Agenten | Keiner Spur zugeteilt: `docs/BEDROHUNGSMODELL.md` (9.1), `SECURITY.md` (9.2), Deploy-Skripte und Rücknahmeplan (9.3), KI-Hinweis nach Art. 50 AI Act und C2PA (9.4). Wer, und wann? | [`phase-9.md`](phase-9.md) |
| Phase 9, Teil des MENSCHEN | Auditoren; Beträge der Bug-Bounty (Sats und SOL); Zeitpunkt Mainnet; CASP-Einordnung nach AMLR (Frist 10.07.2027), Steuer, Impressum und Firmenname (0.F) | [`phase-9.md`](phase-9.md), FORTSCHRITT 0.F |

### 1.2 Zurückgestellt – ohne Termin

Keine Frage für jetzt; hier, damit nichts verloren geht.

| Punkt | Wieder aufnehmen, wenn | Quelle |
|---|---|---|
| D3 versiegelter Provider-Modus | ein Knoten mit TPM da ist (GX10: keins) – „später optional“ | [`D3-ENTWURF.md`](../D3-ENTWURF.md) |
| B-16 Modelle im Browser (WebGPU) | nach eigener Freigabe (L3 A: später) | Sammlung B-16 |
| A-11 Dienste-Markt über KI hinaus | nach B-38 (Transkribieren zuerst) | Sammlung A-11 |
| A-13 Handel mit Treuhand | nach Audit und Mainnet (M-8) | Sammlung A-13 |
| B-36 Bitchat in der Android-Hülle | nach einem Audit von Bitchat | Sammlung B-36 |
| MCO-W1 Datentyp für MeshCore (festen Bereich beim Projekt beantragen oder Versuchsbereich `FF00`–`FFFF`) | B-37 gebaut wird (MCO-W2 B: ein Gerät vor Ort) | [`MESHCORE-ENTWURF.md`](../MESHCORE-ENTWURF.md) |
| B-39 Iroh-Blobs | eine Browser-Fassung von iroh-blobs erscheint | Sammlung B-39 |
| Deckverkehr gegen Zeitmuster | nach Absprache mit Relay-Betreibern | [`MIXNET.md`](../MIXNET.md), „Offen“ |
| Passkey für den Tresor (WebAuthn-PRF) | eigener späterer Schritt (8.1) | FORTSCHRITT 1.2, 8.1 |
| Orakel-Abgleich der Kurse | – | FORTSCHRITT 4.4 |
| Aggregat der Belege mit Merkle-Wurzel | – | FORTSCHRITT 3.2 |
| Prüfung einer TEE-Attestierung | ein Provider mit TEE | FORTSCHRITT 3.3 |
| Mobile Wallet Adapter | mit den nativen Apps | FORTSCHRITT 4.2 |
| L2-3 A netzweite Ausfall-Kenntnis (über Ruf, nie zentral) | nach L2-1, L2-2 (fertig) – „A später“ | Sammlung Anhang F |

---

## 2. Aufgaben des MENSCHEN

### 2.1 Hält Bauschritte auf

| Nr. | Aufgabe | hält auf |
|---|---|---|
| M-2 | Zahlkanal auf Devnet (`F9P2…`) mit der Binary aus 4.3e upgraden – die erste lehnt jeden Aufruf ab | KI-Zahlung mit SOL; 11.3d3, B-18 (8.9c), P5d, A-10 A, Wegfall der Hinterlegung für KI (E8); Devnet-Tests 4.5, 7.4 |
| M-1 | HTLC seit 13.10. an `FVb19s…` (0.G erledigt); `3UmRR…` schließen (gibt Miete zurück); A-28 als Upgrade an `FVb19s…` (Code seit A-28a, Schritte im README des Programms) | A-28 wirksam |
| M-7 | GX10 auf den aktuellen `main` – optional mit `TORRENT=1` und `KI_ANTRIEB=openai` (B-29c), Docker-Bild neu bauen (aria2) | KI-Anfragen der Live-App, wo die App einen neueren Knoten braucht |
| Signierschlüssel | mindestens zwei (Personen oder Geräte), danach `TRUSTED_SIGNERS`; fester Android-Keystore in den Secrets | 0.D, 5.2, 6.1a4b, 11.2a „geprüft“, Release 1.0 |
| A-17 W5 | API-Schlüssel für Breez beantragen | Bau von A-17 mit Breez |
| zwei Geräte | für die Messung des Cluster-Betriebs | E9-5 |

### 2.2 Konten und Einrichtung

| Nr. | Aufgabe | Quelle |
|---|---|---|
| M-3 | Adressen der Entwicklung (`ENTWICKLUNG` in `aufteilung.ts`), Zahlung auf Testnet prüfen | Sammlung M-3 |
| M-4 | Konten der Spiegel | [`KONTEN.md`](../KONTEN.md) |
| 5.9 | Squads einrichten und Upgrade-Recht übertragen, Radicle-Kennung, optional `REPO_MAINTAINER`, Repository öffentlich | [`SOLANA-UPGRADE-AUTHORITY.md`](../SOLANA-UPGRADE-AUTHORITY.md), [`RADICLE.md`](../RADICLE.md) |
| 0.E | Wallet-Erweiterungen unter der CSP | FORTSCHRITT 0.E |
| 5.1b | Gesponserte Pools auf Devnet | FORTSCHRITT 5.1b |
| 5.4 | geprüfte .onion-Adresse; `RELAYS` am GX10 nicht setzen oder um die Startliste ergänzen | FORTSCHRITT 5.4 |
| M-6 | Englische Texte der App durchsehen – danach Website auf Englisch (Spur C) | Sammlung M-6 |

### 2.3 Tests mit echten Geräten

| Bereich | Was | Schritte |
|---|---|---|
| Oberfläche | alle Seiten am Handy (iOS Safari, Android Chrome) und am Desktop | C-19, 1.0 |
| Identität | Tresor auf Handy und Desktop, „vergessen“ mit 12 Wörtern; echter Bunker (Amber); zweites Gerät; White Noise mit zwei Geräten; FROSTR mit Igloo als Bunker | 1.2, 1.3, 8.6, 2.2b, A-18 |
| Geld | Phantom-Abgleich, Devnet senden und empfangen; Swaps auf Devnet mit Polar; NWC mit zwei Wallets; LP mit zwei Testnet-LND; echte Relay-Zahlung; Verdienen in SOL; Kopfgeld mit Test-Wallet bezahlen (Lightning an eine Adresse, SOL versiegelt erfragt); KI-Frage mit Gebot in SOL über einen offenen Kanal (nach M-2); Kasse im Raum auf Devnet (eigener Devnet-Endpunkt, zwei Personen nennen Adressen, beide Arten anlegen, die Kasse steht im Raum, einzahlen, Stand und Abweichungen stimmen, eine Auszahlung vorschlagen, abstimmen, auszahlen, eine abgelehnte abschließen, ein Mitglied über „Kasse ändern …“ aufnehmen, der Hinweis auf einen neuen Vorschlag steht im Raum, mit einer verbundenen Wallet abstimmen und auszahlen) | 1.1, 4.2, 4.6, 6.3, 8.3, 8.4, 4.5, E10b2, 12.4b, A-12b2b |
| Provider | echter Provider in unter 30 Minuten, beide Schienen; echte KI-Anfrage in der Live-App | 8.2, 3.1 |
| Modelle | Live-Probe: Hugging Face, ein Magnet von Pirate Face, zwei Knoten im Schwarm | B-29c |
| Wissen | Kiwix mit einer echten Wikipedia (ZIM von download.kiwix.org) am GX10: `KIWIX_ZIM` im Installer, eine Frage, die das Modell mit `mcp__wiki__search`/`read` beantwortet | B-31b |
| Funk | lokaler Validator, Devnet, zwei Funkgeräte; zwei Meshtastic-Geräte, Gateway-Knoten | 7.2, 7.4, 7.5d |
| Gruppenanruf | LiveKit am GX10 (`scripts/livekit-einrichten.sh`, Profil „livekit“), drei Geräte im privaten Raum: anrufen, beitreten mit und ohne eigenen TURN, einmal mit eigenem Knoten (Relay, TURN) ohne Rückfrage (B-34e), Bild und Ton, jemand verlässt die Gruppe (neuer Schlüssel) | B-34 |
| Native Apps | Tor in Desktop und Android (`IsTor: true`) | 6.1 |
| Oberfläche | kurzer Nutzertest: fünf Personen ohne Nostr-Vorwissen, drei Aufgaben (erste Frage, Wallet verbinden, Freund anschreiben), Zeit und Abbrüche | Review 15.10. |
| Sonstiges | fremde Person richtet die App in unter fünf Minuten ein; QR-Scan am Handy; Radicle-Spiegel mit `rad` | 8.1, 11.1b, 8.10 |

### 2.4 Phase 9

9.1 Auditoren beauftragen · 9.2 Devnet-Beta mit Bug-Bounty · 9.3 Mainnet mit Squads
und Zeitverzögerung · 9.4 Rechtliches · 9.5 Release 1.0 – [`phase-9.md`](phase-9.md).

---

## 3. Offene Bauschritte je Spur

Stand: `frei` = ohne Entscheidung baubar · `nach …` = wartet darauf.

### Spur A – Netz, Geld, Vertrauen

| Schritt | Inhalt | Stand |
|---|---|---|
| VKd2 | Freedom-MCP: Sprache (mit B-38; SP-W6 A „MCP später“), Bilder über Freedom-Provider (5070) später – VKd2b2 ✓: Bilder über die eigene ComfyUI, VKd2b1 ✓: je Projekt ein eigenes Zeichen, Lese-Freigaben nur im Projekt, VKd2a ✓: Kiwix mit den ZIM-Dateien aus `mcp.json` (B-31), die Seiten-Bedienung kam mit VKk1 (Playwright MCP), VKd1 ✓: Websuche und Seite lesen, VKd1b ✓: gelesen wird nur, was im Auftrag oder in Suchergebnissen steht, VKd3 ✓: Pakete (npm, PyPI) über die Brücke | frei |
| VKg2 | Vorschau als Bildstrom für Programme ohne Web (Linux, später Android, Windows): virtueller Bildschirm, GStreamer `webrtcbin`, NVENC, über den eigenen TURN – mit Spur B. Teile ([`VIBECODEN-ENTWURF.md`](../VIBECODEN-ENTWURF.md), VKg2): a1 Tunnel zum TURN, a2 Bildstrom im Knoten (Xvfb, Programm, `webrtcbin`; Code-Aktionen `bild`, `bild-ende`), a3 Eingaben über XTest, b App (Bild ansehen und bedienen), c Docker-Pakete, Chromium ins Bild, NVENC, Messung | VKg2a1 ✓ (Tunnel mit Filter), VKg2a2 ✓ (Bild in zwei Sandboxen), VKg2a3 ✓ (Eingaben), VKg2b ✓ (App), VKg2c1 ✓ (Docker, Chromium im Bild), VKg2c2 ✓ (Kodierer nach dem Angebot, NVENC) – im Code fertig; NVENC prüft der MENSCH auf dem GX10 |
| VKj | Werkbank-Knoten: weitere eigene Rechner als MCP-Träger (mit Spur B) – Entwurf ✓ ([`WERKBANK-ENTWURF.md`](../WERKBANK-ENTWURF.md)) | wartet auf VKj-W1–W4 (1.5) |
| 11.5c4 | Schalter „Pakete holen“ im privaten Raum (P3, Vorgabe aus): ein Admin schaltet Phase 1 ein (Format in der Definition des Raums zuerst), der Knoten liest ihn; `paket_holen` bleibt privat aus (11.5c1–c3 ✓) | frei, Format vorher klären |
| 11.5d | App: d2 Ablehnungen `agent-repo-…` mit eigenem Satz, Kennzeichen an Patches von Agenten, Antwort mit Patch (`fall`, `["e", …, "mention"]`, seit 11.5c3 `pakete`) im Raum zeigen; d3 „Agent beauftragen“ auch im Raum (Oberfläche mit Spur C) – d1 ✓: „Agent beauftragen“ auf der Repo-Seite (offen und privat), Obergrenze vorher, Warten wie der Lauf | frei (offen und privat) |
| A-21f | Aufräumen (A-21b ✓: Anweisungen als kit; A-21c ✓: Lesen über kit auf dem RpcPool; A-21d1 ✓: Transaktionen über kit, SOL ohne Internet; A-21d2 ✓: Wallets und alle Bauer der App über kit; A-21d3a ✓: Senden und Bestätigen als Baustein, Zahlschienen über den Pool; A-21d3b ✓: HTLC, Tausch, Relayer, Zahlkanal, Wächter, Quittungen und Hinterlegen über den Pool; A-21d3c ✓: Relayer-Prüfung über kit; A-21e1 ✓: Zahlkanal-Kasse, Auszahlung und Einrichtung des Knotens über kit; A-21e2 ✓: Relayer-Dienst, Senden im `main.ts`, HTLC-Adapter des LP – der Knoten ohne web3.js) | A-21f nach W4 ([`KIT-PLAN.md`](../KIT-PLAN.md)) |
| A-12 | Gemeinsame Kasse für Räume über Squads ([`KASSE-ENTWURF.md`](../KASSE-ENTWURF.md)): d2 Wechsel der Art (Gründer ↔ Mehrheit), e Oberfläche (Spur C) – A-12a1 ✓: Anlegen, Konten lesen; A-12a2 ✓: Auszahlen vorschlagen, abstimmen, ausführen, abschließen, Vorschlag und Auszahlung lesen; Tests gegen beide Programme; A-12b1 ✓: Recht „kasse“, Kasse in der Definition, Adressen der Mitglieder mit Nachweis, Abweichungen; A-12b2a ✓: eigene Adresse nennen (eingebaute Wallet, frisch), Grenze „raum-kasse“, die private Definition behält die Kasse; A-12b2b ✓: Kasse anlegen (nur Devnet über eigene Endpunkte, eingebaute Wallet, Art und Zeitschloss, Mitglieder aus den genannten Adressen mit Recht) und in die Definition schreiben; A-12b2c ✓: Stand von der Kette mit Abweichungen zum Raum, einzahlen (nur Devnet, nur Kassen ohne Verwalter, Tageslimit); A-12b2d ✓: Adresse auch aus einer verbundenen Wallet (signiert den festen Text, ohne Vorspann, vor dem Senden geprüft); A-12c1 ✓: auszahlen in der App (Vorschläge von der Kette, vorschlagen, abstimmen, auszahlen und abschließen in einem Zug – nur, was das Programm annimmt; eingebaute Wallet, nur Devnet); A-12a3 ✓: Baustein Konfiguration ändern (Mitglied dazu oder weg, Schwelle, Wartezeit; die Art bleibt, Stand danach wie das Programm, Konto wächst um zehn Plätze); A-12d1 ✓: Mitglieder und Wartezeit in der App ändern (dazu nur mit Recht und genannter Adresse, die Art bleibt, abstimmen und ausführen wie bei Auszahlungen, für eine andere Art nie); A-12c2 ✓: Hinweis im Raum auf neue Vorschläge (nur die Nummer, im ersten beschreibbaren Kanal, privat nur in der Gruppe); A-12c3 ✓: abstimmen und auszahlen mit einer verbundenen Wallet (nur mit der Adresse für die Kasse, signiert nur, gesendet über Devnet); Devnet-Probe MENSCH | wartet (d2: wer wird bei „Mehrheit → Gründer“ Gründer? Frage in #570) |
| A-17a, A-17b | Eingebaute Lightning-Wallet mit Breez (Spark) | nach dem API-Schlüssel (A-17 W5) |
| A-28b | Swap SOL → Lightning: Rückgabe vor Ablauf im LP und in der App – der LP ruft `zurueckgeben` nur, wenn LND die Zahlung sicher als gescheitert meldet; die Antwort sagt es (neuer Status oder Tag – Format vorher klären), die App zeigt „zurückgegeben“ statt „nach Ablauf zurückholen“ (A-28a ✓: Programm, Adapter, Validator-Tests) | frei, Format vorher klären; wirksam mit dem Upgrade an `FVb19s…` (M-1) |
| P5d | Prüfrunden mit SOL | nach M-2 |
| A-10 A | Abos über den Zahlkanal mit Obergrenze | nach M-2, mit B-18 |
| E8 | Hinterlegung für KI entfernen | nach M-2 |
| E9-5 | Cluster-Betrieb | nach zwei Geräten (MENSCH) |
| L2-3 A | Netzweite Ausfall-Kenntnis | später (1.2) |

### Spur B – Mesh und Bausteine

| Schritt | Inhalt | Stand |
|---|---|---|
| 11.5s4b | Speicher aller Prozesse eines Befehls zusammen (cgroups v2, wo es sie gibt) (11.5s3 ✓: 4 GiB je Prozess über `ulimit -d`; 11.5s4a ✓: höchstens 1024 Prozesse je Befehl) | später, nachrangig |
| 11.3d3 | Monatsbudget mit Pfand beim Knoten-Agenten | nach M-2 |
| B-18 (8.9c) | Speicher bezahlen in sats und SOL | nach M-2 |
| B-32 | Reticulum als zweiter Funkweg (a ✓ Bibliothek und Identität, b1 ✓ Funkparameter je Region und RNode verbinden, b2 ✓ Reticulum über die RNode – empfangen, Sendezeitkonto, Datenschutz-Grenze, b3 ✓ Senden an eine Gegenstelle (Adresse eintippen oder per QR), b4 ✓ abweichende Werte in den Grenzen und Smoke-Test, c Adresse für Kontakte, d Gateway) | frei (RN-W1–W5 A, 18.10.; RN-W6 A, 19.10.: Funkparameter je Region; [`RETICULUM-ENTWURF.md`](../RETICULUM-ENTWURF.md)) |
| B-33 | Tor über Brücken: Snowflake und WebTunnel (a CI-Bau, b Hülle Desktop – b1 Logik, b2 Pakete –, c Oberfläche, d Android) – a ✓ (`scripts/pt-bauen.sh`: reproduzierbar aus den Quellen, vier Plattformen, Lizenztexte, Workflow „Tor-Brücken“), b1 ✓ (`bruecken.rs`: arti mit `pt-client`, eingebaute Snowflake-Zeilen, Prüfung eingefügter Zeilen, Test mit Attrappe), b2 ✓ (Programme in den Paketen, geprüft gegen den Bau), c ✓ (Schalter „Über eine Brücke“, eigene Zeilen auch per QR-Code, ehrliche Texte), d ✓ (Android: Programme als `lib<name>.so` im APK, mit cgo für DNS, im APK geprüft) | Code fertig; MENSCH: Live-Test mit einem Paket aus dem Lauf, Desktop und Android ([`TOR-BRUECKEN-ENTWURF.md`](../TOR-BRUECKEN-ENTWURF.md)) |
| B-37 | MeshCore als zweites LoRa-Format | wartet auf ein Gerät vor Ort (MCO-W2 B, 18.10.); MCO-W1 dann ([`MESHCORE-ENTWURF.md`](../MESHCORE-ENTWURF.md)) |
| B-38 | Sprache lokal (a Vorlesen auf dem Gerät, b Whisper im eigenen Knoten, c App: als Text und Diktieren) – Entwurf ✓ ([`SPRACHE-ENTWURF.md`](../SPRACHE-ENTWURF.md)) | frei (SP-W1–W6, 19.10.) – a ✓ (Vorlesen nur mit lokalen Stimmen), b geteilt: b1 ✓ (Protokoll: Kind 5083, WAV in einer Form), b2 ✓ (Knoten: whisper-cli je Auftrag in der Sandbox, Rolle `sprache`), b3 geteilt: b3a ✓ (whisper-cli aus den Quellen, Stufe im Docker-Bild, die CI prüft das echte Programm), b3b geteilt: b3b1 ✓ (Protokoll: Whisper-Manifest mit genau einer ggml-Datei), b3b2 ✓ (Knoten lädt es geprüft: `npm run modell -- --whisper`), b3b3 ✓ (Whisper nimmt je Auftrag das geprüfte Modell) – b fertig; c App geteilt: c1 ✓ („Als Text“ an Sprachnachrichten über den eigenen Knoten, Ton im Browser zu WAV), c2 ✓ (Diktieren im Agenten), c3 ✓ („Dieses Gerät“: whisper-server auf diesem Rechner) – B-38 fertig bis auf die Proben (MENSCH) |
| VKk | MCP-Katalog ([`VIBECODEN-ENTWURF.md`](../VIBECODEN-ENTWURF.md), Tabelle „MCP für gängige Programme“): je Server ein Schritt, gepinnt, nur in der Sandbox des Motors – VKk1 ✓ Browser (Playwright MCP, Chromium) | frei – ohne Bildschirm zuerst (Jupyter, Referenz-Server für git und Dateien); grafische Programme (Godot, Blender, FreeCAD, KiCad …) nach VKg2 (virtueller Bildschirm) |
| VKh | Android: redroid und scrcpy in der Sandbox, APKs bauen (arm64-`aapt2` oder FEX) | nach VKg2 (Bildstrom) |
| VKi | Windows: Wine und Hangover | nach VKg2 (Bildstrom) |

### Spur C – Oberfläche

| Schritt | Inhalt | Stand |
|---|---|---|
| 11.3e (C-9) | Oberfläche: Agenten in Räumen | e1–e4 ✓ ([#431](https://github.com/3DAGI/freedom-app/pull/431), [#432](https://github.com/3DAGI/freedom-app/pull/432), [#433](https://github.com/3DAGI/freedom-app/pull/433), [#434](https://github.com/3DAGI/freedom-app/pull/434)); offen nur das Monatsbudget mit Pfand – nach 11.3d3 |
| Website Englisch | Website auf Englisch | nach M-6 |
| 6.1a4b | Selbst-Update der Hülle | nach den Signierschlüsseln |
| RM2d | Oberfläche Cashu-Pfand: „Guthaben laden“ statt Budget, Mint wählen und „verwahrt“ sichtbar – über `cashuTopf` aus `shell/ki-pfand.ts` (`waehleMint()`, `ladeAnfrage()`, `abholen()`, `guthaben()`); Kopf und Seitenleiste zeigen seit RM2c3 „—“ | frei (RM2c1–c4b ✓, Spur A) ([`RM2-ENTWURF.md`](../RM2-ENTWURF.md)) |

### Ohne Spur

| Schritt | Inhalt | Stand |
|---|---|---|
| 9.1–9.4 (Agenten) | Bedrohungsmodell, `SECURITY.md`, Deploy-Checklisten, KI-Hinweis nach Art. 50 AI Act | Zuteilung offen (1.1) |
