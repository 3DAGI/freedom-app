"""Stand-in fuer die App im Test des Bildstroms (VKg2a2, `bildstrom.test.ts`): webrtcbin ausserhalb der
Sandbox, nur ueber den TURN (UDP, ice-transport-policy=relay), Angebot mit Video zum Empfangen und
Datenkanal "eingabe" - wie die App in VKg2b.

Aufruf: python3 empfaenger.py <turn://...> <eingaben als JSON-Liste>
stdout: {"angebot": SDP}, dann je Sekunde {"bilder": n}, am Ende {"fertig": n}
stdin: {"antwort": SDP}. Sind 20 Bilder da, schickt es die Eingaben, wartet zwei Sekunden und endet.
"""

import json
import sys
import threading

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp", "1.0")
from gi.repository import GLib, Gst, GstSdp, GstWebRTC  # noqa: E402

BEHALTEN = []


def melde(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main(argv):
    turn, eingaben = argv[1], json.loads(argv[2])
    Gst.init(None)
    pipe = Gst.Pipeline.new("empfaenger")
    w = Gst.ElementFactory.make("webrtcbin", "w")
    w.set_property("bundle-policy", GstWebRTC.WebRTCBundlePolicy.MAX_BUNDLE)
    w.set_property("ice-transport-policy", GstWebRTC.WebRTCICETransportPolicy.RELAY)
    pipe.add(w)
    BEHALTEN.append(w.get_property("ice-agent"))
    BEHALTEN[-1].emit("add-local-ip-address", "127.0.0.1")
    w.emit("add-turn-server", turn)
    zustand = {"bilder": 0, "kanal": None, "gesendet": False, "angeboten": False}
    schleife = GLib.MainLoop()

    def bild(_sink, _puffer, _pad):
        zustand["bilder"] += 1

    def pad_neu(_el, pad):
        if pad.direction != Gst.PadDirection.SRC:
            return
        dec = Gst.parse_bin_from_description("rtpvp8depay ! vp8dec ! fakesink name=s signal-handoffs=true", True)
        pipe.add(dec)
        dec.sync_state_with_parent()
        dec.get_by_name("s").connect("handoff", bild)
        pad.link(dec.get_static_pad("sink"))

    w.connect("pad-added", pad_neu)
    caps = Gst.Caps.from_string("application/x-rtp,media=video,encoding-name=VP8,payload=96,clock-rate=90000")
    w.emit("add-transceiver", GstWebRTC.WebRTCRTPTransceiverDirection.RECVONLY, caps)

    def gesammelt(el, _p):
        if el.get_property("ice-gathering-state") == GstWebRTC.WebRTCICEGatheringState.COMPLETE and not zustand["angeboten"]:
            zustand["angeboten"] = True
            melde({"angebot": el.get_property("local-description").sdp.as_text()})

    w.connect("notify::ice-gathering-state", gesammelt)

    def angebot_da(promise, _):
        promise.wait()
        # Antwort und Angebot in Namen halten - PyGObject gaebe sonst die Struktur frei, bevor das Angebot gesetzt ist
        antwort = promise.get_reply()
        angebot = antwort.get_value("offer")
        w.emit("set-local-description", angebot, Gst.Promise.new())

    # erst Datenkanal, dann das Angebot - so steht der Kanal im Angebot
    pipe.set_state(Gst.State.PLAYING)
    zustand["kanal"] = w.emit("create-data-channel", "eingabe", None)
    GLib.idle_add(lambda: w.emit("create-offer", None, Gst.Promise.new_with_change_func(angebot_da, None)) and False)

    def lies():
        for zeile in sys.stdin:
            antwort = json.loads(zeile)["antwort"]
            _, msg = GstSdp.SDPMessage.new_from_text(antwort)
            beschr = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, msg)
            GLib.idle_add(lambda: w.emit("set-remote-description", beschr, Gst.Promise.new()) and False)

    threading.Thread(target=lies, daemon=True).start()

    def takt():
        melde({"bilder": zustand["bilder"]})
        k = zustand["kanal"]
        if zustand["bilder"] >= 20 and not zustand["gesendet"] and k.get_property("ready-state") == GstWebRTC.WebRTCDataChannelState.OPEN:
            zustand["gesendet"] = True
            for e in eingaben:
                k.emit("send-string", json.dumps(e))
            GLib.timeout_add_seconds(2, schleife.quit)
        return True

    GLib.timeout_add_seconds(1, takt)
    GLib.timeout_add_seconds(40, schleife.quit)
    schleife.run()
    melde({"fertig": zustand["bilder"]})
    pipe.set_state(Gst.State.NULL)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
