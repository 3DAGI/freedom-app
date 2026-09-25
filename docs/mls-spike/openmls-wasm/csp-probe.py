import json
from playwright.sync_api import sync_playwright
P = "pkg-web/"  # Ausgabe von wasm-bindgen --target web
def seite(csp):
    return f"""<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="{csp}"></head><body>
<script type="module">
import init, {{ spike }} from "./mls_wasm_spike.js";
try {{ await init(); document.title = "OK " + spike(); }} catch (e) {{ document.title = "FEHLER " + e; }}
</script></body></html>"""
erg = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, csp in [("mit wasm-unsafe-eval", "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"),
                      ("ohne", "default-src 'self'; script-src 'self' 'unsafe-inline'")]:
        pg = b.new_page()
        def route(r):
            url = r.request.url
            if url.endswith("/index.html"): r.fulfill(body=seite(csp), content_type="text/html")
            else:
                f = url.split("/")[-1]
                r.fulfill(path=P + f, content_type="application/wasm" if f.endswith(".wasm") else "text/javascript")
        pg.route("http://spike.test/**", route)
        pg.goto("http://spike.test/index.html"); pg.wait_for_timeout(2500)
        erg[name] = pg.title()[:160]
    b.close()
print(json.dumps(erg, indent=1, ensure_ascii=False))
