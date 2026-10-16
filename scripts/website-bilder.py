#!/usr/bin/env python3
"""
Bilder der App für die Startseite der Website (C-58a, Oberflächen-Review 15.10.2026): die echte App aus dem Build,
keine nachgestellte Szene. Agent-Seite am Desktop, je Sprache (de, en) und Design (dunkel, hell) ein Bild – die
Website zeigt das, das zu Sprache und Gerät passt.

Wie der Smoke-Test: frisches Profil, locale de-DE, jeder Zugriff nach außen gesperrt; die Merkphrase wird
bestätigt, die Einrichtung übersprungen. Neu erzeugen, wenn sich die Agent-Seite sichtbar ändert, und die Bilder
mitcommiten:

    python3 scripts/website-bilder.py packages/app/dist packages/website/bilder
"""
import functools, http.server, sys, threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import DialogSeite, ProbeRelay, freier_port  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BREITE, HOEHE = 1200, 760
BILDER = {f"app-{sprache}-{design}.png": (sprache, schema)
          for sprache in ("de", "en") for design, schema in (("dunkel", "dark"), ("hell", "light"))}


def main() -> int:
    dist, ziel = Path(sys.argv[1]).resolve(), Path(sys.argv[2])
    ziel.mkdir(parents=True, exist_ok=True)
    port = freier_port()
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(dist))
    h.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    fehler: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for datei, (sprache, schema) in BILDER.items():
            erg = {"fehler": []}
            seite = DialogSeite(browser, f"http://127.0.0.1:{port}/freedom.html", ProbeRelay(), erg,
                                init=f"localStorage.setItem('freedom.lang', '{sprache}');",
                                viewport={"width": BREITE, "height": HOEHE}, farbschema=schema)
            seite.ev("() => { location.hash = '#/agent'; }")
            seite.s.wait_for_function("() => !!document.querySelector('#page-ai.active')", timeout=10000)
            # Ohne Meldung oben rechts („Identität gesichert“) und ohne Übergänge im Bild
            seite.s.wait_for_function("() => document.getElementById('toast').hidden", timeout=15000)
            seite.s.add_style_tag(content="*, *::before, *::after { transition: none !important; animation: none !important; }")
            seite.s.screenshot(path=str(ziel / datei))
            fehler += erg["fehler"]
            seite.ctx.close()
        browser.close()
    srv.shutdown()
    for f in fehler:
        print(f"FEHLER: {f}")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
