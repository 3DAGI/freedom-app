"""Banner für die README (C-25) im Stil von Website und App.

Variante „Hero“ wie auf der Website: links die Aussage, rechts das Agent-Fenster mit der
Demo-Szene der Startseite; dahinter dasselbe Partikel-Netz wie im Website-Hero, fest
gewürfelt. Gerendert mit Chromium (Python-Playwright, wie der Smoke-Test) in doppelter
Auflösung. Das PNG entsteht nicht bitgleich auf jedem Rechner (Schriften) – es gehört
nicht zur App und nicht zum reproduzierbaren Build.

    python3 scripts/banner.py              # docs/bilder/banner.png (Englisch)
    python3 scripts/banner.py --sprache de # docs/bilder/banner-de.png
"""
import math
import random
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HIER = Path(__file__).parent
GRUEN = "#7BC80A"

LOGO = (
    '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">'
    '<path d="M22 10 H12 V54 H22" stroke="currentColor" stroke-width="7" stroke-linecap="square"/>'
    '<path d="M42 10 H52 V54 H42" stroke="currentColor" stroke-width="7" stroke-linecap="square"/>'
    '<rect x="27" y="27" width="10" height="10" fill="currentColor"/></svg>'
)
BTC = (
    '<svg viewBox="10.5 0.8 12.6 22.4" fill="#f7931a"><path d="M16.15 12.03c1.44-.36 2.42-1.32 2.24-3.02-.23-2.13-1.98-2.85-4.23-3.05l-.01-2.44h-1.51l-.01 2.38c-.4 0-.81.01-1.21.01l.01-2.39H9.92l-.01 2.44c-.33.01-.65.01-.97.01v-.01H6.88l.01 1.62s1.11-.02 1.09-.01c.61 0 .81.36.87.67v2.77c.04 0 .1.01.16.03h-.16v3.88c-.03.19-.13.49-.54.49.02.01-1.09 0-1.09 0l-.3 1.81h2.55c.34 0 .68.01 1.01.01l.01 2.47h1.51l.01-2.44c.41.01.81.01 1.21.02l-.01 2.43h1.51l.01-2.46c2.58-.15 4.37-.8 4.59-3.18.18-1.93-.73-2.79-2.17-3.14zm-4.7-4.71c.86 0 3.57-.17 3.57 1.53 0 1.63-2.71 1.45-3.57 1.45zm0 7.63v-3.19c1.04 0 4.28-.19 4.28 1.6 0 1.71-3.24 1.59-4.28 1.59z"/></svg>'
)
SOL = (
    '<svg viewBox="0 0 397.7 311.7"><defs><linearGradient id="sg" x1="360.9" y1="351.4" x2="141.4" y2="-69.3" gradientUnits="userSpaceOnUse">'
    '<stop offset="0" stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs><g fill="url(#sg)">'
    '<path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"/>'
    '<path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"/>'
    '<path d="M332.3 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H5.7c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></g></svg>'
)
NOSTR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>'
SCHLOSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>'
CODE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>'


def netz(b: int, h: int, saat: int, dichte: int, leer: list[tuple[float, float, float, float]] | None = None) -> str:
    """Partikel-Netz wie im Website-Hero: grüne Quadrate, Linien unter 60 px Abstand."""
    zufall = random.Random(saat)
    n = max(60, (b * h) // dichte)
    pkte = []
    for _ in range(n):
        x, y = zufall.random() * b, zufall.random() * h
        # in freizuhaltenden Flächen (Text) dünner
        if leer and any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in leer) and zufall.random() < 0.8:
            continue
        pkte.append((x, y, 0.45 + zufall.random() * 0.5, 2 + zufall.random() * 1.6))
    linien = []
    for i in range(len(pkte)):
        for j in range(i + 1, len(pkte)):
            dx, dy = pkte[i][0] - pkte[j][0], pkte[i][1] - pkte[j][1]
            d2 = dx * dx + dy * dy
            if d2 < 3600:
                a = 0.24 * (1 - math.sqrt(d2) / 60) + 0.06
                linien.append(f'<line x1="{pkte[i][0]:.1f}" y1="{pkte[i][1]:.1f}" x2="{pkte[j][0]:.1f}" y2="{pkte[j][1]:.1f}" stroke-opacity="{a:.2f}"/>')
    quadrate = "".join(f'<rect x="{x:.1f}" y="{y:.1f}" width="{s:.1f}" height="{s:.1f}" fill-opacity="{a:.2f}"/>' for x, y, a, s in pkte)
    return (
        f'<svg class="netz" viewBox="0 0 {b} {h}" width="{b}" height="{h}">'
        f'<g stroke="{GRUEN}" stroke-width="1">{"".join(linien)}</g><g fill="{GRUEN}">{quadrate}</g></svg>'
    )


BASIS_CSS = f"""
:root {{ --bg:#050505; --card:#0A0A0A; --border:#1E1E1E; --accent:{GRUEN}; --text:#E0E0E0; --muted:#A1A1AA; }}
* {{ box-sizing:border-box; margin:0; padding:0; }}
html, body {{ background:var(--bg); }}
body {{ font-family:"JetBrains Mono","DejaVu Sans Mono","Noto Sans Mono",ui-monospace,monospace; color:var(--text); }}
.bild {{ position:relative; overflow:hidden; background:radial-gradient(ellipse at 30% 40%, #0c1406 0%, var(--bg) 60%); }}
.netz {{ position:absolute; inset:0; opacity:.8; }}
.rand {{ position:absolute; inset:0; border:1px solid var(--border); pointer-events:none; }}
.inhalt {{ position:absolute; inset:0; }}
.marke {{ display:flex; align-items:center; gap:12px; color:var(--accent); font-weight:700; letter-spacing:4px; }}
.marke svg {{ width:1em; height:1em; }}
.g {{ color:var(--accent); }}
.muted {{ color:var(--muted); }}
.chips {{ display:flex; gap:10px; flex-wrap:wrap; }}
.chip {{ display:inline-flex; align-items:center; gap:7px; border:1px solid var(--border); background:rgba(10,10,10,.85);
        border-radius:3px; padding:6px 11px; font-size:14px; color:var(--text); }}
.chip svg {{ width:14px; height:14px; color:var(--accent); }}
.fenster {{ background:#0a0c0a; border:1px solid var(--border); border-radius:8px; overflow:hidden;
           box-shadow:0 24px 64px rgba(123,200,10,.10), 0 4px 24px rgba(0,0,0,.6); }}
.leiste {{ display:flex; align-items:center; gap:6px; padding:9px 12px; background:#101210; border-bottom:1px solid var(--border); }}
.leiste i {{ width:10px; height:10px; border-radius:50%; }}
.leiste i:nth-child(1) {{ background:#cc5544; }} .leiste i:nth-child(2) {{ background:#ccaa33; }} .leiste i:nth-child(3) {{ background:#66bb44; }}
.leiste span {{ margin-left:8px; font-size:12px; color:var(--muted); }}
.koerper {{ padding:16px 18px; font-size:14px; line-height:1.8; }}
.du {{ color:var(--text); }} .prov {{ color:var(--muted); }} .ant {{ color:var(--text); opacity:.92; }} .bez {{ color:var(--accent); }}
.cursor {{ display:inline-block; width:8px; height:15px; background:var(--accent); vertical-align:-2px; margin-left:2px; }}
"""

CHIPS_DE = (
    f'<span class="chip">{BTC} Lightning</span><span class="chip">{SOL} Solana</span>'
    f'<span class="chip">{NOSTR} Nostr</span><span class="chip">{SCHLOSS} Ohne Verwahrung</span>'
    f'<span class="chip">{CODE} Open Source</span>'
)
CHIPS_EN = (
    f'<span class="chip">{BTC} Lightning</span><span class="chip">{SOL} Solana</span>'
    f'<span class="chip">{NOSTR} Nostr</span><span class="chip">{SCHLOSS} Non-custodial</span>'
    f'<span class="chip">{CODE} Open source</span>'
)

FENSTER_DE = f"""
<div class="fenster"><div class="leiste"><i></i><i></i><i></i><span>freedom — agent</span></div>
<div class="koerper">
<div class="du">du: erklär mir, wie Lightning funktioniert</div>
<div class="prov">&gt; suche einen Provider im Netz…</div>
<div class="prov">✓ Provider e18a… übernimmt die Anfrage</div>
<div class="ant">Lightning ist ein Zahlungsnetz auf Bitcoin: Kanäle halten Guthaben, Zahlungen laufen sofort über Routen …<span class="cursor"></span></div>
<div class="bez">» 82 msat bezahlt, direkt an den Provider</div>
</div></div>"""

FENSTER_EN = f"""
<div class="fenster"><div class="leiste"><i></i><i></i><i></i><span>freedom — agent</span></div>
<div class="koerper">
<div class="du">you: explain how Lightning works</div>
<div class="prov">&gt; looking for a provider on the network…</div>
<div class="prov">✓ provider e18a… takes the request</div>
<div class="ant">Lightning is a payment network on Bitcoin: channels hold balances, payments route instantly …<span class="cursor"></span></div>
<div class="bez">» 82 msat paid, directly to the provider</div>
</div></div>"""


def seite(b: int, h: int, css: str, inhalt: str, saat: int, dichte: int, leer=None) -> str:
    return (
        f'<!doctype html><html><head><meta charset="utf-8"><style>{BASIS_CSS}{css}'
        f'.bild {{ width:{b}px; height:{h}px; }}</style></head><body>'
        f'<div class="bild">{netz(b, h, saat, dichte, leer)}<div class="inhalt">{inhalt}</div><div class="rand"></div></div>'
        f"</body></html>"
    )


def hero(sprache: str) -> str:
    """A – wie der Website-Hero: links Aussage, rechts das Agent-Fenster (1280×400)."""
    de = sprache == "de"
    css = """
.links { position:absolute; left:64px; top:52px; width:640px; }
.links .marke { font-size:22px; margin-bottom:34px; }
.links .chips { gap:8px; flex-wrap:nowrap; }
.links .chip { font-size:13px; padding:6px 10px; }
h1 { font-size:40px; line-height:1.22; font-weight:700; letter-spacing:.5px; margin-bottom:18px; }
.sub { font-size:17px; line-height:1.55; margin-bottom:26px; max-width:600px; }
.rechts { position:absolute; right:56px; top:70px; width:470px; }
"""
    titel = ("Kommunizieren. KI nutzen.<br><span class='g'>Bezahlen — ohne Betreiber.</span>" if de
             else "Message. Use AI.<br><span class='g'>Pay — without an operator.</span>")
    sub = ("Nachrichten, KI-Rechenzeit und Zahlungen über Nostr, Lightning und Solana. Kein Konto, kein Token – niemand verwahrt dein Geld." if de
           else "Messages, AI compute and payments over Nostr, Lightning and Solana. No account, no token – nobody holds your money.")
    inhalt = (f'<div class="links"><div class="marke">{LOGO}FREEDOM</div><h1>{titel}</h1>'
              f'<p class="sub muted">{sub}</p><div class="chips">{CHIPS_DE if de else CHIPS_EN}</div></div>'
              f'<div class="rechts">{FENSTER_DE if de else FENSTER_EN}</div>')
    return seite(1280, 400, css, inhalt, 7, 4200, [(40, 30, 720, 380)])


def baue(sprache: str) -> Path:
    ziel = HIER.parent / "docs" / "bilder" / ("banner.png" if sprache == "en" else f"banner-{sprache}.png")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        seite_ = browser.new_page(viewport={"width": 1280, "height": 400}, device_scale_factor=2)
        seite_.set_content(hero(sprache))
        seite_.screenshot(path=str(ziel), clip={"x": 0, "y": 0, "width": 1280, "height": 400})
        browser.close()
    return ziel


if __name__ == "__main__":
    sprache = sys.argv[sys.argv.index("--sprache") + 1] if "--sprache" in sys.argv else "en"
    if sprache not in ("en", "de"):
        sys.exit("--sprache en|de")
    print(baue(sprache))
