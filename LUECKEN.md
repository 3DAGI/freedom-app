# Was dem Protokoll noch fehlt

Systematische Durchsicht: Wo hat das System Lücken, die ein Nutzer im Ernstfall
bemerkt — und was kostet es, sie zu schließen?

**Sortiert nach Dringlichkeit, nicht nach Aufwand.** Die ersten fünf würde ich
vor dem öffentlichen Start bauen; alles ab Stufe C kann warten.

---

## Stufe A — vor dem Start

### A1. Schlüsselwechsel nach Diebstahl ✅ **gebaut**

**Warum es fehlte:** Die Nachfolge löst „Schlüssel verloren". Für „Schlüssel
gestohlen" gab es nichts — und das ist der schlimmere Fall. Wer deinen
Schlüssel hat, ist du: für immer, ohne Widerspruchsmöglichkeit.

**Warum es schwer ist:** Der Dieb kann dieselben Ereignisse veröffentlichen wie
du, auch einen Widerruf. Aus Sicht der Relays sind beide identisch.

**Wie gebaut:** Ein Mandat wird **im Voraus** signiert und getrennt aufbewahrt.
Es benennt den Nachfolgeschlüssel. Das *früheste* Mandat gewinnt — derselbe
Gedanke wie beim Referral-Graphen: Wo zwei widersprüchliche Aussagen möglich
sind, entscheidet nicht die lauteste, sondern die älteste.

`key-rotation.ts`, 17 Tests. Ereignisse vor der Kompromittierung bleiben
gültig, sonst würde ein Diebstahl die gesamte Vorgeschichte löschen.

---

### A2. Zeitstempel sind fälschbar ✅ **gebaut**

**Warum es fehlt:** Jedes Nostr-Ereignis trägt ein `created_at`, das der
Absender frei wählt. Das ist bekannt und normalerweise harmlos. Bei euch nicht:

| Mechanismus | Regel | Angriff |
|---|---|---|
| Referral-Graph | früheste Angabe gewinnt | Werber datiert zurück und stiehlt fremde Geworbene |
| Schlüsselwechsel | frühestes Mandat gewinnt | Dieb datiert sein Mandat vor das echte |
| Moderatorenliste | neueste gewinnt | Abgesetzter Moderator datiert vor und setzt sich wieder ein |
| Aufgaben | aktive Tage zählen | Provider erzeugt 30 „Tage" in einer Minute |

Das ist keine theoretische Lücke. **Der Aufgaben-Angriff ist trivial** und
kostet euch bis zu 29.500 sats je Wegwerf-Identität.

**Wie bauen:** Drei Stufen, aufsteigend nach Aufwand.

1. **Plausibilitätsfenster (ein Tag Arbeit).** Ereignisse mehr als ein paar
   Minuten in der Zukunft oder deutlich vor dem ersten bekannten Ereignis
   dieses Schlüssels werden verworfen. Fängt die plumpen Fälle.
2. **Relay-Zeugen (drei Tage).** Relays veröffentlichen periodisch einen
   signierten Zeitanker über die zuletzt gesehenen Ereignis-Kennungen. Wer
   zurückdatiert, kann keinen passenden Zeugen vorweisen. Kostet nichts außer
   Konvention.
3. **OpenTimestamps (zwei Tage).** Für Ereignisse, bei denen es um Geld geht
   — Fee-Belege, Leistungsnachweise —, ein Merkle-Anker in der Bitcoin-Kette.
   Beweiskräftig, aber mit Stunden Verzögerung.

Ich würde 1 und 2 sofort bauen, 3 erst, wenn echtes Geld fließt.

---

### A3. Spam- und Flutschutz ✅ **gebaut**

**Warum es fehlt:** Publizieren kostet nichts. Jeder kann beliebig viele
Ereignisse auf beliebig viele Relays schreiben, und jeder kann jedem eine
Direktnachricht schicken. Das ist nicht hypothetisch — es ist das Problem, an
dem offene Nostr-Clients heute leiden.

Für euch besonders: Ein Provider-Knoten, der jede Job-Anfrage annimmt, lässt
sich mit sinnlosen Anfragen beschäftigen, bis er für zahlende Kunden nicht mehr
erreichbar ist.

**Wie bauen:**

- **Rechennachweis auf DM-Ereignisse (NIP-13, zwei Tage).** Eine Nachricht an
  jemanden, der dir nicht folgt, braucht ein paar Sekunden Rechenzeit. Für
  einen Menschen unmerklich, für einen Massenversender teuer. Gegen Kontakte
  entfällt er.
- **Vertrauensfilter für DMs (ein Tag).** Nachrichten von Leuten ohne Pfad im
  Vertrauensgraphen landen in einem zweiten Posteingang statt im ersten. Das
  ist der Mechanismus, den jedes funktionierende System hat.
- **Anfrage-Deckel je Absender im Provider (ein Tag).** Ein gleitendes Fenster
  je Pubkey. Bezahlte Anfragen zählen anders als Gratis-Anfragen.

---

### A4. Ablaufende Nachrichten ✅ **gebaut**

**Warum es fehlt:** Alles bleibt für immer auf allen Relays. Für eure
Zielgruppe ist das eine Belastung, keine Eigenschaft: Eine Nachricht, die ein
Journalist vor drei Jahren geschrieben hat, ist heute noch für jeden abrufbar,
der die richtige Kennung kennt.

**Wie bauen:** NIP-40 kennt einen `expiration`-Tag; wohlmeinende Relays löschen
danach. Ein halber Tag Arbeit.

**Die ehrliche Grenze gehört daneben:** Das ist eine *Bitte*, keine Garantie.
Wer die Nachricht kopiert hat, behält sie. Eine Funktion namens „verschwindende
Nachrichten" ohne diesen Hinweis erzeugt genau das falsche Sicherheitsgefühl —
und dann schreibt jemand etwas, das er sonst nicht geschrieben hätte.

---

### A5. Verschlüsselte Zustandssicherung ✅ **gebaut**

**Warum es fehlt:** Merkphrase sichert die *Identität*. Unterhaltungen,
Raum-Mitgliedschaften, eigene Namen, Lesestände liegen im Browser-Speicher.
Wer seine Browserdaten löscht, behält den Schlüssel und verliert alles andere —
und weiß dann nicht einmal mehr, in welchen Räumen er war.

**Wie bauen:** Ein aus der Merkphrase abgeleiteter Zweitschlüssel (anderer
Ableitungspfad) verschlüsselt den Zustand; das Ergebnis geht als Blob ins
eigene Netz. Wiederherstellung braucht nur die Merkphrase. Zwei Tage.

**Wichtig:** anderer Ableitungspfad als die Identität. Denselben Schlüssel für
Signieren und Verschlüsseln zu verwenden ist ein Fehler, den man nicht
rückgängig machen kann.

---

## Stufe B — vor dem Wachstum

### B1. Mehrere Geräte ✅ **gebaut**

**Warum es fehlt:** Es gibt keinen Weg, dieselbe Identität auf Laptop und
Handy zu benutzen, außer den privaten Schlüssel zu kopieren. Das ist genau das,
was man Nutzern abgewöhnen will — und es ist der Grund, warum viele
Nostr-Clients in der Praxis unbenutzbar bleiben.

**Wie bauen:** Zwei Wege, und ich würde beide anbieten.

- **NIP-46 (Remote-Signierung).** Der Schlüssel bleibt auf einem Gerät, andere
  Geräte fragen nach Unterschriften. Sauber, aber das Hauptgerät muss erreichbar
  sein. Drei Tage.
- **Geräteschlüssel mit Vollmacht.** Jedes Gerät hat einen eigenen Schlüssel,
  den die Hauptidentität beglaubigt. Funktioniert offline, und ein verlorenes
  Gerät lässt sich einzeln entziehen — dieselbe Mechanik wie A1. Fünf Tage.

Der zweite Weg ist mehr Arbeit und die bessere Lösung, weil er zum
Offline-Anspruch passt.

---

### B2. Streitfall bei Aufträgen ✅ **gebaut**

**Warum es fehlt:** Ein Kunde zahlt, der Provider liefert Unsinn oder gar
nichts. Es gibt Redundanz und Konsens, aber **keinen Rückweg für das Geld**.
Der Kunde kann den Provider schlecht bewerten — das war's.

Bei Swaps ist das gelöst (HTLC mit Frist), bei Rechenaufträgen nicht. Die
Asymmetrie fällt jedem auf, der beides benutzt.

**Wie bauen:** Eine Session hält die Zahlung für ein kurzes Fenster zurück
(Hold-Invoice, wie beim Swap). Reklamiert der Kunde innerhalb der Frist, geht
ein zweiter Provider dieselbe Anfrage. Stimmen die Ergebnisse überein, wird
abgerechnet; weichen sie ab, fließt zurück. Vier Tage.

**Grenze:** Bei kreativen Aufgaben gibt es kein „richtig". Das Verfahren fängt
den Totalausfall ab, nicht die Geschmacksfrage — und das gehört in die
Beschreibung.

---

### B3. Relays haben kein Geschäftsmodell ✅ **gebaut**

**Warum es fehlt:** Provider verdienen, Werber verdienen, der Reward-Pool
verteilt. **Relays bekommen nichts** und tragen die gesamte Koordination. Das
ist derselbe Fehler, den ihr bei Providern vermieden habt — nur eine Ebene
tiefer und bisher unbemerkt.

Die Folge ist vorhersehbar: Das Netz hängt an fremden, unbezahlten Relays. Bei
Wachstum werfen die zuerst hin.

**Wie bauen:** Ein Anteil des Reward-Pools für Relays, verteilt nach
nachgewiesener Zustellung. Die Aufgabe „Relay betrieben" existiert bereits —
sie braucht eine laufende Vergütung daneben, nicht nur eine einmalige. Drei
Tage.

---

### B4. Abstreitbarkeit für Direktnachrichten ✅ **NIP-59 gebaut**

**Warum es fehlt:** Jede Nachricht ist signiert. Das ist gut gegen Fälschung
und schlecht für den Absender: Eine entschlüsselte DM ist ein **kryptografisch
beweisbares Geständnis**, dass diese Person das geschrieben hat. Für einen
Whistleblower ist das genau das Dokument, das ihn verurteilt.

Signal löst das mit abstreitbarer Authentifizierung; Nostr kann es
grundsätzlich nicht, weil Signaturen das Fundament sind.

**Wie bauen:** Kein vollständiger Ersatz, aber zwei Verbesserungen:

- **NIP-59 (Geschenkumschlag).** Die äußere Hülle wird mit einem
  Wegwerfschlüssel signiert, der Absender steht nur innen. Ein Relay sieht
  nicht mehr, wer mit wem schreibt. Drei Tage — und es ist die größte
  Verbesserung beim Metadatenschutz, die für wenig Arbeit zu haben ist.
- **Ehrlicher Hinweis** bei besonders heiklen Unterhaltungen: „Diese Nachricht
  beweist, dass du sie geschrieben hast."

---

## Stufe C — später, aber einplanen

### C1. Verschlüsselte Kanäle mit Schlüsselwechsel ✅ **gebaut**

Aufgeschoben, und ich halte das weiterhin für richtig. Der Aufwand ist nicht
die Verschlüsselung, sondern der Wechsel beim Austritt eines Mitglieds — und
der erreicht nur, wer danach online kommt. MLS (RFC 9420) löst das, ist aber
ein Projekt für mehrere Wochen.

**Bis dahin:** Kanäle ehrlich als offen beschriften. Das tut die App bereits.

### C2. Zusammenführung bei Offline-Bearbeitung ✅ **gebaut**

Wenn zwei Geräte offline dieselbe Sache ändern, gibt es keine Regel für das
Zusammenführen — der letzte Schreibvorgang gewinnt und der andere ist weg. Bei
Nachrichten harmlos, bei Raumeinstellungen und Rollen nicht.

**Wie bauen:** CRDT für die wenigen wirklich veränderlichen Dinge
(Raumdefinition, Rollen, eigene Namen). Eine Woche.

### C3. Zwiebelrouting für Relay-Zugriffe ✅ **Tor-Teil gebaut**

Jedes Relay sieht die IP-Adresse jedes Clients. Für die Zielgruppe ist das der
größte verbleibende Metadatenabfluss.

**Wie bauen:** Kurzfristig eine Tor-Empfehlung mit `.onion`-Relays in der
Startliste (ein Tag). Langfristig Weiterleitung über mehrere Relay-Sprünge —
das ist ein eigenes Forschungsthema.

### C4. Notfall-Löschung und Zwangslage ✅ **gebaut**

Für die Zielgruppe relevant: ein Weg, lokale Daten sofort zu vernichten, und
eine Zweitphrase, die eine harmlose Oberfläche öffnet.

**Warnung, die dazugehört:** In manchen Rechtsordnungen ist das Verbergen von
Beweismitteln strafbar, und eine entdeckte Zwangslagenfunktion verschlechtert
die Situation erheblich. Wenn, dann mit deutlicher Aufklärung — oder gar nicht.

### C5. Durchsuchbarer Verlauf ✅ **gebaut, lokal**

Die Suche lädt alles in den Speicher. Ab ein paar tausend Nachrichten
unbrauchbar. Ein lokaler Index (IndexedDB) ist zwei Tage Arbeit und wird ab
dem ersten ernsthaften Nutzer gebraucht.

### C6. Einsatz für Provider-Reputation ❌ **bewusst nicht gebaut**

Reputation lässt sich aufbauen und dann verbrennen: gut arbeiten, bis viele
Aufträge kommen, dann kassieren und nicht liefern. Ein hinterlegter Betrag, den
man bei nachgewiesenem Fehlverhalten verliert, macht das teuer.

**Aber:** Das braucht eine Instanz, die über Fehlverhalten entscheidet — und
genau die wollt ihr nicht. Deshalb steht es in Stufe C und nicht weiter oben.
Vielleicht ist die richtige Antwort, es nicht zu bauen.

---

## Was ich NICHT bauen würde

**Einen eigenen Token.** Löst kein Problem, das ihr habt, und schafft mehrere.

**Ein On-Chain-Governance-System.** Eure Governance funktioniert über den
Release-Signierschlüssel und die Fork-Möglichkeit. Das ist ehrlicher als eine
Abstimmung, die ohnehin von der Verteilung der Stimmrechte entschieden wird.

**Sprachkanäle.** Brauchen einen Medienserver.

**Eine netzweite Sperrliste.** Der erste Ort, an dem jemand Druck ausüben
würde.

---

## Stand der Abarbeitung

Stufe A, B und C sind abgearbeitet. **856 Protokoll-Tests.**

| Punkt | Modul | Tests |
|---|---|---|
| A1 Schlüsselwechsel | `key-rotation.ts` | 17 |
| A2 Zeitstempel | `timestamps.ts` | 20 |
| A3 Spamschutz | `antispam.ts` | 20 |
| A4 Ablauf + A5 Sicherung | `state-backup.ts` | 20 |
| B4 Geschenkumschlag | `gift-wrap.ts` | 16 |
| B1 Mehrere Geräte | `devices.ts` | 22 |
| B2 + B3 Streitfall, Relays | `disputes-relays.ts` | 23 |
| C1 Verschlüsselte Kanäle | `group-crypto.ts` | 20 |
| C2 + C4 Zusammenführung, Zwang | `merge.ts`, `duress.ts` | 26 |
| C3 Tor | `relay-discovery.ts` | 5 |
| C5 Lokale Suche | `local-search.ts` | 27 |

**C6 (Einsatz) wurde bewusst nicht gebaut.** Ein Einsatz, den man bei
Fehlverhalten verliert, braucht eine Instanz, die über Fehlverhalten
entscheidet — und genau die soll es nicht geben. Der Streitfall (B2) deckt den
konkreten Schaden ab, ohne eine solche Instanz einzuführen. Alles darüber
hinaus wäre ein Gericht mit anderem Namen.

## Reihenfolge, wenn ich entscheiden müsste

1. **A2 Zeitstempel** — weil vier bestehende Mechanismen davon abhängen und
   der Aufgaben-Angriff trivial ist. Drei Tage für Stufe 1 und 2.
2. **A3 Spamschutz** — weil der erste ernsthafte Angriff darauf zielt. Vier Tage.
3. **A5 Zustandssicherung** — weil der erste Datenverlust eines echten Nutzers
   mehr Schaden anrichtet als jeder fehlende Komfort. Zwei Tage.
4. **A4 Ablauf** — halber Tag, große Wirkung auf die Haftungslage.
5. **B4 NIP-59** — drei Tage, größte Metadaten-Verbesserung je Aufwand.
6. **B1 Mehrere Geräte** — fünf Tage, ohne das bleibt die Nutzung mühsam.
7. **B3 Relay-Vergütung** — drei Tage, bevor das Netz wächst.
8. **B2 Streitfall** — vier Tage, sobald echtes Geld fließt.

Zusammen etwa **vier bis fünf Wochen**. Danach halte ich das Protokoll für
vollständig genug, um Nutzer darauf zu lassen.

---

## Der Vorbehalt

Diese Liste ist eine Ableitung aus dem Code, nicht aus Erfahrung. Sobald der
erste echte Sat fließt und die ersten zehn Fremden das System benutzen, wird
sich zeigen, dass ein oder zwei dieser Punkte unwichtig sind — und dass etwas
fehlt, das hier nicht steht.

**Die Devnet-Schritte kommen vor dieser Liste**, nicht danach. Alles hier
gebaute steht sonst auf ungeprüften Annahmen.
