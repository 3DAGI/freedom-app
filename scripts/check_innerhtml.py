#!/usr/bin/env python3
"""
Findet Stellen, an denen Werte ungeprueft in HTML landen.

Durchsucht .ts-Dateien nach innerHTML/outerHTML-Zuweisungen und
insertAdjacentHTML. Geprueft wird die GANZE rechte Seite bis zum Semikolon:
Jeder Teil, der am Ende im HTML landen kann, wird einzeln bewertet –
verkettete Teile (+), beide Zweige einer Bedingung (? :), Alternativen
(|| ?? &&) und in Template-Strings jeder ${...}-Ausdruck, auch verschachtelt
(z. B. in .map()). Bedingungen selbst landen nicht im HTML und zaehlen nicht.

Als sicher gilt ein Teil, der mit einer bekannten Schutzfunktion beginnt
(escapeHtml, ganzeZahl, Math.floor, Number, icon, ...) oder ein reines
Literal ist. Alles andere muss bewertet werden: entweder absichern oder in die
Ausnahmeliste eintragen (Zeilenformat: datei|ausdruck|Begruendung). Ein Teil,
der selbst Template-Strings enthaelt (etwa ein .map() mit Callback), wird
gemeldet UND seine Templates werden zusaetzlich einzeln geprueft.

Aufruf:
  python3 scripts/check_innerhtml.py packages/app/src
  ... --ausnahmen scripts/innerhtml-ausnahmen.txt --markdown   Audit-Tabelle
  ... --ausnahmen scripts/innerhtml-ausnahmen.txt --streng     (fuer die CI)
Exit-Code 1 bei --streng und unbewerteten Fundstellen.
"""
import re, sys
from pathlib import Path

SICHER = re.compile(
    r"^\s*(escapeHtml|ganzeZahl|Math\.(floor|round|min|max|ceil)|Number|String\(Number|"
    r"icon|markSvgCheck|t|tr)\s*\(")
LITERAL = re.compile(
    r"""^\s*(\d+(\.\d+)?|"[^"`$]*"|'[^'`$]*'|true|false|null|undefined)\s*$""")
FUNDSTELLE = re.compile(
    r"(\.innerHTML\s*\+?=\s*|\.outerHTML\s*=\s*|insertAdjacentHTML\(\s*[\"'][a-zA-Z]+[\"']\s*,\s*)")


def string_ueberspringen(s, i):
    q = s[i]; i += 1
    while i < len(s):
        if s[i] == "\\": i += 2; continue
        if s[i] == q: return i + 1
        i += 1
    return i


def kommentar_ueberspringen(s, i):
    """s[i:i+2] ist '//' oder '/*'. Liefert das Ende des Kommentars."""
    if s.startswith("//", i):
        ende = s.find("\n", i)
        return len(s) if ende < 0 else ende
    ende = s.find("*/", i + 2)
    return len(s) if ende < 0 else ende + 2


def ist_kommentar(s, i):
    return s.startswith("//", i) or s.startswith("/*", i)


def template(s, i):
    """s[i] == '`'. Liefert (Ende, [(start, ende)]) fuer jedes ${...}."""
    i += 1; teile = []
    while i < len(s):
        c = s[i]
        if c == "\\": i += 2; continue
        if c == "`": return i + 1, teile
        if c == "$" and s[i + 1:i + 2] == "{":
            start = i + 2
            ende = klammer_ende(s, start)
            teile.append((start, ende))
            i = ende + 1; continue
        i += 1
    return i, teile


def klammer_ende(s, i):
    """Index der '}', die den bei i beginnenden ${...}-Ausdruck schliesst."""
    tiefe = 0
    while i < len(s):
        c = s[i]
        if c in "\"'": i = string_ueberspringen(s, i); continue
        if c == "`": i, _ = template(s, i); continue
        if ist_kommentar(s, i): i = kommentar_ueberspringen(s, i); continue
        if c == "{": tiefe += 1
        elif c == "}":
            if tiefe == 0: return i
            tiefe -= 1
        i += 1
    return i


def rechte_seite_ende(s, i, im_aufruf):
    """Ende der rechten Seite: ';' auf oberster Ebene bzw. ')' des Aufrufs."""
    tiefe = 0
    while i < len(s):
        c = s[i]
        if c in "\"'": i = string_ueberspringen(s, i); continue
        if c == "`": i, _ = template(s, i); continue
        if ist_kommentar(s, i): i = kommentar_ueberspringen(s, i); continue
        if c in "([{": tiefe += 1
        elif c in ")]}":
            if tiefe == 0: return i
            tiefe -= 1
        elif c == ";" and tiefe == 0 and not im_aufruf: return i
        elif c == "," and tiefe == 0 and im_aufruf: return i
        i += 1
    return i


def oberste_ebene(s, a, b):
    """Liefert fuer s[a:b] die Positionen auf oberster Ebene als Liste
    (index, zeichen) – ohne Strings, Templates, Kommentare, Klammerinhalte."""
    tiefe = 0; i = a; out = []
    while i < b:
        c = s[i]
        if c in "\"'": i = string_ueberspringen(s, i); continue
        if c == "`": i, _ = template(s, i); continue
        if ist_kommentar(s, i): i = kommentar_ueberspringen(s, i); continue
        if c in "([{": tiefe += 1
        elif c in ")]}": tiefe -= 1
        elif tiefe == 0: out.append((i, c))
        i += 1
    return out


def ohne_kommentare(s, a, b):
    teile = []; i = a
    while i < b:
        if s[i] in "\"'":
            j = string_ueberspringen(s, i); teile.append(s[i:j]); i = j; continue
        if s[i] == "`":
            j, _ = template(s, i); teile.append(s[i:j]); i = j; continue
        if ist_kommentar(s, i):
            i = kommentar_ueberspringen(s, i); teile.append(" "); continue
        teile.append(s[i]); i += 1
    return "".join(teile)


def trimmen(s, a, b):
    """Leerraum, Kommentare und umschliessende Klammern entfernen."""
    while True:
        while a < b and (s[a].isspace() or ist_kommentar(s, a)):
            a = kommentar_ueberspringen(s, a) if ist_kommentar(s, a) else a + 1
        while b > a and s[b - 1].isspace(): b -= 1
        if a < b and s[a] == "(" and rechte_seite_ende(s, a + 1, True) == b - 1:
            a += 1; b -= 1; continue
        return a, b


def ausgabe_teile(s, a, b):
    """Zerlegt den Ausdruck s[a:b] in die Teile, die im HTML landen koennen."""
    a, b = trimmen(s, a, b)
    if a >= b: return []
    oben = oberste_ebene(s, a, b)
    # Bedingung: nur die beiden Zweige zaehlen. '??' und '?.' sind keine.
    bedingung = lambda i: s[i + 1:i + 2] not in ("?", ".") and s[i - 1:i] != "?"
    frage = next((i for i, c in oben if c == "?" and bedingung(i)), None)
    if frage is not None:
        offen = 0
        for i, c in oben:
            if i <= frage: continue
            if c == "?" and bedingung(i): offen += 1
            elif c == ":":
                if offen == 0:
                    return ausgabe_teile(s, frage + 1, i) + ausgabe_teile(s, i + 1, b)
                offen -= 1
    # Verkettung und Alternativen: jeder Teil zaehlt.
    for trenner in ("||", "??", "&&", "+"):
        if trenner == "+":
            stellen = [i for i, c in oben if c == "+" and s[i - 1:i] != "+" and s[i + 1:i + 2] not in ("+", "=")]
        else:
            stellen = [i for i, c in oben if s.startswith(trenner, i) and s[i - 1:i] != trenner[0]]
        if stellen:
            teile = []; start = a
            for i in stellen:
                teile += ausgabe_teile(s, start, i); start = i + len(trenner)
            return teile + ausgabe_teile(s, start, b)
    return [(a, b)]


def wahrheitswert(s, a, b):
    """Vergleich oder Negation auf oberster Ebene: ergibt immer true/false."""
    if s[a] == "!" and s[a + 1:a + 2] != "=": return True
    return any(s.startswith(op, i) for i, _ in oberste_ebene(s, a, b) for op in ("===", "!==", "==", "!="))


def pruefe_ausdruck(s, a, b, datei, funde, zuweisung=False):
    for x, y in ausgabe_teile(s, a, b):
        text = s[x:y]
        if s[x] == "`" and template(s, x)[0] == y:
            for p, q in template(s, x)[1]:
                pruefe_ausdruck(s, p, q, datei, funde)
            continue
        if SICHER.match(text) or LITERAL.match(text) or wahrheitswert(s, x, y): continue
        kurz = " ".join(ohne_kommentare(s, x, y).split())[:120].rstrip()
        funde.append((datei, s.count("\n", 0, x) + 1, ("(Zuweisung) " if zuweisung else "") + kurz))
        # Templates im Innern (etwa im Callback eines .map()) zusaetzlich pruefen.
        i = x
        while i < y:
            if s[i] in "\"'": i = string_ueberspringen(s, i); continue
            if ist_kommentar(s, i): i = kommentar_ueberspringen(s, i); continue
            if s[i] == "`":
                ende, teile = template(s, i)
                for p, q in teile: pruefe_ausdruck(s, p, q, datei, funde)
                i = ende; continue
            i += 1


def schluessel(datei, ausdruck):
    """'|' steht in der Ausnahmeliste als '¦' – es ist dort das Trennzeichen."""
    return (Path(datei).name, ausdruck.replace("|", "¦"))


def ausnahmen_lesen(args):
    """Jede Zeile deckt genau EINE Fundstelle ab. Derselbe Ausdruck an einer
    weiteren Stelle braucht eine eigene Zeile – sonst gaebe eine Ausnahme fuer
    `${cls}` jedes kuenftige `${cls}` in der Datei frei."""
    ausnahmen = {}
    if "--ausnahmen" in args:
        pfad = Path(args[args.index("--ausnahmen") + 1])
        if pfad.exists():
            for z in pfad.read_text(encoding="utf-8").splitlines():
                if z.strip() and not z.startswith("#"):
                    teil = z.split("|")
                    if len(teil) >= 3 and teil[2].strip():
                        k = (teil[0].strip(), teil[1].strip())
                        ausnahmen.setdefault(k, []).append("|".join(teil[2:]).strip())
    return ausnahmen


def main():
    args = sys.argv[1:]
    if not args: print(__doc__); return 2
    ordner = Path(args[0]); markdown = "--markdown" in args; streng = "--streng" in args
    ausnahmen = ausnahmen_lesen(args)
    funde = []
    for f in sorted(ordner.rglob("*.ts")):
        if f.name.endswith(".test.ts") or "shims" in f.parts: continue
        src = f.read_text(encoding="utf-8")
        for m in FUNDSTELLE.finditer(src):
            i = m.end()
            ende = rechte_seite_ende(src, i, m.group(0).startswith("insertAdjacentHTML"))
            pruefe_ausdruck(src, i, ende, str(f), funde, zuweisung=True)
    # Ausnahmen der Reihe nach verbrauchen: eine Zeile, eine Fundstelle.
    rest = {k: list(v) for k, v in ausnahmen.items()}
    bewertung, offen = [], []
    for x in funde:
        k = schluessel(x[0], x[2])
        if rest.get(k):
            bewertung.append(rest[k].pop(0))
        else:
            bewertung.append(None); offen.append(x)
    veraltet = [(k, n) for k, v in rest.items() for n in v]
    if markdown:
        print("# innerHTML-Audit\n")
        print("Erzeugt mit `python3 scripts/check_innerhtml.py packages/app/src "
              "--ausnahmen scripts/innerhtml-ausnahmen.txt --markdown` – nicht von Hand bearbeiten.\n")
        print("Geprüft wird jede Zuweisung an `innerHTML`/`outerHTML` und jedes "
              "`insertAdjacentHTML` in `.ts`-Dateien: jeder Teil der rechten Seite, der im HTML "
              "landen kann. Sicher ohne Eintrag sind Literale, Vergleiche, Negationen und "
              "Schutzfunktionen (`escapeHtml`, `ganzeZahl`, `Math.*`, `Number`, `icon`, `t`). "
              "Alle übrigen Stellen stehen unten mit Begründung aus "
              "`scripts/innerhtml-ausnahmen.txt`; Fremddaten gehören nie dorthin.\n")
        print("Nicht abgedeckt: andere Eingänge wie `href` oder `src`, die per "
              "Eigenschaft gesetzt werden – die muss man beim Hinzufügen selbst prüfen.\n")
        print("| Datei | Zeile | Ausdruck | Bewertung |\n|---|---|---|---|")
        for (d, z, a), bew in zip(funde, bewertung):
            code = a.replace("|", "¦")
            code = f"`` {code} ``" if "`" in code else f"`{code}`"  # Templates enthalten Backticks
            print(f"| `{d}` | {z} | {code} | {(bew or '**PRÜFEN**').replace('|', '¦')} |")
        print(f"\n{len(funde)} Fundstellen, davon {len(offen)} unbewertet.")
    else:
        for d, z, a in offen: print(f"{d}:{z}  ${{{a}}}")
        for (d, a), _ in veraltet: print(f"veraltete Ausnahme (keine passende Fundstelle): {d}|{a}")
        print(f"{len(offen)} unbewertete Fundstellen ({len(funde) - len(offen)} in der Ausnahmeliste).")
    return 1 if (streng and (offen or veraltet)) else 0


if __name__ == "__main__":
    sys.exit(main())
