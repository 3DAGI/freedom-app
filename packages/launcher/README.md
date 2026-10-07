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
- Noch nicht: Selbst-Update der Oberfläche über das Release-Manifest (6.1a2,
  6.1a3), Pakete zum Herunterladen (6.1a4), Tor (6.1b), Android (6.1c).

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

Die Symbole in `icons/` entstehen nur aus dem Logo der App:
`python3 scripts/launcher-symbole.py` (prüfen: `--pruefen`).
