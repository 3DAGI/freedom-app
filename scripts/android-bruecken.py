#!/usr/bin/env python3
"""Tor-Brücken im Android-Projekt der Hülle (B-33d, `docs/TOR-BRUECKEN-ENTWURF.md` V2).

Das Projekt unter packages/launcher/gen/android entsteht je Lauf aus Tauris Vorlage (`cargo tauri android init`).
Die Programme der Brücken legt `scripts/pt-beilegen.sh … aarch64-linux-android` als Bibliotheken nach
`app/src/main/jniLibs/arm64-v8a/`. Dieses Skript hängt an `app/build.gradle.kts` an, was sie dort brauchen:

- `useLegacyPackaging = true`: Android entpackt die Bibliotheken beim Installieren nach `nativeLibraryDir` – nur von
  dort darf eine App ein Programm starten (W^X); ohne Entpacken blieben sie im APK und die Hülle fände keinen Ordner.
- `keepDebugSymbols` für beide Programme: Das Release strippt Bibliotheken sonst mit llvm-strip – die Programme blieben
  nicht bitgleich mit dem Bau, und die CI vergliche sie vergeblich.

    python3 scripts/android-bruecken.py <gen/android/app>            # anhängen
    python3 scripts/android-bruecken.py <gen/android/app> --pruefen  # nur prüfen
"""

import pathlib
import sys

MARKE = "// Tor-Brücken (B-33d, scripts/android-bruecken.py)"
PROGRAMME = ["libfreedom_snowflake.so", "libfreedom_webtunnel.so"]


def block() -> str:
    halten = "\n".join(f'            keepDebugSymbols.add("**/{p}")' for p in PROGRAMME)
    return (
        f"\n{MARKE}: Programme als Bibliotheken – beim Installieren nach nativeLibraryDir entpacken,\n"
        "// nie strippen (sie bleiben bitgleich mit dem Bau).\n"
        "android {\n"
        "    packaging {\n"
        "        jniLibs {\n"
        "            useLegacyPackaging = true\n"
        f"{halten}\n"
        "        }\n"
        "    }\n"
        "}\n"
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    datei = pathlib.Path(sys.argv[1]) / "build.gradle.kts"
    if not datei.is_file():
        print(f"fehlt: {datei} – zuerst cargo tauri android init", file=sys.stderr)
        return 1
    text = datei.read_text(encoding="utf-8")
    if "--pruefen" in sys.argv[2:]:
        if MARKE in text and "useLegacyPackaging = true" in text and all(p in text for p in PROGRAMME):
            print("Tor-Brücken im Gradle-Projekt: ok")
            return 0
        print("Tor-Brücken fehlen in build.gradle.kts", file=sys.stderr)
        return 1
    if MARKE not in text:
        datei.write_text(text.rstrip("\n") + "\n" + block(), encoding="utf-8")
    print("Tor-Brücken im Gradle-Projekt eingetragen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
