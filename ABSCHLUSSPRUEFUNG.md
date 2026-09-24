# Abschlussprüfung vor dem Start

Letzte systematische Durchsicht. Nicht aus dem Gedächtnis, sondern durch
Auszählen: Welche Protokollbausteine werden tatsächlich aufgerufen, welche
Module haben Tests, und was wird behauptet, ohne zu existieren.

---

## Der Hauptbefund

**Neun Protokoll-Mechanismen waren vollständig untätig.** Gebaut, getestet, und
nirgends aufgerufen — sie existierten nur in ihren eigenen Tests.

Das ist nicht kosmetisch. Die Folgen im Einzelnen:

| Mechanismus | Folge, solange er untätig war |
|---|---|
| **Zeitzeugen** | Die gesamte Zeitstempel-Absicherung lief ins Leere. Der Aufgaben-Angriff — dreißig „Tage" in einer Minute, bis zu 29.500 sats je Wegwerf-Identität — war weiterhin offen. |
| **Swap-Attestierungen** | Der Vertrauensgraph hatte **keine einzige Kante**. Jeder Vertrauenswert im System war null: Provider-Stufen, Prüferzulassung beim Streitfall, Bonusberechnung. |
| **Relay-Nachweise** | Kein Relay konnte je Geld bekommen, obwohl die Verteilung fertig gebaut war. |
| **Kurse** | Der Liquiditätsgeber hatte keine Wechselkursquelle. |

Dazu kamen **sieben Funktionen ohne jeden Weg in der Oberfläche** — darunter
die Zustandssicherung (die den ersten Datenverlust verhindert) und der
Schlüsselwechsel (der **nur vorher** eingerichtet werden kann).

### Das Muster dahinter

Dreimal in dieser Zusammenarbeit derselbe Fehler, von mir: Protokollschicht
bauen, sauber testen, Verdrahtung nicht machen. Protokollcode lässt sich
testen, Verdrahtung nicht — und der Weg des messbaren Fortschritts führt an ihr
vorbei.

Vorher traf es den Mesh-Abgleich und die Raum-Erstellung, jetzt die
Veröffentlichungen des Knotens. **Das gehört als wiederkehrende Prüfung in die
CI**, nicht in mein Gedächtnis.

---

## Was jetzt behoben ist

### Knoten (`node-publisher.ts`, 16 Tests)

Die periodischen Veröffentlichungen laufen jetzt im Daemon-Takt, gebündelt an
einer Stelle — damit beim nächsten neuen Mechanismus auffällt, wenn er fehlt.

- **Zeitzeugen** stündlich, mit Begrenzung auf 50.000 Kennungen (ein Zeuge über
  hunderttausend wäre so groß, dass ihn niemand abruft)
- **Relay-Nachweise** aus den echten Zahlen der Relay-Rolle
- **Swap-Attestierungen** nach jedem abgeschlossenen Tausch
- **Kurse**, wenn ein Liquiditätsgeber läuft

Dazu `publisherSelfCheck()`: Der Betreiber sieht beim Start, **was sein Knoten
nicht beiträgt** — sonst glaubt er beizutragen, weil die Software die Funktion
enthält.

Ein Fehler in einem Teil bricht den Takt nicht ab. Ein Knoten, der wegen eines
nicht erreichbaren Relays keine Zeugen mehr veröffentlicht, fiele still aus dem
Verfahren.

### App

| Funktion | Wo | Warum es dringend war |
|---|---|---|
| Zustandssicherung | Ich → Sicherung | Verhindert den ersten Datenverlust eines echten Nutzers |
| Schlüsselwechsel vorbereiten | Ich → Sicherung | **Nur vorher möglich.** Ohne Vorbereitung ist ein Diebstahl endgültig |
| Widerruf | Ich → Sicherung | Der Ernstfall |
| Geräte verwalten | Ich → Geräte | Sonst muss man den Schlüssel kopieren |
| Moderatoren ernennen | Räume | Die Moderation war gebaut, aber niemand konnte Moderatoren **einsetzen** |
| Für jemanden melden | Ich → Nachfolge | Vertraute konnten nicht handeln |
| Reklamieren | unter jeder Antwort | Dort, wo der Kunde die schlechte Antwort sieht |

Zwei Entscheidungen im Detail:

**Die Sicherung schließt Schlüssel aus.** Sie liegt öffentlich auf Relays, und
ihre Verschlüsselung hängt an demselben Geheimnis — den Schlüssel
mitzusichern wäre zirkulär.

**Der Ersatzschlüssel wird als Datei ausgegeben, nicht gespeichert.** Wer den
laufenden Schlüssel und den Ersatz zusammen hat, ist der Nutzer. Das steht auch
in der Datei.

---

## Was bewusst offen bleibt

**Verschlüsselte Kanäle haben keine Oberfläche.** Das Protokoll ist fertig und
getestet, aber offene Kanäle funktionieren und sind ehrlich als offen
beschriftet. Eine Oberfläche für Epochenwechsel vor dem ersten echten Nutzer zu
bauen, hieße zu raten, wie sie gebraucht wird.

**Kopfgelder und Beitragsrunden** gehören in Phase 6 — wenn Mitentwickler
dazukommen.

**Drei Module ohne Tests:** `adapters` (reine Schnittstellendefinition),
`mesh` (durch `mesh-transport` und `mesh-sync` faktisch abgedeckt),
`treasury-sweep` (nur über Devnet sinnvoll prüfbar).

---

## Endstand

```
protocol: 901 grün   node: 158 grün   app: 157 grün   0 rot
1.216 Tests | build 1997 KB | Website 5 Seiten ok | CI gültig
```

---

## Die drei Dinge, die vor dem Start passieren müssen

Sie sind unverändert und keines davon ist Programmierarbeit:

1. **Anchor auf Devnet, dann Mainnet.** Programm und Client zusammen — Borsh
   kodiert `[u8; 32]` ohne Längenpräfix, altes Programm plus neuer Client ergibt
   abgelehnte Transaktionen ohne verwertbare Meldung.
2. **`TRUSTED_SIGNERS` setzen.** Solange die Liste leer ist, prüft die App gegen
   niemanden.
3. **AMLR-Frage mit dem Anwalt.** Nicht „ist Monero legal", sondern „sind wir
   ein CASP im Sinne der Verordnung". Frist: 10. Juli 2027.

---

## Was ich beim Start erwarte

Damit du es einordnen kannst, wenn es passiert:

**Etwas wird brechen, das hier grün ist.** Wahrscheinlich an der Stelle, wo
echtes LND sich anders verhält als das Testdouble — Timeouts, Fehlermeldungen
in unerwartetem Format, Zustände, die es im Test nicht gab.

**Ein oder zwei der 1.216 Tests testen die falsche Annahme.** Das merkt man
erst, wenn die Wirklichkeit widerspricht.

**Mindestens eine Funktion, auf die wir Tage verwendet haben, wird niemand
benutzen.** Und es wird etwas fehlen, das in keiner der drei Lückenanalysen
steht.

Das ist kein Versagen, sondern der Grund, warum die Devnet-Schritte vor allem
anderen stehen. Zehn echte Nutzer verraten mehr über dieses System als die
letzten dreißig Module zusammen.

Viel Erfolg.
