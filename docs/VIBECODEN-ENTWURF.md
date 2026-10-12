# Vibecoden auf dem eigenen Knoten – Entwurf (A-31)

Stand 12.10.2026, Spur A.

- **Wunsch MENSCH (11.10.):** Vom Seeker oder iPhone aus auf dem eigenen GX10
  vibecoden – beide per QR-Code verbunden, „ohne Vertrauensproblem“. Das ist
  der Anfang, bevor Fragen zu fremden Geräten (11.5: W3a, W6a, W7; RM2)
  entschieden werden.
- **Freigegeben 11.10. (MENSCH, „Ja“):** den Entwurf festhalten und mit VKa
  beginnen.
- **Offen:** die Fragen VK-W1 bis VK-W5 am Ende. Bis zur Antwort gelten die
  Empfehlungen als Arbeitsgrundlage. VKa hängt an keiner von ihnen.

## Was es schon gibt

| Baustein | Stand | Wo |
|---|---|---|
| Koppeln per QR | `npm run koppeln` zeigt den Code im Terminal des Knotens; die App scannt ihn (Settings → Geräte → „Mein Knoten“), auch ohne `BarcodeDetector` (jsQR, A-20) | B-8, `kopplung.ts` |
| Besitzer erkennen | Geheimnis nur im Tresor; jede Anfrage trägt nur einen HMAC-Nachweis im versiegelten Kern; der Knoten prüft `istBesitzer()` | B-8 |
| Verbindung | Der Knoten verbindet sich selbst nach außen zu Relays – keine Portfreigabe. Handy und Knoten reden über Umschläge, die Relays nicht öffnen; mit Haken nur über das Relay des Knotens | B-9c |
| „Mein Knoten“ | Modell des Knotens in der Modellwahl (gratis, kein Ausweichen), Status, Wecken, Dateien halten, TURN | B-9, B-11, B-12, B-13 |
| Repos | Bundles, Code-Ansicht, Patches, Reviews, Releases in der App | 11.4, C-17, C-20 |

## Was fehlt

1. **Kein Agent, der codet.**
   - Der Knoten führt im laufenden Betrieb keine Werkzeuge aus: `main.ts:375`
     übergibt keine `ToolRegistry`.
   - Agenten-Aufträge sind nur Text.
   - Atomic Agent (B-30) ist frei, aber nicht eingebaut.
2. **Kein Projektordner** auf dem Knoten.
3. **Keine Sandbox** – 11.5s bzw. B-31 sind offen.
4. **Keine Vorschau** der gebauten App auf dem Handy.
5. **Keine Projektseite** in der App: Schritte, Freigaben, Diff, Rückgängig.

## Vorschläge

So sieht es aus Sicht des Besitzers aus:

1. Einmal koppeln.
2. In der App „Mein Knoten“ → „Projekte“ → „Neues Projekt“ wählen.
3. Schreiben, was gebaut werden soll.
4. Live zusehen, was der Agent tut, und Befehle freigeben, wenn gewünscht.
5. Unter „Vorschau“ die App auf dem Handy ausprobieren.
6. „Rückgängig“ setzt jeden Schritt zurück.
7. Ist das Projekt fertig: „Als Repo in einen Raum stellen“.

- **VK1 – Nur der Besitzer.**
  - Code-Aufträge nimmt der Knoten nur versiegelt und mit Nachweis an
    (`istBesitzer()`), wie Status, Halten und TURN. Aufträge Fremder lehnt er ab.
  - Der Code verlässt den Knoten nur zum Handy des Besitzers, versiegelt.
  - Das Modell läuft auf dem Knoten selbst; ein KI-Dienst im Internet ist ohnehin
    ausgeschlossen (`lokaleAntriebAdresse()`).
- **VK2 – Projekte auf dem Knoten.**
  - Je Projekt ein Ordner unter `~/.freedom/projekte/<name>` (0700), dauerhaft –
    es ist der Rechner des Besitzers (AG1 A: eigene Wege mit Gedächtnis).
  - Jeder Schritt des Agenten ist ein Commit. „Rückgängig“ geht damit schrittweise
    (VK-W2).
  - Ins Log kommen nur Zahlen und Kennungen, nie Code oder Befehle.
- **VK3 – Ablauf wie 11.5 (W3a), dazu Freigaben.**
  - Eine Aktion je Antwort des Modells, jeder Befehl in einer neuen Shell in der
    Sandbox, lineare Historie, Ausgabe gekürzt (über 10 000 Zeichen nur Anfang und
    Ende).
  - Modus „fragen“: Jeder Befehl wartet auf „Ja“ vom Handy.
  - Modus „frei“: Der Agent arbeitet im Projekt allein bis zum Ende oder zur Grenze.
  - Ein Ablauf für den eigenen Knoten und später für fremde (11.5c).
- **VK4 – Sandbox auch hier.**
  - Auch das eigene Modell kann sich irren oder Anweisungen aus einem Paket oder
    einer Seite folgen.
  - Schreibbar ist nur der Projektordner (Regeln wie im 11.5-Entwurf, Vorbild
    Codex).
  - Ohne bubblewrap gibt es kein Ausführen; der Agent sagt dann, warum.
  - Netz: Pakete holt der Knoten (W6a); dazu je Projekt der Schalter
    „Internet frei“ (VK-W4) – nie ins Heimnetz.
- **VK5 – Vorschau über die Relays (VK-W3).**
  - Der Knoten baut die App und schickt das Ergebnis versiegelt ans Handy
    (Grenze etwa 5 MB).
  - Die App zeigt es in einem abgeschotteten Rahmen (`sandbox` ohne
    `allow-same-origin`).
  - Das geht ohne eigene Domain und ohne Portfreigabe, auch unterwegs – aber nur für
    Web-Apps ohne eigenen Server.
- **VK6 – Projekte-Seite in der App.**
  - Unter „Mein Knoten“: Projekte, Chat mit dem Agenten, Schritte mit Befehl und
    Ausgabe, Freigabe-Knöpfe, Diff (mit der vorhandenen Code- und Patch-Ansicht),
    Vorschau, Rückgängig.
  - Dazu „Als Repo in einen Raum stellen“ (Bundle hochladen wie 11.4) – der Übergang
    zu 11.5.
- **VK7 – Modell.** Ein Coding-Modell auf dem Knoten über Ollama, gewählt und
  geprüft wie heute (E9-Manifeste); keine Kosten.

**Seeker und iPhone:**
- **Beide:** die Web-App von GitHub Pages; Scannen auch ohne `BarcodeDetector`.
- **Seeker:** dazu die Android-Hülle (6.1c1). Deren Veröffentlichung braucht noch den
  APK-Schlüssel in den Secrets (MENSCH).
- **iPhone:** Wecken nur, wenn die App auf dem Home-Bildschirm liegt.

## Aufteilung

| Schritt | Inhalt | Spur | Umfang |
|---|---|---|---|
| VKa | Protokoll: Code-Auftrag (5080: `liste`, `neu`, `auftrag`, `freigabe`, `stopp`), Schritte (7000, `partial`), Antworten (6080) – `docs/PROTOCOL.md` 34 | A | ~300 – **fertig** |
| VKb | Sandbox (= 11.5s): bubblewrap je Befehl, Grenzen, leere Umgebung, Selbstprüfung „Sandbox“ | B | ~250 |
| VKc | Knoten: Projekte, Ablauf mit Freigaben und Stopp, Commit je Schritt, nur für den Besitzer; Leak-Szenario | A | ~400, ggf. zwei Teile |
| VKd | Knoten und Protokoll: Bauen und Vorschau-Paket | A | ~300 |
| VKe | App: Projekte-Seite unter „Mein Knoten“ | C, Bausteine A | ~400 |
| VKf | App: „Als Repo in einen Raum stellen“ | A | ~200 |

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| VK-W1 | Welcher Harness? | A der eigene Ablauf (wie W3a) mit Freigaben · B Atomic Agent (B-30, „developer preview“) | **A** – ein Ablauf für eigene und fremde Knoten; Atomic Agent später als zweiter Motor |
| VK-W2 | Versionen im Projekt | A git ins Docker-Bild des Knotens (neue Abhängigkeit des Bilds, nur für eigene Projekte) · B eigener Commit-Schreiber aus 11.5a2 | **A** – Projekte sollen auch außerhalb von Freedom mit git funktionieren |
| VK-W3 | Vorschau | A über die Relays in die App (nur Web-Apps; die CSP braucht `frame-src blob:`) · B über die eigene Adresse des Knotens (auch Server-Apps; Domain oder `.onion` nötig) | **A** zuerst, B später |
| VK-W4 | Netz für eigene Projekte | A wie W6a (nur Pakete über den Knoten) · B dazu der Schalter „Internet frei“ je Projekt, nie ins Heimnetz | **B** – es ist der eigene Rechner, der Besitzer entscheidet |
| VK-W5 | Koppeln auch mit kurzem Code zum Abtippen? | A nur QR (der Code lässt sich heute auch einfügen) · B kurzer Code über ein PAKE-Verfahren (neue Kryptografie, neue Abhängigkeit) | **A** |
