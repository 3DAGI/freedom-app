#!/usr/bin/env python3
"""
Prueft die statischen Website-Seiten.

Sie haben keinen Build — ein kaputtes Tag oder ein toter interner Link faellt
sonst erst dem ersten Besucher auf. Genau dem, den die Seite abholen soll.
"""
import html.parser
import os
import re
import sys

SEITEN = ["index.html", "dashboard.html", "faq.html", "whitepaper.html", "roadmap.html"]
BASIS = os.path.join("packages", "website")
# Tags, die sich selbst schliessen und deshalb nie auf dem Stapel landen.
LEER = {"meta", "link", "br", "img", "input", "hr", "source", "area", "base", "col", "embed", "track", "wbr"}


class Pruefer(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag not in LEER:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: object) -> None:
        pass

    def handle_endtag(self, tag: str) -> None:
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            # Verschachtelung stimmt nicht — bis zum passenden Tag abbauen.
            while self.stack and self.stack.pop() != tag:
                pass


# Seiten, die erst beim Bauen entstehen: build-site.sh kopiert die App aus
# ihrem Build (packages/app/dist). Eine eingecheckte Kopie wäre veraltet (5.1.4a).
ERZEUGT = {"freedom.html": os.path.join(BASIS, "..", "app", "dist", "freedom.html")}

# Aussagen des alten Gebührenmodells (bis 5.1.4): Seit A+ gibt es keine
# Protokollgebühr mit Pool, keine abschaltbare App-Gebühr, keinen Fee-Beweis
# des Knotens, keinen Knappheitsbonus und keine Werbe-Stufen. Die Website muss
# dasselbe sagen wie der Code (5.1.4d).
VERALTET = [
    "Protokollfee", "Protokollgebühr", "App-Gebühr", "App-Gebuehr", "für den Reward-Pool",
    "Fee-Beweis", "bis zum Dreifachen", "referral.ts", "scarcityMult", "tierName",
    "protocol takes", "reward pool,",
]

# Aussagen, die der Code nicht (mehr) deckt (0.F mit 8.16h): Das Solana-Programm
# ist erst nach der Testphase unveränderlich; interne Notizen gehören nicht auf
# die Seite; der LP startet nie mit admin.macaroon (8.3); KI über Funk ist gut
# eine Stunde Sendezeit, nicht „Stunden bei 500 Tokens“; Code-Links zeigen aufs
# Repository; die Sprachwahl kennt nur Deutsch und Englisch (8.16, Entscheidung B).
UNGEDECKT = [
    "Das Solana-Programm ist unveränderlich", "das Solana-Programm ist unveränderlich",
    "Kern in drei Sätzen", "ARM64-GX10", "admin.macaroon", "Stunden bei 500 Tokens",
    'href="https://github.com"', "Español", "日本語",
    # Seit P2a stehen neue Provider ohne Daten in der Mitte, nicht hinten (E7, P4)
    "steht aber hinten",
    # Prüfer, Prüffragen und Messberichte fielen mit P5a (Entscheidung 05.10.2026)
    "Messbericht", "PRUEFER=1", "Prüfern, denen du folgst", "Prüfer, denen du folgst",
]

# Die Status-Seite zeigt nur Öffentliches und Freiwilliges (8.15): keine
# Selbstauskünfte der Provider (38010), nie Quittungen oder ihre
# Zusammenfassungen (38075), keine alten Angebote (38025).
DASHBOARD_NIE = ["38010", "38075", "38025", "KIND_PERFORMANCE", "Leistungsnachweis", "worker"]


def main() -> int:
    fehler: list[str] = []

    for datei in SEITEN:
        pfad = os.path.join(BASIS, datei)
        if not os.path.exists(pfad):
            fehler.append(f"{datei} fehlt")
            continue

        inhalt = open(pfad, encoding="utf-8").read()

        p = Pruefer()
        p.feed(inhalt)
        if p.stack:
            fehler.append(f"{datei}: nicht geschlossene Tags {p.stack[:4]}")

        # Jeder interne Link muss auf eine Datei zeigen, die es gibt.
        for link in sorted(set(re.findall(r'href="([a-z0-9_.-]+\.html)"', inhalt))):
            ziel = ERZEUGT.get(link, os.path.join(BASIS, link))
            if not os.path.exists(ziel):
                fehler.append(f"{datei} verlinkt auf {link} — existiert nicht")

        for alt in VERALTET:
            if alt in inhalt:
                fehler.append(f"{datei}: veraltete Gebühren-Aussage „{alt}“ (Modell A+, 5.1.4d)")
        if datei == "dashboard.html":
            for wort in DASHBOARD_NIE:
                if wort in inhalt + open(os.path.join(BASIS, "js", "dashboard-daten.js"), encoding="utf-8").read():
                    fehler.append(f"dashboard.html: „{wort}“ – die Status-Seite zeigt nur Öffentliches und Freiwilliges (8.15)")
        for alt in UNGEDECKT:
            if alt in inhalt:
                fehler.append(f"{datei}: Aussage, die der Code nicht deckt: „{alt}“ (0.F)")

        # Eine Seite ohne Titel oder Beschreibung ist in Suchergebnissen blind.
        if "<title>" not in inhalt:
            fehler.append(f"{datei}: kein <title>")
        if 'name="description"' not in inhalt:
            fehler.append(f"{datei}: keine Beschreibung")

    if fehler:
        for f in fehler:
            print(f"FEHLER: {f}")
        return 1

    print(f"{len(SEITEN)} Website-Seiten ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
