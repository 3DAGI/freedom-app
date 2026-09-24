#!/usr/bin/env python3
"""
Interop-Test der Oberfläche (Schritt 2.1): Die echte App schreibt über Relays
mit einer unabhängigen NIP-17-Gegenstelle (nip17-bot.mjs, nur nostr-tools).

Geprüft wird:
  1. A (App) schreibt B über „neue DM“ – B empfängt und öffnet die Nachricht.
  2. B antwortet – die Antwort erscheint in der App, ohne „alt“-Markierung.
  3. C (unbekannt) schreibt A – in der App erscheint eine „Anfrage“.

Vorher (anderes Terminal):  node scripts/interop/nip17-bot.mjs [--relays …]
Aufruf:  python3 scripts/interop/nip17_ui_test.py [packages/app/dist] [--ausgabe /tmp/nip17-interop]
Voraussetzung: pip install playwright && python3 -m playwright install chromium
"""
import functools, http.server, json, socket, sys, threading, time
from pathlib import Path


def arg(name, vorgabe):
    return sys.argv[sys.argv.index(f"--{name}") + 1] if f"--{name}" in sys.argv else vorgabe


def main() -> int:
    dist = Path(next((a for a in sys.argv[1:] if not a.startswith("--") and not sys.argv[sys.argv.index(a) - 1].startswith("--")),
                     "packages/app/dist")).resolve()
    ausgabe = Path(arg("ausgabe", "/tmp/nip17-interop"))
    schl_datei, status_datei = ausgabe / "schluessel.json", ausgabe / "status.json"
    for _ in range(30):
        if schl_datei.exists(): break
        time.sleep(1)
    schl = json.loads(schl_datei.read_text())
    from playwright.sync_api import sync_playwright

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(dist))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    text = f"Interop-Test aus FreedomStack {int(time.time())}"
    erg = {"schritt1_b_empfangen": False, "schritt2_antwort_in_app": False, "keine_alt_markierung": None,
           "schritt3_anfrage_sichtbar": False, "pageerrors": []}
    init = ("localStorage.setItem('freedom.nsec', %s);"
            "localStorage.setItem('freedom.onboarded', '1');"
            "localStorage.setItem('freedom.relays', %s);") % (json.dumps(schl["a"]["hex"]), json.dumps(json.dumps(schl["relays"])))
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            seite = browser.new_page()
            seite.on("pageerror", lambda e: erg["pageerrors"].append(str(e)[:200]))
            seite.add_init_script(init)
            seite.goto(f"http://127.0.0.1:{port}/freedom.html", wait_until="load")
            seite.wait_for_timeout(3000)

            # 1. A schreibt B
            seite.click('[data-tab="comm"]')
            seite.wait_for_timeout(1500)
            seite.once("dialog", lambda d: d.accept(schl["b"]["npub"]))
            seite.click("#chat-new-dm")
            seite.wait_for_timeout(2000)
            seite.fill("#chat-input", text)
            seite.click("#chat-send")
            ende = time.time() + 45
            while time.time() < ende:
                st = json.loads(status_datei.read_text())
                if text in st.get("bEmpfangen", []):
                    erg["schritt1_b_empfangen"] = True; break
                seite.wait_for_timeout(1500)

            # 2. Antwort von B erscheint in der App
            ende = time.time() + 60
            while time.time() < ende and erg["schritt1_b_empfangen"]:
                seite.click(f'#chat-list .chat-item[data-cid="{schl["b"]["pubkey"]}"]')
                seite.wait_for_timeout(4000)
                faden = seite.inner_text("#chat-thread")
                if "Antwort von Bot B" in faden:
                    erg["schritt2_antwort_in_app"] = True
                    erg["keine_alt_markierung"] = "· alt" not in faden
                    break

            # 3. Anfrage von C nach Neuladen
            seite.reload(wait_until="load")
            seite.wait_for_timeout(3000)
            seite.click('[data-tab="comm"]')
            ende = time.time() + 45
            while time.time() < ende:
                if seite.query_selector(f'#chat-list .chat-item[data-cid="{schl["c"]["pubkey"]}"]') and "Anfrage" in seite.inner_text("#chat-list"):
                    erg["schritt3_anfrage_sichtbar"] = True; break
                seite.wait_for_timeout(3000)
            seite.screenshot(path=str(ausgabe / "ui.png"), full_page=True)
            browser.close()
    finally:
        srv.shutdown()
    erg["bot_status"] = json.loads(status_datei.read_text())
    erg["bestanden"] = bool(erg["schritt1_b_empfangen"] and erg["schritt2_antwort_in_app"]
                            and erg["keine_alt_markierung"] and erg["schritt3_anfrage_sichtbar"]
                            and not erg["pageerrors"])
    (ausgabe / "ergebnis.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False))
    print(json.dumps(erg, indent=1, ensure_ascii=False))
    return 0 if erg["bestanden"] else 1


if __name__ == "__main__":
    sys.exit(main())
