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
(1.2). Offen sind nur noch die Punkte unten.

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

### 1.3 Oberfläche (Spur C, 15.10.2026)

| Nr. | Frage | Empfehlung |
|---|---|---|
| OR1 | Schrift Inter in `freedom.html` einbetten (OFL-1.1, rund 50 KB nur Latin, 130 KB mit Latin-Erweiterung, neue Abhängigkeit) oder bei der Systemschrift bleiben (SF, Segoe, Roboto)? C-42 baut ohne Einbetten. | Systemschrift – nichts Neues im Bundle, sieht auf jedem Gerät heimisch aus |

Quelle: [`OBERFLAECHE-REVIEW.md`](OBERFLAECHE-REVIEW.md), Sammlung C-42.

### 1.5 Atomic Agent (Spur B, 18.10.2026)

Befund nach W2 A: `atomic-agent serve` sendet keine CORS-Kopfzeilen und beantwortet `OPTIONS` mit 404 (Quelltext
`src/http/http-server.ts`, Commit `7899d17`). Die App im Browser – und die Web-Ansicht der Hülle – kann seine Antworten
nicht lesen; „wie jeder lokale Server unter ‚Dieses Gerät‘“ geht so nicht. Details in
[`ATOMIC-AGENT-ENTWURF.md`](../ATOMIC-AGENT-ENTWURF.md).

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| AG-W5 | Wie weiter mit B-30a? | A B-30 schließen (Atomic Agent nur erwähnen: „braucht einen eigenen Vermittler“) · B die Desktop-Hülle reicht Anfragen an `127.0.0.1` selbst weiter (Rust, nur dieser Rechner; der Browser bleibt außen vor) · C nur ein Hinweis unter „Dieses Gerät“, dass es im Browser nicht geht | **A** – B wäre ein eigener Weg nur für ein Programm, das zudem Analyse standardmäßig an hat |

### 1.6 Gruppenanrufe (Spur B, 18.10.2026)

Befund in B-34d: `livekit-client` baut die Signalverbindung (WebSocket) immer direkt zur Adresse des SFU auf – der Knoten
der anrufenden Person sieht die IP-Adresse jedes Teilnehmenden, auch wenn Bild und Ton über den eigenen TURN laufen (die
Annahme hinter LK4 A, „dann sieht der SFU nur die Adresse des TURN“, stimmte nur für Bild und Ton). Seit B-34d fragt die
App deshalb vor jedem fremden Anruf; Details in [`GRUPPENANRUF-ENTWURF.md`](../GRUPPENANRUF-ENTWURF.md).

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| LK5 | Soll der eigene Knoten die Signalverbindung zum fremden SFU weiterreichen, damit dessen Betreiber die IP nicht sieht? | A ja: eine Weiterleitung im Relay des eigenen Knotens (nur für den Besitzer, nur `wss://` zu öffentlichen Adressen aus einer Einladung, ein eigener Schritt im Knoten und in der App) · B nein: es bleibt bei der Rückfrage vor dem Beitritt | **A** – erst dann hält der Weg über den eigenen Knoten, was LK4 A wollte; bis dahin sagt die App es ehrlich (B) |

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
| M-1 | HTLC seit 13.10. an `FVb19s…` (0.G erledigt); `3UmRR…` schließen (gibt Miete zurück); A-28 als Upgrade an `FVb19s…` | A-28 wirksam |
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
| Geld | Phantom-Abgleich, Devnet senden und empfangen; Swaps auf Devnet mit Polar; NWC mit zwei Wallets; LP mit zwei Testnet-LND; echte Relay-Zahlung; Verdienen in SOL; Kopfgeld mit Test-Wallet bezahlen (Lightning an eine Adresse, SOL versiegelt erfragt); KI-Frage mit Gebot in SOL über einen offenen Kanal (nach M-2) | 1.1, 4.2, 4.6, 6.3, 8.3, 8.4, 4.5, E10b2, 12.4b |
| Provider | echter Provider in unter 30 Minuten, beide Schienen; echte KI-Anfrage in der Live-App | 8.2, 3.1 |
| Modelle | Live-Probe: Hugging Face, ein Magnet von Pirate Face, zwei Knoten im Schwarm | B-29c |
| Wissen | Kiwix mit einer echten Wikipedia (ZIM von download.kiwix.org) am GX10: `KIWIX_ZIM` im Installer, eine Frage, die das Modell mit `mcp__wiki__search`/`read` beantwortet | B-31b |
| Funk | lokaler Validator, Devnet, zwei Funkgeräte; zwei Meshtastic-Geräte, Gateway-Knoten | 7.2, 7.4, 7.5d |
| Gruppenanruf | LiveKit am GX10 (`scripts/livekit-einrichten.sh`, Profil „livekit“), drei Geräte im privaten Raum: anrufen, beitreten mit und ohne eigenen TURN, Bild und Ton, jemand verlässt die Gruppe (neuer Schlüssel) | B-34 |
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
| VKd2 | Freedom-MCP: Bilder (ComfyUI oder Provider), Sprache (mit B-38), Kiwix (mit B-31), Browser mit Seiten-Bedienung (Playwright-MCP) – VKd1 ✓: Websuche und Seite lesen, VKd1b ✓: gelesen wird nur, was im Auftrag oder in Suchergebnissen steht | frei |
| VKg1 | Vorschau wie Replit (VKg-W1, 18.10.): a Knoten liefert das Projekt live unter eigener Adresse aus (eigener Port, Zufallspfad, Code-Aktion `vorschau`), b App öffnet sie im neuen Tab, c Dev-Server aus der Sandbox (Hot Reload) – a ✓ (`vorschau.ts`, `VORSCHAU_URL`) | frei – VKg1b als Nächstes |
| VKg2 | Vorschau als Bildstrom für Programme ohne Web (Linux, später Android, Windows): virtueller Bildschirm, GStreamer `webrtcbin`, NVENC, über den eigenen TURN – mit Spur B | frei (VKg-W2 ja), nach VKg1; NVENC prüft der MENSCH auf dem GX10 |
| VKj | Werkbank-Knoten: weitere eigene Rechner als MCP-Träger (mit Spur B) | frei, nach VKd |
| 11.5c | Knoten: Ablauf wie mini-swe-agent (W3a A) für Repo-Aufträge, Patch einreichen | frei (Bausteine von Spur B fertig: 11.5s als VKb, 11.5a1, 11.5a2; Pakete 11.5n ✓: `holeAusSperre()`, `paketHolen()`) |
| 11.5d | App: „Agent beauftragen“, Obergrenze (Oberfläche mit Spur C) | nach 11.5c |
| A-21d3–f | Senden und Bestätigen über den Pool, Knoten, Aufräumen (A-21b ✓: Anweisungen als kit; A-21c ✓: Lesen über kit auf dem RpcPool; A-21d1 ✓: Transaktionen über kit, SOL ohne Internet; A-21d2 ✓: Wallets und alle Bauer der App über kit) | frei – A-21d3 als Nächstes; A-21f nach W4 ([`KIT-PLAN.md`](../KIT-PLAN.md)) |
| A-12 | Gemeinsame Kasse für Räume über Squads | nach A-21b ([`KASSE-ENTWURF.md`](../KASSE-ENTWURF.md)) |
| A-17a, A-17b | Eingebaute Lightning-Wallet mit Breez (Spark) | nach dem API-Schlüssel (A-17 W5) |
| A-28 | Swap SOL → Lightning: Rückgabe vor Ablauf | Code frei, wirksam mit einem Upgrade an `FVb19s…` (M-1) |
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
| B-30a | Atomic Agent: Hinweis unter „Dieses Gerät“ (Adresse, Schlüssel, Werkzeuge und Analyse ehrlich genannt) | wartet auf AG-W5 (1.5): `atomic-agent serve` kennt kein CORS ([`ATOMIC-AGENT-ENTWURF.md`](../ATOMIC-AGENT-ENTWURF.md)) |
| B-32 | Reticulum als zweiter Funkweg (a ✓ Bibliothek und Identität, b App mit RNode, c Adresse für Kontakte, d Gateway) | frei (RN-W1–W5 A, 18.10.; [`RETICULUM-ENTWURF.md`](../RETICULUM-ENTWURF.md)) – b als Nächstes |
| B-33 | Tor über Brücken: Snowflake und WebTunnel (a CI-Bau, b Hülle Desktop – b1 Logik, b2 Pakete –, c Oberfläche, d Android) – a ✓ (`scripts/pt-bauen.sh`: reproduzierbar aus den Quellen, vier Plattformen, Lizenztexte, Workflow „Tor-Brücken“), b1 ✓ (`bruecken.rs`: arti mit `pt-client`, eingebaute Snowflake-Zeilen, Prüfung eingefügter Zeilen, Test mit Attrappe), b2 ✓ (Programme in den Paketen, geprüft gegen den Bau), c ✓ (Schalter „Über eine Brücke“, eigene Zeilen auch per QR-Code, ehrliche Texte), d ✓ (Android: Programme als `lib<name>.so` im APK, mit cgo für DNS, im APK geprüft) | Code fertig; MENSCH: Live-Test mit einem Paket aus dem Lauf, Desktop und Android ([`TOR-BRUECKEN-ENTWURF.md`](../TOR-BRUECKEN-ENTWURF.md)) |
| B-37 | MeshCore als zweites LoRa-Format | wartet auf ein Gerät vor Ort (MCO-W2 B, 18.10.); MCO-W1 dann ([`MESHCORE-ENTWURF.md`](../MESHCORE-ENTWURF.md)) |
| B-38 | Sprache lokal (whisper.cpp, Piper) | nach B-31 |
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
