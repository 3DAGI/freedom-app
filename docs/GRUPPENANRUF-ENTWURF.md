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

## Entscheidungen vom 18.10.2026 (MENSCH)

LK2 **A** (`livekit-client` ins Bundle), LK3 **A** (Schlüssel aus dem MLS-Exporter, die Crate wird dafür geändert – mit `bauen.sh --pruefen`), LK4 **A** (über den eigenen TURN, sonst Warnung vor dem Beitritt). Damit ist B-34 frei; B-34a als Nächstes. Quelle: Entscheidungsvorlage Spur B (Seite „Entscheidungen Spur B“, 18.10.2026), Antworten ohne Notizen.

## Aufteilung (nach Freigabe)

| Schritt | Inhalt | Umfang |
|---|---|---|
| B-34a ✓ | Knoten: Dienst (V1), Zugänge versiegelt (V2), Selbstprüfung im Status – `livekit.ts`, Kind 5081 (`PROTOCOL.md` §39), Profil „livekit“, `scripts/livekit-einrichten.sh` | ~300 |
| B-34b ✓ | MLS: Schlüssel je Epoche (LK3) – `Engine::freedom_export_secret()` in `mdk.patch`, `anrufSchluessel(gruppe, anruf, epoche)` in der Crate (Label `freedom/anruf`, Kontext `livekit:<raum>`, `PROTOCOL.md` §39) | ~150 |
| B-34c1 ✓ | Einladung als inneres Event der Gruppe (`raum-gruppenanruf.ts`, Art 25041), anrufen und beenden in der App (`shell/gruppenanruf.ts`: Zugänge vom eigenen Knoten, je Mitglied einer), Leak-Szenario | ~250 |
| B-34c2 ✓ | App: Beitreten mit `livekit-client` 2.22.4 (`shell/gruppenanruf-verbindung.ts`): je MLS-Epoche ein Schlüssel im Ring (`schluesselIndex()`), Weg nur über den eigenen TURN oder nach Zustimmung (`beitrittsWeg()`, V4), E2EE-Worker als Text im Bundle; `livekit-client` vorab minifiziert (gemessen: `freedom.html` +0,92 MB, gepackt +0,20 MB, sobald B-34d ihn aufruft) | ~300 |
| B-34d ✓ | Oberfläche im privaten Raum (`shell/gruppenanruf-ui.ts`: anrufen, beitreten mit Rückfrage zur IP, Bild und Ton, stumm, verlassen, beenden), Grenze „gruppenanruf“ im Datenschutzbericht, Smoke-Teil „privatraum“ mit Knoten-Attrappe (`scripts/gruppenanruf-probe.mts`) | ~400 |
| B-34e1 ✓ | Signalverbindung über den eigenen Knoten (LK5 A), Teil Knoten: Kind 5082 (nur Besitzer, Nachweis, versiegelt), Weiterleitung `/signal/<zeichen>` im Relay des Knotens, nur `wss://`, ohne Tor nur öffentliche Adressen, mit Tor über den Proxy | ~300 |
| B-34e2 ✓ | Teil App: Zeichen beim eigenen Knoten holen, `livekit-client` dorthin verbinden; mit Weiterleitung und eigenem TURN entfällt die Rückfrage vor fremden Anrufen; Datenschutzbericht, Smoke-Test | ~250 |

## Befund B-34d (18.10.2026): die Signalverbindung geht direkt

`livekit-client` verbindet sich für die Signalisierung per WebSocket direkt mit der Adresse des SFU (`<url>/rtc/v1`, im
Quelltext `createRtcUrl()`); `iceServers` und `iceTransportPolicy: "relay"` gelten nur für Bild und Ton. Der Knoten der
anrufenden Person sieht die IP-Adresse jedes Teilnehmenden also immer – auch mit eigenem TURN. Die Aussage unter
„Befunde“ („dann sieht der SFU nur die Adresse des TURN“) stimmte nur für Bild und Ton.

Folge in B-34d (strenger als LK4 A, im Sinn der Entscheidung): Einem fremden Anruf tritt die App nur nach Rückfrage bei
(`zustimmungNoetig()`), auch mit eigenem TURN; beim eigenen läuft der SFU auf dem eigenen Knoten. Der eigene TURN trägt
weiter Bild und Ton. Datenschutzbericht: Grenze „gruppenanruf“. Ob der eigene Knoten die Signalverbindung weiterreichen
soll, fragt LK5 (`docs/ausbau/OFFEN.md` 1.6).

Außerdem: Alle Eingeladenen sehen alle Zugänge der Einladung (V2) – wer im Anruf welchen nutzt, prüft niemand. Die App
nennt im Anruf deshalb keine Namen.

## Entscheidung LK5 (19.10.2026, MENSCH)

LK5 **A** – der eigene Knoten reicht die Signalverbindung zum fremden SFU weiter (nur für den Besitzer, nur `wss://` zu
öffentlichen Adressen aus einer Einladung). Erst dann hält der Weg über den eigenen Knoten, was LK4 A wollte. Bis B-34e
fragt die App weiter vor jedem fremden Anruf. Quelle: Antwort des MENSCHEN im Chat von Spur B (19.10.2026): „Die offenen Entscheidungen alle nach deinen Empfehlungen.“

## Stand B-34e1 (19.10.2026)

Der Knoten reicht die Signalverbindung weiter (`node/src/signal-weiterleitung.ts`, `docs/PROTOCOL.md` §41): Der Besitzer
holt versiegelt ein Zeichen für ein Ziel (Kind 5082), der Relay des Knotens nimmt `/signal/<zeichen>/rtc[/v1]` an und
verbindet sich zum SFU – mit Tor über den Proxy, ohne Tor nur zu öffentlichen Adressen. Weiter gehen nur Pfad und
Anfrage; Kopfzeilen des Browsers (Herkunft, Cookies, Browserkennung) bleiben beim Knoten. Was der SFU gleich nach dem
Öffnen schickt (die Antwort auf den Beitritt), hebt der Knoten auf, bis der Browser angenommen ist – sonst ginge sie
verloren. `livekit-client` fragt nach einem Fehler `…/rtc/v1/validate` per HTTP; der Relay antwortet dort wie auf jeden
anderen Pfad (200, Hinweistext), der Client meldet dann einen allgemeinen Fehler statt „Zugang abgelehnt“ – für die App
gleich. Die App nutzt den Weg ab B-34e2; bis dahin fragt sie vor fremden Anrufen.

## Stand B-34e2 (19.10.2026) – B-34 fertig im Code

Die App holt bei einem fremden Anruf vor der Rückfrage den eigenen Weg: Vermittler (5079) und – nur mit Relay des Knotens
und der Rolle `signal` im Status – ein Zeichen für die Weiterleitung (5082). Gehen beide über den eigenen Knoten, tritt sie
ohne Rückfrage bei und verbindet `livekit-client` mit `<Relay des Knotens>/signal/<zeichen>`; sonst fragt sie wie bisher und
nutzt nach der Zustimmung, was es gibt (den gerade geholten Weg, nicht neu gefragt). Ein Knoten vor B-34e1 bekommt keine
5082 – er läse sie als gewöhnlichen Auftrag. Datenschutzbericht: Grenze „gruppenanruf“ nennt die Ausnahme (eigener Knoten
mit Relay und Vermittler). Offen bleibt nur der Test mit Geräten (MENSCH).

## Quellen

- `livekit-client` 2.22.4 (npm), gebaut mit esbuild aus `import { Room, ExternalE2EEKeyProvider }`.
- `livekit-server` 1.13.10 über `proxy.golang.org` (Lizenz, `config-sample.yaml`), Bildgrößen von Docker Hub.
