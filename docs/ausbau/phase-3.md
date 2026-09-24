# Phase 3 – Private KI-Aufträge

Öffentlich bleibt nur, was zum Finden nötig ist: die Angebote der Provider
(Modelle, Preise in Sats und SOL, Regionen). Alles, was ein Kunde tut, wird
verschlüsselt.

---

## 3.1 Verschlüsselte Job-Anfragen – CODE FERTIG (24.09.2026)

> Umgesetzt in drei Teilen (a Protokoll `private-job.ts`, b Knoten `handlePrivate`, c App `buildJobEvent` + `ki-sitzung.ts`; PRs #25–#27). Rechenarbeit Standard 12 Bits (gemessen: 16 Bits ≈ 1 s je Umschlag auf einem PC – zu langsam für jede Chat-Nachricht). Die App sendet nur noch an Provider, deren Angebot `pow` nennt. Offen: MENSCH – Provider-Knoten aktualisieren, echte Anfrage.

- **Voraussetzung:** 1.3, 1.5, 2.1.
- **Stellen:** `buildJobEvent()` (Agent), `packages/app/src/session-client.ts`,
  `packages/protocol/src/dvm.ts`, `packages/node/src/dvm-provider.ts`.
- **Vorgehen:**
  1. Je KI-Sitzung ein zufälliger Sitzungsschlüssel – nicht aus dem Seed, nur im
     Speicher bzw. im Tresor für laufende Sitzungen.
  2. Die Anfrage (Prompt, Parameter, Verlaufszusammenfassung, Anhänge) wird mit
     NIP-44 an den Provider-Schlüssel verschlüsselt und dann per Gift-Wrap an den
     Provider geschickt. Relays sehen weder Kunde noch Inhalt.
  3. Knoten (`dvm-provider.ts`): Gift-Wraps an sich abonnieren, entpacken, wie
     bisher verarbeiten. Alte öffentliche Anfragen eine Übergangszeit weiter
     annehmen – die App sendet aber keine mehr.
  4. Gratis-Anfragen kosten Rechenarbeit nach NIP-13; die Schwierigkeit legt der
     Provider im Angebot fest. Kein Kontingent pro Schlüssel mehr.
  5. `hinweisKiOeffentlich()` entfernen, sobald die Leak-Regel grün ist.
- **Abnahme:** Leak-Regeln „kein Klartext-Prompt“ und „kein Kunden-npub in
  Job-Events“ grün; Knoten-Tests für Entschlüsseln, falschen Empfänger und zu
  geringe Rechenarbeit.

---

## 3.2 Verschlüsselte Antworten, Rechnungen und Belege

- **Vorgehen:**
  1. Ergebnis (Kind 6xxx) samt usage, bolt11 bzw. SOL-Empfangsadresse und
     Gebührenbeleg per Gift-Wrap an den Sitzungsschlüssel.
  2. `parseJobResult()` mit `sanitizeUsage()` bleibt die einzige Eingangsstelle
     für Provider-Daten.
  3. Optional: Der Provider veröffentlicht wöchentlich ein Aggregat (Anzahl,
     Summe, Merkle-Wurzel über die Beleg-Hashes); der Kunde prüft seinen Beleg per
     Merkle-Pfad, ohne andere zu sehen.
- **Abnahme:** Leak-Regel „keine bolt11, keine Adresse, kein Betrag pro Kunde in
  öffentlichen Events“ grün.

---

## 3.3 Provider-Seite

- **Vorgehen:** Der Knoten verwirft den Klartext nach der Antwort; das
  Protokollieren von Prompts ist standardmäßig aus. Ein optionales Feld `tee` im
  Angebot gibt es nur mit Attestierungsnachweis; die App zeigt „vertraulich
  (attestiert)“ nur dann.
- **Abnahme:** Knoten-Test: Nach einem Job enthält weder Log noch Datei den Prompt.

---

## 3.4 Verlauf und Reklamationen privat

- **Vorgehen:** KI-Verlauf nur im Tresor. Reklamationen (`file-dispute`) gehen
  verschlüsselt an den Provider und an einen vom Nutzer gewählten Prüfer –
  kein öffentliches Event.
- **Abnahme:** Leak-Test für eine vollständige Reklamation grün.
