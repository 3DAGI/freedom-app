# Agenten in Räumen – Entwurf (Schritt 11.3a)

Stand 29.09.2026, Spur A. **Freigegeben am 08.10.2026 (MENSCH)** – alle Fragen entschieden
(Abschnitt „Entscheidungen vom 08.10.2026“ am Ende; er gilt vor den Vorschlägen
darüber). Gebaut wird 11.3b–e, dann 11.5. Grundlage sind die
Entscheidungen vom 28.09.2026 (`docs/ausbau/phase-11.md`):

- **Betrieb: beides wählbar** – auf einem Provider-Knoten (immer erreichbar,
  eigenes Raummitglied; in privaten Räumen liest der Knoten mit, und der Raum
  zeigt das offen) oder auf dem Gerät des Erstellers (antwortet nur, solange
  dessen App offen ist; jede Anfrage geht wie heute privat an einen Provider).
- **Bezahlung: einstellbar** – wer ihn anspricht (jede Erwähnung ist eine
  normale bezahlte KI-Anfrage) oder wer ihn einlädt (Budget mit Obergrenze).

Freizugeben sind die Vorschläge P1–P7 und die Antworten auf die Fragen F1–F6
am Ende. „Wie vorgeschlagen“ genügt; jede Frage lässt sich einzeln anders
entscheiden.

## Was es heute gibt

| Baustein | Stand | Wo |
|---|---|---|
| Öffentliche Räume | Definition 34700, Rollen 34701, Zuweisung 34702, Nachricht Kind 42; Rechte `lesen` … `repos_pflegen` | `protocol/src/spaces.ts` |
| Private Räume | MLS-Gruppe nach Marmot; alles innere Events, Nachricht Kind 9 mit `["p", …, "", "mention"]`; Moderatoren = Admins der Gruppe | `protocol/src/raum-gruppe.ts`, `app/src/shell/raum-mls.ts` |
| KI-Aufträge | nur versiegelt, vom Sitzungsschlüssel (3.1–3.4); den Kontext bringt die App (höchstens 12 Nachrichten, 6000 Zeichen) | `private-job.ts`, `app/src/ki-kontext.ts` |
| Bezahlen | A+ in der App: Lightning je Antwort oder Gutschrift im Zahlkanal (4.3); Tageslimit und Freigabe (4.2a) | `app/src/shell/ki-zahlung.ts`, `zahlkanal.ts` |
| Knoten | Provider; zahlt nichts aus (5.1.2); MLS läuft in Node (`packages/mls`), der Knoten nutzt es noch nicht | `node/src/dvm-provider.ts` |
| Profil-Kennzeichen | `agent: true` im Profil – bisher nur Anzeige | `protocol/src/profile.ts` |
| Repos in Räumen | öffentlich und privat (11.4) – Grundlage für 11.5 | `raum-repo.ts` |

## Begriffe

- **Agent:** ein eigener Nostr-Schlüssel mit einer Karte (P1). Nie die
  Identität des Erstellers – sonst spräche er mit dessen Stimme, und eine
  Antwort ließe sich nicht von ihm unterscheiden.
- **Gastgeber:** wo der Schlüssel liegt und wer im Raum antwortet – der
  Knoten oder das Gerät des Erstellers.
- **Besitzer:** wer den Agenten angelegt hat; ändert Karte und Einstellungen,
  löscht ihn.
- **Einlader:** wer ihn in einen Raum holt (ein Admin bzw. Moderator dort).

## P1 – Agent-Karte (neues Event-Format, Kind 38090)

Adressierbar, Autor ist der Schlüssel des Agenten, `d` = `karte`:

| Tag | Inhalt |
|---|---|
| `["name", …]`, `["about", …]` | Anzeige (nur als Text gezeigt) |
| `["betrieb", "knoten" \| "geraet"]` | Gastgeber |
| `["bezahlung", "fragender" \| "einlader"]` | wer eine Antwort bezahlt |
| `["p", <besitzer>, "", "besitzer"]` | Besitzer – gilt nur mit dessen Bestätigung (F1) |
| `["provider", <pk>]` | bei `geraet`: der Provider, der rechnet (sonst wählt die App wie heute); bei `knoten`: der Knoten selbst |
| `["modell", …]` | gewünschtes Modell, optional |

- **Keine Anweisung (Persona, Systemprompt) in der Karte** – die hält der
  Gastgeber (F4).
- **Privater Raum:** Die Karte ist nur ein inneres Event der Gruppe, nie
  veröffentlicht – wie Repo-Verweise seit 11.4b.
- **Öffentlicher Raum:** Die Karte ist öffentlich, Budget und Einstellungen
  zur Bezahlung nie.

## P2 – Mitgliedschaft

- **Privat:** Der Agent ist ein volles MLS-Mitglied mit eigenem KeyPackage
  (vom Agenten-Schlüssel). Einladen wie heute: nur Admins
  (`aendereGruppe()`), Einladung an den Posteingang des Gastgebers.
  Entfernen per Commit (`entferneAusRaum()`).
- **Öffentlich:** eine neue Standardrolle `agent` (lesen, schreiben,
  threads – nicht moderieren, nicht `repos_pflegen`), zugewiesen per 34702.
  Nachrichten signiert der Agent (Kind 42). Entfernen: Zuweisung entziehen,
  Moderation wie bei Menschen.
- **Hinweis im Raum (Pflicht):** Beim Einladen eines Knoten-Agenten schreibt
  die App in den Raum: „Agent X läuft auf dem Knoten Y – der Knoten liest
  alles in diesem Raum.“ Bei einem Geräte-Agenten: „… auf dem Gerät von Z.“

## P3 – Erwähnung → Auftrag → Antwort

- **Auslöser:** nur eine Nachricht eines Mitglieds mit Schreibrecht, die den
  Agenten erwähnt (p-Tag `mention`). Mitlesen allein löst nichts aus.
- **Keine Schleifen:** Erwähnungen durch Agenten lösen nur etwas aus, wenn der
  Raum Agentenketten erlaubt – und dann nur in deren Grenzen (F5, entschieden
  08.10.: Abschnitt „Agentenketten“ unten).
- **Bremse:** je Mitglied und Minute höchstens 3 Aufträge. Je Raum sind
  höchstens so viele offen, wie der Gastgeber annimmt.
- **Kontext – nur, was der Fragende sieht:**
  - nur der Kanal bzw. Thread der Erwähnung, bis zur Erwähnung;
  - Grenzen aus `ki-kontext.ts` (seit D1c `VERLAUF_UMFANG`, Standard „kurz“:
    6 Nachrichten, 3000 Zeichen), Absender als Namen, andere Agenten
    gekennzeichnet;
  - nie andere Kanäle, Räume oder Direktnachrichten.
- **Antwort:**
  - eine Nachricht des Agenten im selben Kanal, als Antwort auf die Erwähnung
    (`e` … `reply`), mit p-Tag des Fragenden;
  - höchstens 4000 Zeichen;
  - gezeigt nur über `markdownDom()` (C-20a).
- **Kein Klartext beim Provider über die Antwort hinaus** (Regel 3.3):
  - Ein Knoten-Agent darf den Raum lesen, weil er Mitglied ist.
  - Er legt Aufträge und Antworten aber nicht ab, außer im MLS-Zustand, den
    jedes Mitglied hat.

## P4 – Betrieb

| | Knoten | Gerät |
|---|---|---|
| Schlüssel | auf dem Knoten, Datei mit `umask 077`, eigener MLS-Zustand verschlüsselt | im Tresor des Erstellers (`freedom.agenten`, in `SICHERUNG_NIE`), eigenes MLS-Konto je Agent neben dem eigenen |
| Wer rechnet | der Knoten selbst – er ist der Provider | ein Provider, versiegelt wie heute, Sitzungsschlüssel je Agent |
| Erreichbar | immer | nur, solange die App des Erstellers offen ist |
| Liest mit | der Knoten (Hinweis im Raum, Grenze im Bericht) | das Gerät des Erstellers (das ohnehin Mitglied ist oder es wird) |
| Bau | 11.3d | 11.3c |

## P5 – Bezahlung

| | Wer ihn anspricht (`fragender`) | Wer ihn einlädt (`einlader`, Budget) |
|---|---|---|
| **Knoten** | Die App des Fragenden schickt einen gewöhnlichen versiegelten Auftrag an den Knoten – Sitzungsschlüssel, A+, Lightning oder Gutschrift. Im Kern steht der Verweis auf die Erwähnung (Raum, Id der Nachricht). Der Knoten prüft, dass es die Erwähnung im Raum gibt, und antwortet im Raum. Unbezahlte Erwähnungen beantwortet er nicht; die App zeigt den Preis vor dem Senden. | Zahlkanal vom Einlader zum Knoten, Einlage = Budget (die Obergrenze erzwingt die Kette). Monatsbudget mit Gutschriften in Stufen (F2, entschieden 08.10. – unten). |
| **Gerät** | gibt es zuerst nicht – Agenten auf dem Gerät zahlt der Ersteller (F3 B, entschieden 08.10.) | Die App des Erstellers zahlt aus der eigenen Wallet, je Raum mit Budget und Tagesgrenze, über `ki-zahlung.ts`. Einlader ist hier immer der Ersteller. |

- **Obergrenzen:**
  - Das Budget gilt je Agent und Raum, in sats oder SOL, dazu eine
    Tagesgrenze.
  - Ist es erreicht, schweigt der Agent und sagt das einmal im Raum.
  - Kein Agent zahlt je über sein Budget.
  - Fragende sehen den Preis vorher; ab der Schwelle des Tageslimits kommt
    die Freigabe (4.2a).
- **A+ bleibt:** Der Zahlende teilt auf wie heute (`teileAuf()`). Ein Knoten
  zahlt auch als Gastgeber nichts aus.

## P6 – Datenschutz (neue Aussagen, mit Szenario in 11.3b)

- **Belegt:**
  - In privaten Räumen erscheinen Karte, Erwähnung und Antwort nur als innere
    Events der Gruppe.
  - Der Auftrag an einen Provider geht versiegelt vom Sitzungsschlüssel und
    nennt weder die Identität noch den Raum offen.
  - Leak-Regel neu: `agent-raum-privat`.
- **Grenzen:**
  - Ein Agent auf einem Knoten liest alles im privaten Raum mit; der Raum zeigt
    das.
  - In öffentlichen Räumen sind Erwähnung und Antwort öffentlich, der Auftrag
    an den Provider nicht.
  - Einlader-Budget über den Zahlkanal: Einlage, Knoten und jede Einlösung
    stehen auf der Kette (wie `zahlkanal`).

## P7 – Aufteilung des Baus

| Schritt | Inhalt | Spur | Umfang |
|---|---|---|---|
| 11.3b | Protokoll: Karte 38090 samt Bestätigung des Besitzers (F1), Rolle `agent`, Auslöser- und Kontextregeln, Agentenketten (Schalter, Zählung, F5), Budgetbuch mit Stufen (F2), Verweis im Auftrag, Leak-Regel und Szenario | A | ~350, ggf. zwei Teile |
| 11.3c | Gerät: Schlüssel im Tresor, zweites MLS-Konto, Erwähnungen beantworten, Einlader-Budget (F3 B: der Ersteller zahlt, auch wenn ein anderer fragt) | A | ~400 |
| 11.3d | Knoten: Agent-Rolle, MLS-Konto im Knoten, Einladung annehmen, Erwähnungen beantworten, Bezahlung je Auftrag und aus dem Budget (Monatskanal mit Stufen erst nach dem Devnet-Deploy) | A | ~400, ggf. zwei Teile |
| 11.3e | Oberfläche: Agent als Mitglied mit Kennzeichen, „Agent hinzufügen“ (neu oder vorhanden), Einstellungen | C | ~300 |
| 11.5 | Entwurf, dann Bau: Agenten arbeiten an Raum-Repos – mehrere Agenten stimmen sich über Agentenketten ab (F5) | A + B | nach 11.3/11.4 |

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| F1 | Wer steht als Besitzer auf der Karte eines öffentlichen Agenten? | A nur mit Bestätigung des Besitzers (eine eigene Liste seiner Agenten, NIP-51) · B kein Besitzer öffentlich | **A** – sonst kann jeder einen Agenten „von X“ nennen |
| F2 | Einlader-Budget beim Knoten: Woher kommen die Gutschriften? | A Vorab-Gutschrift in Stufen (je 10 % des Budgets; die App des Einladers stockt auf, wenn sie offen ist) – der Knoten könnte eine Stufe ohne Arbeit einlösen · B je Antwort eine Gutschrift – der Agent antwortet nur, solange der Einlader online ist · C Einlader-Budget nur beim Gerät | **A** – Vertrauen höchstens eine Stufe, dafür immer erreichbar |
| F3 | Gerät und „wer ihn anspricht“? | A Die App des Fragenden zahlt den Provider direkt und schickt die Antwort versiegelt an den Gastgeber; der prüft die Signatur des Providers und schreibt sie als Agent in den Raum · B zuerst nicht anbieten – Geräte-Agenten zahlt der Ersteller | **B** – deutlich einfacher; A kann später folgen |
| F4 | Persona/Systemanweisung öffentlich? | A nie, nur beim Gastgeber · B wahlweise in der Karte | **A** |
| F5 | Dürfen Agenten auf Agenten antworten? | A nie · B eine Ebene | **A** – keine Schleifen, keine Kosten ohne Menschen |
| F6 | Kind 38090 für die Karte und Rolle `agent` als neue Standardrolle? | A ja · B andere Nummer/Rolle | **A** (38090 ist frei) |

## Entscheidungen vom 08.10.2026 (MENSCH)

Dieser Abschnitt gilt vor den Vorschlägen oben.

| Nr. | Entscheidung |
|---|---|
| F1 | **A** – Besitzer nur mit seiner Bestätigung (eigene Liste seiner Agenten, NIP-51) |
| F2 | **A als Monatsbudget mit Pfand** – Wunsch MENSCH: „prepaid mit Escrow und Rückzahlung nach Ablauf, monatlich einzahlen“; Ausgestaltung unten |
| F3 | **B** – Agenten auf dem Gerät zahlt, wer sie anlegt, aus seinem Budget für den Raum; „wer fragt, zahlt“ nur beim Agenten auf dem Knoten. A kann später folgen (Erklärung unten) |
| F4 | **A** – Persona und Systemanweisung nur beim Gastgeber |
| F5 | **B mit Schalter** – Wunsch MENSCH: Agenten sollen sich beim gemeinsamen Arbeiten abstimmen können, etwa am Code eines Raum-Repos; Regeln unten |
| F6 | **A** – Kind 38090, Standardrolle `agent` |

### Einlader-Budget beim Knoten (F2)

- **Pfand:** Der Einlader öffnet einen Zahlkanal zum Knoten (`oeffneZahlkanal()`).
  - Einlage = Monatsbudget, Laufzeit 30 Tage (die längste, die es gibt).
  - Das Geld liegt beim Programm, nicht beim Knoten.
- **Stufen:**
  - Die App des Einladers signiert Gutschriften im Voraus, je eine Stufe über dem Verbrauchten.
  - Standard ist eine Stufe von 10 % des Budgets. Der Einlader kann eine größere wählen: Je größer die Stufe, desto länger antwortet der Agent ohne ihn, und desto mehr muss er dem Knoten trauen.
  - Ohne Arbeit kann der Knoten nie mehr als eine Stufe einlösen.
  - Ist die Stufe verbraucht und die App des Einladers nicht offen, schweigt der Agent und sagt das einmal im Raum.
- **Rückzahlung:** Nach Ablauf geht der Rest von selbst an den Einlader zurück.
  - `refund` darf seit Z1 jeder aufrufen; der Wächter der App tut es.
  - Das Geld geht nur an den Kunden aus dem Kanal.
- **Jeden Monat:** Vor Ablauf erinnert die App.
  - Neu eingezahlt wird nur auf Klick und nach Rückfrage – als neuer Kanal oder durch Aufstocken (E8).
  - Nie automatisch, wie beim Verlängern des Relay-Zugangs (E11 B).
- **Folgen:**
  - Das Pfand gibt es nur mit SOL und erst nach dem Devnet-Deploy (M-2), denn der Zahlkanal ist auf Solana.
  - Mit sats gibt es kein Pfand ohne Verwahrer. Dort und bis zum Deploy gilt eines von beidem:
    - Die App des Einladers zahlt je Antwort, solange sie offen ist (wie Option B).
    - Es zahlt, wer fragt.

### Agentenketten (F5)

- **Schalter je Raum** „Agenten sprechen Agenten an“, Standard aus.
  - Im privaten Raum setzen ihn die Admins der Gruppe (Raumstand), im offenen Raum der Gründer (Definition 34700).
  - Ausschalten wirkt sofort, laufende Ketten enden.
- **Jede Kette beginnt bei einem Menschen.**
  - Gezählt werden die Antworten von Agenten in der Antwortkette seit der letzten Nachricht eines Menschen.
  - Gelesen wird das aus dem Raum, nie aus einer Angabe des Agenten.
  - Grenze je Raum: Standard 10, höchstens 50. Danach antwortet in dieser Kette kein Agent mehr, bis ein Mensch wieder schreibt.
- **Bezahlt** wird jede Antwort wie sonst.
  - Ein Agent antwortet einem Agenten nur, wenn seine Antworten aus einem Budget kommen: Einlader-Budget, beim Agenten auf dem Gerät der Ersteller.
  - „Wer fragt, zahlt“ gilt nur für Menschen, denn Knoten zahlen nichts aus (5.1.2).
  - Budget und Tagesgrenze bleiben die Obergrenze.
  - Die Bremse von 3 Aufträgen je Minute gilt je Absender, auch für Agenten.
- **Kontext** wie bei Menschen: nur der Kanal bzw. Thread bis zur Erwähnung.
- **Grundlage für 11.5:** mehrere Agenten an einem Raum-Repo.

### Seit dem Entwurf geändert (gilt beim Bau)

- **B-22:** In offenen Räumen schreibt jeder, der beitritt (Rolle für alle).
  - Damit kann auch jeder den Agenten erwähnen.
  - Bei „wer einlädt, zahlt“ zahlt der Einlader auch für Fragen von Fremden. Schutz sind Budget, Tagesgrenze und Bremse; die App sagt das beim Einladen.
- **D1c:** Kontext nach `VERLAUF_UMFANG` (in P3 eingetragen).
- **D1b2:** Ein Agent auf dem Gerät bekommt je Raum einen eigenen Sitzungsschlüssel, nicht nur je Agent – sonst verbände der Provider die Räume.
- **12.4a:** Mit SOL als Standard-Schiene zahlt KI nur über einen Kanal. Auch „wer fragt, zahlt“ braucht dann einen Kanal des Fragenden zum Knoten.

### F3 erklärt (entschieden: B)

**Die Frage:** Ein Agent läuft auf dem Gerät seines Erstellers, und ein anderes Mitglied fragt ihn. Wer bezahlt den Provider?

- **B – der Ersteller,** aus dem Budget, das er für den Raum festlegt. Das ist einfach.
- **A – die App des Fragenden.** Dafür müssten drei Seiten zusammenspielen:
  - Der Fragende bezahlt eine Rechnung.
  - Das Gerät des Erstellers wartet auf den Nachweis und schreibt erst dann.
  - Der Provider liefert die Antwort an beide.
  - Dazu kommt: Mit F4 A kennt nur das Gerät des Erstellers die Persona. Der Fragende könnte die Anfrage also nicht selbst stellen.
- **Empfehlung: B.** Wer möchte, dass Fragende selbst zahlen, nimmt einen Agenten auf dem Knoten – dort geht das schon.
