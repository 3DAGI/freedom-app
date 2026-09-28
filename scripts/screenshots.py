#!/usr/bin/env python3
"""
Screenshots jeder Ansicht der gebauten App, Desktop und Mobil (Spur C, seit C.1a).

Nicht in der CI: Jeder Teilschritt der Phase 10 prüft damit seine Ansichten
selbst und beschreibt im Pull Request, was sich geändert hat.

Wie der Smoke-Test: frisches Profil, locale de-DE, jeder Zugriff nach außen
gesperrt. Die Merkphrase wird bestätigt, die Einrichtung übersprungen – der
Sicherungsdialog wird nie aufgenommen (er zeigt die Merkphrase). Seit C.2b2
antwortet eine Relay-Attrappe mit dem Probe-Raum (`scripts/raum-probe.mts`).

Aufruf:  python3 scripts/screenshots.py packages/app/dist <zielordner> [--nur desktop|mobil]
Ziel nie ein Git-Checkout außer docs/ausbau/bilder/.
"""
import functools, http.server, re, socket, sys, threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import ProbeRelay, raum_probe  # noqa: E402

GROESSEN = {"desktop": {"width": 1280, "height": 800}, "mobil": {"width": 390, "height": 844}}
# (Name, Adresse, Unter-Reiter als "gruppe:reiter" oder ""[, Knopf, der einen Dialog öffnet])
ANSICHTEN = [
    ("agent", "#/agent", ""), ("agent-verlauf", "#/agent/verlauf", ""), ("agent-modelle", "#/agent/modelle", ""),
    ("chat", "#/chat", ""), ("repos", "#/repos", ""), ("waehrung", "#/waehrung", ""),
    ("waehrung-tauschen", "#/waehrung", "wallet:swap"), ("waehrung-hinterlegen", "#/waehrung", "wallet:lp"),
    ("verdienen", "#/verdienen", ""), ("verdienen-werben", "#/verdienen", "earn:refer"),
    ("netz-karte", "#/netz", ""), ("netz-mesh", "#/netz", "netz:mesh"), ("profil", "#/profil", ""),
    ("settings", "#/settings", ""), ("settings-verbindung", "#/settings", "settings:network"),
    ("mehr", "#/mehr", ""),
    # Dialoge (seit C.2b1): Knopf, der ihn öffnet, als vierter Eintrag; danach Esc
    ("dialog-beitreten", "#/chat", "", "#rail-join"), ("dialog-anlegen", "#/chat", "", "#space-create"),
    ("dialog-oeffentlich", "#/chat", "", "#space-create-public"),
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
            # Seit C.2b2: Relay-Attrappe mit dem Probe-Raum (wie im Smoke-Test)
            relay = ProbeRelay()
            ctx.route_web_socket(re.compile(r"^wss?://"), relay.verbinde)
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
            for nr, (name, adresse, reiter, *knopf) in enumerate(ANSICHTEN, start=1):
                s.evaluate("(a) => { location.hash = a; }", adresse)
                s.wait_for_timeout(400)
                if reiter:
                    gruppe, sub = reiter.split(":")
                    s.evaluate("([g, r]) => document.querySelector(`[data-subtab-group='${g}'] [data-subtab='${r}']`)?.click()", [gruppe, sub])
                    s.wait_for_timeout(300)
                if knopf:
                    s.evaluate("(k) => document.querySelector(k)?.click()", knopf[0])
                    s.wait_for_timeout(300)
                s.screenshot(path=str(ziel / f"{groesse}-{nr:02d}-{name}.jpg"), type="jpeg", quality=70)
                if knopf:
                    s.keyboard.press("Escape")
            # Probe-Raum: Verlauf, Aktionen an einer Nachricht, Raum-Menü (mobil: Kanalliste)
            if relay.ich:
                relay.events = raum_probe(relay.ich)
                nr = len(ANSICHTEN)
                s.evaluate("() => { location.hash = '#/chat'; document.getElementById('rail-join').click(); }")
                s.wait_for_timeout(300)
                s.keyboard.type("probe-raum")
                s.keyboard.press("Enter")
                s.wait_for_timeout(2500)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 1:02d}-raum.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.querySelectorAll('#channel-thread .msg-zeile')[2]?.focus()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 2:02d}-raum-aktionen.jpg"), type="jpeg", quality=70)
                # Thread (seit C.2c): offen, „Antwort an …“ auf die letzte Antwort
                s.evaluate("() => document.querySelector('#channel-thread .thread-link')?.click()")
                s.wait_for_timeout(200)
                s.evaluate("() => { const b = [...document.querySelectorAll('#thread-verlauf .antworten')]; b[b.length - 1]?.click(); }")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 3:02d}-raum-thread.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.getElementById('thread-zu')?.click()")
                # Mitglieder (seit C.2d1): mobil als Ebene; das Menü am ersten Mitglied mit Menü
                if mobil:
                    s.evaluate("() => document.getElementById('kanal-mitglieder').click()")
                s.evaluate("() => document.querySelector('#member-list .mitglied-knopf')?.click()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 4:02d}-raum-mitglieder.jpg"), type="jpeg", quality=70)
                s.keyboard.press("Escape")
                if mobil:
                    s.evaluate("() => document.getElementById('mitglieder-zu').click()")
                    s.evaluate("() => document.getElementById('channel-zurueck').click()")
                s.evaluate("() => document.getElementById('space-menue-knopf').click()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 5:02d}-raum-menue.jpg"), type="jpeg", quality=70)
            ctx.close()
        browser.close()
    srv.shutdown()
    print(f"{len(list(ziel.glob('*.jpg')))} Bilder in {ziel}; Seitenfehler: {fehler or 'keine'}")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
