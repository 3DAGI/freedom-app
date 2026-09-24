#!/usr/bin/env python3
"""
Smoke-Test fuer die gebaute App (dist/freedom.html).

Prueft im Headless-Chromium:
  - die App startet (window.freedomApp existiert), keine Skriptfehler
  - eine Content-Security-Policy ist gesetzt
  - ein eingeschleuster Inline-Handler (onerror=...) wird NICHT ausgefuehrt
  - Fremddaten landen als Text, nicht als HTML: ein gespeicherter Verlauf mit
    HTML im Modellnamen des Providers (Schritt 0.B) wird wiederhergestellt
  - Tresor (Schritt 1.2): Merkphrase bestaetigen, Tresor einrichten, danach
    Speicher-Scan – der Schluessel steht weder in localStorage noch im Klartext
    in IndexedDB; neu laden, falsche und richtige Passphrase; „Passphrase
    vergessen“ ueber die 12 Woerter – die Identitaet bleibt dieselbe

Verbindungsfehler zu Relays werden ignoriert (hängen vom Netz ab).

Aufruf:  python3 agent/werkzeuge/smoke_test.py packages/app/dist
Voraussetzung: pip install playwright && python3 -m playwright install chromium
Exit-Code 0 = bestanden, 1 = durchgefallen.
"""
import functools, http.server, json, socket, sys, threading

# Verlauf mit HTML im Modellnamen und in meta – beides kam frueher roh ins HTML.
PROBE_VERLAUF = [{"id": "probe", "title": "Probe", "at": 1790000000, "messages": [
    {"role": "user", "text": "frage", "meta": ""},
    {"role": "ai", "text": "antwort", "meta": "<b id='probe-meta'>m</b>",
     "model": "<img id='probe-modell' src='x'>"}]}]
from pathlib import Path


def freier_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def tresor_pruefen(browser, url: str) -> dict:
    """Tresor-Ablauf in einem frischen Profil, ohne Netz nach aussen."""
    erg = {"fehler": []}
    ctx = browser.new_context()
    basis = url.rsplit("/", 1)[0]
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    ev = s.evaluate

    def warte(bedingung: str) -> None:
        s.wait_for_function(bedingung, timeout=30000)

    def felder(werte: dict, knopf: str) -> None:
        ev("([w, k]) => { for (const [id, v] of Object.entries(w)) document.getElementById(id).value = v;"
           " document.getElementById(k).click(); }", [werte, knopf])

    s.goto(url, wait_until="load")
    s.wait_for_timeout(2500)
    woerter = ev("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
    ev("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", woerter)
    ev("() => document.getElementById('bk-done').click()")
    nsec = ev("() => localStorage.getItem('freedom.nsec')") or ""
    ident = ev("() => document.getElementById('ident').textContent")
    erg["start"] = len(woerter) == 12 and len(nsec) == 64

    ev("() => document.querySelector('.app-nav button[data-tab=\"settings\"]').click()")
    ev("() => document.querySelector('.sec-action[data-step=\"4\"]').click()")
    felder({"tr-neu1": "smoke tresor 1", "tr-neu2": "smoke tresor 1"}, "tr-ok")
    warte("() => !document.getElementById('tr-ok')")
    scan = ev("""async (nsec) => {
      const ls = Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('\\n');
      const blob = await new Promise((r) => { const q = indexedDB.open('freedom-vault');
        q.onsuccess = () => { const g = q.result.transaction('tresor').objectStore('tresor').get('blob');
          g.onsuccess = () => r(g.result); }; q.onerror = () => r(null); });
      return { klar_in_ls: ls.includes(nsec), blob: typeof blob === 'string',
               klar_in_blob: String(blob).includes(nsec), merker: localStorage.getItem('freedom.vault') };
    }""", nsec)
    erg["speicher_scan"] = (scan["blob"] and not scan["klar_in_ls"] and not scan["klar_in_blob"]
                            and scan["merker"] == "1")

    s.reload(wait_until="load")
    warte("() => !!document.getElementById('tr-pass')")
    erg["gesperrt_ohne_identitaet"] = ev("() => document.getElementById('ident').textContent") != ident
    felder({"tr-pass": "falsche passphrase"}, "tr-ok")
    warte("() => document.getElementById('tr-meldung').textContent.includes('falsch')")
    felder({"tr-pass": "smoke tresor 1"}, "tr-ok")
    warte("() => !document.getElementById('tr-pass')")
    s.wait_for_timeout(1000)
    erg["entsperrt_gleiche_identitaet"] = ev("() => document.getElementById('ident').textContent") == ident

    s.reload(wait_until="load")
    warte("() => !!document.getElementById('tr-vergessen')")
    ev("() => document.getElementById('tr-vergessen').click()")
    felder({"tr-phrase": " ".join(woerter), "tr-neu1": "smoke tresor 2", "tr-neu2": "smoke tresor 2"}, "tr-ok")
    warte("() => !document.getElementById('tr-phrase')")
    s.wait_for_timeout(1000)
    erg["vergessen_gleiche_identitaet"] = ev("() => document.getElementById('ident').textContent") == ident
    ctx.close()
    erg["bestanden"] = (not erg["fehler"] and all(v is True for k, v in erg.items()
                                                   if k not in ("fehler", "bestanden")))
    return erg


def main() -> int:
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "packages/app/dist").resolve()
    datei = dist / "freedom.html"
    if not datei.exists():
        print(f"FEHLT: {datei} – vorher bauen (node build.mjs)")
        return 1
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright fehlt: pip install playwright && python3 -m playwright install chromium")
        return 1

    port = freier_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(dist))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    erg = {"pageerrors": [], "csp_verletzungen": []}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            seite = browser.new_page()
            seite.on("pageerror", lambda e: erg["pageerrors"].append(str(e)[:300]))
            seite.add_init_script(
                "document.addEventListener('securitypolicyviolation', e => {"
                " (window.__csp = window.__csp || []).push(e.violatedDirective); });"
                f"localStorage.setItem('freedom.agentHistory', {json.dumps(json.dumps(PROBE_VERLAUF))});"
            )
            seite.goto(f"http://127.0.0.1:{port}/freedom.html", wait_until="load")
            seite.wait_for_timeout(4000)
            erg["booted"] = seite.evaluate("typeof window.freedomApp")
            erg["csp_gesetzt"] = seite.evaluate(
                "!!document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')")
            seite.evaluate("""() => { const d = document.createElement('div');
                d.innerHTML = '<img src=x onerror="window.__xss=1">';
                document.body.appendChild(d); }""")
            seite.wait_for_timeout(800)
            erg["xss_ausgefuehrt"] = seite.evaluate("window.__xss === 1")
            # Verlauf oeffnen: addAiMessage() bekommt Modellname und meta aus dem Speicher.
            seite.evaluate("() => document.querySelector('.history-item[data-hid=\"probe\"]')?.click()")
            seite.wait_for_timeout(300)
            erg["fremd_als_text"] = seite.evaluate(
                "!document.getElementById('probe-modell') && !document.getElementById('probe-meta')"
                " && [...document.querySelectorAll('#ai-thread .who')].some(e => e.textContent.includes('<img'))")
            erg["csp_verletzungen"] = seite.evaluate("window.__csp || []")
            erg["tresor"] = tresor_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            browser.close()
    finally:
        srv.shutdown()

    ok = (erg.get("booted") == "object" and not erg["pageerrors"]
          and erg.get("csp_gesetzt") and erg.get("xss_ausgefuehrt") is False
          and erg.get("fremd_als_text") is True
          and erg.get("tresor", {}).get("bestanden") is True)
    erg["bestanden"] = bool(ok)
    print(json.dumps(erg, indent=1, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
