"""Start eines ACP-Motors in der Sandbox (VKc3, docs/VIBECODEN-ENTWURF.md).

Die Sandbox hat kein Netz. Das Modell erreicht der Motor nur ueber die Bruecke des
Knotens: einen Unix-Socket, den der Knoten nur lesbar einbindet (modell-bruecke.ts).
Dieses Skript reicht 127.0.0.1:<port> im eigenen Netz-Namensraum der Sandbox dorthin
weiter und startet dann den Motor mit stdin und stdout des Knotens (ACP). Was
durchfliesst, liest und schreibt es nicht.

Aufruf: python3 freedom_motor.py <sockel> <port> -- <befehl ...>

Seit VKg1c auch zurueck, fuer den Dev-Server der Vorschau: mit --zurueck lauscht das
Skript am Socket (in einem Ordner, den nur der Knoten und diese Sandbox sehen) und
reicht jede Verbindung an 127.0.0.1:<port> in der Sandbox weiter.

Aufruf: python3 freedom_motor.py --zurueck <sockel> <port> -- <befehl ...>
Nur die Standardbibliothek; laeuft mit dem Python des Motors.
"""

import os
import socket
import subprocess
import sys
import threading


def pumpe(von, nach):
    try:
        while True:
            daten = von.recv(65536)
            if not daten:
                break
            nach.sendall(daten)
    except OSError:
        pass
    finally:
        try:
            nach.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def nach_sockel(sockel):
    ziel = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        ziel.connect(sockel)
    except OSError:
        ziel.close()
        raise
    return ziel


def nach_port(port):
    return socket.create_connection(("127.0.0.1", port), timeout=10)


def weiter(kunde, verbinde):
    try:
        ziel = verbinde()
        ziel.settimeout(None)
    except OSError:
        kunde.close()
        return
    hin = threading.Thread(target=pumpe, args=(kunde, ziel), daemon=True)
    hin.start()
    pumpe(ziel, kunde)
    hin.join()
    kunde.close()
    ziel.close()


def main(argv):
    zurueck = len(argv) > 1 and argv[1] == "--zurueck"
    a = argv[1:] if zurueck else argv
    if len(a) < 5 or a[3] != "--" or not a[2].isdigit():
        sys.stderr.write("Aufruf: freedom_motor.py [--zurueck] <sockel> <port> -- <befehl ...>\n")
        return 2
    sockel, port, befehl = a[1], int(a[2]), a[4:]
    # erst lauschen, dann den Befehl starten - seine erste Anfrage kommt sonst ins Leere
    if zurueck:
        dienst = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        dienst.bind(sockel)
        os.chmod(sockel, 0o600)
        verbinde = lambda: nach_port(port)
    else:
        dienst = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        dienst.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        dienst.bind(("127.0.0.1", port))
        verbinde = lambda: nach_sockel(sockel)
    dienst.listen(16)

    def annehmen():
        while True:
            kunde, _ = dienst.accept()
            threading.Thread(target=weiter, args=(kunde, verbinde), daemon=True).start()

    threading.Thread(target=annehmen, daemon=True).start()
    try:
        return subprocess.call(befehl)
    except OSError:
        return 127


if __name__ == "__main__":
    sys.exit(main(sys.argv))
