"""MCP-Server als Attrappe für die Tests des MCP-Clients (B-31): stdio, eine JSON-Nachricht je Zeile.

Werkzeuge: echo (gibt den Text zurück), lang (sehr lange Ausgabe), kaputt (isError), schlaf (antwortet nie rechtzeitig),
netz (versucht eine Verbindung nach außen – in der Sandbox gibt es keine), bild (Text und Bild). Ein Werkzeug mit unzulässigem Namen wird
mitgeliefert, damit der Client zeigt, dass er es weglässt.
"""
import json
import socket
import sys
import time

WERKZEUGE = [
    {"name": "echo", "description": "Gibt den Text zurück.", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
    {"name": "lang", "description": "Sehr lange Ausgabe.", "inputSchema": {"type": "object"}},
    {"name": "kaputt", "description": "Scheitert immer.", "inputSchema": {"type": "object"}},
    {"name": "schlaf", "description": "Braucht zu lange.", "inputSchema": {"type": "object"}},
    {"name": "netz", "description": "Versucht eine Verbindung nach außen.", "inputSchema": {"type": "object"}},
    {"name": "bild", "description": "Text und ein Bild.", "inputSchema": {"type": "object"}},
    {"name": "böse name; rm", "description": "Unzulässiger Name.", "inputSchema": {"type": "object"}},
]


def sende(nachricht):
    sys.stdout.write(json.dumps(nachricht) + "\n")
    sys.stdout.flush()


def ergebnis(text, fehler=False):
    return {"content": [{"type": "text", "text": text}], "isError": fehler}


for zeile in sys.stdin:
    m = json.loads(zeile)
    methode, nr = m.get("method"), m.get("id")
    if nr is None:
        continue  # Benachrichtigung
    if methode == "initialize":
        sende({"jsonrpc": "2.0", "id": nr, "result": {"protocolVersion": m["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "attrappe", "version": "1"}}})
    elif methode == "tools/list":
        # zwei Seiten: erst drei Werkzeuge, dann der Rest
        cursor = (m.get("params") or {}).get("cursor")
        if cursor is None:
            sende({"jsonrpc": "2.0", "id": nr, "result": {"tools": WERKZEUGE[:3], "nextCursor": "seite2"}})
        else:
            sende({"jsonrpc": "2.0", "id": nr, "result": {"tools": WERKZEUGE[3:]}})
    elif methode == "tools/call":
        name = m["params"]["name"]
        args = m["params"].get("arguments") or {}
        if name == "echo":
            sende({"jsonrpc": "2.0", "id": nr, "result": ergebnis(str(args.get("text", "")))})
        elif name == "lang":
            sende({"jsonrpc": "2.0", "id": nr, "result": ergebnis("x" * 20000)})
        elif name == "kaputt":
            sende({"jsonrpc": "2.0", "id": nr, "result": ergebnis("geht nicht", True)})
        elif name == "schlaf":
            time.sleep(30)
        elif name == "bild":
            sende({"jsonrpc": "2.0", "id": nr, "result": {"content": [{"type": "text", "text": "vorher"}, {"type": "image", "data": "", "mimeType": "image/png"}]}})
        elif name == "netz":
            try:
                socket.create_connection(("1.1.1.1", 443), timeout=2)
                sende({"jsonrpc": "2.0", "id": nr, "result": ergebnis("netz-offen")})
            except OSError:
                sende({"jsonrpc": "2.0", "id": nr, "result": ergebnis("kein-netz")})
        else:
            sende({"jsonrpc": "2.0", "id": nr, "error": {"code": -32602, "message": "unbekannt"}})
    else:
        sende({"jsonrpc": "2.0", "id": nr, "error": {"code": -32601, "message": "Method not found"}})
