#!/usr/bin/python3
"""Ein Jupyter-Notebook ausführen (VKk2b) – vom Motor im Terminal aufgerufen, also in seiner Sandbox (ohne Netz, mit
Grenzen) und im Modus „fragen“ erst nach der Rückfrage von Hermes.

Führt alle Code-Zellen in einem Kernel aus und speichert die Ausgaben ins Notebook – auch bis zu einer Zelle, die
scheitert. Nur die Schnittstelle von nbclient, die jede Fassung hat (`jupyter execute --inplace` kennt erst 0.10, Ubuntu
24.04 bringt 0.8), und nbformat zum Schreiben – so liest die Brücke die Datei, wie sie ist. Fest `/usr/bin/python3`:
Kernel und Pakete gehören zur Python der Distribution (python3-ipykernel, python3-nbclient), nicht zu einer im PATH.

    /freedom/mcp/jupyter/notebook_ausfuehren.py <notebook.ipynb>
"""
import os
import sys

ZELLE_SEK = 600
START_SEK = 60


def fehlerzelle(nb):
    """Die erste Code-Zelle mit einer Fehlerausgabe: (Nummer, Fehlername) – sonst None."""
    for i, zelle in enumerate(nb.cells):
        if zelle.cell_type != "code":
            continue
        for ausgabe in zelle.get("outputs", []):
            if ausgabe.get("output_type") == "error":
                return i, str(ausgabe.get("ename", "Error"))[:100]
    return None


def main(argv):
    if len(argv) != 2 or not argv[1].endswith(".ipynb"):
        print("usage: notebook_ausfuehren.py <notebook.ipynb>", file=sys.stderr)
        return 2
    import nbformat
    from nbclient import NotebookClient
    from nbclient.exceptions import CellExecutionError

    pfad = argv[1]
    try:
        nb = nbformat.read(pfad, as_version=4)
    except Exception as e:
        print(f"cannot read notebook: {type(e).__name__}", file=sys.stderr)
        return 2
    ordner = os.path.dirname(os.path.abspath(pfad))
    client = NotebookClient(nb, timeout=ZELLE_SEK, startup_timeout=START_SEK, resources={"metadata": {"path": ordner}})
    code = 0
    try:
        client.execute()
        print(f"ran {sum(1 for z in nb.cells if z.cell_type == 'code')} code cells – outputs saved")
    except CellExecutionError:
        code = 1
        stelle = fehlerzelle(nb)
        wo = f"cell {stelle[0]} ({stelle[1]})" if stelle else "a cell"
        print(f"stopped at {wo} – outputs up to it saved, read the notebook for the error")
    except Exception as e:  # Kernel startet nicht, Zeit um …
        code = 1
        print(f"stopped: {type(e).__name__} – outputs so far saved")
    nbformat.write(nb, pfad)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
