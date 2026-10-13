# Offen – alle offenen Punkte und Entscheidungen

Stand 13.10.2026, `main` bei `55bc5fd` (nach C-35). Zusammengetragen von Spur B
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

### 1.1 Agenten führen Code aus (11.5 und A-31 Vibecoden)

Für die VK-Fragen gelten bis zur Antwort die Empfehlungen als Arbeitsgrundlage
(Entwurf, Kopf). Für W3a, W6a und W7 nicht – dort baut niemand.

| Nr. | Frage | Empfehlung | Quelle | hält auf |
|---|---|---|---|---|
| W3a | Welcher Harness für Aufträge Fremder? | A – Ablauf von mini-swe-agent in TypeScript nachbauen | [`REPO-AGENTEN-ENTWURF.md`](../REPO-AGENTEN-ENTWURF.md), „Fragen dazu“ | 11.5c, 11.5d, Ort der Arbeitskopie (11.5a1) |
| W6a | Netz in der Sandbox | Pakete holt der Knoten (Sperrdatei mit Prüfsumme, feste Liste, nur GET), die Sandbox bleibt ohne Netz | ebd. | 11.5n |
| W7 | Wer darf an Code privater Räume arbeiten? | A – nur Agenten, die Mitglied sind, mit Modell auf demselben Rechner | ebd. | 11.5c, 11.5d |
| VK-W1 | Harness auf dem eigenen Knoten | A – eigener Ablauf wie W3a, Atomic Agent später | [`VIBECODEN-ENTWURF.md`](../VIBECODEN-ENTWURF.md) | VKc |
| VK-W2 | git ins Docker-Bild des Knotens? | A – ja, nur für eigene Projekte | ebd. | VKc |
| VK-W3 | Vorschau | A – über die Relays in die App, B (eigene Adresse) später | ebd. | VKd |
| VK-W4 | Netz für eigene Projekte | B – Schalter „Internet frei“ je Projekt, nie ins Heimnetz | ebd. | VKc |
| VK-W5 | Koppeln auch mit kurzem Code? | A – nur QR | ebd. | – |

### 1.2 Lightning wie der Zahlkanal (RM2, Cashu-Pfand)

Ohne Antwort baut niemand daran.

| Nr. | Frage | Empfehlung |
|---|---|---|
| W1 | Wie geht „einmal zahlen, viele Nachrichten“ mit Lightning? | A – Cashu-Pfand jetzt, Spilman-Kanal später als Fassung 2 |
| W2 | Wer wählt die Mint? | A – der Nutzer; es gilt die Schnittmenge mit der Liste des Providers |
| W3 | Fenster und Frist | 20 sats und eine Stunde, wie heute |
| W4 | Anteile der übrigen Empfänger | A – nach der Antwort aus dem Guthaben per Lightning, gesammelt |
| W5 | Cashu als Weg für Lightning-Sitzungen (ändert E4b V3 „nie Vorgabe“) | A – jede Ladung bestätigt der Nutzer, die Mint steht immer dabei |

Quelle: [`RM2-ENTWURF.md`](../RM2-ENTWURF.md), „Fragen an den MENSCHEN“.

### 1.3 Bestätigungen und Zuteilungen

| Punkt | Offen | Quelle |
|---|---|---|
| 0.G Programm-ID | Entschieden am 11.10. (A: bei `B6W19U…` bleiben) – **vorausgesetzt, das Upgrade-Recht `8DhKPv…` liegt beim MENSCHEN**. Das ist noch nicht bestätigt. In `FORTSCHRITT.md` steht 0.G noch als „offen“. | Sammlung M-1 |
| Phase 9, Teil der Agenten | Keiner Spur zugeteilt: `docs/BEDROHUNGSMODELL.md` (9.1), `SECURITY.md` (9.2), Deploy-Skripte und Rücknahmeplan (9.3), KI-Hinweis nach Art. 50 AI Act und C2PA (9.4). Wer, und wann? | [`phase-9.md`](phase-9.md) |
| Phase 9, Teil des MENSCHEN | Auditoren; Beträge der Bug-Bounty (Sats und SOL); Zeitpunkt Mainnet; CASP-Einordnung nach AMLR (Frist 10.07.2027), Steuer, Impressum und Firmenname (0.F) | [`phase-9.md`](phase-9.md), FORTSCHRITT 0.F |

### 1.4 Zurückgestellt – ohne Termin

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
| M-1 / 0.G | HTLC-Programm bei `B6W19U…` auf den aktuellen Code upgraden, A-28 im selben Upgrade, `3UmRR…` schließen | A-28 wirksam |
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
| VKc | Knoten: Projekte, Ablauf mit Freigaben und Stopp, Commit je Schritt, nur für den Besitzer | frei (VK-Empfehlungen als Grundlage) |
| VKd | Knoten und Protokoll: Bauen und Vorschau-Paket | frei, nach VKc |
| VKf | App: „Als Repo in einen Raum stellen“ | frei, nach VKc |
| 11.5b | Protokoll: Repo-Tag in der Erwähnung, `patchStatus()` ohne Agenten | frei |
| 11.5n | Pakete holen | nach W6a |
| 11.5c | Knoten: Ablauf für Repo-Aufträge, Patch einreichen | nach W3a, W7 |
| 11.5d | App: „Agent beauftragen“, Obergrenze (Oberfläche mit Spur C) | nach W3a, W7 |
| A-21a–f | `@solana/kit` statt web3.js v1 | frei ([`KIT-PLAN.md`](../KIT-PLAN.md)) |
| A-12 | Gemeinsame Kasse für Räume über Squads | nach A-21a/b ([`KASSE-ENTWURF.md`](../KASSE-ENTWURF.md)) |
| A-17 | Eingebaute Lightning-Wallet (Breez, Cashu) | frei; Breez nach dem API-Schlüssel ([`E4B-ENTWURF.md`](../E4B-ENTWURF.md)) |
| RM2 | Cashu-Pfand für Lightning-Sitzungen | nach RM2 W1–W5 |
| A-28 | Swap SOL → Lightning: Rückgabe vor Ablauf | Code frei, wirksam erst mit dem Upgrade (M-1) |
| P5d | Prüfrunden mit SOL | nach M-2 |
| A-10 A | Abos über den Zahlkanal mit Obergrenze | nach M-2, mit B-18 |
| E8 | Hinterlegung für KI entfernen | nach M-2 |
| E9-5 | Cluster-Betrieb | nach zwei Geräten (MENSCH) |
| L2-3 A | Netzweite Ausfall-Kenntnis | später (1.4) |

### Spur B – Mesh und Bausteine

| Schritt | Inhalt | Stand |
|---|---|---|
| E9-4 | Katalog 38080 mit Verweis aufs Manifest, „geprüft“ je Modell | frei – als Nächstes |
| E9-2 | Gratis-Grenze für Speicher im `storage`-Tag, `network-capacity.ts` raus | frei, nach E9-4 |
| E9-1 | `cluster.ts` aufräumen (Kinds, alte Gebühr und Bilanz raus, Angebot 38028) | frei, nach E9-2 |
| VKb = 11.5s | Sandbox (bubblewrap je Befehl, Grenzen, leere Umgebung), Selbstprüfung „Sandbox“ | frei (VK-Empfehlungen als Grundlage) |
| 11.5a1, 11.5a2 | Bundle-Leser, Patch-Schreiber (W1 B) | frei; Ort der Arbeitskopie nach W3a |
| 11.3d3 | Monatsbudget mit Pfand beim Knoten-Agenten | nach M-2 |
| B-18 (8.9c) | Speicher bezahlen in sats und SOL | nach M-2 |
| B-30 | Atomic Agent als Harness | frei (AG1 A) |
| B-31 | Werkzeuge über MCP, Kiwix | frei (MC1 A), Größe im PR nennen |
| B-32 | Reticulum als zweiter Funkweg | frei – erst ein Entwurf (RN1) |
| B-33 | Tor mit Pluggable Transports | frei (PT1 A), Größe und Lizenz im PR nennen |
| B-34 | Gruppenanrufe über LiveKit | frei (LK1 A) |
| B-35 | Abgleich mit Negentropy (NIP-77), eigene Umsetzung | frei (NG1 B) |
| B-37 | MeshCore als zweites LoRa-Format | frei, nachrangig |
| B-38 | Sprache lokal (whisper.cpp, Piper) | nach B-31 |

### Spur C – Oberfläche

| Schritt | Inhalt | Stand |
|---|---|---|
| 11.3e (C-9) | Oberfläche: Agenten in Räumen | e1–e4 ✓ ([#431](https://github.com/3DAGI/freedom-app/pull/431), [#432](https://github.com/3DAGI/freedom-app/pull/432), [#433](https://github.com/3DAGI/freedom-app/pull/433), [#434](https://github.com/3DAGI/freedom-app/pull/434)); offen nur das Monatsbudget mit Pfand – nach 11.3d3 |
| VKe | App: Projekte-Seite unter „Mein Knoten“ (Bausteine Spur A) | nach VKc |
| Website Englisch | Website auf Englisch | nach M-6 |
| 6.1a4b | Selbst-Update der Hülle | nach den Signierschlüsseln |

### Ohne Spur

| Schritt | Inhalt | Stand |
|---|---|---|
| 9.1–9.4 (Agenten) | Bedrohungsmodell, `SECURITY.md`, Deploy-Checklisten, KI-Hinweis nach Art. 50 AI Act | Zuteilung offen (1.3) |
