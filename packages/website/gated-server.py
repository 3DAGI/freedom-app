#!/usr/bin/env python3
"""
freedom website — Passwort-Gate-Server.
Ein einziges GET-Passwort (kein User-Management, kein Account).
Dient nur dazu, die oeffentliche Funnel-URL nicht komplett offen zu lassen,
bis das dezentrale Deployment steht. KEIN Sicherheits-Feature, nur ein Riegel.

Start: SITE_PASSWORD=<pw> python3 gated-server.py [port]
"""
import hashlib
import hmac
import http.server
import os
import threading
import time
import urllib.parse
import secrets
import time
import urllib.request

PORT = int(os.environ.get("PORT", "3600"))
SITE_PASSWORD = os.environ.get("SITE_PASSWORD", "")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
COMFY_URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
ROOT = os.path.dirname(os.path.abspath(__file__))
COOKIE_NAME = "freedom_gate"
# HMAC-Secret aus Passwort abgeleitet (kein separates Secret nötig)
COOKIE_TTL = 60 * 60 * 24 * 30  # 30 Tage

if not SITE_PASSWORD:
    raise SystemExit("SITE_PASSWORD env fehlt")


def make_token() -> str:
    exp = str(int(time.time()) + COOKIE_TTL)
    sig = hmac.new(SITE_PASSWORD.encode(), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def check_token(token: str) -> bool:
    try:
        exp, sig = token.split(".", 1)
    except ValueError:
        return False
    if int(exp) < time.time():
        return False
    want = hmac.new(SITE_PASSWORD.encode(), exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, want)


LOGIN_PAGE = """<!doctype html><html lang=de><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<meta name=theme-color content=#7BC80A><title>freedom</title>
<style>
body{background:#050505;color:#E0E0E0;font-family:ui-monospace,Menlo,monospace;
display:flex;align-items:center;justify-content:center;height:100dvh;margin:0}
form{background:#0A0A0A;border:1px solid #1E1E1E;padding:24px;border-radius:2px;
width:300px;text-align:center}
.logo{color:#7BC80A;font-weight:700;letter-spacing:2px;margin-bottom:16px;font-size:18px}
input{width:100%;background:#050505;border:1px solid #1E1E1E;color:#E0E0E0;
padding:12px;font-family:inherit;font-size:14px;margin-bottom:12px;border-radius:2px}
button{width:100%;background:#7BC80A;color:#000;border:none;padding:12px;
font-family:inherit;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
border-radius:2px;cursor:pointer;font-size:12px}
.err{color:#CC3333;font-size:11px;margin-bottom:10px}
</style></head><body>
<form method=post action="/__gate">
<div class=logo>FREEDOM</div>
{err}
<input type=password name=pw placeholder="Passwort" autofocus autocomplete=current-password>
<button type=submit>Enter</button>
</form></body></html>"""


class _RateLimiter:
    """Sehr einfache Bremse gegen Passwort-Raten.

    Bewusst pro IP und im Arbeitsspeicher: dieser Server ist ein Zugangstor
    fuer eine Vorschau-Seite, kein Identitaetsdienst. Wichtig ist nur, dass
    automatisiertes Durchprobieren unattraktiv wird.
    """

    def __init__(self, max_fails=6, window=300, block=300):
        self.max_fails, self.window, self.block = max_fails, window, block
        self._fails = {}
        self._lock = threading.Lock()

    def fail(self, ip):
        now = time.time()
        with self._lock:
            hits = [t for t in self._fails.get(ip, []) if now - t < self.window]
            hits.append(now)
            self._fails[ip] = hits
            return max(0, self.max_fails - len(hits))

    def blocked_for(self, ip):
        now = time.time()
        with self._lock:
            hits = [t for t in self._fails.get(ip, []) if now - t < self.window]
            self._fails[ip] = hits
            if len(hits) < self.max_fails:
                return 0
            return int(self.block - (now - hits[-1])) + 1

    def reset(self, ip):
        with self._lock:
            self._fails.pop(ip, None)


_rate_limiter = _RateLimiter()

# Dateien, die nie ausgeliefert werden duerfen. Der Server reicht sonst das
# ganze Verzeichnis heraus — inklusive Sicherungskopien und alter Builds.
BLOCKED_SUFFIXES = (".bak", ".py", ".pyc", ".log", ".env", ".key", ".pem", "~")
BLOCKED_NAMES = {"gated-server.py", "build.sh", "DEPLOY.md", "index.html.bak"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _client_ip(self):
        # Hinter einem Reverse-Proxy steht die echte IP im Header.
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    def _is_https(self):
        return self.headers.get("X-Forwarded-Proto", "").lower() == "https"

    def _is_blocked_path(self, path):
        name = os.path.basename(path.split("?")[0])
        if name in BLOCKED_NAMES:
            return True
        return any(name.endswith(sfx) for sfx in BLOCKED_SUFFIXES)

    def _authorized(self) -> bool:
        cookie = self.headers.get("Cookie", "")
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith(COOKIE_NAME + "="):
                return check_token(part[len(COOKIE_NAME) + 1:])
        return False

    def _send_login(self, err: str = ""):
        err_html = f'<div class=err>{err}</div>' if err else ""
        # .format() kollidiert mit CSS-Klammern — einfache Ersetzung stattdessen
        body = LOGIN_PAGE.replace("{err}", err_html).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/__gate"):
            self._send_login()
            return
        if not self._authorized():
            self._send_login()
            return
        # Sicherungskopien, Skripte und Logs liegen im selben Verzeichnis wie
        # die Seite. Ohne diese Sperre liefert der Server sie mit aus.
        if self._is_blocked_path(self.path):
            self.send_error(404)
            return
        if self.path.startswith("/ollama/"):
            self._proxy_ollama("GET")
            return
        if self.path.startswith("/comfy/"):
            self._proxy_comfy("GET")
            return
        super().do_GET()

    def end_headers(self):
        # freedom.html (die App) immer frisch liefern — kein stale cache
        if self.path.endswith("freedom.html") or self.path == "/":
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def _proxy_to(self, base: str, prefix: str, method: str, timeout: int = 120):
        """Generischer reverse-proxy fuer /ollama + /comfy (loest CORS/mixed-content)."""
        try:
            target = base + self.path[len(prefix):]
            body = None
            if method in ("POST", "PUT"):
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length) if length else None
            req = urllib.request.Request(target, data=body, method=method)
            req.add_header("Content-Type", self.headers.get("Content-Type", "application/json"))
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:
            msg = f'{{"error":"proxy {prefix}: {e}"}}'.encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def _proxy_ollama(self, method: str):
        """Proxy /ollama/* -> OLLAMA_URL (lokaler Chat-Fallback)."""
        self._proxy_to(OLLAMA_URL, "/ollama", method)

    def _proxy_comfy(self, method: str):
        """Proxy /comfy/* -> COMFY_URL (ComfyUI/H3 video_gen)."""
        self._proxy_to(COMFY_URL, "/comfy", method, timeout=600)

    def do_POST(self):
        if self.path == "/__gate":
            # Ohne Bremse ist ein einzelnes Passwort in Minuten durchprobiert.
            ip = self._client_ip()
            wait = _rate_limiter.blocked_for(ip)
            if wait > 0:
                self._send_login(f"zu viele Versuche — bitte {wait} Sekunden warten")
                return

            length = min(int(self.headers.get("Content-Length", 0)), 4096)
            body = self.rfile.read(length).decode("utf-8", "replace")
            pw = ""
            for kv in body.split("&"):
                if kv.startswith("pw="):
                    # Formulardaten sind prozentkodiert: ohne unquote scheitert
                    # jedes Passwort mit Sonderzeichen oder Leerzeichen.
                    pw = urllib.parse.unquote_plus(kv[3:])
            if hmac.compare_digest(pw, SITE_PASSWORD):
                _rate_limiter.reset(ip)
                token = make_token()
                secure = "; Secure" if self._is_https() else ""
                self.send_response(303)
                self.send_header("Set-Cookie", f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax{secure}; Max-Age={COOKIE_TTL}")
                self.send_header("Location", "/")
                self.end_headers()
            else:
                remaining = _rate_limiter.fail(ip)
                hint = "falsches Passwort" if remaining > 1 else "falsches Passwort — naechster Fehlversuch sperrt kurz"
                self._send_login(hint)
            return
        if self.path.startswith("/ollama/"):
            if not self._authorized():
                self._send_login()
                return
            self._proxy_ollama("POST")
            return
        if self.path.startswith("/comfy/"):
            if not self._authorized():
                self._send_login()
                return
            self._proxy_comfy("POST")
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):  # ruhig
        pass


if __name__ == "__main__":
    print(f"freedom gate auf :{PORT} (passwortgeschuetzt)")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
