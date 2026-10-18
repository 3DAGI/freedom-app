# Entwurf: Atomic Agent als Agent-Harness (B-30)

Stand 15.10.2026, Spur B. Sammlung B-30 (Anhang E), Entscheidung AG1 A vom 09.10.2026: eigene Wege
(Dieses Gerät, Mein Knoten, eigener Agent aus 11.3c/d) mit Gedächtnis; Aufträge Fremder nur flüchtig.
Seit dem 14.10. gilt außerdem VK-W1n C: Der Knoten ist ACP-Client, Hermes ist der erste Motor (VKc2 ✓,
VKc3 offen). Dieser Entwurf prüft, wie Atomic Agent dazu passt, und stellt die Fragen W1–W4. Gebaut
wird erst nach Freigabe.

## Befunde (Quelle: README und `package.json` im Repository, Commit `7899d17`, gelesen 15.10.2026)

| Punkt | Befund |
|---|---|
| Lizenz | MIT – mit EUPL-1.2 verträglich. |
| Laufzeit | Node **≥ 25.7** – der Knoten läuft auf Node 22 (`.nvmrc`). Atomic Agent bräuchte eine zweite Node-Laufzeit im Bild. |
| Abhängigkeiten | 31 direkte, darunter `@modelcontextprotocol/sdk`, `playwright-core`, `better-sqlite3` (nativ), `grammy` (Telegram), `posthog-node` (Analyse), React/Ink (TUI). |
| Schnittstellen | TUI und CLI, `atomic-agent serve` (OpenAI-kompatibel, `POST /v1/chat/completions` = eine ganze Runde mit Werkzeugen), ein Sidecar mit NDJSON über stdio (eigenes Format). **Kein ACP** – nicht über `CodeLaeufe` (VKc2) anschließbar, ohne ein eigenes Gegenstück zu bauen. |
| Werkzeuge | Browser, Dateien, Shell und git mit Freigaben, MCP-Client, Skills (auch aus ClawHub), Fusion (Arbeiter-Pool), Telegram/Discord, Composio (1500 SaaS über deren Server), eigenes Postfach `@atomicmail.ai`, GitHub mit Token. |
| Gedächtnis | Sitzungen, Notizen (SQLite + FTS5), Aufgaben, Spuren als Dateien unter `<stateDir>` – passt zu AG1 A für eigene Wege. |
| **Datenschutz** | **Analyse (PostHog) und Absturzberichte (Sentry) sind standardmäßig an**, mit einer Installations-Kennung; dazu Update-Prüfung bei GitHub beim Start. Das widerspricht „ohne Betreiber“ – nur mit allem abgeschaltet und ohne Netz denkbar. |

## Einordnung

- Für **Code-Läufe auf dem eigenen Knoten** ist Hermes über ACP gewählt (VK-W1n C) – mit Freigaben,
  Schritten und Stopp aus VKa. Atomic Agent spricht kein ACP; ein zweiter Motor dafür bräuchte ein eigenes
  Gegenstück (Sidecar-Format) und brächte wenig, was Hermes nicht schon kann.
- Für **„Dieses Gerät“** (B-1) läuft im Browser kein Node – dort bleibt es bei OpenAI-kompatiblen lokalen
  Servern (Ollama, llama.cpp, LM Studio). `atomic-agent serve` wäre so ein Server, mit eigenem Werkzeug-Kreis
  auf dem Rechner des Nutzers – außerhalb jeder Sandbox von Freedom.
- Für **Aufträge Fremder** (Provider, 11.5c) passt es nicht: Gedächtnis auf der Platte, viele Netzwege,
  Analyse an; dort bleibt der eigene, flüchtige Ablauf (W3a A).

## Vorschläge

- **V1 – Nicht als Motor im Knoten**, solange Hermes über ACP der Weg ist (VK-W1n C).
- **V2 – Als lokaler Server „Dieses Gerät“ zulassen, wenn der Nutzer ihn selbst betreibt:** Die App spricht
  ihn wie jeden OpenAI-kompatiblen Server an (`lokaleKiAdresse()`, nur dieser Rechner). Ein Hinweis in den
  Settings nennt ehrlich, was Atomic Agent selbst tut (Werkzeuge auf dem Rechner, Analyse an, bis man sie
  abschaltet) – Freedom installiert und steuert ihn nicht.
- **V3 – Falls doch im Knoten (W1 B):** nur in der Sandbox (VKb, 11.5s2), ohne Netz außer der Brücke zum
  Modell (VKc3), Analyse, Absturzberichte und Update-Prüfung aus, keine Integrationen (Telegram, Composio,
  Postfach, GitHub), eigene Node-Laufzeit gepinnt; Gedächtnis nur je Projekt, nie für Aufträge Fremder.

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| W1 | Atomic Agent im Knoten? | A nein, Hermes über ACP bleibt der Motor (V1) · B als zweiter Motor in der Sandbox (V3, eigenes Gegenstück zum Sidecar, zweite Node-Laufzeit) | **A** |
| W2 | Für „Dieses Gerät“? | A wie jeder lokale OpenAI-Server, mit ehrlichem Hinweis (V2) · B gar nicht erwähnen | **A** |
| W3 | Analyse und Absturzberichte | A nur mit abgeschalteter Analyse empfehlen (Hinweis nennt den Schalter) · B gar nicht empfehlen, solange Analyse standardmäßig an ist | **A** |
| W4 | AG1 neu fassen? | A AG1 A gilt weiter für „eigene Wege“, umgesetzt über V2 · B B-30 schließen | **A** |

## Entscheidungen vom 18.10.2026 (MENSCH)

W1 **A** (nicht als Motor im Knoten, Hermes bleibt), W2 **A** (unter „Dieses Gerät“ wie jeder lokale Server, mit ehrlichem Hinweis), W3 **A** (nur mit abgeschalteter Analyse empfehlen, der Hinweis nennt den Schalter), W4 **A** (B-30 bleibt, umgesetzt über V2 als B-30a). Quelle: Entscheidungsvorlage Spur B (Seite „Entscheidungen Spur B“, 18.10.2026), Antworten ohne Notizen.

## Aufteilung (nach Freigabe, Empfehlung)

| Schritt | Inhalt | Umfang |
|---|---|---|
| B-30a | App: Atomic Agent als Vorlage unter „Dieses Gerät“ (Adresse `127.0.0.1:8787`, Schlüssel aus `--api-key`), Hinweis zu Werkzeugen und Analyse in beiden Sprachen | ~150 |

## Quellen

- [AtomicBot-ai/atomic-agent](https://github.com/AtomicBot-ai/atomic-agent) – README (Abschnitte „OpenAI-compatible HTTP“, „Tauri sidecar“, „Privacy and Egress“), `LICENSE`, `package.json`
- Verzeichniseinträge: [EveryDev](https://www.everydev.ai/tools/atomic-agent), [Enterprise DNA](https://enterprisedna.co/directories/open-source/atomic-agent)
