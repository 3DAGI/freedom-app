#!/usr/bin/env python3
"""
Screenshots jeder Ansicht der gebauten App, Desktop und Mobil (Spur C, seit C.1a).

Nicht in der CI: Jeder Teilschritt der Phase 10 prüft damit seine Ansichten
selbst und beschreibt im Pull Request, was sich geändert hat.

Wie der Smoke-Test: frisches Profil, locale de-DE, jeder Zugriff nach außen
gesperrt. Die Merkphrase wird bestätigt, die Einrichtung übersprungen – der
Sicherungsdialog wird nie aufgenommen (er zeigt die Merkphrase).

Aufruf:  python3 scripts/screenshots.py packages/app/dist <zielordner> [--nur desktop|mobil]
Ziel nie ein Git-Checkout außer docs/ausbau/bilder/.
"""
import functools, http.server, socket, sys, threading
from pathlib import Path

GROESSEN = {"desktop": {"width": 1280, "height": 800}, "mobil": {"width": 390, "height": 844}}
# (Name, Adresse, Unter-Reiter als "gruppe:reiter" oder "")
ANSICHTEN = [
    ("agent", "#/agent", ""), ("agent-verlauf", "#/agent/verlauf", ""), ("agent-modelle", "#/agent/modelle", ""),
    ("agent-repos", "#/agent/modelle", "agent:repos"), ("chat", "#/chat", ""), ("waehrung", "#/waehrung", ""),
    ("waehrung-tauschen", "#/waehrung", "wallet:swap"), ("waehrung-hinterlegen", "#/waehrung", "wallet:lp"),
    ("verdienen", "#/verdienen", ""), ("verdienen-werben", "#/verdienen", "earn:refer"),
    ("verdienen-karte", "#/verdienen", "earn:map"), ("profil", "#/profil", ""), ("settings", "#/settings", ""),
    ("settings-verbindung", "#/settings", "settings:network"), ("settings-mesh", "#/settings", "settings:mesh"),
    ("mehr", "#/mehr", ""),
]


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    dist, ziel = Path(sys.argv[1]), Path(sys.argv[2])
    nur = sys.argv[sys.argv.index("--nur") + 1] if "--nur" in sys.argv else None
    ziel.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    class Leise(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a) -> None:  # kein Zugriffsprotokoll
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Leise, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    basis = f"http://127.0.0.1:{port}"
    fehler: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for groesse, vp in GROESSEN.items():
            if nur and groesse != nur:
                continue
            mobil = groesse == "mobil"
            ctx = browser.new_context(locale="de-DE", viewport=vp, is_mobile=mobil, has_touch=mobil)
            ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
            s = ctx.new_page()
            s.on("pageerror", lambda e: fehler.append(str(e)[:200]))
            s.goto(f"{basis}/freedom.html", wait_until="load")
            s.wait_for_selector("#bk-done", timeout=30000)
            woerter = s.evaluate("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
            s.evaluate("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", woerter)
            s.evaluate("() => document.getElementById('bk-done').click()")
            s.wait_for_timeout(1500)
            s.evaluate("() => document.getElementById('ein-abbrechen')?.click()")
            s.wait_for_timeout(500)
            for nr, (name, adresse, reiter) in enumerate(ANSICHTEN, start=1):
                s.evaluate("(a) => { location.hash = a; }", adresse)
                s.wait_for_timeout(400)
                if reiter:
                    gruppe, sub = reiter.split(":")
                    s.evaluate("([g, r]) => document.querySelector(`[data-subtab-group='${g}'] [data-subtab='${r}']`)?.click()", [gruppe, sub])
                    s.wait_for_timeout(300)
                s.screenshot(path=str(ziel / f"{groesse}-{nr:02d}-{name}.jpg"), type="jpeg", quality=70)
            ctx.close()
        browser.close()
    srv.shutdown()
    print(f"{len(list(ziel.glob('*.jpg')))} Bilder in {ziel}; Seitenfehler: {fehler or 'keine'}")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
