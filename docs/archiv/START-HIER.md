# Start hier – Übergabe an Claude Code im Web

Für dich, nicht für den Agenten. Dieser Ordner ist der vollständige, aktuelle
Stand von FreedomStack (inklusive Schritt 2.1, der noch nicht veröffentlicht
ist) plus alles, was ein Agent zum Weitermachen braucht.

## Was drin ist

| Datei | Wofür |
|---|---|
| `CLAUDE.md` | Anweisungen für den Agenten – Claude Code liest sie automatisch |
| `docs/ausbau/UEBERSICHT.md` | das Projekt, die Ziele, der bisherige Weg |
| `docs/ausbau/FORTSCHRITT.md` | alle Schritte mit Stand und empfohlener Reihenfolge |
| `docs/ausbau/phase-0.md` … `phase-9.md` | Aufgabenkarten |
| `docs/ausbau/VORLAGEN.md` | Aufträge zum Einfügen, Berichtsvorlage |

## 1. GitHub-Repository vorbereiten

Claude Code im Web arbeitet mit einem GitHub-Repository: Es klont es in eine
Cloud-Umgebung, ändert den Code und schiebt einen Branch zur Prüfung.

**Weg A (empfohlen, die Adresse der Seite bleibt gleich):** Den Quellcode in
`3dagi/freedom-app` legen und die Seite von GitHub Actions bauen lassen.

1. In `3dagi/freedom-app` unter Settings → Pages als Quelle „GitHub Actions“ wählen.
2. Den Inhalt dieses Ordners in den Branch `main` von `3dagi/freedom-app`
   übernehmen (er ersetzt die bisher von Hand hochgeladenen Dateien).
3. Ab jetzt baut `.github/workflows/pages.yml` die Seite bei jedem Merge nach
   `main` – nur wenn die Tests grün sind.

Folge: Der Quellcode ist öffentlich. Das ist im Ausbauplan ohnehin vorgesehen
(Schritt 0.D), aber deine Entscheidung.

**Weg B:** ein neues privates Repository für den Quellcode. Dann bleibt das
Veröffentlichen wie bisher Handarbeit (Website bauen, Dateien nach
`3dagi/freedom-app` kopieren).

## 2. Claude Code im Web einrichten

1. Auf claude.ai/code anmelden, GitHub verbinden (Claude GitHub App) und dem
   Repository Zugriff geben.
2. Eine Umgebung anlegen. Der Netzwerkzugriff muss npm-Pakete erlauben, sonst
   laufen die Tests nicht. Für den Smoke-Test braucht es Playwright mit
   Chromium; klappt die Installation in der Cloud nicht, machst du den
   Smoke-Test lokal.
3. Die erste Aufgabe starten – der Text steht in `docs/ausbau/VORLAGEN.md`.

## 3. Arbeitsrhythmus

- Pro Sitzung ein Schritt. Der Agent endet mit einem Pull Request; der Bericht
  steht in der Beschreibung.
- Du prüfst den Bericht, mergst, bei Weg A wird die Seite automatisch
  veröffentlicht.
- Schritt 1.0 (`app.ts` aufteilen) früh erledigen: `app.ts` hat fast 6.000
  Zeilen, und jeder spätere Schritt wird dadurch kleiner und günstiger.

## 4. Was nur du machen kannst

Der Agent hält an und fragt im Pull Request, wenn eines davon dran ist:

- Programm-ID des Solana-Programms klären (0.G) – zwei Befehle, dann Entscheidung
- Signierschlüssel offline erzeugen (0.D)
- Interop-Test der Direktnachrichten mit Amethyst oder 0xchat (2.1)
- Phantom-Abgleich der Solana-Ableitung (1.1)
- Entscheidungen: MLS-Bibliothek (2.2a), Gebührenmodell (4.0)
- Tests mit Geräten, Wallets, Funkgeräten; Audits; Rechtsfragen (Phase 9)
