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
„Entscheidungen vom 14.10.2026“). Offen sind nur noch die Punkte unten.

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

### 1.3 Oberfläche (Spur C, 15.10.2026)

| Nr. | Frage | Empfehlung |
|---|---|---|
| OR1 | Schrift Inter in `freedom.html` einbetten (OFL-1.1, rund 50 KB nur Latin, 130 KB mit Latin-Erweiterung, neue Abhängigkeit) oder bei der Systemschrift bleiben (SF, Segoe, Roboto)? C-42 baut ohne Einbetten. | Systemschrift – nichts Neues im Bundle, sieht auf jedem Gerät heimisch aus |

Quelle: [`OBERFLAECHE-REVIEW.md`](OBERFLAECHE-REVIEW.md), Sammlung C-42.

### 1.1 Bestätigungen und Zuteilungen

| Punkt | Offen | Quelle |
|---|---|---|
| Phase 9, Teil der Agenten | Keiner Spur zugeteilt: `docs/BEDROHUNGSMODELL.md` (9.1), `SECURITY.md` (9.2), Deploy-Skripte und Rücknahmeplan (9.3), KI-Hinweis nach Art. 50 AI Act und C2PA (9.4). Wer, und wann? | [`phase-9.md`](phase-9.md) |
| Sandbox unter Docker (VKb) | Das Standard-Seccomp von Docker sperrt meist Nutzer-Namensräume – im Docker-Bild führt der Knoten dann keinen Code aus (die Selbstprüfung sagt das; ungeprüft, hier läuft kein Docker). Empfehlung: ein eigenes Seccomp-Profil mitliefern (Standard plus `unshare`/`clone` für Namensräume) und in `docker-compose.yml` nur bei `VIBECODEN=1` setzen; sonst Vibecoden nur mit dem Installer. Wie läuft der GX10-Knoten? | [`PROVIDER.md`](../PROVIDER.md), „Vibecoden“ |
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
| Funk | lokaler Validator, Devnet, zwei Funkgeräte; zwei Meshtastic-Geräte, Gateway-Knoten | 7.2, 7.4, 7.5d |
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
| VKc3 | Hermes gepinnt ins Bild, eigene Konfiguration, in der Sandbox (mit Spur B); dazu `CODE_MOTOR` in `main.ts` über `prozessMotor()` mit der Sandbox davor, `.git` darin nur lesbar, `~/.hermes` je Projekt außerhalb des Repos (`prozessMotor()` setzt heute `HOME` = Projekt, `sichere()` nähme es mit) (VKc2 ✓); die Sandbox hat kein Netz – das Modell erreicht der Motor nur über eine Brücke (Unix-Socket, wie Codex) | frei (VKb ✓: `sandboxMotor()`) |
| VKd | Freedom-MCP im Knoten: Suche, Bilder, Sprache, Browser, Kiwix (mit Spur B) | frei (VKc2 ✓) |
| VKj | Werkbank-Knoten: weitere eigene Rechner als MCP-Träger (mit Spur B) | frei, nach VKd |
| VKl | „Als Repo in einen Raum stellen“ | frei |
| 11.5n | Pakete holen (W6a) | frei |
| 11.5c | Knoten: Ablauf wie mini-swe-agent (W3a A) für Repo-Aufträge, Patch einreichen | frei (Bausteine von Spur B fertig: 11.5s als VKb, 11.5a1, 11.5a2) |
| 11.5d | App: „Agent beauftragen“, Obergrenze (Oberfläche mit Spur C) | nach 11.5c |
| A-21d–f | Signieren, Knoten, Aufräumen (A-21b ✓: Anweisungen als kit; A-21c ✓: Lesen über kit auf dem RpcPool) | frei – A-21d als Nächstes ([`KIT-PLAN.md`](../KIT-PLAN.md)) |
| A-12 | Gemeinsame Kasse für Räume über Squads | nach A-21b ([`KASSE-ENTWURF.md`](../KASSE-ENTWURF.md)) |
| A-17c | Cashu-Baustein (`@cashu/cashu-ts`: Mint wählen, Token senden und empfangen, NUT-11/12) | frei ([`E4B-ENTWURF.md`](../E4B-ENTWURF.md)) |
| A-17a, A-17b | Eingebaute Lightning-Wallet mit Breez (Spark) | nach dem API-Schlüssel (A-17 W5) |
| RM2a–c | Cashu-Pfand für Lightning-Sitzungen (RM2d Oberfläche, Spur C) | nach A-17c ([`RM2-ENTWURF.md`](../RM2-ENTWURF.md)) |
| A-28 | Swap SOL → Lightning: Rückgabe vor Ablauf | Code frei, wirksam mit einem Upgrade an `FVb19s…` (M-1) |
| P5d | Prüfrunden mit SOL | nach M-2 |
| A-10 A | Abos über den Zahlkanal mit Obergrenze | nach M-2, mit B-18 |
| E8 | Hinterlegung für KI entfernen | nach M-2 |
| E9-5 | Cluster-Betrieb | nach zwei Geräten (MENSCH) |
| L2-3 A | Netzweite Ausfall-Kenntnis | später (1.2) |

### Spur B – Mesh und Bausteine

| Schritt | Inhalt | Stand |
|---|---|---|
| 11.5s2 | seccomp in der Sandbox (Netz-Aufrufe, `io_uring`) als BPF ohne neue Abhängigkeit, Speicher je Befehl (VKb ✓) | frei, nachrangig |
| 11.3d3 | Monatsbudget mit Pfand beim Knoten-Agenten | nach M-2 |
| B-18 (8.9c) | Speicher bezahlen in sats und SOL | nach M-2 |
| B-30 | Atomic Agent als Harness | frei (AG1 A) |
| B-31 | Werkzeuge über MCP, Kiwix | frei (MC1 A), Größe im PR nennen |
| B-32 | Reticulum als zweiter Funkweg | frei – erst ein Entwurf (RN1) |
| B-33 | Tor mit Pluggable Transports | frei (PT1 A), Größe und Lizenz im PR nennen |
| B-34 | Gruppenanrufe über LiveKit | frei (LK1 A) |
| B-35 | Abgleich mit Negentropy (NIP-77), eigene Umsetzung – c Abgleich nach Funkstille (Gateway, eigenes Relay mit anderen) | frei (NG1 B; a ✓ Kern im Protokoll, b ✓ Relay-Rolle) |
| B-37 | MeshCore als zweites LoRa-Format | frei, nachrangig |
| B-38 | Sprache lokal (whisper.cpp, Piper) | nach B-31 |

### Spur C – Oberfläche

| Schritt | Inhalt | Stand |
|---|---|---|
| 11.3e (C-9) | Oberfläche: Agenten in Räumen | e1–e4 ✓ ([#431](https://github.com/3DAGI/freedom-app/pull/431), [#432](https://github.com/3DAGI/freedom-app/pull/432), [#433](https://github.com/3DAGI/freedom-app/pull/433), [#434](https://github.com/3DAGI/freedom-app/pull/434)); offen nur das Monatsbudget mit Pfand – nach 11.3d3 |
| C-41 bis C-48 | Oberflächen-Review, sofort: Schlüssel per Klick, Schrift und Knöpfe, Führungsleiste, Avatare, leere Zustände, Agent-Kleinigkeiten, Namen, Website-Navigation ([`OBERFLAECHE-REVIEW.md`](OBERFLAECHE-REVIEW.md)) | frei, der Reihe nach (C-41 ✓ [#452](https://github.com/3DAGI/freedom-app/pull/452), C-47 ✓ [#453](https://github.com/3DAGI/freedom-app/pull/453)) |
| C-49 bis C-55 | Oberflächen-Review, mittel: Agent-Eingabe, Wallet-Startseite, Tauschformular, Chat-Liste, Einstellungen, Verdienen, Onboarding | nach C-42 |
| C-56 bis C-59 | Oberflächen-Review, größer: Bausteine und Bildvergleich, helles Design, Website-Auftritt, Rückmeldungen | nach C-42 |
| VKe | App: Projekte-Seite unter „Mein Knoten“ (Bausteine Spur A) | nach VKc |
| Website Englisch | Website auf Englisch | nach M-6 |
| 6.1a4b | Selbst-Update der Hülle | nach den Signierschlüsseln |

### Ohne Spur

| Schritt | Inhalt | Stand |
|---|---|---|
| 9.1–9.4 (Agenten) | Bedrohungsmodell, `SECURITY.md`, Deploy-Checklisten, KI-Hinweis nach Art. 50 AI Act | Zuteilung offen (1.1) |
