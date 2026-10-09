#!/usr/bin/env python3
"""`STATUS.md` je Monat archivieren (C-22b).

Verschiebt jeden Abschnitt (`## …`) aus einem abgeschlossenen Monat nach
`docs/archiv/STATUS-<JJJJ-MM>.md` – angehängt, in der Reihenfolge von `STATUS.md`.
Der Monat eines Abschnitts ist der Monat des Commits, der seine Überschrift schrieb
(`git blame`, UTC); noch nicht eingecheckte Abschnitte gehören zum laufenden Monat.
Der Kopf von `STATUS.md` (alles vor dem ersten Abschnitt) bleibt stehen.

    python3 scripts/status-archiv.py             # verschieben
    python3 scripts/status-archiv.py --pruefen   # nur zeigen, was fällig ist (Exit 1, wenn etwas)
    python3 scripts/status-archiv.py --monat 2026-11   # als liefe gerade dieser Monat

Braucht die ganze Geschichte (kein flacher Klon).
"""

import datetime
import os
import re
import subprocess
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUS = os.path.join(WURZEL, "STATUS.md")
ARCHIV = os.path.join(WURZEL, "docs", "archiv")


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", WURZEL, *args], check=True, capture_output=True, text=True).stdout


def monate_der_zeilen() -> list[str]:
    """Monat (JJJJ-MM) jeder Zeile von STATUS.md laut `git blame`."""
    if git("rev-parse", "--is-shallow-repository").strip() == "true":
        raise SystemExit("flacher Klon – erst `git fetch --unshallow`")
    monate, zeit = [], None
    for zeile in git("blame", "--line-porcelain", "--", "STATUS.md").split("\n"):
        if zeile.startswith("author-time "):
            zeit = int(zeile.split()[1])
        elif zeile.startswith("\t"):
            monate.append(datetime.datetime.fromtimestamp(zeit, datetime.timezone.utc).strftime("%Y-%m"))
    return monate


def teile(text: str, monate: list[str]) -> tuple[str, list[tuple[str, str]]]:
    """Kopf und Abschnitte (Monat, Text) – ein Abschnitt beginnt mit `## `."""
    zeilen = text.split("\n")
    if text.endswith("\n"):
        zeilen.pop()
    if len(zeilen) != len(monate):
        raise SystemExit("STATUS.md und git blame zählen verschieden viele Zeilen")
    kopf, abschnitte = [], []
    for zeile, monat in zip(zeilen, monate):
        if zeile.startswith("## "):
            abschnitte.append([monat, [zeile]])
        elif abschnitte:
            abschnitte[-1][1].append(zeile)
        else:
            kopf.append(zeile)
    return "".join(z + "\n" for z in kopf), [(m, "".join(z + "\n" for z in t)) for m, t in abschnitte]


def main() -> int:
    argumente = sys.argv[1:]
    pruefen = "--pruefen" in argumente
    jetzt = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m")
    if "--monat" in argumente:
        jetzt = argumente[argumente.index("--monat") + 1]
        if not re.fullmatch(r"\d{4}-\d{2}", jetzt):
            raise SystemExit("--monat JJJJ-MM")
    text = open(STATUS, encoding="utf-8").read()
    kopf, abschnitte = teile(text, monate_der_zeilen())
    faellig: dict[str, list[str]] = {}
    bleibt = []
    for monat, teil in abschnitte:
        if monat < jetzt:
            faellig.setdefault(monat, []).append(teil)
        else:
            bleibt.append(teil)
    for monat, teile_ in sorted(faellig.items()):
        print(f"{monat}: {len(teile_)} Abschnitte nach docs/archiv/STATUS-{monat}.md")
    if pruefen or not faellig:
        if not faellig:
            print("nichts fällig")
        return 1 if faellig else 0
    for monat, teile_ in sorted(faellig.items()):
        pfad = os.path.join(ARCHIV, f"STATUS-{monat}.md")
        neu = not os.path.exists(pfad)
        with open(pfad, "a", encoding="utf-8") as f:
            if neu:
                f.write(f"# FreedomStack — Statusbericht {monat} (Archiv)\n\n"
                        "Aus `STATUS.md` verschoben (`scripts/status-archiv.py`); der laufende Monat "
                        "steht dort.\n\n")
            f.write("".join(teile_))
    with open(STATUS, "w", encoding="utf-8") as f:
        f.write(kopf + "".join(bleibt))
    return 0


if __name__ == "__main__":
    sys.exit(main())
