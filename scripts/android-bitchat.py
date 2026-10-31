#!/usr/bin/env python3
"""Bitchat im Android-Projekt der Hülle (B-36b1, `docs/BITCHAT-ENTWURF.md`).

Das Projekt unter packages/launcher/gen/android entsteht je Lauf aus Tauris Vorlage (`cargo tauri android init`). Dieses
Skript legt hinein, was Bitchat über Bluetooth LE braucht:

- die Klasse `packages/launcher/android/FreedomBitchat.kt` neben die `MainActivity` (Paket `io.github.threedagi.freedom`);
- die Rechte im Manifest: ab Android 12 `BLUETOOTH_SCAN` (nie für den Ort), `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`;
  bis Android 11 `BLUETOOTH`, `BLUETOOTH_ADMIN` und `ACCESS_FINE_LOCATION` (ohne die findet Android dort keine Geräte);
  Bluetooth LE als Merkmal, aber nicht Pflicht – Geräte ohne behalten die App. Gefragt wird erst auf Klick
  (`FreedomBitchat.starte()`);
- eine Keep-Regel (`freedom-bitchat.pro`): Die Klasse ruft nur die Hülle über JNI, R8 entfernte sie sonst als unbenutzt.

    python3 scripts/android-bitchat.py <gen/android/app>            # eintragen
    python3 scripts/android-bitchat.py <gen/android/app> --pruefen  # nur prüfen
"""

import pathlib
import re
import sys

QUELLE = pathlib.Path(__file__).resolve().parent.parent / "packages/launcher/android/FreedomBitchat.kt"
ZIEL = pathlib.Path("src/main/java/io/github/threedagi/freedom/FreedomBitchat.kt")
KEEP = "-keep class io.github.threedagi.freedom.FreedomBitchat { *; }\n"

# Name → Zusatz im Element
RECHTE = {
    "android.permission.BLUETOOTH_SCAN": ' android:usesPermissionFlags="neverForLocation"',
    "android.permission.BLUETOOTH_CONNECT": "",
    "android.permission.BLUETOOTH_ADVERTISE": "",
    "android.permission.BLUETOOTH": ' android:maxSdkVersion="30"',
    "android.permission.BLUETOOTH_ADMIN": ' android:maxSdkVersion="30"',
    "android.permission.ACCESS_FINE_LOCATION": ' android:maxSdkVersion="30"',
}
MERKMAL = "android.hardware.bluetooth_le"


def fehlt(manifest: str) -> list[str]:
    namen = set(re.findall(r'<uses-(?:permission|feature)\s+android:name="([^"]+)"', manifest))
    return [n for n in [*RECHTE, MERKMAL] if n not in namen]


def trage_ein(manifest: str) -> str:
    offen = fehlt(manifest)
    if not offen:
        return manifest
    zeilen = [f'    <uses-permission android:name="{n}"{RECHTE[n]} />' for n in RECHTE if n in offen]
    if MERKMAL in offen:
        zeilen.append(f'    <uses-feature android:name="{MERKMAL}" android:required="false" />')
    treffer = re.search(r"<manifest\b[^>]*>\n", manifest)
    if not treffer:
        raise SystemExit("kein <manifest>-Element")
    return manifest[: treffer.end()] + "\n".join(zeilen) + "\n" + manifest[treffer.end():]


def main() -> int:
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--pruefen"):
        print(__doc__)
        return 2
    app = pathlib.Path(sys.argv[1])
    manifest_pfad = app / "src/main/AndroidManifest.xml"
    if not manifest_pfad.is_file():
        print(f"fehlt: {manifest_pfad} – zuerst cargo tauri android init", file=sys.stderr)
        return 1
    manifest = manifest_pfad.read_text(encoding="utf-8")
    klasse = app / ZIEL
    keep = app / "freedom-bitchat.pro"
    if len(sys.argv) == 3:
        fehler = [f"fehlt im Manifest: {n}" for n in fehlt(manifest)]
        if not klasse.is_file() or klasse.read_bytes() != QUELLE.read_bytes():
            fehler.append(f"fehlt oder veraltet: {klasse}")
        if not keep.is_file() or keep.read_text(encoding="utf-8") != KEEP:
            fehler.append(f"fehlt: {keep}")
        for f in fehler:
            print(f, file=sys.stderr)
        if not fehler:
            print("Bitchat im Android-Projekt: ok")
        return 1 if fehler else 0
    neu = trage_ein(manifest)
    if neu != manifest:
        manifest_pfad.write_text(neu, encoding="utf-8")
    klasse.parent.mkdir(parents=True, exist_ok=True)
    klasse.write_bytes(QUELLE.read_bytes())
    keep.write_text(KEEP, encoding="utf-8")
    print("Bitchat im Android-Projekt eingetragen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
