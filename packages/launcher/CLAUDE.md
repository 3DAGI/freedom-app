# Hülle (`packages/launcher`) – Fallstricke

Ergänzt die `CLAUDE.md` in der Wurzel (Projekt, Befehle, Regeln, Fallstricke für
mehrere Pakete). Claude Code lädt diese Datei, sobald eine Datei unter
`packages/launcher/` gelesen wird. Hier steht, was man nur in der Hülle (Tauri, Rust)
falsch macht – verschoben aus der Wurzel mit C-22b (09.10.2026), wörtlich. Ein Eintrag
mit „Weitere Teile“ geht in der Wurzel oder einem anderen Bereich weiter. Neue
Fallstricke dieses Bereichs unten anhängen.

## Fallstricke

- **Desktop-Hülle nur über das eigene Schema** (seit 6.1a1, `packages/launcher`):
  Die App kommt nur über `freedom://localhost/` (Windows `http://freedom.localhost/`)
  aus `oberflaeche::antwort()` – immer derselbe Ursprung, sonst sind Tresor und
  Verläufe nach einem Update weg; nie über `tauri://` oder eine Datei-Adresse.
  Ausgeliefert wird nur `freedom.html` (sonst 404, auch keine `freedom-spiegel.json`
  – die Hülle ist kein Spiegel; einzige Ausnahme seit 6.1b2a: die feste Warteseite `/tor`
  unter Android, ohne Skript). Navigation nur über `darf_navigieren()` (eigener
  Ursprung, Blob-Adressen dieses Ursprungs), neue Fenster `Deny`; die Oberfläche darf
  nur die Kommandos aus `capabilities/oberflaeche.json` (seit 6.1a3b zwei) – ein neues
  Kommando nur über das App-Manifest in `build.rs` und mit eigener Erlaubnis dort,
  nie `core:default` oder Rechte von Tauri selbst. `window.__FREEDOM_NATIVE__` setzt nur
  `kennung_skript()`. `build.rs` bricht ohne gebaute App ab; Symbole nur über
  `scripts/launcher-symbole.py`. Unter Xvfb prüfen (`xvfb-run`): die Hülle startet,
  `isSecureContext` und `crypto.subtle` sind wahr – ein Prüf-Skript nur lokal, nie
  einchecken.
  Abgelegt (seit 6.1a3b) nur über `Ablage::installiere()` (`ablage.rs`: erst `neu.*`
  ganz schreiben, dann umbenennen; geladen nur, wenn die Datei zum Stand passt),
  installiert nur über `Oberflaeche::installiere()` – nie älter als die laufende und
  die abgelegte Fassung, eine neuere beigelegte schlägt eine ältere installierte.
  Zurück nur über den Start (`--oberflaeche=vorher|beigelegt`), nie ein Kommando dafür.
  Android (seit 6.1c1): dieselbe Hülle aus `src/lib.rs` (`run()`), Paketname nur über
  `tauri.android.conf.json` (`io.github.threedagi.freedom` – Desktop behält seine Kennung,
  sonst sind dort Tresor und Verläufe weg). Ablage im Cache (`ablageordner()`): ohne
  Startargumente ist „Cache leeren“ der Rückweg. `gen/android` nie einchecken – die CI
  erzeugt es je Lauf, Symbole nur über `launcher-symbole.py --android`. Das Test-APK
  signiert ein Wegwerf-Schlüssel je Lauf; einen festen Schlüssel legt nur der MENSCH an.
  Maven Central antwortet in dieser Umgebung über den Proxy oft mit 429 – lokal ein
  Gradle-Init-Skript mit Googles Spiegel (`maven-central.storage-download.googleapis.com`),
  nie ins Repo.
  Tor in der Desktop-Hülle (seit 6.1b1a, TOR1 A) nur über arti hinter dem SOCKS5-Zugang aus
  `tor.rs` (nur 127.0.0.1, nur CONNECT, Namen nie lokal auflösen) und nur als Proxy des
  eigenen Fensters (`Netz::proxy()`); mit „Tor“ immer ein Proxy, nie still direkt. Die Wahl
  nur über `netz.json` (`schreibe_wahl()`), gilt ab dem Start. rustls braucht den
  festgelegten Anbieter (`ring`, `install_default()`) – sonst bricht arti beim Start ab.
  Das Release wickelt ab (seit 6.1b3): nie `panic = "abort"` im Profil – sonst wirken
  `catch_unwind` und `melde_ende()` um arti nicht, `netz.rs` bricht den Build dann ab.
  Prüfen unter Xvfb mit `strace -f -Y -e trace=connect` (WebKit-Sandbox dafür lokal aus:
  `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`): WebKit nur zu 127.0.0.1. Ins Tor-Netz kommt
  arti in dieser Umgebung nicht – Live-Tests macht der MENSCH.
  Kamera und Mikrofon (seit 6.1d) nur über `erlaubnis.rs` (`on_permission_request`): nur die
  eigene Oberfläche (`darf_navigieren()`), unter Linux erlaubt (WebKitGTK lehnt sonst still ab),
  sonst `Default` (Windows und Android fragen selbst); das Manifest bekommt die Rechte nur über
  `scripts/android-rechte.py` nach `tauri android init` – die CI prüft sie im APK.
  Unter Android (seit 6.1b2a) setzt die Hülle den Proxy nur über `android_tor.rs` (JNI,
  androidx.webkit `ProxyController`, Regel `http://127.0.0.1:<port>` – HTTP CONNECT; `socks://` hieße in
  Chromium SOCKS4, dann löste das WebView Namen selbst auf); mit Tor lädt die App erst nach dem Proxy, bis
  dahin die Warteseite – nie die App ohne Proxy. Klassen aus androidx nur über `find_class()`
  (wry, Lader der Activity); offene Java-Ausnahmen vor dem nächsten JNI-Aufruf löschen
  (`raeume_auf()`). „Neu starten“ heißt unter Android: die App schließt sich. Was nur JNI ruft,
  entfernt R8 aus dem Release-APK – Keep-Regel `proguard-tor.pro` (die CI kopiert sie nach
  `gen/android/app/` und prüft die Klassen im APK); Signaturen gegen `dexdump` prüfen.
  *(Weitere Teile: Wurzel (`CLAUDE.md`), `packages/app/CLAUDE.md`.)*
