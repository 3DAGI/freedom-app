#!/usr/bin/env python3
"""
Prueft, ob jeder Protokoll-Baustein tatsaechlich aufgerufen wird.

DER FEHLER, DEN DAS VERHINDERT
Dreimal im Projekt dasselbe Muster: Protokollschicht bauen, sauber testen,
Verdrahtung vergessen. Beim letzten Mal waren neun Mechanismen vollstaendig
untaetig — die Zeitstempel-Absicherung lief ins Leere, der Vertrauensgraph
hatte keine Kante, kein Relay konnte Geld bekommen.

Protokollcode laesst sich testen, Verdrahtung nicht. Deshalb diese Pruefung.

SEIT SCHRITT 1.4
Geprueft wird jede exportierte Funktion und Klasse in packages/protocol/src,
nicht mehr nur `build*`. "Verdrahtet" heisst: von App, Knoten oder Skripten
aus erreichbar – direkt oder ueber eine Kette von Protokoll-Funktionen, die
selbst erreichbar sind. Eine Funktion, die nur eine ihrerseits unbenutzte
Funktion aufruft, zaehlt nicht. So lag `giftWrap` vor Schritt 2.1: 16 Tests,
aber in keinem Pfad der App.

Gezaehlt werden Bezeichner im Code – nicht in Kommentaren oder Strings, nicht
als Eigenschaft (`obj.name`) und nicht als Objekt-Schluessel (`name: ...`).
Sonst zaehlte `giftWrap: true` in einer Konfiguration als Aufruf.

Aufruf:
  python3 scripts/check-wiring.py            Bericht, Ausnahmen aus scripts/wiring-ausnahmen.txt
  python3 scripts/check-wiring.py --streng   dazu Exit-Code 1 bei unverdrahteten Exporten
                                             oder veralteten Ausnahmen (fuer die CI)
  python3 scripts/check-wiring.py --liste    jeden unverdrahteten Export zeigen, auch die ausgenommenen
  ... --wurzel <pfad>                        anderes Projektverzeichnis (Selbsttest)
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PROTOCOL = WURZEL / "packages" / "protocol" / "src"
# Wer hier etwas aufruft, verdrahtet es. scripts/interop ist Testwerkzeug.
KONSUMENTEN = [WURZEL / "packages" / "app" / "src", WURZEL / "packages" / "node" / "src", WURZEL / "scripts"]
AUSGESCHLOSSEN = [WURZEL / "scripts" / "interop"]
AUSNAHMEN = WURZEL / "scripts" / "wiring-ausnahmen.txt"

DEKLARATION = re.compile(
    r"^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?"
    r"(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)", re.M)
OBERSTE_EBENE = re.compile(
    r"^(?:export|function|class|const|let|var|interface|type|enum|async|import|declare|abstract)\b", re.M)
# Bezeichner, der als Wert benutzt wird: nicht nach '.', nicht als Schluessel 'name:'.
BEZEICHNER = re.compile(r"(?<![\w.$])([A-Za-z_$][\w$]*)(?![\w$])(?!\s*\??:(?!:))")


def regex_moeglich(s: str, i: int) -> bool:
    """'/' beginnt ein Regex-Literal, wenn davor kein Wert steht."""
    if s.startswith("//", i) or s.startswith("/*", i):
        return False
    k = i - 1
    while k >= 0 and s[k] in " \t":
        k -= 1
    if k < 0 or s[k] in "(,=:[!&|?{};+-*%<>~^\n":
        return True
    wort = re.search(r"(\w+)$", s[:k + 1])
    return bool(wort and wort.group(1) in ("return", "typeof", "case", "in", "of", "void", "delete"))


def leeren(s: str) -> str:
    """Kommentare und Text in Strings durch Leerzeichen ersetzen; ${...} bleibt."""
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if s.startswith("//", i):
            j = s.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i)); i = j; continue
        if s.startswith("/*", i):
            j = s.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", s[i:j])); i = j; continue
        if c == "/" and regex_moeglich(s, i):
            # Regex-Literal: /```(\w*)/ ist kein Template-String
            j, klasse = i + 1, False
            while j < n and s[j] != "\n":
                if s[j] == "\\": j += 2; continue
                if s[j] == "[": klasse = True
                elif s[j] == "]": klasse = False
                elif s[j] == "/" and not klasse: break
                j += 1
            out.append("/" + " " * max(0, j - i - 1) + "/"); i = j + 1; continue
        if c in "\"'":
            j = i + 1
            while j < n and s[j] != c and s[j] != "\n":
                j += 2 if s[j] == "\\" else 1
            out.append(c + " " * max(0, j - i - 1) + c); i = j + 1; continue
        if c == "`":
            j, teil = i + 1, ["`"]
            while j < n and s[j] != "`":
                if s[j] == "\\":
                    teil.append("  "); j += 2; continue
                if s.startswith("${", j):
                    tiefe, k = 0, j + 2
                    while k < n:
                        if s[k] == "{": tiefe += 1
                        elif s[k] == "}":
                            if tiefe == 0: break
                            tiefe -= 1
                        k += 1
                    teil.append(leeren(s[j:k + 1])); j = k + 1; continue
                teil.append("\n" if s[j] == "\n" else " "); j += 1
            teil.append("`"); out.append("".join(teil)); i = j + 1; continue
        out.append(c); i += 1
    return "".join(out)


def bezeichner(text: str) -> set[str]:
    return set(BEZEICHNER.findall(text))


def protokoll_lesen():
    """Deklarationen auf oberster Ebene: Name -> benutzte Bezeichner; Exporte -> Datei."""
    rumpf: dict[str, set[str]] = defaultdict(set)
    exporte: dict[str, str] = {}
    for f in sorted(PROTOCOL.glob("*.ts")):
        if f.name == "index.ts":
            continue
        src = leeren(f.read_text(encoding="utf-8"))
        starts = [m.start() for m in OBERSTE_EBENE.finditer(src)] + [len(src)]
        for a, b in zip(starts, starts[1:]):
            m = DEKLARATION.match(src, a)
            if not m:
                continue
            name = m.group(3)
            rumpf[name] |= bezeichner(src[m.end():b])
            if m.group(1) and m.group(2) in ("function", "function*", "class"):
                exporte[name] = f.name
    return rumpf, exporte


def konsumenten_bezeichner() -> set[str]:
    alle: set[str] = set()
    for ordner in KONSUMENTEN:
        for f in ordner.rglob("*"):
            if f.suffix not in (".ts", ".mjs", ".js") or not f.is_file():
                continue
            if f.name.endswith(".test.ts") or any(a in f.parents for a in AUSGESCHLOSSEN):
                continue
            alle |= bezeichner(leeren(f.read_text(encoding="utf-8")))
    return alle


def verdrahtet(rumpf, wurzeln: set[str]) -> set[str]:
    erreicht: set[str] = set()
    stapel = [n for n in wurzeln if n in rumpf]
    while stapel:
        n = stapel.pop()
        if n in erreicht:
            continue
        erreicht.add(n)
        stapel.extend(m for m in rumpf[n] if m in rumpf and m not in erreicht)
    return erreicht


def ausnahmen_lesen() -> dict[tuple[str, str], str]:
    aus: dict[tuple[str, str], str] = {}
    if AUSNAHMEN.exists():
        for z in AUSNAHMEN.read_text(encoding="utf-8").splitlines():
            if z.strip() and not z.startswith("#"):
                teil = [t.strip() for t in z.split("|")]
                if len(teil) >= 3 and teil[2]:
                    aus[(teil[0], teil[1])] = teil[2]
    return aus


def wurzel_setzen(wurzel: Path) -> None:
    """Fuer den Selbsttest: ein anderes Projektverzeichnis pruefen."""
    global PROTOCOL, KONSUMENTEN, AUSGESCHLOSSEN, AUSNAHMEN
    PROTOCOL = wurzel / "packages" / "protocol" / "src"
    KONSUMENTEN = [wurzel / "packages" / "app" / "src", wurzel / "packages" / "node" / "src", wurzel / "scripts"]
    AUSGESCHLOSSEN = [wurzel / "scripts" / "interop"]
    AUSNAHMEN = wurzel / "scripts" / "wiring-ausnahmen.txt"


# Schritt 4.1: Geld fliesst nur ueber die Zahlschienen. Jeder direkte
# Wallet-Zugriff in der App steht hier mit den Dateien, die ihn duerfen.
ZAHLWEGE = {
    r"\.payInvoice\(": {"rails.ts"},
    r"\.sendPayment\(": {"rails.ts"},
    r"signAndSendTransaction": {"shell/zahlschienen.ts"},
    r"\bbuildSolTransfer\b": {"sol-transfer.ts", "shell/zahlschienen.ts"},
    # Treuhand-Programme (HTLC-Deposit, Swap) senden eigene Anweisungen, keine Ueberweisung.
    r"sendRawTransaction": {"shell/zahlschienen.ts", "sol-htlc.ts", "swap-client.ts"},
    # Keysend der Sitzung: nie mit Wallet aufgerufen; die KI-Bezahlung wartet auf 4.0/4.3.
    r"\.keysend\(": {"session-client.ts"},
}


def zahlwege_pruefen(app_src: Path) -> list[str]:
    """Wallet-Zugriffe ausserhalb der erlaubten Dateien (Kommentare ausgenommen)."""
    funde = []
    for f in sorted(app_src.rglob("*.ts")):
        rel = f.relative_to(app_src).as_posix()
        code = leeren(f.read_text(encoding="utf8"))
        for muster, erlaubt in ZAHLWEGE.items():
            if rel not in erlaubt and re.search(muster, code):
                funde.append(f"{rel}: {muster}")
    return funde


def main() -> int:
    streng, liste = "--streng" in sys.argv, "--liste" in sys.argv
    if "--wurzel" in sys.argv:
        wurzel_setzen(Path(sys.argv[sys.argv.index("--wurzel") + 1]))
    rumpf, exporte = protokoll_lesen()
    erreicht = verdrahtet(rumpf, konsumenten_bezeichner())
    ausnahmen = ausnahmen_lesen()

    nicht = [n for n in sorted(exporte) if n not in erreicht]
    ausgenommen = [n for n in nicht if (exporte[n], n) in ausnahmen]
    zeigen = defaultdict(list)
    for n in nicht:
        if liste or (exporte[n], n) not in ausnahmen:
            zeigen[exporte[n]].append(n)
    offen = len(nicht) - len(ausgenommen)
    # Eine Ausnahme fuer etwas, das inzwischen verdrahtet ist oder nicht mehr
    # existiert, faellt auf – sonst waechst die Liste nur noch.
    veraltet = sorted(k for k in ausnahmen if exporte.get(k[1]) != k[0] or k[1] in erreicht)

    if zeigen:
        titel = "Nicht verdrahtete Exporte" + ("" if liste else " ohne Ausnahme")
        print(f"{titel} – nur in Tests oder in unbenutzten Bausteinen aufgerufen:\n")
        for datei in sorted(zeigen):
            print(f"  {datei}: {', '.join(zeigen[datei])}")
        if offen:
            print("\nEntweder verdrahten oder mit Begruendung in scripts/wiring-ausnahmen.txt eintragen.")
    for datei, name in veraltet:
        print(f"veraltete Ausnahme (verdrahtet oder entfernt): {datei}|{name}")
    print(f"\nVerdrahtung: {len(exporte)} Exporte, {len(exporte) - len(nicht)} verdrahtet, "
          f"{len(nicht)} nicht – davon {len(ausgenommen)} begruendet ausgenommen, {offen} offen.")
    zahlwege = zahlwege_pruefen(KONSUMENTEN[0])
    for z in zahlwege:
        print(f"Wallet-Zugriff ausserhalb der Zahlschienen: {z}")
    print(f"Zahlwege: {len(zahlwege)} Wallet-Zugriffe ausserhalb der Schienen.")
    return 1 if streng and (offen or veraltet or zahlwege) else 0


if __name__ == "__main__":
    sys.exit(main())
