# Datenschutz gegenüber Providern (D1)

Stand 06.10.2026, Spur A. Grundlage ist die Entscheidung des MENSCHEN vom
05.10.2026 (`docs/neuordnung/SAMMLUNG.md`, D1): erst P5a–P5d, dann Stufe 1,
dann ein Entwurf für Stufe 3 zur Freigabe. Zielgeräte der Provider sind
DGX Spark/GB10 und ihre OEM-Varianten, Macs und Gaming-PCs. Hardware aus
Rechenzentren (H100 usw.) gehört nicht zum Ziel.

## 1. Was ein Provider heute sieht

| Was | Sieht der Provider es? | Warum |
|---|---|---|
| Frage, Verlauf, Anhänge, Eingaben für Werkzeuge | ja, im Klartext | Er muss sie rechnen. Ein TEE, das das verhindert, gibt es auf den Zielgeräten nicht. |
| Wer fragt | nein | Die Anfrage kommt von einem Sitzungsschlüssel (3.1), nie von der Identität. |
| Welche Fragen zusammengehören | ja, innerhalb einer Seitensitzung | Alle Fragen an denselben Provider tragen bis zum Neuladen denselben Sitzungsschlüssel, auch über Unterhaltungen hinweg. Mit Zahlkanal auch darüber hinaus (der Kanal hat einen festen Schlüssel). |
| IP-Adresse | nein | Dazwischen liegen Relays. Die Relays sehen sie, außer über .onion (6.2). |
| Prüfrunden | ja, zwei weitere Provider | Etwa jede 400. Frage (P5c2, Grenze „pruefrunde“). |

Der Weg ist also geschützt (Nostr, Umschläge, Sitzungsschlüssel). Der Inhalt
nicht: Wer einen Provider betreibt, kann mitschreiben, was er rechnet. Der
Knoten loggt zwar nichts (3.3, `klartext.test.ts`), aber das gilt nur für den
veröffentlichten Code. Ob ein Provider ihn unverändert laufen lässt, kann die
App heute nicht prüfen (siehe Stufe 3).

## 2. Stufe 1 – in der App

Drei Schritte, je ein Pull Request. Die Standardwerte unten sind Vorschläge
von Spur A. Der MENSCH kann sie ändern, ohne dass sich der Plan ändert.

### D1a – Platzhalter für persönliche Angaben

- **Baustein** `platzhalter.ts` (Protokoll, ohne DOM – so prüft ihn auch das
  Szenario im Datenschutz-Test):
  - `ersetzeAngaben(text, zuordnung, namen)` liefert den Text mit
    Platzhaltern und die Zahl der ersetzten Stellen.
  - `Zuordnung.setzeEin(antwort)` setzt die Werte in die Antwort zurück.
  - In der App nur über `shell/ki-platzhalter.ts` (`maskiere()`,
    `entmaskiere()`, `neueZuordnung()`).
- **Erkannt wird nur, was eine klare Form hat:**
  - E-Mail-Adressen;
  - Telefonnummern (mit `+` oder `0` vorn, mindestens 7 Ziffern);
  - IBAN (mit Prüfziffer);
  - Kartennummern (mit Luhn-Prüfung);
  - IP-Adressen;
  - Nostr-Schlüssel (`npub`, `nsec`, `nprofile`);
  - Lightning-Rechnungen;
  - Namen aus dem eigenen Adressbuch und der eigene Profilname, nur als ganze
    Wörter.
- **Kein Raten:** keine Erkennung per KI, keine Liste von Vornamen. Was nicht
  erkannt wird, geht unverändert hinaus, und die Texte sagen das.
- **Form:** Platzhalter wie `[E-Mail 1]`, `[Telefon 2]`, `[Name 1]`. Je
  Unterhaltung stabil: derselbe Wert ergibt denselben Platzhalter, damit der
  Verlauf zusammenpasst.
- **Zuordnung:** nur im Speicher, nie gespeichert, nie gesendet.
- **Wo:** Angewendet auf Frage und Verlauf, unmittelbar vor `buildJobEvent()`.
  Die Antwort bekommt die Werte zurück, nur in der Anzeige und im eigenen
  Verlauf.
- **Nicht** für dieses Gerät und den eigenen Knoten, dort liest niemand mit.
  Über Funk schon.
- **Standard an.** Abschaltbar in Settings › Datenschutz
  (`freedom.platzhalter`). Unter der Antwort steht nur die Zahl, z. B.
  „2 Angaben ersetzt“.
- **Bericht:** neue Grenze mit Szenario. Ersetzt wird nur Erkennbares. Namen
  außerhalb des Adressbuchs, Adressen, Gesundheitsangaben und der Inhalt von
  Anhängen gehen unverändert hinaus.

### D1b – Neuer Schlüssel je Unterhaltung

- **Neue Schlüssel:** `KiSitzungen` bekommt für jede neue oder gewechselte
  Unterhaltung neue Sitzungsschlüssel (`neueAufgabe()`, `oeffneVerlauf()`).
  Alte bleiben im Speicher, bis ihre Antworten da sind, damit das Abo
  `pubkeys()` sie weiter abholt.
- **Erst begleichen:** Vorher begleicht die App offene Beträge der alten
  Zahlsitzungen. Das geht ab 1 sat, mit derselben Prüfung von Rechnung und
  Betrag. Unklares bleibt unklar und wird nie von selbst wiederholt. Heute
  bleiben Beträge unter der Schwelle von 20 sats beim Neuladen offen.
- **Reklamationen** nehmen den Schlüssel des Auftrags (Zuordnung Auftrag →
  Schlüssel), nicht den aktuellen. Sonst passte die Reklamation nicht mehr zum
  Auftrag.
- **Aufteilung** (beim Bau, wegen des Umfangs):
  - **D1b1 ✓:** Zahlsitzungen gehören zum Schlüssel, Abrechnung und
    Reklamation nehmen den Schlüssel des Auftrags. Der Schlüssel kommt aus dem
    eigenen Gedächtnis (`kiSitzungen.merkeAuftrag()` vor dem Senden), nie aus
    dem `p`-Tag des Ergebnisses: den setzt der Provider selbst. Ohne Wechsel
    ändert sich dadurch nichts.
  - **D1b2:** neue Schlüssel je Unterhaltung, offene Beträge begleichen,
    Grenze Zahlkanal im Bericht.
- **Grenze:** Mit Zahlkanal verbindet der feste Schlüssel des Kanals alle
  Anfragen über diesen Kanal. Das steht im Bericht.

### D1c – Weniger Verlauf

- **Standard kürzer:** 6 Nachrichten, 3 000 Zeichen, je Nachricht höchstens
  1 000. Heute sind es 12, 6 000 und 1 500.
- **Einstellung** „Verlauf mitschicken“ in Settings › Datenschutz:
  - aus;
  - kurz (Standard);
  - lang (der heutige Umfang).
- **Bericht:** Er nennt, wie viel mitgeht.

## 3. Stufe 2 – Wahl nach Vertrauen (D2)

- **Privat-Schalter je Unterhaltung:** nur dieses Gerät oder der eigene
  Knoten, nie ein fremder Provider, auch keine Prüfrunde.
- **Danach** vielleicht „nur vertraute Provider“, etwa Provider von Kontakten.
  Das ist eine eigene Entscheidung, sie folgt nach Stufe 1.

## 4. Stufe 3 – versiegelter Provider-Modus (Entwurf folgt, D3)

- **Ziel:** Die App kann prüfen, dass auf dem Knoten genau die veröffentlichte,
  reproduzierbar gebaute Software läuft, die nichts mitschreibt.
- **Weg:** gemessener Start mit Secure Boot und TPM (PCR-Werte), Attestierung
  im Angebot, Vergleich mit den Werten eines reproduzierbaren Images.
- **Geräte:** GB10 (fTPM/dTPM, UEFI Secure Boot) und Linux-PCs. Auf Macs nicht:
  App Attest belegt dort zu wenig.
- **Grenze:** Das ist kein TEE. Wer physischen Zugriff hat, kann den Speicher
  auslesen. Es belegt nur, welche Software gestartet wurde. Die Texte dürfen
  nicht mehr versprechen.
- **MENSCH:** auf dem GX10 `ls /dev/tpm*` und `mokutil --sb-state` ausführen
  und das Ergebnis nennen.

## 5. Schritte

| Schritt | Inhalt |
|---|---|
| D1a ✓ | Platzhalter für persönliche Angaben (Baustein, Verdrahtung in `buildJobEvent()` und über Funk, Rücksetzen in `handleAnswer()`, Einstellung, Grenze „ki-platzhalter“ mit Szenario, Whitepaper) |
| D1b1 ✓ | Abrechnung und Reklamation mit dem Schlüssel des Auftrags (`merkeAuftrag()`/`fuerAuftrag()`, Zahlsitzungen je Schlüssel) |
| D1b2 | Neuer Schlüssel je Unterhaltung (offene Beträge vorher begleichen, Grenze Zahlkanal) |
| D1c ✓ | Weniger Verlauf: Standard „kurz“ (6 Nachrichten, 3 000 Zeichen), Auswahl aus · kurz · lang (`VERLAUF_UMFANG`, `freedom.verlauf`), Grenze „ki-verlauf“ im Bericht, Whitepaper |
| D2 | Privat-Schalter: nur Gerät oder eigener Knoten |
| D3-Entwurf | Versiegelter Provider-Modus, zur Freigabe |
