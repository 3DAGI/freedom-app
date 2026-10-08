# FreedomStack als App (Hülle)

Dieselbe App wie im Browser – `freedom.html` – als eigenes Programm für Linux,
Windows und seit 6.1c Android (Karte `docs/ausbau/phase-6.md`, 6.1; Entscheidung
N2 vom 07.10.2026). Gebaut mit Tauri 2 und dem Webview des Systems (WebKitGTK
unter Linux, WebView2 unter Windows, System-WebView unter Android). Die Hülle
steht in `src/lib.rs`; Desktop startet sie aus `src/main.rs`, Android aus der
Activity.

## Was die Hülle tut – und was nicht

- Sie legt die beim Bauen erzeugte `packages/app/dist/freedom.html` bei und
  liefert sie über ein eigenes Schema aus (`freedom://localhost/`, unter Windows
  und Android `http://freedom.localhost/`). Ein sicherer Kontext: Tresor, MLS und
  `crypto.subtle` gehen wie im Browser.
- Nur die App selbst; jeder andere Pfad ist 404. Das Fenster navigiert nie zu
  einer fremden Seite, neue Fenster werden abgelehnt.
- Die Oberfläche darf genau zwei Kommandos der Hülle rufen
  (`capabilities/oberflaeche.json`, seit 6.1a3b): den Stand ihrer Fassung
  abfragen und eine neuere Fassung installieren lassen. Sonst nichts – auch
  keine Kommandos von Tauri selbst (Fenster, App, Dateien).
- Die Hülle selbst spricht mit niemandem im Netz; das tut nur die App, mit
  denselben Regeln wie im Browser.
- Noch nicht: Selbst-Update der Hülle (6.1a4b), Tor (6.1b), ein Android-Paket mit
  festem Schlüssel (6.1c2).
- Unter Linux geht „App exportieren“ (Weitergeben) in der Hülle nicht: Die CSP der
  App lässt kein `fetch` auf `freedom://` zu (Entscheidung H1 in der Sammlung).

## Neue Oberfläche installieren (seit 6.1a3b)

Die App findet ein Update über das Release-Manifest (Kind 38054): Settings ›
Echtheit nennt in der Hülle die laufende Fassung und bietet „Version …
installieren“ an (seit 6.1a3c). Die App lädt die Datei von einer https-Quelle des
Manifests, prüft Größe und Prüfsumme und fragt nach. Installiert wird sie nur,
wenn die Hülle selbst zustimmt
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

## Android (seit 6.1c1)

- Paketname `io.github.threedagi.freedom` (`tauri.android.conf.json`): Ein Teil
  eines Android-Pakets darf nicht mit einer Ziffer beginnen – Desktop behält
  `io.github.3dagi.freedom` (dort hängen Datenverzeichnis und Webview-Speicher daran).
- Android kennt keine Startargumente. Installierte Oberflächen liegen deshalb im
  Cache der App: „Cache leeren“ in den Einstellungen von Android führt zur
  beigelegten Fassung zurück; Tresor und Verläufe liegen bei den Daten des Webviews
  und bleiben.
- Das Projekt unter `gen/android` wird nicht eingecheckt, sondern je Lauf erzeugt
  (`cargo tauri android init`); `scripts/launcher-symbole.py --android` setzt danach
  die Symbole aus dem Logo ein.
- Die CI (`launcher.yml`, Job „Android-APK bauen“) legt
  `freedom-android-arm64-test.apk` mit `SHA256SUMS` als Artefakt ab (14 Tage),
  signiert mit einem Wegwerf-Schlüssel, der nur in diesem Lauf entsteht. Deshalb
  geht ein Update von einem Lauf auf den nächsten nur nach dem Deinstallieren –
  dabei sind die Daten der App weg. Zum Testen, kein Release; ein fester Schlüssel
  ist eine Aufgabe für den MENSCHEN (6.1c2).

Lokal (Android-SDK mit Plattform 36, Build-Tools, NDK r27d; Java 17 oder neuer):

```bash
export ANDROID_HOME=… NDK_HOME=$ANDROID_HOME/ndk/27.3.13750724
cd packages/launcher && cargo tauri android init --ci
python3 ../../scripts/launcher-symbole.py --android
cargo tauri android build --apk --target aarch64
```

