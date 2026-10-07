#!/usr/bin/env python3
"""Symbole der Desktop-Hülle (6.1a1) aus dem Logo der App erzeugen.

Das Logo steht als SVG im Manifest der Website (packages/website/manifest.json):
schwarzes Quadrat, zwei grüne Klammern, ein grünes Quadrat in der Mitte. Es
besteht nur aus Rechtecken – hier wird es Pixel für Pixel nachgerechnet (vier mal
vier Abtastpunkte je Pixel), ohne Bildbibliothek und ohne Zeitstempel. Dieselbe
Eingabe ergibt so immer dieselben Dateien.

    python3 scripts/launcher-symbole.py            # schreibt packages/launcher/icons/
    python3 scripts/launcher-symbole.py --pruefen  # vergleicht nur, Exit 1 bei Abweichung
"""
import struct
import sys
import zlib
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "packages" / "launcher" / "icons"
GRUND = (0x05, 0x05, 0x05)
GRUEN = (0x7B, 0xC8, 0x0A)

# Flächen im Koordinatensystem der Gruppe (translate(22 22) scale(0.875)):
# Linien der Breite 7 mit eckigen Enden, Ecken auf Gehrung – als Rechtecke.
H = 3.5
FLAECHEN = [
    (12 - H, 10 - H, 22 + H, 10 + H), (12 - H, 10 - H, 12 + H, 54 + H), (12 - H, 54 - H, 22 + H, 54 + H),
    (42 - H, 10 - H, 52 + H, 10 + H), (52 - H, 10 - H, 52 + H, 54 + H), (42 - H, 54 - H, 52 + H, 54 + H),
    (27, 27, 37, 37),
]


def gruen(u: float, v: float) -> bool:
    x, y = (u - 22) / 0.875, (v - 22) / 0.875
    return any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in FLAECHEN)


def bild(n: int) -> bytes:
    """Rohdaten RGBA, Zeile für Zeile mit Filterbyte 0."""
    zeilen = bytearray()
    for py in range(n):
        zeilen.append(0)
        for px in range(n):
            treffer = sum(gruen((px + (i + 0.5) / 4) * 100 / n, (py + (j + 0.5) / 4) * 100 / n) for i in range(4) for j in range(4))
            a = treffer / 16
            zeilen += bytes(round(g * (1 - a) + f * a) for g, f in zip(GRUND, GRUEN)) + b"\xff"
    return bytes(zeilen)


def png(n: int) -> bytes:
    def stueck(art: bytes, daten: bytes) -> bytes:
        return struct.pack(">I", len(daten)) + art + daten + struct.pack(">I", zlib.crc32(art + daten) & 0xFFFFFFFF)
    kopf = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + stueck(b"IHDR", kopf) + stueck(b"IDAT", zlib.compress(bild(n), 9)) + stueck(b"IEND", b"")


def ico(bilder: list[tuple[int, bytes]]) -> bytes:
    """ICO mit eingebetteten PNG (ab Windows Vista)."""
    kopf = struct.pack("<HHH", 0, 1, len(bilder))
    eintraege, daten = b"", b""
    versatz = 6 + 16 * len(bilder)
    for n, p in bilder:
        eintraege += struct.pack("<BBBBHHII", n % 256, n % 256, 0, 0, 1, 32, len(p), versatz + len(daten))
        daten += p
    return kopf + eintraege + daten


def dateien() -> dict[str, bytes]:
    p32, p128, p256, p512 = png(32), png(128), png(256), png(512)
    return {"32x32.png": p32, "128x128.png": p128, "128x128@2x.png": p256, "icon.png": p512, "icon.ico": ico([(32, p32), (256, p256)])}


def main() -> int:
    pruefen = "--pruefen" in sys.argv[1:]
    abweichend = []
    for name, inhalt in dateien().items():
        pfad = ZIEL / name
        if pruefen:
            if not pfad.exists() or pfad.read_bytes() != inhalt:
                abweichend.append(name)
        else:
            ZIEL.mkdir(parents=True, exist_ok=True)
            pfad.write_bytes(inhalt)
    if pruefen:
        print("Symbole passen" if not abweichend else f"Symbole weichen ab: {', '.join(abweichend)}")
        return 1 if abweichend else 0
    print(f"geschrieben: {ZIEL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
