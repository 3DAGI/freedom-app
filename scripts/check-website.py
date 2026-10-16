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
    # Seit P5b (Entscheidung 05.10.2026): Entwicklung 2 %, 0,5 % Prüfbudget beim Kunden
    "2,5 % Entwicklung", "2,5 % an die Entwicklung", "2.5% development",
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

# Fremde Adressen in Befehlen zum Kopieren (C-21): freedomstack.io gehört nicht
# zum Projekt (DNS: NXDOMAIN, 07.10.2026) – wer sie registriert, bekäme jeden
# „curl … | bash“; wallet.cash ist ein verwahrender Dienst und taugt nicht als
# Beispiel für Provider-Einnahmen. Geprüft auf der Website und in den
# Einstiegsdateien des Repositorys.
FREMDE_ADRESSEN = ["freedomstack.io", "wallet.cash"]
EINSTIEG = ["README.md", os.path.join("docs", "PROVIDER.md"), "docker-compose.yml",
            os.path.join("scripts", "install-freedom.sh")]

# Downloads der App (6.1c2a): Links auf Dateien des Releases nur unter dieser
# Adresse und nur mit Namen, die der Job „veroeffentlichen“ in launcher.yml
# erzeugt (plus SHA256SUMS) – sonst zeigte die Seite auf eine Datei, die es nie
# gibt. Das APK nur, wenn der Job es mit dem festen Schlüssel signiert.
RELEASE_DOWNLOAD = "https://github.com/3DAGI/freedom-app/releases/latest/download/"
RELEASE_JOB = os.path.join(".github", "workflows", "launcher.yml")


def release_dateien() -> set[str]:
    job = open(RELEASE_JOB, encoding="utf-8").read().split("\n  veroeffentlichen:", 1)
    if len(job) < 2:
        return set()
    namen = set(re.findall(r"\bfreedom-(?:linux|windows|android)-[a-z0-9]+(?:\.AppImage|\.deb|-setup\.exe|\.apk)\b", job[1]))
    return namen | {"SHA256SUMS"}


# Die Status-Seite zeigt nur Öffentliches und Freiwilliges (8.15): keine
# Selbstauskünfte der Provider (38010), nie Quittungen oder ihre
# Zusammenfassungen (38075), keine alten Angebote (38025).
DASHBOARD_NIE = ["38010", "38075", "38025", "KIND_PERFORMANCE", "Leistungsnachweis", "worker"]


def navigation_pruefen() -> list[str]:
    """Eine Navigation für alle Seiten (C-48): dieselben Ziele, der Menü-Knopf fürs Handy samt Skript,
    die eigene Seite als „aria-current“; Text ohne Serifen, Monospace nur für Code."""
    fehler: list[str] = []
    listen: dict[str, list[str]] = {}
    for datei in SEITEN:
        inhalt = open(os.path.join(BASIS, datei), encoding="utf-8").read()
        m = re.search(r'<nav id="site-nav" aria-label="Website">(.*?)</nav>', inhalt, re.S)
        if not m:
            fehler.append(f"{datei}: keine Navigation „site-nav“ (C-48)")
            continue
        listen[datei] = re.findall(r'<a href="([^"]+)"', m.group(1))
        if 'id="nav-toggle"' not in inhalt or 'aria-controls="site-nav"' not in inhalt or '<script src="js/nav.js"></script>' not in inhalt:
            fehler.append(f"{datei}: Menü-Knopf oder js/nav.js fehlt (C-48)")
        eigene = re.findall(r'<a href="([^"]+)" aria-current="page">', m.group(1))
        if datei != "index.html" and eigene != [datei]:
            fehler.append(f"{datei}: die eigene Seite ist nicht als aria-current markiert {eigene} (C-48)")
    erste = listen.get(SEITEN[0])
    for datei, liste in listen.items():
        if liste != erste:
            fehler.append(f"{datei}: andere Navigation als {SEITEN[0]} – {liste} statt {erste} (C-48)")
    css = open(os.path.join(BASIS, "css", "style.css"), encoding="utf-8").read()
    koerper = re.search(r"\nbody \{(.*?)\}", css, re.S)
    if not koerper or "font-family: var(--font-body);" not in koerper.group(1) or "monospace" in koerper.group(1):
        fehler.append("css/style.css: Fließtext nicht ohne Serifen (C-48)")
    return fehler


# In beiden Designs gleich (C-57c): Schatten und die drei Fensterpunkte der Terminal-Demo
FARBEN_BEIDE = {"rgba(0,0,0,.6)", "rgba(0,0,0,.5)", "rgba(123,200,10,.07)", "#cc5544", "#ccaa33", "#66bb44"}


def _leuchte(farbe: str) -> float:
    x = farbe.lstrip("#")
    if len(x) == 3:
        x = "".join(c * 2 for c in x)
    kanaele = [int(x[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    r, g, b = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in kanaele]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def kontrast(a: str, b: str) -> float:
    hell, dunkel = sorted([_leuchte(a), _leuchte(b)], reverse=True)
    return (hell + 0.05) / (dunkel + 0.05)


def farben_pruefen() -> list[str]:
    """Zwei Designs (C-57c): Die Website folgt dem Gerät. Jede Farbe steht als Token in `:root` (dunkel) und im
    Block `prefers-color-scheme: light`; Schrift erreicht auf Grund und Karte in beiden mindestens 4,5:1. Feste
    Farben nur in den Tokens – nicht im übrigen CSS, nicht im `<style>` des Dashboards, nicht in `style="…"`."""
    fehler: list[str] = []
    css = open(os.path.join(BASIS, "css", "style.css"), encoding="utf-8").read()
    ohne = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    dunkel_m = re.search(r"^:root \{(.*?)\}", ohne, re.S | re.M)
    hell_m = re.search(r"@media \(prefers-color-scheme: light\) \{\s*:root \{(.*?)\}", ohne, re.S)
    if not dunkel_m or not hell_m:
        return ["css/style.css: Tokens für Dunkel und Hell fehlen (C-57c)"]
    tokens = lambda t: dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", t))
    dunkel, hell = tokens(dunkel_m.group(1)), tokens(hell_m.group(1))
    for name, wert in dunkel.items():
        if re.fullmatch(r"#[0-9a-fA-F]{3,8}|rgba?\(.*\)", wert.strip()) and name not in hell:
            fehler.append(f"css/style.css: {name} ohne hellen Wert (C-57c)")
    for design, t in (("dunkel", dunkel), ("hell", hell)):
        for flaeche in ("--bg", "--card"):
            for schrift in ("--text", "--text-muted", "--accent", "--amber", "--red"):
                k = kontrast(t[schrift], t[flaeche])
                if k < 4.5:
                    fehler.append(f"css/style.css: {design} {schrift} auf {flaeche} nur {k:.2f}:1 (C-57c)")
        if kontrast(t["--auf-akzent"], t["--accent"]) < 4.5:
            fehler.append(f"css/style.css: {design} Schrift auf Grün zu schwach (C-57c)")
    rest = ohne.replace(dunkel_m.group(0), "").replace(hell_m.group(0), "")
    for farbe in re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)", rest):
        if farbe.lower() not in FARBEN_BEIDE:
            fehler.append(f"css/style.css: feste Farbe {farbe} außerhalb der Tokens (C-57c)")
    for datei in SEITEN:
        inhalt = open(os.path.join(BASIS, datei), encoding="utf-8").read()
        for stil in re.findall(r"<style>(.*?)</style>", inhalt, re.S) + re.findall(r'style="([^"]*)"', inhalt):
            for farbe in re.findall(r"(?<![-\w])#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)", stil):
                if not re.search(r"--brand:\s*" + re.escape(farbe), stil):
                    fehler.append(f"{datei}: feste Farbe {farbe} im Stil statt eines Tokens (C-57c)")
    return fehler


def main() -> int:
    fehler: list[str] = []
    im_release = release_dateien()
    if not im_release - {"SHA256SUMS"}:
        fehler.append(f"{RELEASE_JOB}: kein Job „veroeffentlichen“ mit Dateinamen (6.1c2a)")

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
        for adresse in FREMDE_ADRESSEN:
            if adresse in inhalt:
                fehler.append(f"{datei}: fremde Adresse „{adresse}“ (C-21)")

        for link in re.findall(r'href="(https://github\.com/[^"]*/releases/[^"]*download/[^"]*)"', inhalt):
            if not link.startswith(RELEASE_DOWNLOAD) or link[len(RELEASE_DOWNLOAD):] not in im_release:
                fehler.append(f"{datei}: Download „{link}“ – den erzeugt der Release-Job nicht (6.1c2a)")

        # Eine Seite ohne Titel oder Beschreibung ist in Suchergebnissen blind.
        if "<title>" not in inhalt:
            fehler.append(f"{datei}: kein <title>")
        if 'name="description"' not in inhalt:
            fehler.append(f"{datei}: keine Beschreibung")

    fehler += navigation_pruefen()
    fehler += farben_pruefen()

    for datei in EINSTIEG:
        inhalt = open(datei, encoding="utf-8").read()
        for adresse in FREMDE_ADRESSEN:
            if adresse in inhalt:
                fehler.append(f"{datei}: fremde Adresse „{adresse}“ (C-21)")

    if fehler:
        for f in fehler:
            print(f"FEHLER: {f}")
        return 1

    print(f"{len(SEITEN)} Website-Seiten ok, {len(EINSTIEG)} Einstiegsdateien ohne fremde Adressen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
