#!/usr/bin/env python3
"""Rechte im Android-Manifest der Hülle (6.1d): Kamera und Mikrofon.

Das Projekt unter packages/launcher/gen/android entsteht je Lauf aus Tauris Vorlage
(`cargo tauri android init`), dort steht nur INTERNET. Ohne CAMERA und RECORD_AUDIO
lehnt Android die Anfrage des Webviews ab, bevor der Nutzer gefragt wird – dann gehen
QR-Code, Sprachnachricht und Anruf in der Android-App nicht. Dieses Skript trägt genau
diese Rechte ein (ohne Pflicht-Hardware, damit Geräte ohne Kamera die App behalten);
gefragt wird erst, wenn die App sie auf Klick anfordert (`src/erlaubnis.rs`).

    python3 scripts/android-rechte.py <AndroidManifest.xml>            # eintragen
    python3 scripts/android-rechte.py <AndroidManifest.xml> --pruefen  # nur prüfen
"""

import re
import sys

RECHTE = [
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
]
MERKMALE = ["android.hardware.camera", "android.hardware.microphone"]


def zeilen() -> list[str]:
    return [f'    <uses-permission android:name="{r}" />' for r in RECHTE] + [
        f'    <uses-feature android:name="{m}" android:required="false" />' for m in MERKMALE
    ]


def fehlt(manifest: str) -> list[str]:
    namen = set(re.findall(r'<uses-(?:permission|feature)\s+android:name="([^"]+)"', manifest))
    return [n for n in RECHTE + MERKMALE if n not in namen]


def trage_ein(manifest: str) -> str:
    offen = fehlt(manifest)
    if not offen:
        return manifest
    neu = [z for z in zeilen() if any(f'"{n}"' in z for n in offen)]
    treffer = re.search(r"<manifest\b[^>]*>\n", manifest)
    if not treffer:
        raise SystemExit("kein <manifest>-Element")
    return manifest[: treffer.end()] + "\n".join(neu) + "\n" + manifest[treffer.end():]


def main() -> int:
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--pruefen"):
        print(__doc__)
        return 2
    pfad = sys.argv[1]
    manifest = open(pfad, encoding="utf-8").read()
    if len(sys.argv) == 3:
        offen = fehlt(manifest)
        for n in offen:
            print(f"fehlt im Manifest: {n}")
        return 1 if offen else 0
    neu = trage_ein(manifest)
    if neu != manifest:
        open(pfad, "w", encoding="utf-8").write(neu)
    print(f"{pfad}: Kamera und Mikrofon eingetragen" if neu != manifest else f"{pfad}: schon vollständig")
    return 0


if __name__ == "__main__":
    sys.exit(main())
