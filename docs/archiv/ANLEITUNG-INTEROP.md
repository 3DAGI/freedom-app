# Interop-Test für Schritt 2.1 (NIP-17) – Anleitung für den lokalen Agenten

**Ziel:** Belegen, dass die Direktnachrichten von FreedomStack mit anderen
NIP-17-Clients funktionieren – in beide Richtungen, über echte Relays und durch
die echte Oberfläche der App.

**Die Gegenstelle** ist bewusst unabhängig von FreedomStack: `nostr-tools`, die
Bibliothek, auf der viele Nostr-Clients aufbauen. Sie spielt zwei fremde
Clients – Bot B antwortet auf jede Nachricht, Fremder C schreibt die App einmal
von sich aus an.

**Bei Claude schon gelaufen** (ohne Internet, mit lokalem Relay):

| Test | Ergebnis |
|---|---|
| Bibliothek, beide Richtungen, inkl. Betreff, Antwortbezug und Selbstkopien | 5 von 5 grün |
| Oberfläche: App → Bot B, Antwort B → App, Anfrage von C | bestanden, keine Skriptfehler |
| alle Protokoll-Tests | 934 grün, 5 übersprungen, 0 rot |

**Deine Aufgabe:** dasselbe auf dem echten Rechner wiederholen und zusätzlich
über öffentliche Relays testen – das konnte Claude nicht.

## Regeln

- Nur Wegwerf-Schlüssel – das Skript erzeugt sie selbst. Nie eine echte Identität verwenden.
- Der Test verschickt drei Nachrichten. Nicht in Schleifen wiederholen.
- **Kein App-Code ändern.** Schlägt ein Test fehl: STOPP und berichten.
- Danach `/tmp/nip17-interop` löschen – dort liegt ein Test-Schlüssel.

## Schritt 1 – Voraussetzungen

```bash
git status                                                  # sauber, sonst STOPP
grep -c "buildPrivateDm" packages/app/src/shell/tabs/kommunikation.ts   # mindestens 1 = Schritt 2.1 ist drin
node --version                                              # 20 oder neuer
pip install playwright && python3 -m playwright install chromium   # einmalig
```

Ist `buildPrivateDm` 0: STOPP – erst Schritt 2.1 übernehmen (Patch
`freedomstack-2.1.patch` oder das Übergabe-ZIP).

## Schritt 2 – Patch übernehmen

```bash
git checkout -b test/interop-2.1
git am -3 agent/patch/freedomstack-interop-2.1.patch
npm ci
```

Der Patch fügt hinzu: `nostr-tools` als Test-Abhängigkeit des Protokoll-Pakets,
`packages/protocol/test/nip17-interop.test.ts`, `scripts/interop/nip17-bot.mjs`
und `scripts/interop/nip17_ui_test.py`. App-Code ändert er nicht.

## Schritt 3 – Bibliotheks-Test und alle Tests

```bash
cd packages/protocol && node --import tsx --test test/nip17-interop.test.ts && cd ../..
cd packages/protocol && npm test && cd ../..
cd packages/app && npm test && node build.mjs && cd ../..
```

Erwartung: Interop 5 von 5 grün; protocol 934 grün (5 übersprungen); app 167 grün.

## Schritt 4 – Oberfläche mit lokalem Relay

Zwei Terminals, beide im Wurzelverzeichnis:

```bash
# Terminal 1 – lokales Relay und Gegenstelle (läuft 240 Sekunden)
rm -rf /tmp/nip17-interop
node scripts/interop/nip17-bot.mjs
```

```bash
# Terminal 2 – die App im Headless-Browser
python3 scripts/interop/nip17_ui_test.py packages/app/dist
```

Erwartung in `/tmp/nip17-interop/ergebnis.json`:
`schritt1_b_empfangen`, `schritt2_antwort_in_app`, `keine_alt_markierung`,
`schritt3_anfrage_sichtbar` alle `true`, `pageerrors` leer, `"bestanden": true`.
Das Bildschirmfoto `ui.png` zeigt die Unterhaltung mit B und die „Anfrage“ von C.

## Schritt 5 – Live über öffentliche Relays

```bash
# Terminal 1
rm -rf /tmp/nip17-interop
node scripts/interop/nip17-bot.mjs --relays wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net
```

```bash
# Terminal 2
python3 scripts/interop/nip17_ui_test.py packages/app/dist
```

Erwartung wie in Schritt 4. Scheitert es: einmal wiederholen. Scheitert es
wieder, `status.json` (Feld `fehler`) und `ergebnis.json` in den Bericht und mit
anderen Relays versuchen, etwa `wss://relay.snort.social` oder
`wss://offchain.pub`. Manche Relays verlangen für Kind 1059 eine Anmeldung
(NIP-42) – das ist dann eine Eigenschaft des Relays, kein Fehler der App.
Notiere, welche Relays funktionieren und welche nicht.

## Schritt 6 – Aufräumen und abliefern

```bash
rm -rf /tmp/nip17-interop
```

- Hat das Repository `docs/ausbau/FORTSCHRITT.md`: Schritt 2.1 auf „fertig“
  setzen und in die Notiz „Interop mit nostr-tools belegt (lokal und live)“
  schreiben. Einen kurzen Abschnitt in `STATUS.md` ergänzen.
- Liegt das Repository auf GitHub: Branch pushen und einen Pull Request mit dem
  Bericht öffnen. Sonst: `git format-patch main --stdout > interop-2.1.patch`.

## Schritt 7 (optional, MENSCH, 5 Minuten) – Stichprobe mit einer Handy-App

Die Tests oben ersetzen den Handy-Test weitgehend. Wer ganz sicher gehen will:
FreedomStack in einem frischen Browserprofil mit neuer Identität öffnen,
Amethyst oder 0xchat mit einem Test-Konto, einmal hin und zurück schreiben.

## Bericht

```markdown
## Bericht Interop 2.1
- Patch sauber übernommen: ja/nein
- Bibliothek (nip17-interop.test.ts): x von 5 grün
- Alle Tests: protocol … · app …
- Oberfläche, lokales Relay: bestanden ja/nein (ergebnis.json anhängen)
- Oberfläche, öffentliche Relays: bestanden ja/nein; funktionierende Relays: …; nicht funktionierende: … (mit Fehlermeldung)
- Aufgeräumt (/tmp/nip17-interop gelöscht): ja/nein
- Pull Request oder Patch: …
```
