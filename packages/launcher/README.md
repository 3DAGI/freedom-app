# FreedomStack Desktop (Hülle)

Dieselbe App wie im Browser – `freedom.html` – als eigenes Programm für Linux
und Windows (Karte `docs/ausbau/phase-6.md`, 6.1; Entscheidung N2 vom
07.10.2026). Gebaut mit Tauri 2 und dem Webview des Systems (WebKitGTK unter
Linux, WebView2 unter Windows).

## Was die Hülle tut – und was nicht

- Sie legt die beim Bauen erzeugte `packages/app/dist/freedom.html` bei und
  liefert sie über ein eigenes Schema aus (`freedom://localhost/`, unter Windows
  `http://freedom.localhost/`). Ein sicherer Kontext: Tresor, MLS und
  `crypto.subtle` gehen wie im Browser.
- Nur die App selbst; jeder andere Pfad ist 404. Das Fenster navigiert nie zu
  einer fremden Seite, neue Fenster werden abgelehnt.
- Die Oberfläche darf genau zwei Kommandos der Hülle rufen
  (`capabilities/oberflaeche.json`, seit 6.1a3b): den Stand ihrer Fassung
  abfragen und eine neuere Fassung installieren lassen. Sonst nichts – auch
  keine Kommandos von Tauri selbst (Fenster, App, Dateien).
- Die Hülle selbst spricht mit niemandem im Netz; das tut nur die App, mit
  denselben Regeln wie im Browser.
- Noch nicht: der Knopf „Installieren“ in der App (6.1a3c), Selbst-Update der
  Hülle (6.1a4b), Tor (6.1b), Android (6.1c).

## Neue Oberfläche installieren (seit 6.1a3b)

Die App findet ein Update über das Release-Manifest (Kind 38054) und lädt die
Datei. Installiert wird sie nur, wenn die Hülle selbst zustimmt
(`src/update.rs`): k vertraute Signierer bestätigen genau diese Datei (SHA-256,
Größe), und sie ist neuer als die laufende **und** als die abgelegte Fassung.
Vertraute Signierer und k liest `build.rs` aus der App – solange
`TRUSTED_SIGNERS` leer ist, wird nichts installiert.

Abgelegt wird im Datenverzeichnis der Hülle (`oberflaeche/`, unter Linux
`~/.local/share/io.github.3dagi.freedom/oberflaeche/`): `aktuell.*` und
`vorher.*`, je Datei und Stand. Beim Start gilt `aktuell`, wenn die Datei zu
ihrem Stand passt und neuer ist als die beigelegte – sonst die beigelegte.

Zurück geht es nur über den Start, nie aus der App (sonst könnte eine Lücke in
der Oberfläche auf eine ältere, verwundbare Fassung zurückschalten):

```bash
freedom-launcher --oberflaeche=vorher     # die vorige installierte wird wieder aktuell (dauerhaft)
freedom-launcher --oberflaeche=beigelegt  # diesmal die beigelegte, die Ablage bleibt
```

Ein Release-Bau setzt `FREEDOM_RELEASED_AT` (Unix-Sekunden der beigelegten
Fassung); ohne gilt jede bestätigte Fassung als neuer.

## Bauen

```bash
npm ci && (cd packages/app && node build.mjs)      # die App, die beigelegt wird
cd packages/launcher && cargo test --locked && cargo build --release --locked
```

Unter Linux braucht der Bau WebKitGTK 4.1 (Ubuntu 24.04:
`libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev`).
Die CI baut und testet unter Linux und Windows (`.github/workflows/launcher.yml`).

`leer/` ist nur da, weil Tauri ein `frontendDist` verlangt – die App kommt nie
von dort, sondern über das eigene Schema.

## Pakete zum Testen (seit 6.1a4a)

Jeder Lauf von `launcher.yml` baut Pakete und legt sie mit `SHA256SUMS` als
Artefakt ab (14 Tage): `freedom-desktop-Linux` (`.deb`, AppImage) und
`freedom-desktop-Windows` (Installer für den eigenen Benutzer, ohne
Administratorrechte). Zu finden unter Actions › Desktop-Hülle › Lauf ›
Artifacts. Das ist kein Release: unsigniert – Windows warnt (SmartScreen) –,
nirgends verlinkt, nur zum Testen auf Geräten. Lokal:
`cargo install tauri-cli --version "^2" --locked`, dann
`cargo tauri build --bundles deb,appimage -- --locked`.

Die Symbole in `icons/` entstehen nur aus dem Logo der App:
`python3 scripts/launcher-symbole.py` (prüfen: `--pruefen`).
