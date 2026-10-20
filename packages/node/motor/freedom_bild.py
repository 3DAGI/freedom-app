"""Bildstrom eines Programms aus der Sandbox (VKg2a2, docs/VIBECODEN-ENTWURF.md VKg2).

Startet einen virtuellen Bildschirm (Xvfb) und schickt sein Bild ueber WebRTC (GStreamer webrtcbin) an
die App - nur ueber den TURN des Knotens, den diese Sandbox ueber dessen Tunnel erreicht (turn-tunnel.ts;
freedom_motor.py reicht 127.0.0.1:<port> dorthin). Das Programm des Projekts startet der Knoten in einer
eigenen Sandbox; mit dieser teilt es nur den Socket des Bildschirms (/tmp/.X11-unix). Eingaben ueber den
Datenkanal "eingabe" kommen mit VKg2a3.

Aufruf: python3 freedom_bild.py <breite> <hoehe>
stdin, eine Zeile JSON: {"turn": "<turn://...?transport=tcp>", "angebot": "<SDP der App>"}
stdout, eine Zeile JSON: {"antwort": "<SDP>"} oder {"fehler": "<kennung>"} - danach nichts mehr.
Es laeuft, bis stdin endet oder die Verbindung abbricht. Nur die Standardbibliothek, PyGObject
(GStreamer).
"""

import json
import os
import subprocess
import sys
import threading
import time

ANZEIGE = ":99"
SOCKEL_X = "/tmp/.X11-unix/X99"
SAMMELN_SEK = 15
# PyGObject gibt den ICE-Agenten beim Aufraeumen seiner Huelle frei, ohne ihn genommen zu haben -
# die Huelle lebt deshalb so lange wie das Skript
BEHALTEN = []

def melde(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def warte_auf_anzeige(xvfb):
    for _ in range(200):
        if os.path.exists(SOCKEL_X):
            return True
        if xvfb.poll() is not None:
            return False
        time.sleep(0.05)
    return False


def main(argv):
    if len(argv) != 3 or not argv[1].isdigit() or not argv[2].isdigit():
        melde({"fehler": "aufruf"})
        return 2
    breite, hoehe = int(argv[1]), int(argv[2])
    try:
        auftrag = json.loads(sys.stdin.readline())
        turn, angebot = auftrag["turn"], auftrag["angebot"]
        if not isinstance(turn, str) or not isinstance(angebot, str):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        melde({"fehler": "eingabe"})
        return 2

    try:
        import gi
        gi.require_version("Gst", "1.0")
        gi.require_version("GstWebRTC", "1.0")
        gi.require_version("GstSdp", "1.0")
        from gi.repository import GLib, Gst, GstSdp, GstWebRTC
    except (ImportError, ValueError):
        melde({"fehler": "gstreamer"})
        return 3

    leise = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    try:
        xvfb = subprocess.Popen(["Xvfb", ANZEIGE, "-screen", "0", f"{breite}x{hoehe}x24", "-nolisten", "tcp", "-noreset"], **leise)
    except OSError:
        melde({"fehler": "anzeige"})
        return 3

    def aufraeumen():
        if xvfb.poll() is None:
            xvfb.terminate()

    if not warte_auf_anzeige(xvfb):
        aufraeumen()
        melde({"fehler": "anzeige"})
        return 3

    Gst.init(None)
    try:
        pipe = Gst.parse_launch(
            f"ximagesrc display-name={ANZEIGE} use-damage=false show-pointer=true ! video/x-raw,framerate=30/1 "
            "! videoconvert ! queue leaky=downstream max-size-buffers=2 "
            "! vp8enc deadline=1 cpu-used=8 threads=4 target-bitrate=3000000 end-usage=cbr keyframe-max-dist=120 "
            "! rtpvp8pay pt=96 ! application/x-rtp,media=video,encoding-name=VP8,payload=96,clock-rate=90000 "
            "! webrtcbin name=w bundle-policy=max-bundle ice-transport-policy=relay")
    except GLib.Error:
        aufraeumen()
        melde({"fehler": "gstreamer"})
        return 3
    w = pipe.get_by_name("w")
    BEHALTEN.append(w.get_property("ice-agent"))
    # In der Sandbox gibt es nur lo - libnice laesst Loopback sonst aus und sammelt gar nichts
    BEHALTEN[-1].emit("add-local-ip-address", "127.0.0.1")
    w.emit("add-turn-server", turn)
    schleife = GLib.MainLoop()
    zustand = {"gemeldet": False}

    def ende_mit(fehler=None):
        if fehler and not zustand["gemeldet"]:
            zustand["gemeldet"] = True
            melde({"fehler": fehler})
        schleife.quit()
        return False

    def gesammelt(el, _p):
        if el.get_property("ice-gathering-state") != GstWebRTC.WebRTCICEGatheringState.COMPLETE or zustand["gemeldet"]:
            return
        beschr = el.get_property("local-description")
        if beschr is None:
            GLib.idle_add(ende_mit, "antwort")
            return
        zustand["gemeldet"] = True
        melde({"antwort": beschr.sdp.as_text()})

    def verbindung(el, _p):
        z = el.get_property("connection-state")
        if z in (GstWebRTC.WebRTCPeerConnectionState.FAILED, GstWebRTC.WebRTCPeerConnectionState.CLOSED):
            GLib.idle_add(ende_mit)

    def antwort_da(promise, _):
        promise.wait()
        r = promise.get_reply()
        a = r.get_value("answer") if r is not None and r.has_field("answer") else None
        if a is None:
            GLib.idle_add(ende_mit, "antwort")
            return
        w.emit("set-local-description", a, Gst.Promise.new())

    def angebot_gesetzt(promise, _):
        promise.wait()
        w.emit("create-answer", None, Gst.Promise.new_with_change_func(antwort_da, None))

    def fehler_im_bus(_bus, nachricht):
        if nachricht.type == Gst.MessageType.ERROR:
            GLib.idle_add(ende_mit, "gstreamer")

    w.connect("notify::ice-gathering-state", gesammelt)
    w.connect("notify::connection-state", verbindung)
    bus = pipe.get_bus()
    bus.add_signal_watch()
    bus.connect("message", fehler_im_bus)

    ok, msg = GstSdp.SDPMessage.new_from_text(angebot)
    if ok != GstSdp.SDPResult.OK or pipe.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
        aufraeumen()
        melde({"fehler": "angebot" if ok != GstSdp.SDPResult.OK else "gstreamer"})
        return 3
    beschr = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.OFFER, msg)
    w.emit("set-remote-description", beschr, Gst.Promise.new_with_change_func(angebot_gesetzt, None))

    def lies_stdin():
        sys.stdin.read()
        GLib.idle_add(ende_mit)

    threading.Thread(target=lies_stdin, daemon=True).start()
    GLib.timeout_add_seconds(SAMMELN_SEK, lambda: ende_mit("zeit") if not zustand["gemeldet"] else False)
    GLib.timeout_add(500, lambda: ende_mit() if xvfb.poll() is not None else True)
    schleife.run()
    pipe.set_state(Gst.State.NULL)
    aufraeumen()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
