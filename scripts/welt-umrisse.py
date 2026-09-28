#!/usr/bin/env python3
"""
Welt-Umrisse für die Abdeckungskarte (Schritt C.4b, Entscheidung E5):
Natural Earth 1:110m „Land“ (gemeinfrei), vereinfacht und als SVG-Pfad fest
eingebettet – höchstens 40 KB, zur Laufzeit wird nichts geladen.

Quelle (Natural Earth, public domain):
  https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
Die Prüfsumme der Quelle steht fest – eine andere Datei wird abgelehnt, damit
dieselbe Quelle immer dieselbe Datei ergibt.

Aufruf:  python3 scripts/welt-umrisse.py <ne_110m_land.geojson>
         → schreibt packages/app/src/welt-umrisse.ts (nie von Hand ändern)
"""
import hashlib, json, sys
from pathlib import Path

QUELLE_SHA256 = "9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9"
TOLERANZ = 0.05       # Grad: Douglas-Peucker
MIN_FLAECHE = 0.3     # Quadratgrad: kleinere Inseln fallen weg
GRENZE = 40 * 1024    # Byte im erzeugten Pfad (E5)
ZIEL = Path(__file__).resolve().parent.parent / "packages/app/src/welt-umrisse.ts"


def abstand(p, a, b) -> float:
    """Abstand des Punkts p von der Strecke a–b."""
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return ((x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2) ** 0.5


def vereinfache(pkt: list, tol: float) -> list:
    """Douglas-Peucker ohne Rekursion (Anfang und Ende bleiben)."""
    behalten = [False] * len(pkt)
    behalten[0] = behalten[-1] = True
    stapel = [(0, len(pkt) - 1)]
    while stapel:
        a, b = stapel.pop()
        weit, idx = 0.0, -1
        for i in range(a + 1, b):
            d = abstand(pkt[i], pkt[a], pkt[b])
            if d > weit:
                weit, idx = d, i
        if idx >= 0 and weit > tol:
            behalten[idx] = True
            stapel += [(a, idx), (idx, b)]
    return [p for p, k in zip(pkt, behalten) if k]


def flaeche(pkt: list) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pkt, pkt[1:] + pkt[:1]))) / 2


def ring_pfad(ring: list) -> str | None:
    pkt = [(lon, lat) for lon, lat in ring]
    if pkt[0] == pkt[-1]:
        pkt = pkt[:-1]
    if len(pkt) < 3 or flaeche(pkt) < MIN_FLAECHE:
        return None
    # Geschlossener Ring: am weitesten entfernten Punkt teilen, beide Hälften vereinfachen
    fern = max(range(len(pkt)), key=lambda i: (pkt[i][0] - pkt[0][0]) ** 2 + (pkt[i][1] - pkt[0][1]) ** 2)
    teil = vereinfache(pkt[: fern + 1], TOLERANZ)[:-1] + vereinfache(pkt[fern:] + [pkt[0]], TOLERANZ)[:-1]
    # Zehntelgrad der Karte: x = (Länge + 180) · 10, y = (90 − Breite) · 10
    ganz = []
    for lon, lat in teil:
        p = (round((lon + 180) * 10), round((90 - lat) * 10))
        if not ganz or ganz[-1] != p:
            ganz.append(p)
    if len(ganz) < 3:
        return None
    teile = [f"M{ganz[0][0]} {ganz[0][1]}l"]
    zahlen = []
    for (x1, y1), (x2, y2) in zip(ganz, ganz[1:]):
        zahlen += [x2 - x1, y2 - y1]
    # Ein Minus trennt schon – ein Leerzeichen nur vor positiven Zahlen
    s = "".join((("" if i == 0 or z < 0 else " ") + str(z)) for i, z in enumerate(zahlen))
    return teile[0] + s + "z"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    roh = Path(sys.argv[1]).read_bytes()
    if hashlib.sha256(roh).hexdigest() != QUELLE_SHA256:
        print("Quelle hat eine andere Prüfsumme – abgelehnt")
        return 1
    daten = json.loads(roh)
    pfade = []
    for f in daten["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            p = ring_pfad(poly[0])  # 110m-Land hat keine Löcher, die zählen
            if p:
                pfade.append(p)
    pfad = "".join(pfade)
    if len(pfad) > GRENZE:
        print(f"zu groß: {len(pfad)} Byte")
        return 1
    ZIEL.write_text(
        "/**\n"
        " * Welt-Umrisse der Abdeckungskarte (Schritt C.4b, E5) – erzeugt von\n"
        " * `scripts/welt-umrisse.py`, nie von Hand ändern.\n"
        " *\n"
        " * Quelle: Natural Earth 1:110m „Land“ (gemeinfrei), sha256\n"
        f" * {QUELLE_SHA256}.\n"
        f" * Vereinfacht (Douglas-Peucker {TOLERANZ}°), Inseln unter {MIN_FLAECHE} Quadratgrad\n"
        f" * weggelassen; {len(pfade)} Flächen. Koordinaten in Zehntelgrad der Karte:\n"
        " * x = (Länge + 180) · 10, y = (90 − Breite) · 10 – gezeichnet mit `scale(0.1)`.\n"
        " */\n"
        f'export const WELT_UMRISSE = "{pfad}"; // kein UI-Text\n',
        encoding="utf-8",
    )
    print(f"{ZIEL.name}: {len(pfade)} Flächen, {len(pfad)} Byte")
    return 0


if __name__ == "__main__":
    sys.exit(main())
