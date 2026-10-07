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
- Die Oberfläche bekommt keine Rechte der Hülle (keine Tauri-Capabilities).
- Die Hülle selbst spricht mit niemandem im Netz; das tut nur die App, mit
  denselben Regeln wie im Browser.
- Noch nicht: das Installieren einer neuen Oberfläche (6.1a3; geprüft wird sie
  seit 6.1a2), Selbst-Update der Hülle (6.1a4b), Tor (6.1b), Android (6.1c).

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
