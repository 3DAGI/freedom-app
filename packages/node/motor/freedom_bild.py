"""Bildstrom eines Programms aus der Sandbox (VKg2a2, Eingaben VKg2a3; docs/VIBECODEN-ENTWURF.md VKg2).

Startet einen virtuellen Bildschirm (Xvfb) und schickt sein Bild ueber WebRTC (GStreamer webrtcbin) an
die App - nur ueber den TURN des Knotens, den diese Sandbox ueber dessen Tunnel erreicht (turn-tunnel.ts;
freedom_motor.py reicht 127.0.0.1:<port> dorthin). Das Programm des Projekts startet der Knoten in einer
eigenen Sandbox; mit dieser teilt es nur den Socket des Bildschirms (/tmp/.X11-unix). Maus, Beruehrung
und Tasten kommen ueber den Datenkanal "eingabe" zurueck (VKg2a3) und gehen per XTest an den Bildschirm -
an nichts sonst.

Kodiert wird nach dem Angebot der App (VKg2c2): die Nummer des Formats (payload type) aus dem Angebot - Firefox nennt
VP8 120, Chromium 96 -, mit "h264" H.264 ueber NVENC, wo es das Angebot nennt und GStreamer nvh264enc hat, sonst VP8.

Aufruf: python3 freedom_bild.py <breite> <hoehe> [vp8|h264]
stdin, eine Zeile JSON: {"turn": "<turn://...?transport=tcp>", "angebot": "<SDP der App>"}
stdout, eine Zeile JSON: {"antwort": "<SDP>", "kodierer": "<vp8enc|nvh264enc>"} oder {"fehler": "<kennung>"} -
danach nichts mehr.
Es laeuft, bis stdin endet oder die Verbindung abbricht. Nur die Standardbibliothek, PyGObject
(GStreamer) und python-xlib.
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
NACHRICHT_MAX = 200
# PyGObject gibt den ICE-Agenten beim Aufraeumen seiner Huelle frei, ohne ihn genommen zu haben -
# die Huelle lebt deshalb so lange wie das Skript
BEHALTEN = []

# Kodierer: VP8 in Software; H.264 nur ueber NVENC (nur, wo der Knoten der Sandbox die GPU gibt) - kein H.264 in
# Software (openh264 scheitert auf Ubuntu 24.04 mit cmInitParaError, x264 ist GPL, und H.264 traegt Patente)
KODIERER = {
    "vp8enc": "vp8enc deadline=1 cpu-used=8 threads=4 target-bitrate=3000000 end-usage=cbr keyframe-max-dist=120",
    "nvh264enc": "nvh264enc preset=low-latency-hq rc-mode=cbr bitrate=6000 gop-size=60 zerolatency=true bframes=0",
}

# Tasten wie KeyboardEvent.key -> Name des Keysyms in X
TASTEN = {
    "Enter": "Return", "Backspace": "BackSpace", "Tab": "Tab", "Escape": "Escape", " ": "space",
    "ArrowLeft": "Left", "ArrowRight": "Right", "ArrowUp": "Up", "ArrowDown": "Down",
    "Shift": "Shift_L", "Control": "Control_L", "Alt": "Alt_L", "Meta": "Super_L", "CapsLock": "Caps_Lock",
    "Delete": "Delete", "Insert": "Insert", "Home": "Home", "End": "End", "PageUp": "Prior", "PageDown": "Next",
    **{f"F{i}": f"F{i}" for i in range(1, 13)},
}


def melde(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


class Eingabe:
    """Maus und Tasten per XTest - nur Bewegung, Knoepfe 1-5 und Tasten, nichts sonst."""

    def __init__(self, breite, hoehe):
        from Xlib import X, XK, display
        from Xlib.ext import xtest
        self.X, self.XK, self.xtest = X, XK, xtest
        self.d = display.Display(ANZEIGE)
        self.breite, self.hoehe = breite, hoehe
        self.gedrueckt = set()
        self.frei = None
        self.shift = self.d.keysym_to_keycode(XK.string_to_keysym("Shift_L"))

    def keysym(self, wert):
        name = TASTEN.get(wert)
        if name:
            return self.XK.string_to_keysym(name)
        if len(wert) != 1:
            return 0
        cp = ord(wert)
        return cp if 0x20 <= cp <= 0x7E or 0xA0 <= cp <= 0xFF else 0x01000000 | cp

    def tastencode(self, keysym):
        kc = self.d.keysym_to_keycode(keysym)
        if kc:
            return kc
        # Zeichen ohne Taste (etwa Umlaute auf der US-Belegung): eine freie Taste dafuer belegen
        if self.frei is None:
            erster = self.d.display.info.min_keycode
            belegung = self.d.get_keyboard_mapping(erster, self.d.display.info.max_keycode - erster + 1)
            leer = [erster + i for i, z in enumerate(belegung) if not any(z)]
            self.frei = leer[-1] if leer else 0
        if not self.frei:
            return 0
        self.d.change_keyboard_mapping(self.frei, [(keysym,) * 4])
        self.d.sync()
        return self.frei

    def zeiger(self, e):
        x, y = e.get("x"), e.get("y")
        if isinstance(x, (int, float)) and isinstance(y, (int, float)) and 0 <= x <= 1 and 0 <= y <= 1:
            self.xtest.fake_input(self.d, self.X.MotionNotify, x=round(x * (self.breite - 1)), y=round(y * (self.hoehe - 1)))

    def taste(self, art, s):
        X, fake = self.X, self.xtest.fake_input
        keysym = self.keysym(s) if isinstance(s, str) else 0
        kc = self.tastencode(keysym) if keysym else 0
        if not kc:
            return
        if art == "ku":
            if kc in self.gedrueckt:
                fake(self.d, X.KeyRelease, kc)
                self.gedrueckt.discard(kc)
            return
        # Grossbuchstaben ohne gedrueckte Umschalttaste (Tastatur am Handy): Umschalten drumherum
        hoch = (self.d.keycode_to_keysym(kc, 0) != keysym and self.d.keycode_to_keysym(kc, 1) == keysym
                and self.shift not in self.gedrueckt)
        if hoch:
            fake(self.d, X.KeyPress, self.shift)
        fake(self.d, X.KeyPress, kc)
        if hoch:
            fake(self.d, X.KeyRelease, kc)
            fake(self.d, X.KeyRelease, self.shift)
        else:
            self.gedrueckt.add(kc)

    def nimm(self, text):
        if not text or len(text) > NACHRICHT_MAX:
            return
        try:
            e = json.loads(text)
            art = e["t"]
        except (ValueError, KeyError, TypeError):
            return
        X, fake = self.X, self.xtest.fake_input
        if art in ("b", "d", "u"):
            self.zeiger(e)
            k = e.get("k", 1)
            if art != "b" and k in (1, 2, 3):
                fake(self.d, X.ButtonPress if art == "d" else X.ButtonRelease, k)
        elif art == "r":
            dy = e.get("dy")
            if isinstance(dy, (int, float)) and dy != 0:
                knopf = 5 if dy > 0 else 4
                for _ in range(min(5, max(1, round(abs(dy) / 50)))):
                    fake(self.d, X.ButtonPress, knopf)
                    fake(self.d, X.ButtonRelease, knopf)
        elif art in ("kd", "ku"):
            self.taste(art, e.get("s"))
        self.d.sync()

    def alles_los(self):
        for kc in list(self.gedrueckt):
            self.xtest.fake_input(self.d, self.X.KeyRelease, kc)
        self.gedrueckt.clear()
        self.d.sync()


def formate(angebot):
    """Formate des Videos im Angebot: {"VP8": pt} und {"H264": (pt, profile-level-id)} - H.264 nur mit
    packetization-mode=1 und Baseline (profile-level-id 42..), Constrained Baseline (42e0..) vorn."""
    namen, fmtp, im_video = {}, {}, False
    for zeile in angebot.splitlines():
        if zeile.startswith("m="):
            im_video = zeile.startswith("m=video ")
        elif im_video and zeile.startswith("a=rtpmap:"):
            pt, _, rest = zeile[9:].partition(" ")
            if pt.isdigit() and 0 <= int(pt) <= 127:
                namen[int(pt)] = rest.split("/")[0].upper()
        elif im_video and zeile.startswith("a=fmtp:"):
            pt, _, rest = zeile[7:].partition(" ")
            if pt.isdigit():
                fmtp[int(pt)] = dict(t.strip().split("=", 1) for t in rest.split(";") if "=" in t)
    erg = {}
    for pt, name in namen.items():
        if name == "VP8" and "VP8" not in erg:
            erg["VP8"] = pt
        f = fmtp.get(pt, {})
        plid = f.get("profile-level-id", "").lower()
        if name == "H264" and f.get("packetization-mode") == "1" and len(plid) == 6 and plid.startswith("42"):
            if "H264" not in erg or (plid.startswith("42e0") and not erg["H264"][1].startswith("42e0")):
                erg["H264"] = (pt, plid)
    return erg


def pipeline_text(kodierer, pt, plid=None):
    """Bildschirm -> Kodierer -> RTP mit der Nummer aus dem Angebot -> webrtcbin (nur ueber den TURN)."""
    quelle = (f"ximagesrc display-name={ANZEIGE} use-damage=false show-pointer=true ! video/x-raw,framerate=30/1 "
              "! videoconvert ! queue leaky=downstream max-size-buffers=2 ")
    if kodierer == "vp8enc":
        rtp = (f"! rtpvp8pay pt={pt} ! application/x-rtp,media=video,encoding-name=VP8,payload={pt},clock-rate=90000 ")
    else:
        rtp = ("! video/x-h264,profile=constrained-baseline ! h264parse config-interval=-1 "
               f"! rtph264pay pt={pt} config-interval=-1 aggregate-mode=zero-latency "
               f"! application/x-rtp,media=video,encoding-name=H264,payload={pt},clock-rate=90000,"
               f"packetization-mode=(string)1,profile-level-id=(string){plid} ")
    return quelle + "! " + KODIERER[kodierer] + " " + rtp + "! webrtcbin name=w bundle-policy=max-bundle ice-transport-policy=relay"


def warte_auf_anzeige(xvfb):
    for _ in range(200):
        if os.path.exists(SOCKEL_X):
            return True
        if xvfb.poll() is not None:
            return False
        time.sleep(0.05)
    return False


def main(argv):
    if len(argv) not in (3, 4) or not argv[1].isdigit() or not argv[2].isdigit() or argv[3:] not in ([], ["vp8"], ["h264"]):
        melde({"fehler": "aufruf"})
        return 2
    breite, hoehe = int(argv[1]), int(argv[2])
    wunsch = argv[3] if len(argv) == 4 else "vp8"
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
    ok, msg = GstSdp.SDPMessage.new_from_text(angebot)
    da = formate(angebot)
    if ok != GstSdp.SDPResult.OK or not da:
        aufraeumen()
        melde({"fehler": "angebot"})
        return 3
    # Versuche in dieser Reihenfolge: H.264 ueber NVENC (wenn gewuenscht, angeboten und da), dann VP8
    versuche = []
    if wunsch == "h264" and "H264" in da and Gst.ElementFactory.find("nvh264enc"):
        versuche.append(("nvh264enc", *da["H264"]))
    if "VP8" in da:
        versuche.append(("vp8enc", da["VP8"], None))
    pipe, gewaehlt = None, None
    for kodierer, pt, plid in versuche:
        try:
            pipe = Gst.parse_launch(pipeline_text(kodierer, pt, plid))
        except GLib.Error:
            continue
        # erst hier oeffnet NVENC das Geraet - scheitert es, der naechste Versuch
        if pipe.set_state(Gst.State.PLAYING) != Gst.StateChangeReturn.FAILURE:
            gewaehlt = kodierer
            break
        pipe.set_state(Gst.State.NULL)
        pipe = None
    if pipe is None:
        aufraeumen()
        melde({"fehler": "gstreamer"})
        return 3
    w = pipe.get_by_name("w")
    BEHALTEN.append(w.get_property("ice-agent"))
    # In der Sandbox gibt es nur lo - libnice laesst Loopback sonst aus und sammelt gar nichts
    BEHALTEN[-1].emit("add-local-ip-address", "127.0.0.1")
    w.emit("add-turn-server", turn)
    schleife = GLib.MainLoop()
    zustand = {"gemeldet": False, "eingabe": None}

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
        melde({"antwort": beschr.sdp.as_text(), "kodierer": gewaehlt})

    def verbindung(el, _p):
        z = el.get_property("connection-state")
        if z in (GstWebRTC.WebRTCPeerConnectionState.FAILED, GstWebRTC.WebRTCPeerConnectionState.CLOSED):
            GLib.idle_add(ende_mit)

    def kanal(_el, k):
        if k.get_property("label") != "eingabe" or zustand["eingabe"] is not None:
            return
        try:
            zustand["eingabe"] = Eingabe(breite, hoehe)
        except Exception:  # noqa: BLE001 - ohne XTest gibt es eben keine Eingaben
            return
        k.connect("on-message-string", lambda _k, text: zustand["eingabe"].nimm(text))
        k.connect("on-close", lambda _k: zustand["eingabe"].alles_los())

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
    w.connect("on-data-channel", kanal)
    bus = pipe.get_bus()
    bus.add_signal_watch()
    bus.connect("message", fehler_im_bus)

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
