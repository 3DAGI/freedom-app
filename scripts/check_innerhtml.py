#!/usr/bin/env python3
"""
Findet Stellen, an denen Werte ungeprueft in HTML landen.

Durchsucht .ts-Dateien nach innerHTML/outerHTML-Zuweisungen und
insertAdjacentHTML. In Template-Strings wird jeder ${...}-Ausdruck geprueft,
auch in verschachtelten Templates (z. B. in .map()).

Als sicher gilt ein Ausdruck, der mit einer bekannten Schutzfunktion beginnt
(escapeHtml, ganzeZahl, Math.floor, Number, icon, ...) oder ein reines
Literal ist. Alles andere muss bewertet werden: entweder absichern oder in die
Ausnahmeliste eintragen (Zeilenformat: datei|ausdruck|Begruendung).

Aufruf:
  python3 agent/werkzeuge/check_innerhtml.py packages/app/src
  ... --markdown                      Tabelle fuer docs/INNERHTML-AUDIT.md
  ... --ausnahmen scripts/innerhtml-ausnahmen.txt --streng   (fuer die CI)
Exit-Code 1 bei --streng und unbewerteten Fundstellen.
"""
import re, sys
from pathlib import Path

SICHER = re.compile(
    r"^\s*(escapeHtml|ganzeZahl|Math\.(floor|round|min|max|ceil)|Number|String\(Number|"
    r"icon|pkShort|markSvgCheck|t|tr)\s*\(")
LITERAL = re.compile(r"""^\s*(\d+(\.\d+)?|"[^"`$]*"|'[^'`$]*')\s*$""")
FUNDSTELLE = re.compile(
    r"(\.innerHTML\s*\+?=\s*|\.outerHTML\s*=\s*|insertAdjacentHTML\(\s*[\"'][a-zA-Z]+[\"']\s*,\s*)")


def string_ueberspringen(s, i):
    q = s[i]; i += 1
    while i < len(s):
        if s[i] == "\\": i += 2; continue
        if s[i] == q: return i + 1
        i += 1
    return i


def template(s, i):
    """s[i] == '`'. Liefert (Ende, [(start, ausdruck, verschachtelt)])."""
    i += 1; teile = []
    while i < len(s):
        c = s[i]
        if c == "\\": i += 2; continue
        if c == "`": return i + 1, teile
        if c == "$" and s[i + 1:i + 2] == "{":
            start = i + 2
            ende, innen = ausdruck(s, start)
            teile.append((start, s[start:ende], innen))
            i = ende + 1; continue
        i += 1
    return i, teile


def ausdruck(s, i):
    tiefe = 0; innen = []
    while i < len(s):
        c = s[i]
        if c in "\"'": i = string_ueberspringen(s, i); continue
        if c == "`":
            ende, teile = template(s, i); innen.append(teile); i = ende; continue
        if c == "{": tiefe += 1
        elif c == "}":
            if tiefe == 0: return i, innen
            tiefe -= 1
        i += 1
    return i, innen


def pruefe(teile, src, datei, funde):
    for start, text, innen in teile:
        if innen:  # enthaelt selbst Templates -> deren Ausdruecke pruefen
            for t in innen: pruefe(t, src, datei, funde)
            continue
        if SICHER.match(text) or LITERAL.match(text): continue
        zeile = src.count("\n", 0, start) + 1
        funde.append((datei, zeile, " ".join(text.split())[:120]))


def main():
    args = sys.argv[1:]
    if not args: print(__doc__); return 2
    ordner = Path(args[0]); markdown = "--markdown" in args; streng = "--streng" in args
    ausnahmen = set()
    if "--ausnahmen" in args:
        pfad = Path(args[args.index("--ausnahmen") + 1])
        if pfad.exists():
            for z in pfad.read_text(encoding="utf-8").splitlines():
                if z.strip() and not z.startswith("#"):
                    teil = z.split("|")
                    if len(teil) >= 2: ausnahmen.add((teil[0].strip(), teil[1].strip()))
    funde = []
    for f in sorted(ordner.rglob("*.ts")):
        if f.name.endswith(".test.ts") or "shims" in f.parts: continue
        src = f.read_text(encoding="utf-8")
        for m in FUNDSTELLE.finditer(src):
            i = m.end()
            while i < len(src) and src[i] in " \t\n": i += 1
            if i < len(src) and src[i] == "`":
                _, teile = template(src, i)
                pruefe(teile, src, str(f), funde)
            else:
                rest = src[i:i + 160].split(";")[0].split("\n")[0]
                if not (SICHER.match(rest) or LITERAL.match(rest)):
                    funde.append((str(f), src.count("\n", 0, i) + 1, "(Zuweisung) " + rest.strip()[:110]))
    offen = [x for x in funde if (Path(x[0]).name, x[2]) not in ausnahmen]
    if markdown:
        print("# innerHTML-Audit\n\n| Datei | Zeile | Ausdruck | Bewertung |\n|---|---|---|---|")
        for d, z, a in offen: print(f"| `{d}` | {z} | `{a.replace('|', '¦')}` | PRÜFEN |")
        print(f"\n{len(offen)} unbewertete Fundstellen ({len(funde) - len(offen)} in der Ausnahmeliste).")
    else:
        for d, z, a in offen: print(f"{d}:{z}  ${{{a}}}")
        print(f"{len(offen)} unbewertete Fundstellen ({len(funde) - len(offen)} in der Ausnahmeliste).")
    return 1 if (streng and offen) else 0


if __name__ == "__main__":
    sys.exit(main())
