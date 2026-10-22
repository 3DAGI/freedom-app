# Entwurf: Reticulum als zweiter Funkweg (B-32)

Stand 15.10.2026, Spur B. Sammlung B-32 (Anhang E), Entscheidungen vom 09.10.2026: RN1 „wie
empfohlen – im Entwurf prüfen: Bibliothek, wenn Größe, Lizenz und Pflege passen, sonst eigene
Umsetzung“, RN2 A (eigene Reticulum-Identität je Gerät, nie aus dem Nostr-Schlüssel, Grenze im
Datenschutzbericht). Dieser Entwurf prüft RN1 und stellt die offenen Fragen (W1–W5). Gebaut wird
erst nach Freigabe.

## Ausgangslage

- **Meshtastic** (7.5) bringt Umschläge über LoRa-Geräte mit Meshtastic-Firmware: ein Kanal,
  Fluten durch die Firmware, keine Zustellung an Abwesende, Sendezeit über `Sendezeitkonto`.
- **Reticulum** routet über mehrere Sprünge und Träger (LoRa über RNode, Packet-Radio, WLAN,
  I2P, TCP), baut Links, überträgt große Ressourcen in Stücken und hat mit **LXMF** Nachrichten,
  die warten, bis der Empfänger erreichbar ist (direkt oder über Propagation-Knoten).
- Ein LoRa-Gerät läuft **entweder** mit RNode- **oder** mit Meshtastic-Firmware. Wer beides will,
  braucht zwei Geräte oder flasht um.

## Befunde

| Punkt | Befund |
|---|---|
| Bibliothek | [`@reticulum/core`](https://www.npmjs.com/package/@reticulum/core) 0.9.8 (reticulum-js, Henri Bergius): keine Abhängigkeiten, ohne `node:`-Importe, läuft im Browser und in Node; 1,2 MB entpackt. LXMF in `@reticulum/lxmf` (240 KB), Node-Schnittstellen (TCP, `rnsd`) in `@reticulum/node` (340 KB). |
| Lizenz | **EUPL-1.2** – dieselbe wie Freedom (seit LIZ), kein Konflikt. |
| Pflege | Releases fast täglich (0.9.3 bis 0.9.8 zwischen 03. und 10.10.2026), abgeglichen mit der Python-Referenz (RNS 1.5.x), eigene Interop-Tests gegen Python. |
| Stand | „Leaf node“: sendet und empfängt, routet aber nicht für andere. LXMF senden und empfangen geht, dazu Papier-Nachrichten (`lxm://` als QR). |
| Geräte | RNode über **WebSerial** im Browser (`rnode-webserial.js`) – wie Meshtastic über USB (7.5b); im Knoten über `@reticulum/node` (TCP zu `rnsd`, seriell). |
| Python-Referenz | RNS steht seit April 2025 unter einer eigenen Lizenz: MIT-Text plus Verbot, die Software in Systemen zu nutzen, die Menschen schaden sollen, und eine Klausel gegen KI. Das ist keine OSI-Lizenz. Freedom bindet RNS nicht ein; Vektoren daraus (wie bei Meshtastic, 7.5a) hießen, RNS im Projekt auszuführen – das vermeiden wir. |

**Ergebnis zu RN1:** Bibliothek (A) – Lizenz gleich, keine Abhängigkeiten, gepflegt, im Browser
lauffähig. Exakt gepinnt wie `jsqr` und das ACP-SDK; Größe im Pull Request des ersten Schritts
nennen (Messung an `freedom.html`, W5).

## Vorschläge

- **V1 – Nur Umschläge.** Über Reticulum geht, was heute über Funk geht: nur, was
  `pruefeMeshInhalt()` durchlässt (Umschläge 1059, voll signierte Solana-Transaktionen). Der
  Nostr-Umschlag liegt als Inhalt in einer LXMF-Nachricht; Reticulum verschlüsselt zusätzlich.
- **V2 – Identität je Gerät (RN2 A).** Ein Reticulum-Schlüssel je Gerät, zufällig erzeugt, im
  Tresor (`freedom.reticulum`), nie aus dem Nostr-Schlüssel abgeleitet. Ankündigungen (Announces)
  machen die Ziel-Adresse im Funk sichtbar – Grenze „reticulum-ankuendigung“ im Datenschutzbericht,
  mit Szenario in `privacy-facts.test.ts`.
- **V3 – Sendezeit.** LoRa über RNode unterliegt denselben Regeln wie Meshtastic: alles über die
  Warteschlange mit `Sendezeitkonto` (1 % je Stunde), nie an ihr vorbei. Ankündigungen zählen mit.
- **V4 – Adresse nur für Kontakte (W2).** Wer jemandem über Reticulum schreiben will, braucht dessen
  LXMF-Adresse. Vorschlag: versiegelt an Kontakte wie die Ruf-Zusammenfassung (38075), nie offen im
  Profil – sonst verbände jeder den Nostr-Schlüssel mit einer Funk-Adresse.
- **V5 – Warten auf Abwesende (W3).** Erst direkt (der Empfänger ist erreichbar) und über den
  eigenen Knoten, der wie heute über Nostr weiterreicht; fremde Propagation-Knoten nur auf Wunsch,
  weil ihr Betreiber sieht, wer wem wann schreibt.
- **V6 – Gateway.** Der Knoten bekommt eine weitere Gateway-Art (`FUNK_GATEWAY=reticulum:…`), mit
  denselben Regeln wie 7.4/7.5d (`kurzParam()`, `GatewayBuch`, Sendezeit) – erst nach der App.

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| W1 | RN1 bestätigt? | A `@reticulum/core` + `@reticulum/lxmf` (EUPL-1.2, ohne Abhängigkeiten, gepinnt) · B eigene Umsetzung | **A** – Befunde oben |
| W2 | Wie lernt ein Kontakt die Reticulum-Adresse? | A versiegelt an Kontakte (neues Kind wie 38075) · B nur persönlich (QR beim Sicherheitscode, B-4) · C offen im Profil | **A**, B zusätzlich |
| W3 | Zustellen an Abwesende | A direkt und über den eigenen Knoten · B dazu fremde Propagation-Knoten auf Wunsch · C eigener Propagation-Knoten im Freedom-Knoten (reticulum-js routet noch nicht; Python `lxmd` hat die Lizenz oben) | **A**, B als Schalter später |
| W4 | Wo zuerst? | A App mit RNode über WebSerial · B Gateway im Knoten · C beides zugleich | **A**, dann B |
| W5 | Größe von `freedom.html` | A immer dabei · B nur in der Hülle (Desktop/Android) · C eigener Build | **A**, wenn der Zuwachs unter etwa 150 KB (gzip) bleibt – sonst neu fragen |

## Entscheidungen vom 18.10.2026 (MENSCH)

W1 **A** (`@reticulum/core` und `@reticulum/lxmf`, exakt gepinnt), W2 **A** (Adresse versiegelt an Kontakte; B, persönlich per QR, zusätzlich), W3 **A** (direkt und über den eigenen Knoten), W4 **A** (zuerst die App mit RNode über WebSerial, dann das Gateway), W5 **A** (immer in `freedom.html`, solange der Zuwachs unter etwa 150 KB gepackt bleibt – sonst neu fragen). Damit ist B-32 frei; B-32a als Nächstes. Quelle: Entscheidungsvorlage Spur B (Seite „Entscheidungen Spur B“, 18.10.2026), Antworten ohne Notizen.

## Aufteilung (nach Freigabe)

| Schritt | Inhalt | Umfang |
|---|---|---|
| B-32a | Abhängigkeit gepinnt, Identität im Tresor, Umschlag in LXMF ein- und auspacken (`pruefeMeshInhalt()`), Größe gemessen | ~250 |
| B-32b1 ✓ | App: Funkparameter je Region (RN-W6 A) mit Quelle, Prüfung der Grenzen, RNode über WebSerial verbinden (Sendezeit-Sperre der Region in der Firmware), Knopf im Funk-Bereich – die RNode hört nur zu | ~250 |
| B-32b2 ✓ | App: Reticulum über die RNode – eigenes LXMF-Ziel, empfangen wie Funk, Sendezeitkonto für jedes Paket an die RNode, Datenschutz-Grenze „reticulum-ankuendigung“ | ~300 |
| B-32b3 ✓ | Senden: Gegenstelle (Adresse eintippen oder per QR, nur in `geheim`), `sendeUeberFunk()` über Reticulum, eigene Adresse als QR | ~250 |
| B-32b4 ✓ | Abweichende Werte innerhalb der Grenzen, Smoke-Test mit Attrappe | ~200 |
| B-32c | Adresse für Kontakte (W2), Zustellen über den eigenen Knoten (W3 A) | ~300 |
| B-32d | Gateway im Knoten (`@reticulum/node`, TCP zu `rnsd`) | ~300 |

Live-Proben mit echten RNode-Geräten macht der MENSCH (wie bei Meshtastic, MENSCH-Checkliste).

## Stand B-32a (18.10.2026)

- **Bibliothek:** `@reticulum/core` und `@reticulum/lxmf` 0.9.12, exakt gepinnt (0.9.9–0.9.11 schlossen Lecks und
  Abstürze; 0.9.12 ist bei B-32a einen Tag alt). `@reticulum/lxmf` hängt nur an `@reticulum/core`. Die Nachricht kommt
  aus `@reticulum/lxmf/src/message.js` – das Paket nennt die Klasse an der Wurzel `LXMessage` und hat dort keine Typen
  (Brücke `src/reticulum-typen.d.ts`).
- **Größe (W5):** Baustein samt Bibliothek gebündelt 163 KB, gepackt 48 KB – fast alles `@reticulum/core` (Links,
  Ressourcen, Transport, die B-32b braucht). Noch nicht in `freedom.html`: die App lädt den Baustein erst mit B-32b;
  dort wird an `freedom.html` gemessen.
- **Identität (V2):** `freedom.reticulum.identitaet` in `geheim` (`GEHEIM_FEST`); alles unter `freedom.reticulum.`
  steht in `SICHERUNG_NIE` (damit auch nicht im Export). Ein kaputter Eintrag wird nie ersetzt.
- **Umschlag (V1):** `reticulum-umschlag.ts` – Felder `0xFB` = `"freedom/mesh-1"`, `0xFC` = Art + Nutzlast, Schlüssel
  als Zahlen (`Map`; ein Objekt machte Text daraus). Gelesen wird nur die direkte Form mit der eigenen Adresse am
  Anfang: Ohne sie nähme die Bibliothek eine Nachricht als „opportunistisch“ und setzte die erwartete Adresse ein.
  Opportunistische Pakete (ein Paket, Ziel im Kopf von Reticulum) kommen mit B-32b, wenn der Transport das Ziel nennt.
- **Gegen Python geprüft?** Nein – die Python-Referenz läuft wegen ihrer Lizenz nicht im Projekt (Befunde oben). Die
  Form folgt der Spezifikation und den eigenen Interop-Tests von reticulum-js; die Live-Probe mit Sideband/NomadNet
  macht der MENSCH mit B-32b.

## Frage vor B-32b (19.10.2026)

Eine RNode sendet nur mit Funkparametern, die die App ihr beim Verbinden gibt (Frequenz, Bandbreite, Spreizfaktor,
Kodierrate, Sendeleistung) – anders als Meshtastic, wo die Region im Gerät steht und die App sie nie setzt (7.5).
Was erlaubt ist, hängt von der Region ab (Frequenzbereich, höchste Sendeleistung, Sendezeit). Die Adresse für Kontakte
(W2) kommt erst mit B-32c; bis dahin tauscht man sie persönlich per QR-Code aus (W2 B, schon entschieden).

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| RN-W6 | Woher kommen die Funkparameter der RNode? | **A** Vorgaben je Region (Bereich, Leistung, Sendezeit aus einer Tabelle im Code, mit Quelle), die man vor dem ersten Senden bestätigt; Abweichen nur innerhalb der Grenzen der Region · **B** man trägt alles selbst ein, die App schlägt nichts vor · **C** wie A, aber ohne Grenzen (Funkamateure) | **A** – niemand muss Frequenzpläne kennen, und die App sendet nie außerhalb dessen, was die gewählte Region erlaubt |

**Entschieden 19.10.2026 (MENSCH):** RN-W6 **A** – Vorgaben je Region (Tabelle im Code mit Quelle), vor dem ersten Senden
bestätigt, Abweichen nur innerhalb der Grenzen der Region. Damit ist B-32b frei. Quelle: Antwort des MENSCHEN im Chat von Spur B (19.10.2026): „Die offenen Entscheidungen alle nach deinen Empfehlungen.“

## Stand B-32b1 (19.10.2026)

- **Regionen (RN-W6 A):** `FUNK_REGIONEN` in `app/src/rnode-funk.ts` – zwei Einträge, beide EU:
  - `eu-869`: 869,400–869,650 MHz, 500 mW e.r.p., Sendezeit ≤ 10 %; Vorgabe 869,525 MHz, 125 kHz, SF 8, CR 4/5, 14 dBm.
  - `eu-433`: 433,050–434,790 MHz, 10 mW e.r.p. bei Sendezeit ≤ 10 %; Vorgabe 433,775 MHz, 125 kHz, SF 8, CR 4/5, 10 dBm.
  - Quelle je Zeile: Beschluss 2006/771/EG der Kommission (Kurzstreckengeräte), geändert durch Durchführungsbeschluss
    (EU) 2019/1345; dazu ERC/REC 70-03 Anhang 1 und ETSI EN 300 220. **Den Primärtext erreicht diese Umgebung nicht**
    (EUR-Lex, CEPT, legislation.gov.uk gesperrt) – die Werte stimmen mit den Zusammenfassungen überein, die erreichbar
    waren: für 868 MHz The Things Network („Regional Limitations of RF Use“), Tektelic und Mobilefish (ETSI-Teilbänder
    M bzw. g1: 25 mW, 1 %; P bzw. g3: 500 mW, 10 %), für 433 MHz die Fassung von Beschluss 2008/432/EG (10 mW e.r.p. bei
    ≤ 10 %) und Analog Devices zu ERC/REC 70-03. Der MENSCH vergleicht sie vor dem ersten Senden mit dem Anhang des
    konsolidierten Beschlusses.
  - Andere Regionen (USA, Asien …) gibt es nicht: Ohne geprüfte Quelle sendet die App dort über RNode nicht.
- **Grenzen:** `pruefeFunkParameter()` – das ganze Signal (Mitte ± halbe Bandbreite) im Band, Bandbreiten der LoRa-Chips,
  SF 7–12, CR 5–8, Leistung höchstens die e.r.p.-Grenze abgerundet (für eine Antenne ohne Gewinn; der Text sagt das).
  Die Sendezeit sperrt die Firmware selbst (`airtimeLimitLong` = Wert der Region).
- **Verbinden:** `verbindeRNode()` über `RNodeWebSerialInterface` (`@reticulum/core` 0.9.12, schon gepinnt) – nur mit
  bestätigter Wahl (`freedom.reticulum.funk`); die Schnittstelle bricht ab, wenn die Firmware andere Werte meldet oder
  älter als 1.52 ist. Im Funk-Bereich: Knopf „RNode (Reticulum)“ → Region bestätigen → Port → verbunden. Vorerst hört die
  RNode nur zu; gesendet wird über sie erst mit B-32b2.
- **Größe (W5):** `freedom.html` +192 KB, gepackt +41 KB.

## Stand B-32b2 (22.10.2026)

- **Kern:** `starteReticulum()` (`app/src/reticulum-funk.ts`) – ein Reticulum-Kern (`@reticulum/core`, ohne Speicher: Pfade
  und Identitäten nur für die Sitzung) mit der RNode als einziger Schnittstelle und dem LXMF-Router der Bibliothek
  (`@reticulum/lxmf/src/router.js`, nicht der Sammelpunkt mit Propagation-Knoten). Das eigene Ziel ist `lxmf.delivery` der
  Identität aus B-32a. Was ankommt, geht nur weiter, wenn `leseReticulumFelder()` es durchlässt – dann wie Funk über
  `nimmFunkInhalt()` (`tabs/mesh.ts`, dieselbe Stelle wie Meshtastic).
- **Sendezeit (V3):** Jedes Paket an die RNode geht durch `send()` der Schnittstelle – auch was der Kern von sich aus
  schickt (Antwort auf eine Pfad-Anfrage, Bestätigung, Link). Dort bucht `RETICULUM_KONTO` (`Sendezeitkonto`, 1 % je
  Stunde, eines je Sitzung) nach `rnodeSendezeit()` (Semtech, Präambel wie die Firmware: mindestens 18 Symbole, sonst
  24 ms; über 254 Byte zwei Rahmen). Was nicht mehr hineinpasst, geht still verloren wie ein Paket im Funk – ein Fehler
  ließe den Schreibstrom des Kerns für immer scheitern (Gegenprobe im Test). Vor dem Senden einer Nachricht prüft
  `sende()` das Konto und meldet `sendezeit`.
- **Gemessen** (zwei RNode-Attrappen, SF 8, 125 kHz): ein Umschlag von 2,9 KB kostet den Absender 12 Pakete und etwa
  11,4 s Sendezeit (Pfad-Anfrage, Link, Ressource in Stücken), den Empfänger 5 Pakete und etwa 2 s. Mit 36 s je Stunde
  sind das etwa drei solche Nachrichten je Stunde.
- **Von sich aus nichts:** Die App kündigt ihr Ziel nicht an; erst wer nach der Adresse fragt, bekommt eine Antwort –
  sie trägt Adresse und öffentlichen Schlüssel offen. Grenze „reticulum-ankuendigung“ im Datenschutzbericht.
- **Senden** baut `sende()` schon (geprüft wie `verpackeFuerReticulum()`, `fallback: "opportunistic"`); aufgerufen wird es
  erst mit B-32b3, wenn die App eine Gegenstelle kennt.
- **Größe (W5):** Das Bundle der App ist nicht minifiziert – mit Kern und Router wäre `freedom.html` gepackt um weitere
  117 KB gewachsen, zusammen mit b1 über die 150 KB aus W5. Deshalb wie bei `livekit-client` vorab minifiziert (Plugin
  „reticulum-klein“ in `build.mjs`), und alle Pfade in die Bibliothek führen auf EIN Modul – zwei Kopien des Kerns
  hätten getrennte Tabellen für Wege und Ziele. Reticulum insgesamt (b1 und b2) gegenüber dem Stand vor b1: +332 KB,
  gepackt +80 KB. Die Tests liefen zusätzlich gegen genau dieses Modul (Umschlag A → B, Sendezeit).

## Stand B-32b3 (22.10.2026)

- **Gegenstelle:** die LXMF-Adresse, an die die App über Reticulum sendet – heute eine Freedom-App mit Internet, die
  weiterreicht (sie nimmt den Umschlag über `nimmFunkInhalt()` an und gibt ihn an den Pool bzw. reicht die Zahlung ein),
  ab B-32d auch der eigene Knoten. Gelesen nur über `leseLxmfAdresse()` (32 Zeichen Hex, wie Reticulum sie zeigt auch in
  spitzen Klammern), gemerkt nur in `geheim` (`freedom.reticulum.gegenstelle` – sie verrät, mit wem man funkt).
- **Oberfläche:** Knopf „Reticulum-Adressen“ im Funk-Bereich (`adressenDialog()`): die eigene Adresse als Text und
  QR-Code (nicht geheim – jede Antwort im Funk trägt sie), die Gegenstelle eintippen oder scannen, leer = keine.
- **Senden:** `sendeUeberFunk()` nimmt ohne Meshtastic-Gerät `sendeUeberReticulum()` – nur mit laufender RNode und
  gemerkter Gegenstelle, sonst wie bisher der Datei-Weg. Heute geht das so: SOL-Zahlungen ohne Internet. KI über Funk
  bleibt bei Meshtastic (`funkGeraetVerbunden()`): Die Antwort käme nur über ein Gateway im Knoten zurück (B-32d).
  Fehler nur über ihre Kennung (`reticulumFehlerText()`, je Fall ein Text).
- **Datenschutz:** Die Grenze „reticulum-ankuendigung“ nennt jetzt auch das Senden – jedes Paket an die Gegenstelle trägt
  deren Adresse offen; sie selbst erfährt deine.

## Stand B-32b4 (22.10.2026)

- **Eigene Werte:** Im Dialog der Region „Werte“: Vorgabe der Region oder eigene. Eigene stehen in einem zweiten Dialog
  (Frequenz in MHz, Bandbreite, Spreizfaktor, Kodierrate, Sendeleistung), vorbelegt mit den gemerkten eigenen Werten
  derselben Region, sonst mit der Vorgabe. Angenommen wird nur, was `pruefeFunkParameter()` besteht – der Dialog bleibt
  offen und nennt den Fall (`funkFallText()`, je `FUNK_FAELLE` ein Text). Bandbreiten stehen nur zur Wahl, wenn sie ins
  Band passen. Gelesen über `leseFunkEingabe()` (Hz genau, ohne Rundung). Den Port wählt man erst danach.
- **Sendezeit:** Das Konto (1 % je Stunde) rechnet mit den gewählten Werten – SF 12 bei 62,5 kHz kostet je Paket mehr als
  das Achtfache der Vorgabe. Die Sperre der Firmware bleibt die der Region.
- **Smoke-Test „rnode“:** Eine KISS-Attrappe spielt die RNode im Browser: Grenzen im Dialog, Port erst nach dem
  Bestätigen, die Firmware bekommt genau die eigenen Werte samt Sperre (10 %), die App funkt von sich aus nichts,
  Reticulum-Adressen mit QR-Code und geprüfter Gegenstelle, Trennen, gemerkte eigene Werte beim nächsten Mal vorgewählt.

## Quellen

- reticulum-js, README und Changelog im npm-Paket `@reticulum/core` 0.9.8 (gelesen 15.10.2026)
- Reticulum-Lizenz: [Lizenztext (Spiegel)](https://git.hackliberty.org/Git-Mirrors/Reticulum/src/branch/master/docs/source/license.rst),
  [FOSDEM 2026, Reticulum-Treffen (Folien)](https://fosdem.org/2026/events/attachments/9NCWUR-reticulum_community_meetup_implementations_migration_and_future/slides/262533/reticulum_dimz1j8.pdf)
