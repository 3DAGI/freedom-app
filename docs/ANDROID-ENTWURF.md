# Entwurf: Android-Apps bauen und im Bild zeigen (VKh)

Stand 04.11.2026, Spur B. Ausgangspunkt ist `docs/VIBECODEN-ENTWURF.md`, Zeile VKh: „Android: redroid und scrcpy in der
Sandbox, APKs bauen (arm64-`aapt2` oder FEX)“. Dazu gehört VK-W8 **A** (14.10.2026): erst Web und Linux, dann Android, dann
Windows. Web und Linux sind fertig (VKg2, VKk3–VKk4), Windows auch (VKi). Dieser Entwurf hält Befunde und Fragen fest.
**Entschieden am 04.11.2026** (Abschnitt „Entscheidungen“). Gebaut wurde erst nach der Freigabe, aus drei Gründen:
- Jeder Weg bringt neue Abhängigkeiten.
- Einer davon bräuchte Rechte, die keine Sandbox des Knotens heute hat.
- Der Bau der Apps braucht einen neuen Weg nach draußen.

## Ausgangslage

- **Bildstrom** (VKg2, `bildstrom.ts`): zwei Sandboxen mit bubblewrap. Die Bild-Sandbox hat Xvfb, GStreamer und den Tunnel
  zum eigenen TURN. Die Sandbox des Programms hat weder Netz noch Rechte; sie teilt mit der Bild-Sandbox nur
  `/tmp/.X11-unix`. Was dort laufen soll, braucht nur einen X11-Bildschirm (Godot, Wine, OpenSCAD, KiCad, Blender,
  LibreOffice, Inkscape, GIMP). Neu laden heißt neu starten (`neustartSchleife()`).
- **Der Motor** (Hermes) arbeitet in der Sandbox ohne Netz. Pakete bekommt er nur über den Spiegel der Brücke (VKd3), und
  der kennt nur npm und PyPI, jeweils nur `GET`.
- **Der GX10** ist ARM64 (Grace, DGX OS auf Basis von Ubuntu 24.04). Ob `/dev/kvm` und das Kernel-Modul `binder` dort
  vorhanden sind, ist ungeprüft.
- **Werkbank** (VKj, Entwurf der Spur A): Weitere eigene Rechner sollen Programme bedienen, die es für ARM64 nicht gibt.
  Eine der Fragen dort ist VKj-W4 C, „Android Studio auf x86-Linux“.
- **Das Handy des Nutzers** ist selbst ein Android-Gerät. Ein APK, das dort läuft, zeigt mehr als jede Nachbildung: echte
  Sensoren, echte Berührung, echte Leistung.

## Befunde

**Android laufen lassen**

| Weg | Was es ist | Was es braucht | Grenze zum Rechner |
|---|---|---|---|
| **redroid** (Apache-2.0, Kernel-Module GPL-2.0) | Android 8.1–16 als Container, arm64 und amd64 | `docker run --privileged`, `binder_linux` mit `binder,hwbinder,vndbinder` (aus `linux-modules-extra`), `ashmem` (wird durch memfd ersetzt). Bild über adb und scrcpy | ein **privilegierter** Container: Bricht eine App aus Android aus, ist sie root auf dem Rechner |
| **Waydroid** | Android in LXC | `binder` wie redroid, LXC mit Rechten, ein Wayland-Compositor (in X11 verschachtelt: weston) | wie redroid |
| **Cuttlefish** (Google, AOSP) | Android als VM (crosvm, wahlweise QEMU) mit KVM; Hosts Linux x86 und arm64 | `/dev/kvm`, Pakete `cuttlefish-base` und `cuttlefish-user` aus Googles apt-Registry, Gruppen `kvm`, `cvdnetwork`, `render`; Abbilder aus `ci.android.com` (`aosp_cf_arm64_only_phone`). Bild über WebRTC oder VNC (`--start_vnc_server`, Port ab 6444) | eine **VM** – eine App müsste aus Android und aus KVM ausbrechen |
| **Android-Emulator** (Google) | QEMU-basiert, mit KVM | für Linux ARM64 **kein fertiger Build**. Nur ein Bau aus den Quellen ist beschrieben (2020, nur SwiftShader, ohne Snapshots). Auf x86-Linux läuft er voll | VM; auf dem GX10 nicht verfügbar, auf einer x86-Werkbank schon (VKj) |

- **redroid ruht vermutlich.** Fremde Übersichten nennen den letzten Push am Doku-Repo 2024 bzw. 2025. Die neueste
  Fassung ist Android 16.
- **Cuttlefish passt nicht in unsere Sandbox.**
  - Es startet eigene Dienste und richtet ein virtuelles Netz ein (`cvdnetwork`).
  - Als eigener Dienst neben dem Knoten wäre es eher wie coturn oder LiveKit: Die Sandbox des Programms bekäme nur einen
    Socket, etwa für VNC oder adb.
  - Ob Cuttlefish ohne Netz in der VM startet, ist ungeprüft.
- **scrcpy** (Apache-2.0) zeigt den Bildschirm eines Android-Geräts über adb in einem X11-Fenster. Damit passt es in die
  Sandbox des Programms.
  - In Debian 12 gibt es scrcpy nur über `bookworm-backports` (3.3.4, contrib).
  - Der Teil `scrcpy-server` läuft im Gerät.

**Apps bauen**

- **Gradle und das Android-SDK** (Plattform, Build-Tools) kommen von Google.
  - Sie stehen unter dem Lizenzvertrag des SDK, nicht unter einer freien Lizenz.
  - Laden nur beim Bau des Bilds auf dem eigenen Rechner. Ein fertiges Bild mit SDK darf niemand weitergeben.
- **`aapt2` gibt es von Google nur für x86-64.**
  - Ab Android Gradle Plugin 9 holt Gradle es selbst aus Maven (`com.android.tools.build:aapt2:…:linux`, x86-64). Der
    Umweg dafür ist `android.aapt2FromMavenOverride`.
  - Für ARM64 gibt es nur Gemeinschafts-Builds: `Commit451/android-arm-build-tools` und `hamza72x/android-sdk-linux-arm64`
    (aus AOSP-Quellen). Beides wären fremde Programme.
  - Ebenso möglich: selbst aus AOSP bauen, wie `whisper-cli` und die Tor-Brücken.
  - Oder FEX für x86-Programme. Das Bild hat FEX nur innerhalb von Hangover für Wine; ein FEX für Linux-Programme wäre neu.
  - Debian hat für ARM64 nur `aapt` (Fassung 1), kein `aapt2`.
- **Gradle lädt Bibliotheken aus Maven** (Google Maven, Maven Central).
  - In der Sandbox ohne Netz geht das nur über einen weiteren Weg im Spiegel der Brücke, nach denselben Regeln wie npm und
    PyPI.
  - Das ist eine eigene Entscheidung (VK-W4 B, „Internet frei“, ist nicht gefallen).
  - Ohne Maven gehen nur Apps ohne Bibliotheken: `aapt2`, `d8` und `apksigner` direkt, ohne Kotlin-Bibliotheken und ohne
    Compose.
- **Das APK zum Handy:**
  - Die Vorschau (VKg1) liefert schon jede Datei des Projekts aus, auch ein APK (`application/octet-stream`), nur mit dem
    Zeichen des Projekts. Das geht, soweit die Vorschau erreichbar ist (`VORSCHAU_URL`: Heimnetz, Domain oder `.onion`).
  - Außerhalb davon bräuchte es einen versiegelten Weg, etwa über das Blob-Netz wie die Bundles (VKl).

## Vorschlag

1. **Erst bauen, laufen lassen auf dem eigenen Handy.**
   - Der Motor baut das APK im Terminal; der Nutzer lädt es über die Vorschau und installiert es selbst.
   - Kein privilegierter Dienst, keine neue Fähigkeit für die Sandbox – und das echte Gerät ist die beste Vorschau.
2. **Danach Android im Bild – nur als VM** (Cuttlefish) und nur, wenn der GX10 KVM hat.
   - Cuttlefish läuft als eigener Dienst neben dem Knoten, ohne Netz für die VM.
   - Die Sandbox des Programms bekommt nur einen Socket (VNC oder adb) und zeigt das Bild mit einem Viewer bzw. scrcpy auf
     ihrem Bildschirm.
   - Das APK installiert der Knoten über adb, nach jeder Änderung neu – wie die Schleife der anderen Programme.
3. **redroid nicht.** Code des Agenten in einem privilegierten Container widerspricht der Sandbox, die alles andere trägt.
4. **Wer Android Studio und den offiziellen Emulator will,** bekommt sie über eine x86-Werkbank (VKj), nicht auf dem GX10.

## Fragen an den MENSCHEN

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| VKh-W1 | Wie laufen Android-Apps? | **A** Cuttlefish als VM (KVM), eigener Dienst, Bild über VNC oder scrcpy im Bildstrom · **B** redroid (privilegierter Container, binder) · **C** erst nur bauen, laufen lassen auf dem eigenen Handy (APK über die Vorschau) · **D** über eine x86-Werkbank mit dem offiziellen Emulator (VKj) | **C** zuerst, danach **A**, wenn die Probe am GX10 KVM zeigt. B nicht: fremder Code in einem privilegierten Container |
| VKh-W2 | Woher kommt `aapt2` für ARM64? | **A** selbst aus AOSP-Quellen bauen (Skript mit fester Fassung und `--pruefen`, wie `whisper-bauen.sh`) · **B** Gemeinschafts-Build mit fester Prüfsumme (`hamza72x/android-sdk-linux-arm64`) · **C** FEX für x86-Programme (neues Paket im Bild) · **D** Android nur auf x86-Knoten bauen | **A** – wie whisper-cli und die Tor-Brücken: nur, was wir selbst aus den Quellen gebaut haben, läuft in der Sandbox |
| VKh-W3 | Woher holt Gradle Bibliotheken? | **A** Maven über den Spiegel der Brücke (nur `GET`, nur Google Maven und Maven Central, nur Archive und POMs) · **B** ein Gradle-Cache mit festen Fassungen, gefüllt beim Bau des Bilds · **C** kein Gradle-Bau mit Bibliotheken, nur `aapt2`, `d8` und `apksigner` direkt | **A** – dieselben Regeln wie npm und PyPI (VKd3). Ohne Maven gehen weder Kotlin-Bibliotheken noch Compose |
| VKh-W4 | Wie kommt das APK aufs Handy? | **A** über die Vorschau (gibt es schon, soweit sie erreichbar ist) · **B** versiegelt über das Blob-Netz wie die Bundles (VKl), überall · **C** beides | **A** jetzt, **B**, wenn die Vorschau von unterwegs nicht reicht |

## Entscheidungen vom 04.11.2026 (MENSCH: „wie empfohlen“)

- **VKh-W1 C, danach A:** erst bauen und auf dem eigenen Handy laufen lassen; Cuttlefish als VM, sobald die Probe am GX10 KVM
  zeigt. redroid nicht.
- **VKh-W2 A:** `aapt2` für ARM64 selbst aus den AOSP-Quellen, mit fester Fassung und `--pruefen`.
- **VKh-W3 A:** Maven über den Spiegel der Brücke – nur `GET`, nur Google Maven und Maven Central.
- **VKh-W4 A:** das APK über die Vorschau; das Blob-Netz erst, wenn die Vorschau von unterwegs nicht reicht.

## Aufteilung (nach den Entscheidungen)

Maven kommt zuerst: Ohne Maven lädt Gradle nicht einmal das Android-Plugin.

| Teil | Inhalt | Umfang |
|---|---|---|
| VKh1 ✓ | Maven über den Spiegel der Brücke (W3 A): `/maven/google/…` und `/maven/central/…`, nur Archive, POMs, Gradle-Metadaten und Prüfsummen, als Strom; Init-Skript für Gradle im Home des Motors (Plugin-Portal → Maven Central); Java in der Sandbox (`/etc/java-<N>-openjdk`). Echttest mit Gradle in der Sandbox | ~400 |
| VKh2a ✓ | Gradle und JDK im Bild (`GRADLE=1`): Gradle 9.8.2 in fester Fassung gegen SHA-256 (`scripts/gradle-holen.sh`, die CI vergleicht mit gradle.org), JDK 17 aus Debian; Hinweis in `SOUL.md` („`gradle`, nicht `./gradlew`“); die Echttests aus VKh1 laufen in der CI mit dieser Fassung | ~250 |
| VKh2b | Bauen von APKs (W1 C, W4 A): SDK beim Bau des Bilds (`ARG ANDROID=1`, Lizenz des SDK nur lokal, vom MENSCHEN angenommen), auf amd64 mit Googles `aapt2`. Hinweis in `SOUL.md` („APK bauen, über die Vorschau laden“), Echttest in der CI (amd64) | ~300 |
| VKh3 | `aapt2` für ARM64 aus den Quellen (W2 A, `scripts/aapt2-bauen.sh`, Fassung und Commit fest, `--pruefen`), im Bild über `android.aapt2FromMavenOverride` | ~250 |
| VKh4 | Android im Bild (W1 A): Cuttlefish als eigener Dienst (Installer bzw. Compose-Profil „android“), Socket in die Sandbox des Programms, Viewer bzw. scrcpy, Installation über adb nach jeder Änderung – nur nach der Probe am GX10 | ~400 |
| – | Das APK versiegelt über das Blob-Netz (VKh-W4 B) – erst, wenn die Vorschau von unterwegs nicht reicht | ~200 |

**Befunde aus VKh1:**
- Das JDK von Debian und Ubuntu liest `conf/security/java.security` über einen Verweis nach `/etc/java-<N>-openjdk`. Ohne
  diesen Ordner bricht jede JVM in der Sandbox schon beim Start ab, auch im Terminal. Die Sandbox liest ihn jetzt mit.
- Plugins: Ohne eigene Liste fragt Gradle das Plugin-Portal selbst. Das Init-Skript setzt deshalb Google Maven und Maven
  Central vor die Plugin-Repositories und lenkt `gradlePluginPortal()` auf Maven Central. Die Marker des Android- und des
  Kotlin-Plugins liegen auf Google Maven bzw. Maven Central. Plugins, die es nur im Portal gibt, findet Gradle nicht.
- `./gradlew` lädt seine Gradle-Fassung von services.gradle.org und scheitert ohne Netz. Gradle selbst kommt seit VKh2a mit
  `GRADLE=1` ins Bild.

## Proben am GX10 (MENSCH)

- `ls -l /dev/kvm` – gibt es KVM für Cuttlefish (VKh4)?
- `grep -i binder /boot/config-$(uname -r)` und `modinfo binder_linux` – nur für redroid und Waydroid (VKh-W1 B) nötig.
- `getconf PAGESIZE` – Android-Abbilder für arm64 und FEX erwarten 4096 (steht schon bei der Probe „Vibecoden“ in OFFEN).

## Quellen

- redroid: https://github.com/remote-android/redroid-doc (Apache-2.0, Kernel-Module GPL-2.0; `--privileged`, `binder_linux`)
- Waydroid: https://wiki.archlinux.org/title/Waydroid; X11-Betrieb mit weston: https://pkg.go.dev/github.com/thereisnotime/x11droid
- Cuttlefish: https://github.com/google/android-cuttlefish (Hosts x86 und arm64, Pakete, Gruppen),
  https://android.googlesource.com/device/google/cuttlefish/+/42b4a243f0d9d66f6157df1c1d3f00ba42b49615/README.md (VNC),
  arm64-Abbilder: https://linaro.atlassian.net/wiki/x/YIAs3AY
- Android-Emulator: https://developer.android.com/studio/releases/emulator (Linux ARM64 nur als Bau aus den Quellen, 30.0.26
  vom 16.08.2020; neueste Fassung 37.2.13 vom 28.10.2026)
- `aapt2` für ARM64: https://github.com/Commit451/android-arm-build-tools, https://github.com/hamza72x/android-sdk-linux-arm64;
  Debian `aapt` (Fassung 1): https://packages.debian.org/trixie/arm64/aapt/filelist
- scrcpy in Debian: https://tracker.debian.org/pkg/scrcpy, https://sources.debian.org/patches/scrcpy
- KVM auf dem DGX Spark (QEMU mit VFIO, Forum): https://forums.developer.nvidia.com/t/gpu-device-assignment-to-kvm-guest-vfio-on-host-ok-qemu-fails-error-getting-device-from-group-invalid-argument/366376
