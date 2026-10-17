"""Start eines ACP-Motors in der Sandbox (VKc3, docs/VIBECODEN-ENTWURF.md).

Die Sandbox hat kein Netz. Das Modell erreicht der Motor nur ueber die Bruecke des
Knotens: einen Unix-Socket, den der Knoten nur lesbar einbindet (modell-bruecke.ts).
Dieses Skript reicht 127.0.0.1:<port> im eigenen Netz-Namensraum der Sandbox dorthin
weiter und startet dann den Motor mit stdin und stdout des Knotens (ACP). Was
durchfliesst, liest und schreibt es nicht.

Aufruf: python3 freedom_motor.py <sockel> <port> -- <befehl ...>
Nur die Standardbibliothek; laeuft mit dem Python des Motors.
"""

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


def weiter(kunde, sockel):
    ziel = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        ziel.connect(sockel)
    except OSError:
        kunde.close()
        ziel.close()
        return
    hin = threading.Thread(target=pumpe, args=(kunde, ziel), daemon=True)
    hin.start()
    pumpe(ziel, kunde)
    hin.join()
    kunde.close()
    ziel.close()


def main(argv):
    if len(argv) < 5 or argv[3] != "--" or not argv[2].isdigit():
        sys.stderr.write("Aufruf: freedom_motor.py <sockel> <port> -- <befehl ...>\n")
        return 2
    sockel, port, befehl = argv[1], int(argv[2]), argv[4:]
    # erst lauschen, dann den Motor starten - seine erste Anfrage kommt sonst ins Leere
    dienst = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    dienst.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    dienst.bind(("127.0.0.1", port))
    dienst.listen(16)

    def annehmen():
        while True:
            kunde, _ = dienst.accept()
            threading.Thread(target=weiter, args=(kunde, sockel), daemon=True).start()

    threading.Thread(target=annehmen, daemon=True).start()
    try:
        return subprocess.call(befehl)
    except OSError:
        return 127


if __name__ == "__main__":
    sys.exit(main(sys.argv))
