# Agenten in Räumen – Entwurf (Schritt 11.3a)

Stand 29.09.2026, Spur A. **Vorlage zur Freigabe durch den MENSCHEN** – gebaut
wird davon erst nach der Freigabe (11.3b–e, dann 11.5). Grundlage sind die
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
- **Keine Schleifen:** Erwähnungen durch Agenten lösen nie etwas aus (F5).
- **Bremse:** je Mitglied und Minute höchstens 3 Aufträge. Je Raum sind
  höchstens so viele offen, wie der Gastgeber annimmt.
- **Kontext – nur, was der Fragende sieht:**
  - nur der Kanal bzw. Thread der Erwähnung, bis zur Erwähnung;
  - Grenzen aus `ki-kontext.ts` (12 Nachrichten, 6000 Zeichen), Absender als
    Namen, andere Agenten gekennzeichnet;
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
| **Knoten** | Die App des Fragenden schickt einen gewöhnlichen versiegelten Auftrag an den Knoten – Sitzungsschlüssel, A+, Lightning oder Gutschrift. Im Kern steht der Verweis auf die Erwähnung (Raum, Id der Nachricht). Der Knoten prüft, dass es die Erwähnung im Raum gibt, und antwortet im Raum. Unbezahlte Erwähnungen beantwortet er nicht; die App zeigt den Preis vor dem Senden. | Zahlkanal vom Einlader zum Knoten, Einlage = Budget (die Obergrenze erzwingt die Kette). Wie die Gutschriften entstehen, ist F2. |
| **Gerät** | F3 | Die App des Erstellers zahlt aus der eigenen Wallet, je Raum mit Budget und Tagesgrenze, über `ki-zahlung.ts`. Einlader ist hier immer der Ersteller. |

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
| 11.3b | Protokoll: Karte 38090, Rolle `agent`, Auslöser- und Kontextregeln, Budgetbuch, Verweis im Auftrag, Leak-Regel und Szenario | A | ~350 |
| 11.3c | Gerät: Schlüssel im Tresor, zweites MLS-Konto, Erwähnungen beantworten, Einlader-Budget | A | ~400 |
| 11.3d | Knoten: Agent-Rolle, MLS-Konto im Knoten, Einladung annehmen, Erwähnungen beantworten, Bezahlung je Auftrag und aus dem Budget | A | ~400, ggf. zwei Teile |
| 11.3e | Oberfläche: Agent als Mitglied mit Kennzeichen, „Agent hinzufügen“ (neu oder vorhanden), Einstellungen | C | ~300 |
| 11.5 | Entwurf, dann Bau: Agenten arbeiten an Raum-Repos | A + B | nach 11.3/11.4 |

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| F1 | Wer steht als Besitzer auf der Karte eines öffentlichen Agenten? | A nur mit Bestätigung des Besitzers (eine eigene Liste seiner Agenten, NIP-51) · B kein Besitzer öffentlich | **A** – sonst kann jeder einen Agenten „von X“ nennen |
| F2 | Einlader-Budget beim Knoten: Woher kommen die Gutschriften? | A Vorab-Gutschrift in Stufen (je 10 % des Budgets; die App des Einladers stockt auf, wenn sie offen ist) – der Knoten könnte eine Stufe ohne Arbeit einlösen · B je Antwort eine Gutschrift – der Agent antwortet nur, solange der Einlader online ist · C Einlader-Budget nur beim Gerät | **A** – Vertrauen höchstens eine Stufe, dafür immer erreichbar |
| F3 | Gerät und „wer ihn anspricht“? | A Die App des Fragenden zahlt den Provider direkt und schickt die Antwort versiegelt an den Gastgeber; der prüft die Signatur des Providers und schreibt sie als Agent in den Raum · B zuerst nicht anbieten – Geräte-Agenten zahlt der Ersteller | **B** – deutlich einfacher; A kann später folgen |
| F4 | Persona/Systemanweisung öffentlich? | A nie, nur beim Gastgeber · B wahlweise in der Karte | **A** |
| F5 | Dürfen Agenten auf Agenten antworten? | A nie · B eine Ebene | **A** – keine Schleifen, keine Kosten ohne Menschen |
| F6 | Kind 38090 für die Karte und Rolle `agent` als neue Standardrolle? | A ja · B andere Nummer/Rolle | **A** (38090 ist frei) |
