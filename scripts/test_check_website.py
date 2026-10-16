#!/usr/bin/env python3
"""
Selbsttest für die Farbprüfung in check-website.py (C-57c): Eine Prüfung, die still etwas übersieht, meldet „ok“,
und alle glauben es. Hier je ein Verstoß in einer Kopie der Website – jeder muss gemeldet werden.

Aufruf: python3 scripts/test_check_website.py
"""
import importlib.util, shutil, tempfile, unittest
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("check_website", Path(__file__).with_name("check-website.py"))
cw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cw)


class Farben(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.basis = Path(self.tmp) / "website"
        shutil.copytree(WURZEL / "packages" / "website", self.basis)
        cw.BASIS = str(self.basis)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp)

    def aendere(self, datei: str, alt: str, neu: str) -> None:
        p = self.basis / datei
        s = p.read_text(encoding="utf-8")
        self.assertIn(alt, s)
        p.write_text(s.replace(alt, neu, 1), encoding="utf-8")

    def test_heute_ohne_befund(self) -> None:
        self.assertEqual(cw.farben_pruefen(), [])

    def test_feste_farbe_im_css(self) -> None:
        self.aendere("css/style.css", ".ok { color: var(--accent); }", ".ok { color: #7BC80A; }")
        self.assertTrue(any("feste Farbe #7BC80A" in f for f in cw.farben_pruefen()))

    def test_feste_farbe_im_style_des_dashboards(self) -> None:
        self.aendere("dashboard.html", "#status { font-size: 12px; color: var(--text-muted); }", "#status { font-size: 12px; color: #888; }")
        self.assertTrue(any(f.startswith("dashboard.html: feste Farbe #888") for f in cw.farben_pruefen()))

    def test_feste_farbe_in_style_attribut(self) -> None:
        self.aendere("index.html", '<pre class="mono befehl">', '<pre class="mono" style="background:#000">')
        self.assertTrue(any(f.startswith("index.html: feste Farbe #000") for f in cw.farben_pruefen()))

    def test_zu_wenig_kontrast_hell(self) -> None:
        self.aendere("css/style.css", "--text-muted: #555B62;", "--text-muted: #A1A1AA;")
        self.assertTrue(any("hell --text-muted auf --bg" in f for f in cw.farben_pruefen()))

    def test_token_ohne_hellen_wert(self) -> None:
        self.aendere("css/style.css", " --code-bg: #EFF1EC;", "")
        self.assertIn("css/style.css: --code-bg ohne hellen Wert (C-57c)", cw.farben_pruefen())

    def test_ohne_hellen_block(self) -> None:
        self.aendere("css/style.css", "@media (prefers-color-scheme: light) {", "@media (min-width: 1px) {")
        self.assertEqual(cw.farben_pruefen(), ["css/style.css: Tokens für Dunkel und Hell fehlen (C-57c)"])


class Bilder(Farben):
    """Echtes Bild der App (C-58a): Größe, Alternativtext, Auslieferung."""

    def test_heute_ohne_befund(self) -> None:
        self.assertEqual(cw.bilder_pruefen(), [])

    def test_bild_fehlt(self) -> None:
        (self.basis / "bilder" / "app-en-hell.png").unlink()
        self.assertIn("bilder/app-en-hell.png fehlt (C-58a)", cw.bilder_pruefen())

    def test_falsche_groesse(self) -> None:
        p = self.basis / "bilder" / "app-de-dunkel.png"
        b = bytearray(p.read_bytes())
        b[16:20] = (640).to_bytes(4, "big")
        p.write_bytes(bytes(b))
        self.assertTrue(any("app-de-dunkel.png: kein PNG" in f for f in cw.bilder_pruefen()))

    def test_ohne_alternativtext(self) -> None:
        self.aendere("index.html", 'data-i18n-alt="heroBildAlt"', "")
        self.assertIn("index.html: Bild der App ohne Größe oder Alternativtext (C-58a)", cw.bilder_pruefen())


if __name__ == "__main__":
    unittest.main()
