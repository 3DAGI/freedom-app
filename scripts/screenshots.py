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
from smoke_test import PROBE_BUNDLE, ProbeRelay, raum_probe  # noqa: E402

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
            # Seit C.4b ein fester Probe-Ort für „mein Gebiet zeigen“ (nie der echte)
            ctx = browser.new_context(locale="de-DE", viewport=vp, is_mobile=mobil, has_touch=mobil,
                                      geolocation={"latitude": 48.137154, "longitude": 11.576124}, permissions=["geolocation"])
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
                s.keyboard.press("Escape")
                # Eigener offener Raum (seit C.2d2): das Menü mit „Kanal anlegen“ und dessen Dialog
                s.evaluate("() => document.getElementById('space-create-public').click()")
                s.wait_for_timeout(200)
                s.keyboard.type("Werkstatt")
                s.keyboard.press("Enter")
                s.wait_for_timeout(2500)
                s.keyboard.press("Escape")
                if mobil:
                    s.evaluate("() => document.getElementById('channel-zurueck').click()")
                s.evaluate("() => document.getElementById('space-menue-knopf').click()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 6:02d}-eigener-raum-menue.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.getElementById('space-kanal-neu').click()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 7:02d}-kanal-anlegen.jpg"), type="jpeg", quality=70)
                s.keyboard.press("Escape")
                # Repos (seit C.3a): Liste mit einer Karte, dann die Repo-Seite mit dem offenen Patch
                s.evaluate("() => { location.hash = '#/repos'; }")
                s.wait_for_timeout(1500)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 8:02d}-repos.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.querySelector('#repos-karten .repo-karte')?.click()")
                s.wait_for_timeout(300)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 9:02d}-repo-seite.jpg"), type="jpeg", quality=70)
                # Seit C.3a2: Reiter „Mitwirkende“, dann ein eigenes Repo mit „Einstellungen“
                s.evaluate("() => document.querySelector('#repo-seite [data-reiter=mitwirkende]')?.click()")
                s.wait_for_timeout(800)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 10:02d}-repo-mitwirkende.jpg"), type="jpeg", quality=70)
                s.evaluate("() => { document.querySelector('.repo-zurueck')?.click(); document.getElementById('nip34-ankuendigen').click(); }")
                s.wait_for_timeout(200)
                s.keyboard.type("meins")
                s.keyboard.press("Enter")
                s.wait_for_timeout(200)
                s.keyboard.press("Enter")
                s.wait_for_timeout(1500)
                s.evaluate("() => [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'meins')?.click()")
                s.wait_for_timeout(200)
                s.evaluate("() => document.querySelector('#repo-seite [data-reiter=einstellungen]')?.click()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 11:02d}-repo-einstellungen.jpg"), type="jpeg", quality=70)
                # Seit C.3b1: der offene Patch von „werkzeug“ als eigene Seite mit Änderungen
                s.evaluate("""() => { document.querySelector('.repo-zurueck')?.click();
                  [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'werkzeug')?.click(); }""")
                s.wait_for_timeout(200)
                s.evaluate("() => { document.querySelector('#repo-seite [data-reiter=patches]')?.click(); document.querySelector('#repo-seite .repo-patch-betreff')?.click(); }")
                s.wait_for_timeout(300)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 12:02d}-patch-seite.jpg"), type="jpeg", quality=70)
                # Seit C.3b2: Annehmen als Dialog mit Commit und Begründung, danach die Angaben zum Status
                s.evaluate("() => document.querySelector('#repo-seite .patch-aktionen button')?.click()")
                s.wait_for_timeout(200)
                s.keyboard.type("c" * 40)
                s.keyboard.press("Tab")
                s.keyboard.type("Danke, eingespielt.")
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 13:02d}-status-dialog.jpg"), type="jpeg", quality=70)
                s.keyboard.press("Control+Enter")
                s.wait_for_timeout(1200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 14:02d}-patch-angenommen.jpg"), type="jpeg", quality=70)
                # Seit C.3c1: das eigene Repo bekommt ein echtes Bundle, der Reiter „Code“ liest es in der App
                s.evaluate("""() => { document.querySelector('.repo-zurueck')?.click();
                  [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'meins')?.click();
                  document.querySelector('#repo-seite [data-reiter=einstellungen]')?.click(); }""")
                s.wait_for_timeout(200)
                datei = "#repo-seite .repo-hochladen input[type=file]"
                if s.evaluate(f"() => !!document.querySelector('{datei}')"):
                    s.set_input_files(datei, files=[{"name": "meins.bundle", "mimeType": "application/octet-stream", "buffer": PROBE_BUNDLE}])
                    s.wait_for_timeout(2500)
                s.evaluate("() => document.querySelector('#repo-seite [data-reiter=code]')?.click()")
                s.wait_for_timeout(200)
                s.evaluate("() => document.querySelector('#repo-seite .code-laden')?.click()")
                s.wait_for_timeout(2500)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 15:02d}-code.jpg"), type="jpeg", quality=70)
                # Seit C.3c2: eine Datei im Ordner src, dann der Reiter „Commits“ mit aufgeklapptem Commit
                for name in ("src/", "liste.txt"):
                    s.evaluate(f"() => [...document.querySelectorAll('#repo-seite .code-eintrag')].find(b => b.textContent === '{name}')?.click()")
                    s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 16:02d}-code-datei.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.querySelector('#repo-seite [data-reiter=commits]')?.click()")
                s.wait_for_timeout(200)
                s.evaluate("() => document.querySelector('#repo-seite .code-commits details summary')?.click()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 17:02d}-commits.jpg"), type="jpeg", quality=70)
                # Seit C.4a: Abdeckungskarte aus den Probe-Einträgen – Welt, näher an Europa mit gewähltem Gebiet, Liste
                s.evaluate("() => { location.hash = '#/netz'; document.querySelector(\"[data-subtab-group='netz'] [data-subtab='map']\")?.click(); }")
                s.wait_for_timeout(1500)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 18:02d}-karte-welt.jpg"), type="jpeg", quality=70)
                s.evaluate("""() => { for (let i = 0; i < 10; i++) { const k = document.querySelector('#coverage-svg svg'); const r = k.getBoundingClientRect();
                    k.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: r.left + 189 / 360 * r.width, clientY: r.top + 42 / 180 * r.height, bubbles: true, cancelable: true })); }
                  document.querySelector('#coverage-svg [data-zelle="lora:48.00,11.00"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }""")
                s.wait_for_timeout(300)
                s.evaluate("() => document.querySelector('#coverage-karte').scrollIntoView({ block: 'start' })")
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 19:02d}-karte-europa.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.querySelector('#coverage-ansicht [data-ansicht=liste]')?.click()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 20:02d}-karte-liste.jpg"), type="jpeg", quality=70)
                # Seit C.4b: Umrisse, eigenes Gebiet (gerundet, nur umrandet) und „Mein Gebiet“
                s.evaluate("() => { document.querySelector('#coverage-ansicht [data-ansicht=karte]')?.click(); document.getElementById('coverage-standort')?.click(); }")
                s.wait_for_timeout(1500)
                s.evaluate("() => { document.getElementById('coverage-meins')?.click(); document.querySelector('#coverage-karte').scrollIntoView({ block: 'start' }); }")
                s.wait_for_timeout(300)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 21:02d}-karte-eigen.jpg"), type="jpeg", quality=70)
                s.evaluate("() => { document.getElementById('coverage-welt')?.click(); document.querySelector('#coverage-karte').scrollIntoView({ block: 'start' }); }")
                s.wait_for_timeout(300)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 22:02d}-karte-umrisse.jpg"), type="jpeg", quality=70)
                # Seit 11.4c: im Probe-Raum die Liste seiner Repos (mobil auf der Ebene der Kanäle), die Repo-Seite mit dem Raum,
                # im eigenen Raum das Menü mit „Repo anlegen“
                s.evaluate("() => { location.hash = '#/chat'; document.querySelector('#space-rail .space-pill[data-space=\"probe-raum\"]')?.click(); }")
                s.wait_for_timeout(1500)
                if mobil:
                    s.evaluate("() => document.getElementById('channel-zurueck')?.click()")
                    s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 23:02d}-raum-repos.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.querySelector('#raum-repos .raum-repo')?.click()")
                s.wait_for_timeout(1000)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 24:02d}-raum-repo-seite.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.querySelector('#repo-seite .repo-zum-raum')?.click()")
                s.wait_for_timeout(1000)
                s.evaluate("() => [...document.querySelectorAll('#space-rail .space-pill')].find(p => p.dataset.space.startsWith('werkstatt-'))?.click()")
                s.wait_for_timeout(1500)
                if mobil:
                    s.evaluate("() => document.getElementById('channel-zurueck')?.click()")
                s.evaluate("() => document.getElementById('space-menue-knopf').click()")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 25:02d}-raum-repo-anlegen.jpg"), type="jpeg", quality=70)
                s.keyboard.press("Escape")
                # Seit C-17b1: Reiter „Issues“ von „werkzeug“ – Liste und die Seite des Issues mit Kommentar
                s.evaluate("""() => { location.hash = '#/repos'; }""")
                s.wait_for_timeout(1500)
                s.evaluate("() => [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'werkzeug')?.click()")
                s.wait_for_timeout(300)
                s.evaluate("() => document.querySelector('#repo-seite [data-reiter=issues]')?.click()")
                s.wait_for_timeout(300)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 26:02d}-issues.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.querySelector('#repo-seite .issue-betreff')?.click()")
                s.wait_for_timeout(300)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 27:02d}-issue-seite.jpg"), type="jpeg", quality=70)
                # Seit C-17b2/C-17c: Diskussion unter dem Issue (Status-Knöpfe, Feld) und unter dem angenommenen Patch
                s.evaluate("() => document.querySelector('#repo-seite .kommentar-feld')?.scrollIntoView({ block: 'end' })")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 28:02d}-issue-diskussion.jpg"), type="jpeg", quality=70)
                s.evaluate("() => document.querySelector('#repo-seite [data-reiter=patches]')?.click()")
                s.wait_for_timeout(200)
                s.evaluate("() => document.querySelector('#repo-seite .repo-filter [data-filter=angenommen]')?.click()")
                s.evaluate("() => document.querySelector('#repo-seite .repo-patch-betreff')?.click()")
                s.wait_for_timeout(300)
                s.evaluate("() => document.querySelector('#repo-seite .kommentar-feld')?.scrollIntoView({ block: 'end' })")
                s.wait_for_timeout(200)
                s.screenshot(path=str(ziel / f"{groesse}-{nr + 29:02d}-patch-diskussion.jpg"), type="jpeg", quality=70)
            ctx.close()
        browser.close()
    srv.shutdown()
    print(f"{len(list(ziel.glob('*.jpg')))} Bilder in {ziel}; Seitenfehler: {fehler or 'keine'}")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
