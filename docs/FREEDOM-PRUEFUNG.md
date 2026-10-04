# Freedom-Prüfung – Verfügbarkeit und Qualität der Provider (Entwurf zu E7)

Stand 04.10.2026. Entscheidung des MENSCHEN: Neue Provider sollen in der
Probezeit Qualität und Stabilität beweisen und danach, wenn alles passt,
sofort viel Verkehr bekommen – **wie bei OpenRouter**. Das Vergleichen mehrerer
Antworten ist keine Funktion für Kunden mehr (der Haken „vergleichen“ aus A-7
ist entfernt), stattdessen gibt es **automatische Kontrollen von Freedom aus**.

Dieser Entwurf beschreibt, was OpenRouter macht, was davon hier passt, und in
welchen Schritten Spur A es baut.

## 1. Was OpenRouter macht (Recherche 04.10.2026)

- **Aufnahme mit Testverkehr.** Neue Anbieter werden geprüft und bekommen
  Testverkehr. Ein neues Modell wird erst nach bestandenen Grundtests
  sichtbar („auto-stages the endpoint, runs baseline tests, and unhides it once
  the tests pass“).
- **Verfügbarkeit.** Gerechnet wird „erfolgreiche Anfragen ÷ alle Anfragen“,
  ohne Fehler der Nutzer, und erst ab 100 Anfragen:
  - ab 95 %: normal;
  - 80–94 %: herabgestuft, mit geringerem Vorrang;
  - unter 80 %: nur noch als Rückfall.

  Wer in den letzten 30 Sekunden einen deutlichen Ausfall hatte, kommt nach
  hinten.
- **Lastverteilung.** Unter den stabilen Anbietern wird zufällig gewählt,
  gewichtet mit 1/Preis²: Wer halb so viel kostet, wird viermal so oft gewählt.
  Die übrigen sind Rückfall in fester Reihenfolge.
- **Qualität (Auto Exacto, standardmäßig an).** Etwa alle 5 Minuten neu
  bewertet, aus drei Signalen:
  - Durchsatz aus echtem Verkehr;
  - Werkzeug-Aufrufe: gültiges JSON, passendes Schema, richtiger Werkzeugname;
  - wiederkehrende Benchmarks.

  Neue Anbieter ohne genug Daten stehen **in der Mitte**, bis sie genug Verkehr
  hatten („We don't push you to an untested endpoint“). Ausreißer kommen nach
  hinten und steigen wieder auf, wenn sie besser werden.
- **Signale der Nutzer.** Anbieter, die viele Nutzer ausschließen, zählen als
  schlechter.
- **Öffentliche Kennzahlen.** Zeit bis zum ersten Token, Durchsatz und
  Verfügbarkeit stehen auf jeder Modellseite.

Quellen:
[Provider Routing](https://openrouter.ai/docs/features/provider-routing),
[For Providers](https://openrouter.ai/docs/guides/community/for-providers),
[Auto Exacto](https://openrouter.ai/blog/announcements/auto-exacto/),
[Provider Variance: Introducing Exacto](https://openrouter.ai/blog/announcements/provider-variance-introducing-exacto/).

## 2. Was hier anders sein muss

| OpenRouter | FreedomStack |
|---|---|
| Sieht jede Anfrage im Klartext und misst am echten Verkehr. | Anfragen sind Ende-zu-Ende versiegelt, von Wegwerf-Schlüsseln. Messungen aus echtem Verkehr macht nur die **App des Kunden**, und sie bleiben auf seinem Gerät. |
| Ein Unternehmen prüft. | Prüfen ist eine **Rolle des Knotens**, die jeder betreiben kann („Prüfer“). Die App folgt standardmäßig dem **Freedom-Prüfer** des Projekts (Schlüssel trägt der MENSCH ein, bis dahin Platzhalter) und auf Wunsch weiteren – wie bei den Modellkatalogen (5.7). |
| Benchmarks auf den eigenen Servern. | Der Prüfer stellt **synthetische Prüffragen**, nie Fragen von Nutzern. Er stellt sie wie jeder Kunde (versiegelt, Wegwerf-Schlüssel), damit ein Provider sie nicht von echten Anfragen unterscheiden kann. Sie entstehen aus Vorlagen mit Zufall, die Antwort prüft Code – kein Sprachmodell als Richter. |
| Rangfolge zentral. | Der Prüfer veröffentlicht **Messwerte** je Provider (signiert). Die **Rangfolge bildet jede App selbst**. |

**Regeländerung, die mit E7 freigegeben ist:**
- „Ruf nur aus Quittungen“ bleibt für den Ruf.
- Für Verfügbarkeit und Qualität zählen zusätzlich:
  - die eigenen Messungen;
  - die Messberichte der gewählten Prüfer.
- Selbstauskünfte (38010) zählen weiter nicht.
- „Nie eine öffentliche Rangliste“ bleibt: Messwerte sind öffentlich wie bei
  OpenRouter, eine Rangliste veröffentlicht niemand.

## 3. Bausteine

### 3.1 Eigene Messung in der App
Die Messung bleibt nur auf dem Gerät.

- **Was je Provider gezählt wird:**
  - Anfragen und Erfolge;
  - Fehler des Providers (Zeitüberschreitung, Ablehnung, kaputtes Ergebnis);
  - Zeit bis zur Antwort;
  - Tokens je Sekunde (aus `usage` und Dauer);
  - bei Werkzeugen: gültige Aufrufe.
- **Nicht gezählt:** Fehler des Nutzers, etwa ein zu niedriges Gebot, ein
  leerer Kanal oder ein Abbruch.
- **Fenster:** die letzten 100 Anfragen je Provider. Ein Ausfall in den letzten
  60 Sekunden stellt den Provider zurück; das sind 60 statt 30 Sekunden, weil
  die App im Takt abfragt.
- **Ablage:** im Tresor (`freedom.messungen`, nie in der Sicherung), wie die
  Quittungen.
- **Später, eigener Schritt:** mit Kontakten teilen über die versiegelte
  Ruf-Zusammenfassung (38075).

### 3.2 Prüfer – Rolle im Knoten (`PRUEFER=1`)
- **Wen er prüft:** Er liest die Angebote (38027) und prüft jeden Provider je
  angebotenem Modell.
  - **Grundtest:** Ein neuer Provider bekommt in der ersten Stunde 20
    Prüffragen, verteilt.
  - **Danach laufend:** etwa alle 5 Minuten eine je Provider und Modell, mit
    Zufall im Abstand.
- **Prüfarten**, alle maschinell prüfbar:
  - Rechnen mit Zufallszahlen;
  - Text umformen (umkehren, zählen, sortieren);
  - JSON nach einem zufälligen Schema;
  - Wissensfragen mit Mehrfachwahl aus einer festen Liste;
  - ein Werkzeug-Aufruf, wenn der Provider Werkzeuge anbietet.
  - Für offene Aufgaben vergleicht der Prüfer mehrere Provider untereinander
    (`evaluateConsensus()` aus `consensus.ts`) – hier lebt das Vergleichen
    aus A-7 weiter.
- **Bezahlung:** Der Prüfer zahlt seine Prüffragen wie ein Kunde (kleines
  Gebot, höchstens 300 Tokens Antwort) aus einem festen Budget
  (`PRUEFER_BUDGET_MSAT` je Tag). In der Probezeit des Providers sind sie
  gratis.
- **Messbericht** (neues Kind **38081**, ersetzbar, `d` = `<provider>:<modell>`,
  vom Prüfer signiert, Ablauf nach NIP-40 nach 2 Stunden). Er enthält:
  - den Zeitraum;
  - Anzahl und Erfolge, daraus die Verfügbarkeit;
  - Median der Zeit bis zur Antwort und den Durchsatz;
  - die Trefferquote je Prüfart;
  - die Stufe (`neu`, `normal`, `herabgestuft`, `ausgefallen`).

  Keine Prüffragen, keine Antworten, nichts über Kunden.

### 3.3 Auswahl in der App (wie OpenRouter)
1. **Ausschluss nach hinten:** eigener Ausfall in den letzten 60 Sekunden;
   bestätigte Reklamationen (wie heute).
2. **Stufe nach Verfügbarkeit:**
   - Quelle: die eigene Messung ab 20 Anfragen, sonst der Bericht eines
     gewählten Prüfers ab 50 Prüffragen.
   - Ab 95 % normal, 80–94 % herabgestuft, unter 80 % nur Rückfall.
3. **Qualität:**
   - Liegt die Trefferquote deutlich unter dem Median aller Provider desselben
     Modells, steht der Provider hinter den übrigen seiner Stufe (Ausreißer).
   - Quittungen und Ruf wirken wie heute zusätzlich.
4. **Neue ohne genug Daten stehen in der Mitte:** vor den Herabgestuften, hinter
   den Normalen mit Daten. Heute stehen sie ganz hinten (Score -1) – genau das
   verhindert, was E7 will. Unter den Neuen stehen bekannte (mit Quittungen,
   eigene oder von Kontakten) vor unbekannten: Ein Unbekannter wird normal erst
   durch Messung – eigene oder die eines Prüfers (Grundtest, 3.4).
5. **Lastverteilung:** Unter gleich Guten wählt die App zufällig, gewichtet mit
   1/Preis² (`sichererZufall()`), statt immer denselben. So bekommen günstige
   und neue Provider Verkehr.
6. **Rückfall:** Die Reihenfolge bei Ausfall ist diese Liste.

### 3.4 Probezeit (24 Stunden), neu gedeutet
- **Bleibt:** In den ersten 24 Stunden nimmt der Knoten nur Gratis-Aufträge an.
- **Neu:** In dieser Zeit läuft der Grundtest des Prüfers, wie der Testverkehr
  bei OpenRouter vor dem Freischalten.
- **Bestanden** (Verfügbarkeit ab 95 %, Qualität im üblichen Bereich): Nach 24
  Stunden steht der Provider in der normalen Stufe. Ist er günstig, bekommt er
  über die Gewichtung mit 1/Preis² sofort viel Verkehr.
- **Nicht bestanden:** herabgestuft oder nur Rückfall, bis er sich erholt.

## 4. Was Nutzer sehen
- Den Haken „vergleichen“ gibt es nicht mehr (entfernt am 04.10.2026). Im
  Agenten ändert sich nichts.
- Auf der Seite Netz steht je Provider als Text:
  - Verfügbarkeit;
  - Antwortzeit;
  - Stand der Prüfung (`neu`, `geprüft`, `herabgestuft`);
  - woher die Zahl kommt (eigene Messung oder Prüfer).
- **Datenschutzbericht, neue Aussage:** „Prüfer stellen eigene Prüffragen,
  nie deine. Deine Messungen bleiben auf dem Gerät.“
- **Website (FAQ):** wie Provider geprüft und ausgewählt werden.

## 5. Grenzen (ehrlich)
- **Prüfungen erkennen:** Ein Provider könnte Prüffragen am Stil erkennen und
  sie besser beantworten. Dagegen helfen Vorlagen mit Zufall, Wegwerf-Schlüssel
  und die eigenen Messungen der Kunden, die Vorrang bekommen, sobald genug
  Daten da sind.
- **Prüfer lügt:** Die App folgt nur gewählten Prüfern. Mehrere Prüfer sind
  möglich, eigene Messungen gehen vor.
- **Messberichte sind öffentlich:** Wer die Relays liest, sieht Messwerte je
  Provider – gewollt wie bei OpenRouter. Kundenzahlen oder Einnahmen stehen
  nicht darin.
- **Kosten:** Der Prüfer kostet seinen Betreiber Geld. Ohne Budget prüft er nur
  Gratis-Angebote.

## 6. Neue Formate (STOPP-Punkte, mit E7 freigegeben)
- **Messbericht** Kind 38081 (ersetzbar), Beschreibung kommt in
  `docs/PROTOCOL.md`.
- **Prüfer-Rolle** im Knoten: `PRUEFER=1`, `PRUEFER_BUDGET_MSAT`.
- **Standard-Prüfer** in der App: `FREEDOM_PRUEFER` (Platzhalter bis MENSCH).

## 7. Schritte (Spur A, je ein PR, jeweils unter ~400 Zeilen)
| Schritt | Inhalt |
|---|---|
| P1a | Protokoll ohne DOM (`pruefung.ts`): Prüffragen aus Vorlagen und ihre Prüfung (Rechnen, Umkehren, Zählen, Sortieren, JSON); eigene Messung (Fenster, Median, Ausfall); Auswahl-Rechnung (Stufen, Mitte für Neue, Ausreißer, 1/Preis²). Tests, auch Negativfälle. Wissensfragen und Werkzeug-Aufruf kommen mit P3. |
| P1b | Messbericht 38081 (`messbericht.ts`): bauen und lesen (Treffer je Prüfart, Durchsatz freiwillig; Arten, die ein Leser nicht kennt, zählen nicht), `docs/PROTOCOL.md` §28. |
| P2a | App: eigene Messung (`messbuch.ts`, Tresor `freedom.messungen`, geschrieben nach jedem Lauf in `askWithFailover()`), Auswahl in `matchmaking.ts` über `ordneNachPruefung()`. |
| P2b | App: Berichte der gewählten Prüfer lesen (Stufe und Qualität, wo die eigene Messung zu wenig hat), Anzeige auf der Seite Netz (nur Text), Datenschutzbericht. |
| P3 | Knoten: Prüfer-Rolle – Grundtest, laufende Prüfung, Budget, Bericht veröffentlichen; `pruefeEinrichtung()` kennt sie. |
| P4 | Probezeit und Prüfer verbinden, FAQ, MENSCH-Checkliste. |

**MENSCH:** den Freedom-Prüfer auf dem GX10 starten (mit Budget) und seinen
Schlüssel als `FREEDOM_PRUEFER` eintragen.
