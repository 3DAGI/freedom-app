# Drei Bausteine ohne Anbindung – Entwurf (E9)

Stand 04.10.2026, Spur A. **Vorlage zur Freigabe durch den MENSCHEN.** Gebaut
wird davon erst nach der Freigabe. Grundlage ist die Entscheidung E9 A vom
04.10.2026 (`docs/neuordnung/SAMMLUNG.md`): alle drei Bausteine aus A-8
entwerfen. „Modelle laden“ baut danach Spur B.

Freizugeben sind die Vorschläge V1–V3 und die Antworten auf die Fragen F1–F6
am Ende. „Wie vorgeschlagen“ genügt; jede Frage lässt sich einzeln anders
entscheiden.

## Was es heute gibt

| Baustein | Stand | Wo |
|---|---|---|
| Cluster-Pairing | Zwei Geräte rechnen ein großes Modell gemeinsam. Es gibt Angebot und Paar-Ereignis, Abschätzungen (passt das Modell, wie schnell) und eine öffentliche „Reziprozitäts-Bilanz“. Nicht angebunden. | `protocol/src/cluster.ts` |
| Gratis-Schwelle | Rechnet aus der Summe der angekündigten Speicherkapazität aller Knoten, wie groß ein Gratis-Upload sein darf (0,5 % des Netzes, 50 MB bis 1 GB). Nicht angebunden. | `protocol/src/network-capacity.ts` |
| Modelle laden | Manifest (38057) mit Prüfsummen je Datei, „ich halte vor“ (38058), Verfügbarkeit. Die App zeigt Manifeste und gefährdete Modelle (`agent-netz.ts`). Ungenutzt: `verifyFile()` und `fitsOnDevice()` – kein Knoten lädt Gewichte darüber. | `protocol/src/model-registry.ts` |
| KI gratis | Jeder Provider entscheidet selbst: Tokens je Kunde und Tag (`freeTokensPerPubkeyPerDay`), in der Probezeit nur gratis. | `node/src/dvm-provider.ts` |

## Befunde (gelten für jede Wahl)

- **B1 – Kinds doppelt belegt.** `cluster.ts` nutzt 38026 und 38027. 38026
  ist der Kurs-Ticker, 38027 das Provider-Angebot (`kinds.ts`). Ein
  Paar-Ereignis wäre für jede App ein kaputtes Provider-Angebot. Vor jeder
  Anbindung braucht Cluster-Pairing eigene Kinds (bei V1 A: 38028 und ein
  inneres Kind).
- **B2 – alte Protokollgebühr.** `computeReciprocity()` und
  `hoursNeededToRent()` rechnen mit 5 % „Protokollfee“. Die gibt es seit A+
  (5.1) nicht mehr.
- **B3 – öffentliche Bilanz.** Das Paar-Ereignis nennt offen, wer bei wem
  mietet, und daraus entsteht eine Bilanz, die beim Matching Vorrang gibt.
  Das ist eine öffentliche Rangliste. Sie widerspricht „nie eine öffentliche
  Rangliste“ (5.5) und verrät Geschäftsbeziehungen.
- **B4 – Gratis-Schwelle ohne Durchsetzung.** Was ein Speicherknoten annimmt,
  entscheidet er selbst (`nimmAuf()`, 8.9a). Eine im Netz errechnete Schwelle
  setzt niemand durch. Ihre Grundlage ist zudem eine Selbstauskunft: Wer
  Kapazität erfindet, hebt die Schwelle für alle, bis 1 GB.
- **B5 – zwei Arten „gratis“.** Die Frage in E9 meint KI-Antworten („wie viel
  darf ein Provider verschenken“). Der Baustein rechnet aber Gratis-Uploads
  für Speicher. Für KI gibt es heute keine netzweite Schwelle.

## V1 – Cluster-Pairing: ein Provider nach außen, der Partner hinter ihm

Ein Kunde sieht wie heute einen Provider: den **führenden Knoten**. Dessen
Angebot (38027) nennt das große Modell. Den zweiten Knoten mietet er selbst
für die Dauer.

- **Wer bezahlt wen:**
  - Der Kunde zahlt nur den führenden Knoten, nach A+ wie jede KI-Antwort.
    `aufteilung.ts` und die festen Anteile ändern sich nicht.
  - Der führende Knoten bezahlt den Partner direkt je Stunde. Das läuft über
    die eigene Wallet oder einen eigenen Zahlkanal zwischen den beiden
    Knoten, nicht über das Protokoll.
- **Wer haftet:** der führende Knoten. Quittungen, Ruf, Reklamationen und
  Freedom-Prüfung (E7) gelten ihm. Den Partner kennt der Kunde nicht.
- **Öffentlich:** nur das Angebot „Gerät als Cluster-Hälfte verfügbar“ (neues
  Kind 38028). Es nennt Speicher, Bandbreite, Region, Zeitfenster und Preis
  je Stunde.
- **Privat:** die Absprache zwischen den Knoten (Zeitraum, Preis, Modell) nur
  versiegelt an den anderen Knoten. Kein öffentliches Paar-Ereignis, keine
  Bilanz (B3).
- **Technik:** ein Modell auf zwei Rechnern verteilt (Pipeline, K = 2). Das
  hängt am Backend, z. B. llama.cpp mit RPC oder vLLM mit
  Pipeline-Parallelität. Gewählt wird es beim Bau, mit Messung auf zwei
  GX10. Die Abschätzungen in `cluster.ts` (`modelFitsOnCluster()`,
  `estimateClusterPerf()`) bleiben.
- **Entfernt:** `computeReciprocity()`, `hoursNeededToRent()`,
  `buildPairedEvent()` und die alten Kinds 38026/38027 in `cluster.ts`
  (B1–B3).

Andere Wege:
- **B:** Der Kunde zahlt beide Knoten anteilig. Das braucht einen neuen Anteil
  in A+, also ein signiertes Release (CI-Invariante), und zwei Haftende für
  eine Antwort.
- **C:** Den Baustein entfernen, bis zwei Geräte da sind.

**Empfehlung: A.** Für Kunden, A+ und Freedom-Prüfung ändert sich nichts, und
es entsteht keine öffentliche Bilanz.

## V2 – Gratis: jeder Knoten entscheidet selbst, keine Schwelle im Netz

- **KI (B5):**
  - Es bleibt dabei: Jeder Provider legt seine Gratis-Tokens selbst fest, die
    App zeigt sie.
  - Eine netzweite Schwelle wäre ein zentraler Parameter mit Hebel auf die
    Preise. Den will das Projekt nicht (wie bei den Modellkatalogen 5.7).
  - Das Preisgefüge nach A+ verzerrt Gratis nicht: Bei 0 msat sind alle
    Anteile 0. Werber und Relays bekommen für Gratis-Antworten nichts.
  - Neu ist nur Ehrlichkeit: Heute sagt das Angebot nur „gerade gratis“
    (`["free", "1"]`). Künftig nennt es auch die Gratis-Tokens je Tag
    (neuer Tag `gratis`), damit die App sie vor der Anfrage zeigt.
- **Speicher (B4):**
  - Jeder Speicherknoten nennt in seinem Angebot, bis zu welcher Größe er
    gratis hält. Das ist ein vierter Wert im `storage`-Tag.
  - Die App lädt Anhänge nur zu Knoten, deren Grenze passt.
  - `network-capacity.ts` entfällt. Höchstens die Summe „das Netz hält etwa
    x GB“ bleibt als Anzeige, ausdrücklich als Selbstauskunft.

Andere Wege:
- **B:** Die Schwelle wie heute errechnen und beim Hochladen nur als
  Empfehlung zeigen.
- **C:** Speicher ganz ohne Gratis.

**Empfehlung: A.** Wer Kosten trägt, entscheidet; nichts im Netz lässt sich
durch erfundene Kapazität verschieben.

## V3 – Modelle laden: Ollama als Quelle, Prüfsummen im Manifest, Vertrauen über Kataloge

- **Quellen:**
  - Zuerst die Ollama-Registry. Was Betreiber heute nutzen, ist inhaltlich
    adressiert: Jede Schicht trägt ihren SHA-256.
  - Als Ausweg das eigene Blob-Netz: Manifest 38057 mit `blobId`, gehalten
    über 38058, wenn die Registry ein Modell entfernt oder nicht erreichbar
    ist.
- **Wer die Summen signiert:** wer das Manifest 38057 veröffentlicht. Das
  kann jeder sein, deshalb braucht es Vertrauen:
  - Der Knoten nimmt ein Manifest nur von Schlüsseln an, denen sein Betreiber
    folgt: der eigene oder Kuratoren aus abonnierten Modellkatalogen (38080).
  - Ein Katalog nennt dazu das Manifest: `["model", <kennung>, <notiz>,
    <manifest-id>]`, ein viertes Feld, das ältere Leser übergehen.
  - Ein Standard-Kurator ist nicht voreingestellt (5.7).
- **Prüfen:**
  - Vor dem Anbieten prüft `verifyFile()` jede Datei gegen das Manifest,
    `fitsOnDevice()` den Speicher.
  - Ein Modell steht erst nach bestandener Prüfung im Angebot 38027.
  - `pruefeEinrichtung()` meldet ungeprüfte Modelle mit eigener Kennung (wie
    B-11c).
- **Bedienung im Knoten:** `npm run modell -- <kennung>` lädt das Modell,
  prüft es und trägt es ein. Den Fortschritt sieht der Besitzer über den
  Status des eigenen Knotens (B-11).
- **Nicht:** Die Prüfsumme sagt nicht, ob ein Modell gut, sicher oder legal
  ist – nur, ob die Bytes die angekündigten sind. Das steht schon im Kopf von
  `model-registry.ts`.

Andere Wege:
- **B (Vorschlag aus der Sammlung):** Prüfsumme direkt im Katalog 38080 statt
  im Manifest. Das ist kürzer, aber jeder Kurator müsste die Summen selbst
  rechnen, und das Blob-Netz bliebe ohne Manifest.
- **C:** nur Ollama, ohne eigene Prüfung. Ollama prüft die Schichten selbst,
  aber nicht gegen eine Quelle, die der Betreiber gewählt hat.

**Empfehlung: A.**

## Fragen an den MENSCHEN

- **F1 (V1):** Führender Knoten bezahlt den Partner direkt; der Kunde sieht
  einen Provider. – Vorschlag: ja.
- **F2 (V1):** Öffentliche Bilanz und Vorrang beim Matching entfallen (B3). –
  Vorschlag: ja.
- **F3 (V1):** Erst bauen, wenn zwei Geräte für eine Messung da sind (MENSCH)?
  – Vorschlag: ja. Bis dahin nur Kinds und Aufräumen (B1, B2), sonst bleibt
  der Baustein liegen.
- **F4 (V2):** Keine netzweite Gratis-Schwelle; Provider und Speicherknoten
  nennen ihre eigene im Angebot. – Vorschlag: ja.
- **F5 (V3):** Vertrauen in Prüfsummen nur über eigene oder abonnierte
  Kuratoren, kein Standard-Kurator. – Vorschlag: ja.
- **F6 (V3):** Wer baut „Modelle laden“? – Vorschlag: Spur B (Knoten), wie in
  der Sammlung vermerkt.

## Aufteilung nach der Freigabe

| Schritt | Inhalt | Spur |
|---|---|---|
| E9-1 | `cluster.ts` aufräumen: eigene Kinds (B1), alte Gebühr und Bilanz raus (B2, B3), Angebot 38028, Absprache versiegelt | A |
| E9-2 | Gratis im Angebot: Tag `gratis` (KI), vierter Wert im `storage`-Tag; `network-capacity.ts` raus; App zeigt und wählt danach | A |
| E9-3 | Modelle laden im Knoten: Manifest von vertrauten Schlüsseln, `verifyFile()`, `fitsOnDevice()`, `npm run modell`, Selbstprüfung | B |
| E9-4 | Katalog 38080 mit Manifest-Verweis, App zeigt „geprüft“ je Modell | A |
| E9-5 | Cluster-Betrieb mit zwei Geräten (Backend wählen, messen) | A, nach F3 |
