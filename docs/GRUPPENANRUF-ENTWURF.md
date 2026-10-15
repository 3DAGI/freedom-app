# Entwurf: Gruppenanrufe über LiveKit (B-34)

Stand 15.10.2026, Spur B. Sammlung B-34 (Anhang E), Entscheidung LK1 A vom 09.10.2026: „ja, nur in
privaten Räumen, Schlüssel aus MLS“ – LiveKit als Dienst neben dem Knoten (wie coturn), Ende-zu-Ende
über Insertable Streams, die Signalisierung sieht nur der eigene Knoten. Dieser Entwurf nennt Größe und
Lizenz (neue Abhängigkeiten nach `CLAUDE.md`) und die Fragen, die vor dem Bau offen sind.

## Ausgangslage

- **1:1-Anrufe** (B-13) laufen direkt zwischen zwei Browsern, Aufbau versiegelt (Kind 25040), im SDP nur
  `relay`-Kandidaten (`pruefeSdpNurRelay()`): Keiner sieht die IP des anderen, beide gehen über TURN.
- **Ab drei Personen** trägt das nicht mehr: Jeder müsste an jeden senden (Mesh). Ein SFU nimmt jeden Strom
  einmal an und verteilt ihn. LiveKit ist ein solcher SFU.
- **Private Räume** sind MLS-Gruppen (2.3): Alle Mitglieder teilen pro Epoche ein Geheimnis; wer entfernt
  wird, kennt das nächste nicht.

## Befunde

| Teil | Version | Größe | Lizenz |
|---|---|---|---|
| Server `livekit-server` (Go) | 1.13.10 (14.10.2026) | Docker-Bild 43,7 MB (amd64), 41,5 MB (arm64) | Apache-2.0 |
| Client `livekit-client` (npm) | 2.22.4 | 15 Pakete; im Bundle 561 KB minifiziert (147 KB gepackt), dazu der E2EE-Worker 294 KB (unminifiziert) – `freedom.html` hat heute 8,7 MB, also etwa +8 bis +10 % | Apache-2.0; Abhängigkeiten MIT, BSD-3-Clause, Apache-2.0, 0BSD – kein Copyleft |

Weitere Befunde:

- **Zugang:** LiveKit lässt nur mit einem JWT (HS256) in einen Raum, signiert mit dem API-Geheimnis des
  Servers. Das Geheimnis bleibt beim Knoten; Zugänge vergibt nur er (wie TURN-Zugänge, B-13a).
- **Ende-zu-Ende:** `livekit-client` verschlüsselt Bild und Ton im Browser (Insertable Streams bzw.
  `RTCRtpScriptTransform`) mit einem Schlüssel, den die App setzt (`ExternalE2EEKeyProvider`). Der SFU sieht
  nur Chiffrat – aber Metadaten: wer wann wie lange spricht, Größe der Pakete, IP-Adressen der Teilnehmer.
- **Schlüssel aus MLS:** `packages/mls` gibt heute kein Exporter-Geheimnis heraus (MLS-Exporter, RFC 9420
  8.5). Das hieße die Crate ändern und mit `bauen.sh` neu bauen.
- **Worker:** Der E2EE-Worker läuft als Web Worker; die App erlaubt `worker-src blob:` schon (CSP aus
  `build.mjs`) – er kann in `freedom.html` eingebettet bleiben.
- **IP-Adressen:** Wer sich direkt mit dem SFU verbindet, zeigt dessen Betreiber (dem Gastgeber) seine IP.
  LiveKit nimmt eigene TURN-Server des Clients an (`iceServers`, `iceTransportPolicy: "relay"`) – dann sieht
  der SFU nur die Adresse des TURN.

## Vorschläge

- **V1 – Dienst wie coturn:** `livekit-server` als Profil `livekit` in `docker-compose.yml`, Datei aus einem
  Skript (`scripts/livekit-einrichten.sh`: Schlüssel 0600, kein Log, Redis aus, Analyse aus, nur die nötigen
  Ports). Keine npm-Abhängigkeit im Knoten.
- **V2 – Zugänge nur versiegelt:** Die App des Gastgebers fragt ihren Knoten mit Besitzer-Nachweis (neues
  Kind wie 5079) nach Zugängen – je Teilnehmer einer, mit zufälliger Kennung statt Schlüssel, kurzer Laufzeit
  und nur für diesen Raum. Die Zugänge reisen als inneres Event in der MLS-Gruppe, nie offen.
- **V3 – Schlüssel je Epoche:** Der Schlüssel für Bild und Ton kommt aus der Gruppe und wechselt mit jeder
  Epoche – wer entfernt wird, hört ab dem nächsten Commit nichts mehr.
- **V4 – IP nur bewusst zeigen:** Wer einen eigenen Knoten mit TURN hat, geht über ihn zum SFU (nur `relay`,
  wie B-13c). Wer keinen hat, sieht vor dem Beitritt: „Der Gastgeber sieht deine IP-Adresse“ – und
  entscheidet. Grenze im Datenschutzbericht.
- **V5 – Ehrliche Texte:** Ende-zu-Ende heißt hier: Bild und Ton sind verschlüsselt; wer wann spricht, sieht
  der Knoten des Gastgebers.

## Fragen an den MENSCHEN

| Frage | Optionen | Empfehlung |
|---|---|---|
| **LK2** – `livekit-client` ins Bundle? (+0,6 bis 0,9 MB in `freedom.html`) | **A** ja, ins Bundle · **B** eigener schlanker Client für das Signalprotokoll (Protobuf über WebSocket; groß, viel Pflege) · **C** nur in der Hülle | **A** – gepflegt, Apache-2.0, E2EE fertig |
| **LK3** – Woher kommt der Schlüssel? | **A** MLS-Exporter (Crate ändern, `bauen.sh --pruefen`) · **B** der Gastgeber würfelt je Epoche einen Schlüssel und schickt ihn als inneres Event in die Gruppe | **A** – kein zusätzliches Geheimnis, das reisen muss; B als Übergang, falls die Crate warten soll |
| **LK4** – IP der Teilnehmer | **A** wie V4: über den eigenen TURN, sonst Warnung vor dem Beitritt · **B** immer direkt, Hinweis im Datenschutzbericht | **A** |

## Aufteilung (nach Freigabe)

| Schritt | Inhalt | Umfang |
|---|---|---|
| B-34a | Knoten: Dienst (V1), Zugänge versiegelt (V2), Selbstprüfung im Status | ~300 |
| B-34b | MLS: Schlüssel je Epoche (LK3), Tests | ~150 |
| B-34c | App: Beitreten, Bild und Ton mit E2EE, IP-Warnung (V4), Datenschutzbericht | ~350 |
| B-34d | Oberfläche (Spur C oder hier klein) | ~200 |

## Quellen

- `livekit-client` 2.22.4 (npm), gebaut mit esbuild aus `import { Room, ExternalE2EEKeyProvider }`.
- `livekit-server` 1.13.10 über `proxy.golang.org` (Lizenz, `config-sample.yaml`), Bildgrößen von Docker Hub.
