#!/usr/bin/env python3
"""Referenz für die Jupyter-Brücke (VKk2a) aus nbformat 5.11.1.

Erzeugt packages/node/test/fixtures/jupyter-referenz.json: Notebooks, wie Jupyter
selbst sie schreibt (sortierte Schlüssel, Einrückung 1, Quelltext als Zeilen).
Die Brücke muss genau diese Bytes liefern – sonst zeigte git nach jeder Änderung
der Brücke das ganze Notebook als geändert. Nur zum Nachbauen der Referenz – weder
Build noch Tests brauchen Python:

    python3 -m venv /tmp/nb && /tmp/nb/bin/pip install nbformat==5.11.1
    /tmp/nb/bin/python scripts/jupyter-referenz.py
"""
import io
import json
import pathlib

import nbformat
from nbformat.v4 import new_code_cell, new_markdown_cell, new_notebook, new_output, new_raw_cell

KERNEL = {
    "kernelspec": {"display_name": "Python 3 (ipykernel)", "language": "python", "name": "python3"},
    "language_info": {"name": "python"},
}

# Zellen, wie sie die Brücke anlegt – Zeilenenden aller Art, wie str.splitlines(True) sie trennt
ZELLEN = [
    ("markdown", "a1b2c3d4", "# Überschrift\n\nText mit Ümlaut – und Strich"),
    ("code", "0f0f0f0f", "import math\nprint(math.pi)\n"),
    ("code", "00000001", ""),
    ("raw", "deadbeef", "eins\r\nzwei\rdrei\x0cvier fünf\x1cende"),
    ("code", "00000002", "x = 1\n\n\ny = 2"),
]


def text(nb) -> str:
    f = io.StringIO()
    nbformat.write(nb, f)
    return f.getvalue()


def zelle(art, id_, quelle):
    return {"code": new_code_cell, "markdown": new_markdown_cell, "raw": new_raw_cell}[art](source=quelle, id=id_)


def mit_ausgaben():
    nb = new_notebook(metadata=KERNEL)
    c = new_code_cell(source="print('hallo')\n1 + 1", id="11111111", execution_count=3)
    c.outputs = [
        new_output("stream", name="stdout", text="hallo\n"),
        new_output("stream", name="stderr", text="Warnung\n"),
        new_output("execute_result", data={"text/plain": "2", "text/html": "<b>2</b>"}, execution_count=3),
    ]
    b = new_code_cell(source="zeige()", id="22222222", execution_count=4)
    b.outputs = [new_output("display_data", data={"image/png": "iVBORw0KGgo=", "text/plain": "<Figure size 640x480>"})]
    f = new_code_cell(source="1/0", id="33333333", execution_count=5)
    f.outputs = [new_output("error", ename="ZeroDivisionError", evalue="division by zero",
                            traceback=["\x1b[0;31mZeroDivisionError\x1b[0m: division by zero"])]
    nb.cells = [new_markdown_cell(source="## Auswertung", id="00000000"), c, b, f]
    return nb


def main():
    neu = text(new_notebook(metadata=KERNEL))
    nb = new_notebook(metadata=KERNEL)
    nb.cells = [zelle(*z) for z in ZELLEN]
    zellen = text(nb)
    ausgaben = mit_ausgaben()
    vorher = text(ausgaben)
    # eine Code-Zelle ändern: neue Quelle, Ausgaben und Zählung weg (sie passten nicht mehr)
    ausgaben.cells[1].source = "print('neu')"
    ausgaben.cells[1].outputs = []
    ausgaben.cells[1].execution_count = None
    ref = {
        "nbformat": nbformat.__version__,
        "kernel": KERNEL,
        "neu": neu,
        "zellen": {"zellen": [{"art": a, "id": i, "quelle": q} for a, i, q in ZELLEN], "text": zellen},
        "ausgaben": vorher,
        "geaendert": {"index": 1, "quelle": "print('neu')", "text": text(ausgaben)},
    }
    ziel = pathlib.Path(__file__).resolve().parent.parent / "packages/node/test/fixtures/jupyter-referenz.json"
    ziel.write_text(json.dumps(ref, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(ziel)


if __name__ == "__main__":
    main()
