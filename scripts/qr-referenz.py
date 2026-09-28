#!/usr/bin/env python3
"""Referenz-Codes für den QR-Baustein (Schritt 11.1a) aus python-qrcode 7.4.2.

Erzeugt packages/protocol/test/fixtures/qr-referenz.json. Nur zum Nachbauen
der Referenz – weder Build noch Tests brauchen Python:

    python3 -m venv /tmp/qr && /tmp/qr/bin/pip install qrcode==7.4.2
    /tmp/qr/bin/python scripts/qr-referenz.py

Verglichen wird mit fester Maske: python-qrcode bewertet die Masken ohne
Format- und Versionsbits (alle hell), die Norm mit dem fertigen Symbol – die
Wahl der Maske prüft der Test deshalb selbst.
"""
import hashlib
import json
import pathlib

import qrcode
from qrcode.constants import ERROR_CORRECT_H, ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q
from qrcode.util import BIT_LIMIT_TABLE, MODE_8BIT_BYTE, QRData

STUFE = {"L": ERROR_CORRECT_L, "M": ERROR_CORRECT_M, "Q": ERROR_CORRECT_Q, "H": ERROR_CORRECT_H}


def matrix(daten: bytes, stufe: str, maske: int):
    qr = qrcode.QRCode(version=None, error_correction=STUFE[stufe], mask_pattern=maske, border=0)
    qr.add_data(QRData(daten, mode=MODE_8BIT_BYTE))
    qr.make(fit=True)
    return qr.version, ["".join("1" if m else "0" for m in zeile) for zeile in qr.modules]


def fall(text: str | None, daten: bytes, stufe: str, maske: int, voll: bool):
    version, zeilen = matrix(daten, stufe, maske)
    f = {"stufe": stufe, "maske": maske, "version": version}
    f["text" if text is not None else "hex"] = text if text is not None else daten.hex()
    if voll:
        # je Zeile Hex, von links; die letzte Ziffer mit hellen Modulen aufgefüllt
        f["zeilen"] = [format(int(z + "0" * (-len(z) % 4), 2), "0%dx" % ((len(z) + 3) // 4)) for z in zeilen]
    else:
        f["sha256"] = hashlib.sha256("\n".join(zeilen).encode()).hexdigest()
    return f


def main():
    faelle = []
    for stufe in "LMQH":
        for maske in range(8):
            faelle.append(fall("FreedomStack", b"FreedomStack", stufe, maske, True))
    # Form eines Gerätecodes – Schlüssel sind Füllwerte, kein echter Schlüssel
    geraet = "freedom-geraet:" + "ab" * 32 + ":" + "cd" * 32
    for maske in range(8):
        faelle.append(fall(geraet, geraet.encode(), "M", maske, True))
    werbelink = "https://beispiel.org/freedom.html?ref=" + "12" * 32 + "&ln=grüße@beispiel.org"
    faelle.append(fall(werbelink, werbelink.encode(), "M", 3, True))
    faelle.append(fall(werbelink, werbelink.encode(), "H", 6, True))
    # Grenzen der Längenangabe (8 → 16 Bit ab Version 10) und große Versionen
    for n, stufe, maske in [(213, "M", 1), (214, "M", 4), (1128, "M", 5), (1500, "Q", 7), (2953, "L", 2), (1273, "H", 0)]:
        faelle.append(fall(None, bytes((i * 37 + 11) % 256 for i in range(n)), stufe, maske, False))

    kapazitaet = {}
    for stufe, ec in STUFE.items():
        kapazitaet[stufe] = [
            (BIT_LIMIT_TABLE[ec][v] - 4 - (8 if v < 10 else 16)) // 8 for v in range(1, 41)
        ]

    ziel = pathlib.Path(__file__).resolve().parent.parent / "packages/protocol/test/fixtures/qr-referenz.json"
    ziel.parent.mkdir(parents=True, exist_ok=True)
    # eine Zeile je Stufe und je Fall – lesbare Diffs
    zeile = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    teile = ['{"quelle":"python-qrcode 7.4.2","kapazitaet":{']
    teile.append(",\n".join(f"{zeile(s)}:{zeile(k)}" for s, k in kapazitaet.items()) + '},"faelle":[')
    teile.append(",\n".join(zeile(f) for f in faelle) + "]}")
    ziel.write_text("\n".join(teile) + "\n")
    print(f"{len(faelle)} Fälle → {ziel}")


if __name__ == "__main__":
    main()
