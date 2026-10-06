# Freedom-Prüfung – Verfügbarkeit und Qualität der Provider (Entwurf zu E7)

Stand 05.10.2026. Entscheidung des MENSCHEN (04.10.2026): Neue Provider sollen in der
Probezeit Qualität und Stabilität beweisen und danach, wenn alles passt,
sofort viel Verkehr bekommen – **wie bei OpenRouter**. Das Vergleichen mehrerer
Antworten ist keine Funktion für Kunden mehr (der Haken „vergleichen“ aus A-7
ist entfernt), stattdessen gibt es **automatische Kontrollen von Freedom aus**.

**Entscheidung des MENSCHEN vom 05.10.2026 (P3c), ersetzt die Prüfer:**
- **Keine Prüfer.** Es gibt keine Prüfer-Knoten, keine synthetischen
  Prüffragen und keine Messberichte (38081) mehr – zurückgebaut mit P5a.
- **Prüfrunden:** Die App schickt die **echte Anfrage** an **drei Provider
  statt an einen** und vergleicht die Antworten – **etwa jede 400. Antwort**
  (MENSCH 06.10.2026, nach der Rechnung in 3.2: Antwort, nicht Zahlung).
- **Pflicht, ohne Schalter.** Ausgenommen sind nur Wege ohne Netz oder
  Zahlung: KI auf diesem Gerät, der eigene Knoten, Funk.
- **Budget:** 0,5 % jeder Zahlung, genommen vom Anteil der Entwicklung
  (2,5 % → 2,0 %). Provider behalten 94 %.
- **Zahlung in beiden Währungen**, je nachdem, womit der Nutzer zahlt:
  Lightning, oder SOL über die schon offenen Zahlkanäle.

Dieser Entwurf beschreibt, was OpenRouter macht, was davon hier passt, und in
welchen Schritten Spur A es baut. Abschnitte über Prüfer (P1b–P4) stehen nur
noch als Verlauf da.

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
| Ein Unternehmen prüft. | Seit 05.10.2026 prüft **jede App selbst**: in **Prüfrunden** geht die echte Anfrage an drei Provider statt an einen, sobald das Prüfbudget reicht (P5c). Prüfer-Knoten (P1b–P4) sind zurückgebaut. |
| Benchmarks auf den eigenen Servern. | **Keine synthetischen Prüffragen:** Eine echte Anfrage kann ein Provider nicht von anderen unterscheiden. Die zwei zusätzlichen Antworten bezahlt das Prüfbudget (0,5 % jeder Zahlung, P5b). |
| Rangfolge zentral. | Die **Rangfolge bildet jede App selbst**; veröffentlicht wird nichts davon. |

**Regeländerung, die mit E7 freigegeben ist:**
- „Ruf nur aus Quittungen“ bleibt für den Ruf.
- Für Verfügbarkeit und Qualität zählen zusätzlich die eigenen Messungen,
  künftig samt Prüfrunden (P5c). Messberichte von Prüfern zählen seit P5a nicht mehr.
- Selbstauskünfte (38010) zählen weiter nicht.
- „Nie eine öffentliche Rangliste“ bleibt. Seit P5a gibt es auch keine
  öffentlichen Messwerte mehr.

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

### 3.2 Prüfrunden (P5c, P5d – Entscheidung 05.10.2026)
- **Was:** Ist das Prüfbudget groß genug für zwei weitere Antworten, geht die
  echte Anfrage zusätzlich an zwei andere Provider. Jede Kopie geht versiegelt,
  von einem eigenen Sitzungsschlüssel.
- **Rechnung:** Zwei weitere Antworten kosten etwa zwei ganze Zahlungen.
  0,5 % je Zahlung decken das erst nach rund 400 Zahlungen (2 ÷ 0,005), nicht
  nach 40. **Entschieden 06.10.2026 (MENSCH):** „Jede 400. Antwort reicht.
  Antwort, nicht Zahlung.“ – gezählt werden Antworten, das Budget bleibt 0,5 %.
- **Was der Nutzer sieht:** die Antwort des gewählten Providers, wie immer,
  und einen kurzen Hinweis, dass die Frage diesmal zusätzlich an zwei andere
  Provider geht. Die zwei anderen Antworten vergleicht die App im Hintergrund
  (`evaluateConsensus()` aus `consensus.ts` – hier lebt das Vergleichen aus A-7
  weiter) und zeigt sie nicht.
- **Ablauf (P5c2, `shell/pruefrunde-lauf.ts`):** Erst wenn die eigentliche
  Anfrage draußen ist, startet `starteRunde()`: fällig nach `PRUEFRUNDE`,
  Bedarf zwei Höchstbeträge (Gebot plus Werkzeuge), vom Budget abgezogen. Die
  zwei kommen aus `waehleZusatz()` – nie ein Provider dieses Laufs, nie ein
  eigener Knoten (gekoppelt oder auf der Liste eigener Provider), bis P5d nie
  einer mit Zahlkanal. Gibt es keine zwei, fällt die Runde aus, und die nächste
  Antwort versucht es wieder. Die Kopien gehen über `buildJobEvent()` wie jede
  Anfrage, die Antworten holt die App still ab und bezahlt sie wie jede andere
  (`rechneAntwortAb()`, Sitzung, Quittung). Was nicht gebraucht wurde, geht ins
  Budget zurück. Gezählt wird jede Antwort aus `askWithFailover()` außer vom
  eigenen Knoten; Max und Schwarm zählen nicht und prüfen nicht.
- **Was gezählt wird:** Verfügbarkeit und Antwortzeit aller drei in der eigenen
  Messung (`MessBuch`), dazu die Übereinstimmung als Qualität (`qualitaet` in
  `ordneNachPruefung()`: Ausreißer nach hinten) – erst ab drei Vergleichen je
  Provider (`PRUEF_GRENZEN.minVergleiche`).
- **Vergleich:** über Wort-Ähnlichkeit (`evaluateConsensus()`, Schwelle 0,6).
  Eine Aussage gibt es nur bei Einstimmigkeit oder klarer Mehrheit (zwei gegen
  einen). Offene Fragen werden oft verschieden formuliert – dann gehen die
  Antworten auseinander, und die Runde zählt nur für die Verfügbarkeit.
- **Pflicht, ohne Schalter.** Ausgenommen sind nur Wege ohne Netz oder Zahlung:
  KI auf diesem Gerät, der eigene Knoten, Funk.
- **Bezahlt** wird in der Währung des Nutzers: Lightning, bzw. SOL nur über
  schon offene Zahlkanäle (P5d) – nie still über die andere Währung.
- **Budget (P5b):** 0,5 % jeder KI-Zahlung bleiben beim Kunden als Prüfbudget
  (Anteil `pruefung`), genommen vom Anteil der Entwicklung (2,5 % → 2,0 %).
  Provider behalten 94 %. Alte Knoten kennen den neuen Anteil nicht und lehnen
  unbekannte Anteile ab – er wird nur Providern deklariert, deren Angebot ihn
  nennt.
- **Datenschutz:** Bei einer Prüfrunde lesen drei Provider die Anfrage statt
  einem. Das sagt der Datenschutzbericht ehrlich, sobald P5c läuft.

### 3.2a Prüfer (P1b–P4) – zurückgebaut mit P5a
Von P1b bis P4 gab es eine Rolle im Knoten (`PRUEFER=1`), die Providern
synthetische Prüffragen stellte (Rechnen, Umkehren, Zählen, Sortieren, JSON)
und Messberichte (38081) veröffentlichte; die App folgte gewählten Prüfern.
Entfernt am 05.10.2026: Prüffragen lassen sich am Stil erkennen, ein Prüfer
kostet seinen Betreiber Geld, und echte Anfragen an drei Provider prüfen,
was Kunden wirklich fragen. Kind 38081 wird nicht wiederverwendet.

### 3.3 Auswahl in der App (wie OpenRouter)
1. **Ausschluss nach hinten:** eigener Ausfall in den letzten 60 Sekunden;
   bestätigte Reklamationen (wie heute).
2. **Stufe nach Verfügbarkeit:**
   - Quelle: die eigene Messung ab 20 Anfragen, sonst gilt der Provider als
     neu (seit P5a; vorher zählten Berichte gewählter Prüfer).
   - Ab 95 % normal, 80–94 % herabgestuft, unter 80 % nur Rückfall.
3. **Qualität:**
   - Liegt die Übereinstimmung in Prüfrunden (ab P5c) deutlich unter dem
     Median aller Provider desselben Modells, steht der Provider hinter den
     übrigen seiner Stufe (Ausreißer).
   - Quittungen und Ruf wirken wie heute zusätzlich.
4. **Neue ohne genug Daten stehen in der Mitte:** vor den Herabgestuften, hinter
   den Normalen mit Daten. Heute stehen sie ganz hinten (Score -1) – genau das
   verhindert, was E7 will. Unter den Neuen stehen bekannte (mit Quittungen,
   eigene oder von Kontakten) vor unbekannten: Ein Unbekannter wird normal erst
   durch Messung (3.4).
5. **Lastverteilung:** Unter gleich Guten wählt die App zufällig, gewichtet mit
   1/Preis² (`sichererZufall()`), statt immer denselben. So bekommen günstige
   und neue Provider Verkehr.
6. **Rückfall:** Die Reihenfolge bei Ausfall ist diese Liste.

### 3.4 Probezeit (24 Stunden), neu gedeutet
- **Bleibt:** In den ersten 24 Stunden nimmt der Knoten nur Gratis-Aufträge an.
- **Seit P5a:** Gemessen wird nur in den Apps der Kunden. Ein neuer Provider
  steht dort bei den Neuen in der Mitte und bekommt so Aufträge; nach 20
  Anfragen mit mindestens 95 % Antworten steht er bei dieser App bei den
  Normalen. Prüfrunden (P5c) bringen zusätzliche Messpunkte.
- **Nicht bestanden:** herabgestuft oder nur Rückfall, bis er sich erholt.

## 4. Was Nutzer sehen
- Den Haken „vergleichen“ gibt es nicht mehr (entfernt am 04.10.2026). Im
  Agenten ändert sich nichts.
- Auf der Seite Netz steht je Provider als Text:
  - Verfügbarkeit;
  - Antwortzeit;
  - Stand der Prüfung (`neu`, `geprüft`, `herabgestuft`);
  - woher die Zahl kommt (eigene Messung).
- **Datenschutzbericht:** „Wie zuverlässig Provider bei dir antworten, misst
  die App nur auf deinem Gerät – die Messung geht an kein Relay.“ Mit P5c kommt
  dazu, dass bei einer Prüfrunde drei Provider die Anfrage lesen.
- **Website (FAQ):** wie Provider geprüft und ausgewählt werden.

## 5. Grenzen (ehrlich)
- **Mehr Leser:** Bei einer Prüfrunde lesen drei Provider die Anfrage statt
  einem – etwa jede 400. Antwort (3.2).
- **Gleiche Irrtümer:** Provider mit demselben Basismodell teilen dessen
  Fehler. Übereinstimmung heißt nie „richtig“, erkannt wird nur Abweichung.
- **Absprachen:** Wer mehrere Knoten betreibt, könnte gleich falsch antworten.
  Die zwei zusätzlichen Provider wählt die App zufällig.
- **Wenig Daten bei wenig Nutzung:** Wer selten fragt, hat wenige Prüfrunden;
  die eigene Messung wächst langsam.

## 6. Formate (STOPP-Punkte)
- **Messbericht** Kind 38081: *nicht mehr belegt* (P1b bis P5a).
- **Prüfer-Rolle** (`PRUEFER`, `PRUEFER_BUDGET_MSAT`) und **Standard-Prüfer**
  (`FREEDOM_PRUEFER`): entfernt mit P5a.
- **Neuer Anteil `pruefung`** (0,5 %) und Kennzeichen im Angebot, dass ein
  Provider ihn kennt (`["aufteilung", "2"]`, `AUFTEILUNG_FASSUNG`):
  freigegeben am 05.10.2026, gebaut mit P5b. Die Tabelle der Anteile ist eine
  CI-Invariante; sie ändert sich nur mit dieser Entscheidung.

## 7. Schritte (Spur A, je ein PR, jeweils unter ~400 Zeilen)
| Schritt | Inhalt |
|---|---|
| P1a | Protokoll ohne DOM (`pruefung.ts`): Prüffragen aus Vorlagen und ihre Prüfung (Rechnen, Umkehren, Zählen, Sortieren, JSON); eigene Messung (Fenster, Median, Ausfall); Auswahl-Rechnung (Stufen, Mitte für Neue, Ausreißer, 1/Preis²). Tests, auch Negativfälle. Wissensfragen und Werkzeug-Aufruf kommen mit P3. |
| P1b | Messbericht 38081 (`messbericht.ts`): bauen und lesen (Treffer je Prüfart, Durchsatz freiwillig; Arten, die ein Leser nicht kennt, zählen nicht), `docs/PROTOCOL.md` §28. |
| P2a | App: eigene Messung (`messbuch.ts`, Tresor `freedom.messungen`, geschrieben nach jedem Lauf in `askWithFailover()`), Auswahl in `matchmaking.ts` über `ordneNachPruefung()`. |
| P2b1 | App: Berichte der gewählten Prüfer lesen (Stufe und Qualität, wo die eigene Messung zu wenig hat; abgefragt ohne Filter nach Prüfer, nur wenn jemand gewählt ist), Datenschutzbericht. |
| P2b2 | App: Prüfer wählen und Anzeige auf der Seite Netz (nur Text): Verfügbarkeit, Antwortzeit, Stand, Quelle der Zahl. |
| P3a | Knoten: Kern der Prüfer-Rolle ohne Netz (`pruefer-rolle.ts`) – Zeitplan (Grundtest, laufend), Prüffrage als versiegelte Anfrage von einem Wegwerf-Schlüssel, Auswertung, Buch, Bericht. Ohne Budget nur Gratis-Angebote. |
| P3b | Knoten: Verdrahtung (`PRUEFER=1` in `main.ts`, `pruefer-dienst.ts`) – Angebote lesen, Fragen senden, Antworten abholen, Berichte veröffentlichen; der Status kennt die Rolle (`pruefer`), das Log nennt die Einstellung (`prueferAusUmgebung()`). Befunde der Selbstprüfung bleiben bei den zwei Schienen – eine dritte bräche ältere Apps (`leseBefund()` weist sonst den ganzen Status ab). |
| P3c | Budget für bezahlte Prüffragen – erst nach Entscheidung des MENSCHEN (der Knoten zahlt seit 5.1.2 nichts aus). |
| P4 | Probezeit und Prüfer verbinden (3.4, Zeitraum des Berichts endet mit der letzten Prüffrage), FAQ der Website (Auswahl, Probezeit, Grenze „Prüffragen erkennen“; `check-website.py` weist die alte Aussage „steht aber hinten“ ab), MENSCH-Checkliste (8). |
| P5a | Rückbau nach der Entscheidung vom 05.10.2026: Prüfer-Rolle im Knoten (`pruefer-rolle.ts`, `pruefer-dienst.ts`, `PRUEFER`), Messbericht 38081 (`messbericht.ts`), Prüffragen und `stufeFuerAuswahl()`, Prüfern folgen (`pruefer-wahl.ts`, `freedom.pruefer`), Status-Rolle `pruefer`. Netz › Prüfung zeigt nur die eigene Messung. Datenschutz-Aussage, Doku, FAQ (`check-website.py` weist Prüfer-Aussagen ab). |
| P5b | Aufteilung: Entwicklung 2,0 %, neuer Anteil `pruefung` 0,5 % (bleibt beim Kunden als Prüfbudget, `teileAuf()` → `pruefbudgetMsat`); CI-Invariante; Fassung im Angebot (`["aufteilung", "2"]`) – nur dann deklariert die App Entwicklung und Prüfbudget; Prüfbudget im Tresor (`pruefbudget.ts`, `freedom.pruefbudget`), gezeigt in der Antwort und in den Settings. Im Zahlkanal bleibt der Anteil bis P5d beim Provider. |
| P5c1 | Bausteine ohne Netz: Zähler der Antworten und Start einer Runde im Prüfbudget (`PRUEFRUNDE`, `faellig()`, `beginneRunde()`), Wahl der zwei zusätzlichen Provider (`waehleZusatz()`: nie der gewählte, nie eigene Knoten, gleiches Modell zuerst, zufällig), Auswertung (`werteRundeAus()` über `evaluateConsensus()`: nur einstimmig oder Mehrheit, sonst keine Aussage), Übereinstimmung als Qualität der eigenen Messung (`Messpunkt.einig`, `MessStand.qualitaet` ab drei Vergleichen) – die Auswahl stellt Ausreißer nach hinten. |
| P5c2 | Verdrahtung mit Lightning (`shell/pruefrunde-lauf.ts`, aus `askWithFailover()`): Antworten zählen (`messeLauf()`), die echte Anfrage nach dem ersten Senden zusätzlich versiegelt an die zwei (`starteRunde()`), ihre Antworten still abholen (`waitForAnswer(…, { still: true })`), bezahlen wie jede Antwort, auswerten, messen (`mitEinig()`), Rest ins Budget (`rueckgabeMsat()`); Hinweis beim Start; Datenschutz-Grenze „pruefrunde“ mit Szenario, FAQ und Whitepaper. |
| P5d | Pflicht-Prüfrunden mit SOL über offene Zahlkanäle. |

P1b, P2b1, P3a, P3b und P4 (Prüfer-Teil) sowie die Prüffragen aus P1a und die
Prüfer-Wahl aus P2b2 sind mit P5a zurückgebaut.

**MENSCH:** siehe Abschnitt 8 (Checkliste).

## 8. MENSCH-Checkliste

- [x] **P3c entschieden** (05.10.2026): keine Prüfer, Prüfrunden mit drei
  Providern, Pflicht, Budget 0,5 % aus dem Anteil der Entwicklung, beide
  Währungen.
- [ ] **Knoten mit `PRUEFER=1`** (falls einer lief): den Schalter entfernen und
  den Knoten auf `main` bringen. Ein älterer Knoten mit `PRUEFER=1` prüft und
  veröffentlicht weiter 38081, die App liest es nicht mehr.
- [x] **Häufigkeit entschieden** (06.10.2026): etwa jede 400. Antwort, Budget 0,5 %.
- [ ] **Nach P5b:** alle Knoten auf `main` bringen, damit sie den neuen Anteil
  kennen. Bis dahin deklariert die App ihn ihnen nicht.
- [ ] **Nach P5c/P5d:** Prüfrunden auf Testnet bzw. Devnet ausprobieren.
