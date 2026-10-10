# Phase 11 – Gemeinsam arbeiten: QR, Werbelinks, Agenten und Repos in Räumen

Wunsch des MENSCHEN (28.09.2026): Geräte per QR-Code hinzufügen; Werbelinks
mit eigener Adresse; Agenten in Räumen und Communities – neu anlegen oder
vorhandene einladen –, dazu Repos im Raum, damit Mitglieder mit Agenten
gemeinsam an Projekten, Apps und Websites arbeiten. Privat und öffentlich,
jeweils als Option.

## Entscheidungen (MENSCH, 28.09.2026)

| Frage | Entscheidung |
|---|---|
| Wo läuft ein Agent? | **Beides wählbar:** auf einem Provider-Knoten (immer erreichbar, eigenes Raummitglied; in privaten Räumen liest der Knoten mit wie jedes Mitglied – der Raum zeigt das offen) oder auf dem Gerät des Erstellers (antwortet nur, solange dessen App offen ist; jede Anfrage geht wie heute privat an einen Provider). |
| Wer bezahlt die Arbeit eines Agenten? | **Einstellbar:** wer ihn anspricht (jede Erwähnung ist eine normale bezahlte KI-Anfrage) oder wer ihn einlädt (Budget mit Obergrenze). |
| QR-Codes | **Selbst bauen**, ohne neue Abhängigkeit; scannen mit der Kamera über die eingebaute Browser-Erkennung (`BarcodeDetector`), wo es sie gibt – sonst Code einfügen. |
| Werbelink mit eigener URL | **Beides:** eigene Domain (eigene Kopie der App: Werber- und Hosting-Anteil) und kurzer Name statt Schlüssel (NIP-05). |

## Schritte

| ID | Schritt | Spur | Umfang (geschätzt) |
|---|---|---|---|
| 11.1a | QR-Baustein: Erzeuger ohne Abhängigkeit (Byte-Modus, Fehlerkorrektur M, Version nach Länge), gegen Referenz-Codes getestet; Ausgabe als Modul-Matrix für SVG ohne `innerHTML` | A | ~300 |
| 11.1b | QR in der App: Gerätecode als QR (Settings › Geräte, nur auf Klick, mit Warnung, verschwindet nach kurzer Zeit), Scannen beim Einrichten als Gerät (Kamera nur auf Klick, `BarcodeDetector`, sonst Code einfügen), Werbelink als QR | A | ~300 |
| 11.2a | Werbelink mit eigener Domain: Earn › Werben „eigene Adresse der App“ (nur https); die App prüft, ob dort eine signierte Version liegt (Release 5.2), sonst ehrlich „nicht geprüft“; Hinweis auf den Hosting-Anteil (`freedom-spiegel.json`, 5.3a) | A | ~200 |
| 11.2b | Werbelink mit kurzem Namen: `?ref=name@domain` (auf der eigenen Domain auch `?ref=name`), aufgelöst über NIP-05; der erste Werber bleibt; Lightning-Adresse aus `ln` oder dem signierten Profil; die Abfrage nennt der Domain einmal die IP (Datenschutzbericht) | A | ~250 |
| 11.3a | **Entwurf** Agenten in Räumen (Vorlage wie 4.0/2.2a, MENSCH gibt frei): Agent-Karte (neues Event-Format), Mitgliedschaft privat (MLS-Mitglied) und öffentlich (Rolle im Raum), Erwähnung → Auftrag (Kontext nur, was der Fragende sieht), Antwort als Nachricht des Agenten, beide Betriebsarten, beide Bezahlarten mit Obergrenzen, Datenschutz-Aussagen – **freigegeben 08.10.2026** (F1, F4, F6 A; F2 Monatsbudget mit Pfand; F5 Agentenketten mit Schalter; F3 B – `docs/AGENTEN-RAUM-ENTWURF.md`, Abschnitt „Entscheidungen“) | A | Dokument |
| 11.3b | Protokoll: Agent-Karte, Auftrag und Antwort im Raum, Budget-Regeln, Leak-Szenario – **FERTIG** (b1 `agent-karte.ts`: Karte 38090, Besitzer nur bestätigt, Rolle `agent`, Leak-Regel `agent-raum-privat`; b2 `agent-auftrag.ts`: Auslöser, Agentenketten, Bremse, Kontext, Verweis, Antwort, Monatsbudget in Stufen; Format in `docs/PROTOCOL.md` 32) | A | ~350 |
| 11.3c | Agent auf dem eigenen Gerät: anlegen (Schlüssel im Tresor), einladen, Aufträge über `ki-zahlung.ts`. Geteilt (09.10., mehr als 400 Zeilen): **c1 – FERTIG** Agentenbuch im Tresor (`agenten-buch.ts`: Schlüssel, Persona, Budget je Raum in Monat und Tag), anlegen und in offene Räume einladen (`shell/agenten.ts`: Rolle `agent`, Zuweisung, Karte vom Agenten, Liste des Besitzers nur mit Agenten offener Räume, Pflicht-Hinweis); **c2 – FERTIG** Erwähnungen in offenen Räumen beantworten (`agent-antwort.ts`: Entscheidung mit dem Stand des Raums, Prompt mit Pseudonymen, Antwort-Event; `shell/agenten-lauschen.ts`: Abo ab dem Start, Budget vor dem Auftrag in der Einheit der Schiene, eigener Sitzungsschlüssel je Agent und Raum, A+ über `ki-zahlung.ts`, Antwort vom Agenten; Smoke „agent_abo“); **c3** private Räume, geteilt: **c3a – FERTIG** eigenes MLS-Konto je Agent (`shell/agent-mls.ts`, IndexedDB `freedom-agenten-mls`), lokal eingeladen (`mlsLadeAgentEin()`: KeyPackage und Einladung nie über ein Relay), danach Raumstand, Karte vom Agenten, Liste des Besitzers und Hinweis nur als innere Events; Aussagen „agent-raum“ (belegt, Szenario mit echter Engine) und „agent-geraet“ (Grenze); **c3b – FERTIG** Erwähnungen in privaten Räumen beantworten (Verlauf je Agent, `agentAbgleichen()` holt alles nach – auch Commits –, beantwortet wird nur, was nach dem Abo kam; Raum und Agenten aus seinem Verlauf, Antwort als inneres Event; Engine erst im Abruftakt). **11.3c Code fertig.** | A | ~350 |
| 11.3d | Agent auf dem Knoten: Agent-Rolle mit eigenem MLS-Konto (`packages/mls`), KeyPackage, Einladung annehmen, Erwähnungen beantworten, Bezahlung je Auftrag oder aus dem Budget. Geteilt (10.10.): **d1a – FERTIG** offene Räume, „wer fragt, zahlt“ (`knoten-agent.ts`: eigener Schlüssel, Karte, versiegelter Auftrag mit Verweis, Prüfung mit `entscheide()` aus dem Protokoll, jede Erwähnung einmal, Antwort Kind 42 vom Agenten); **d1b** App, geteilt: **d1b1 – FERTIG** „@Name“ erwähnt Agenten des Raums (`erwaehnteAgenten()`, offen aus den Karten der Mitglieder mit Rolle `agent`, privat aus der Gruppe – gilt auch für Agenten auf dem Gerät), **d1b2 – FERTIG** Preis zeigen und bestätigen, Auftrag mit Verweis an den Knoten (`frageKnotenAgenten()`, `bezahlterAuftrag()`), Grenze „agent-knoten“ im Datenschutzbericht; **d2** private Räume, geteilt (10.10., MENSCH: Schalter `besitzer|alle`, Stand verschlüsselt, Chat nur im Speicher): **d2a – FERTIG** MLS-Konto im Knoten (`knoten-mls.ts`: KeyPackage, Listen, Einladung nach Schalter, höchstens 20 Gruppen, Abgleich, Karte als inneres Event, Grenze „agent-knoten-privat“), **d2b – FERTIG** antworten in privaten Räumen (`KnotenAgent.pruefePrivat()`: Verweis mit Gruppe, `entscheide()` mit `gruppenRaum()`, Antwort als inneres Event; Verweis nimmt Gruppen-Ids von MDK mit 32 Zeichen), **d2c – FERTIG** App: Knoten-Agent einladen (Warnung vorher, Pflicht-Hinweis im Raum), Fragen in privaten Räumen bezahlen (`sendePrivat()` liefert die Id des inneren Events); **d2 FERTIG**; **d3** Budget des Einladers (Pfand, nach M-2) | B (seit 09.10., nach 11.3b) | ~400, geteilt |
| 11.3e | Oberfläche: Agent als Mitglied mit Kennzeichen, „Agent hinzufügen“ (neu oder vorhanden), Einstellungen (Betrieb, Bezahlung, Budget) | C | ~300 |
| 11.4a | Repos in öffentlichen Räumen: Repo-Ankündigung (NIP-34, 30617) mit Verweis auf den Raum, Rechte aus den Raum-Rollen – **FERTIG** (Recht `repos_pflegen`, `raum-repo.ts`, Format in `docs/PROTOCOL.md` 18) | B | ~250 |
| 11.4b | Repos in privaten Räumen: Repo-Verweis, Bundle-Schlüssel und Patches nur als innere Events der MLS-Gruppe – nie offen. Aufgeteilt (Spur B): **b1 Protokoll – FERTIG** (innere Events, `raumReposPrivat()`, Leak-Regel `raum-repo-privat`, Aussage „raum-repos“ mit echter Engine), **b2 App – FERTIG** (Repos privater Räume aus dem MLS-Verlauf als eigene Karten; Ankündigen, Einstellungen, Patch, Status und neue Version gehen nur in die Gruppe, Bundle-Verweis samt Schlüssel nur dort; ehrliche Texte „nur Mitglieder“) | B | ~350 |
| 11.4c | Oberfläche: Raum-Repos auf der Repo-Seite und im Raum (mit C.3) – **FERTIG** (Liste „Repos“ im Raum nur bestätigt, Repo-Seite mit „Zum Raum“, „Repo anlegen“ im Raum-Menü nach Recht) | C | ~250 |
| 11.5 | **Entwurf**, dann Bau: Agenten arbeiten an Raum-Repos – mit Git-Werkzeugen in der Sandbox (8.7) holen, ändern, als Patch in den Raum stellen; angenommen wird nur durch ein Mitglied mit Recht, nie von selbst | A + B | nach 11.3/11.4 |

Reihenfolge Spur A: 11.1a → 11.1b → 11.2a → 11.2b → 11.3a (freigegeben
08.10.) → 11.3b–d (Monatsbudget beim Knoten nach dem Devnet-Deploy) →
11.5. Spur B nimmt 11.4 nach ihrem
laufenden Schritt; Spur C 11.3e und 11.4c, sobald die Bausteine stehen.

## Leitplanken

- **Gerätecode als QR trägt den Schlüssel des neuen Geräts.** Nur auf Klick
  zeigen, mit Warnung, nach kurzer Zeit ausblenden; nie speichern, nie als
  Bild exportieren. Das Kamerabild bleibt im Gerät.
- **Kamera nur auf Klick**, nie beim Start; ohne `BarcodeDetector` ehrlich
  „Code einfügen“ anbieten, nicht still scheitern.
- **Werbelinks:** Werber bleibt der erste (wie 5.1.3b); ein Name gilt nur mit
  gültigem Schlüssel aus NIP-05; fremde Domains nur https.
- **Agenten:** Sie sehen nur, was ihnen als Mitglied zusteht; wer einen Agenten
  auf einem Knoten einlädt, erfährt im Raum, dass der Knoten mitliest. Kein
  Agent zahlt von selbst über sein Budget hinaus; jede Zahlung über die
  Zahlschienen und die Aufteilung A+.
- **Repos in privaten Räumen** nie offen: Verweise, Schlüssel und Patches nur
  in der MLS-Gruppe.
- Neue Event-Formate (Agent-Karte, Raum-Repo-Verweis) stehen vor dem Bau im
  Entwurf und danach in `docs/PROTOCOL.md`.
