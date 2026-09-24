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
            if not os.path.exists(os.path.join(BASIS, link)):
                fehler.append(f"{datei} verlinkt auf {link} — existiert nicht")

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
