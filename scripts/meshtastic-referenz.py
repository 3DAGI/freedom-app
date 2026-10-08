#!/usr/bin/env python3
"""Referenz für das Meshtastic-Format (Schritt 7.5a) aus meshtastic 2.7.11.

Erzeugt packages/protocol/test/fixtures/meshtastic-referenz.json mit den
Protobuf-Klassen der offiziellen Python-Bibliothek. Nur zum Nachbauen der
Referenz – weder Build noch Tests brauchen Python:

    python3 -m venv /tmp/mt && /tmp/mt/bin/pip install meshtastic==2.7.11
    /tmp/mt/bin/python scripts/meshtastic-referenz.py

„zumGeraet“: was die App sendet – unser Kodierer muss genau diese Bytes
liefern. „vomGeraet“: was ein Gerät schickt, samt Feldern, die die App nicht
braucht (die muss der Leser überspringen), und dem, was er herauslesen soll.
"""
import hashlib
import json
import pathlib

from meshtastic.protobuf import channel_pb2, config_pb2, mesh_pb2, portnums_pb2

START = bytes([0x94, 0xC3])
RUNDRUF = 0xFFFFFFFF
PSK = hashlib.sha256(b"freedomstack-meshtastic-kanal-v1").digest()


def muster(n: int, s: int) -> bytes:
    return bytes((i * 37 + s) % 256 for i in range(n))


def zum_geraet():
    faelle = []
    for kid in (1, 0x12345678, 0xFFFFFFFF):
        m = mesh_pb2.ToRadio()
        m.want_config_id = kid
        faelle.append({"fall": "konfig", "id": kid, "hex": m.SerializeToString().hex()})
    for kanal, n, hop in ((1, 1, 3), (0, 200, 3), (7, 233, 7), (2, 57, 0)):
        nutzlast = muster(n, kanal + n)
        m = mesh_pb2.ToRadio()
        m.packet.to = RUNDRUF
        m.packet.channel = kanal
        m.packet.decoded.portnum = portnums_pb2.PortNum.PRIVATE_APP
        m.packet.decoded.payload = nutzlast
        m.packet.hop_limit = hop
        faelle.append({"fall": "paket", "kanal": kanal, "hopLimit": hop, "nutzlast": nutzlast.hex(),
                       "hex": m.SerializeToString().hex()})
    return faelle


def vom_geraet():
    faelle = []

    def fall(name, m, erwartet):
        faelle.append({"fall": name, "hex": m.SerializeToString().hex(), "erwartet": erwartet})

    # Paket aus dem Funk, mit allem, was das Gerät dazuschreibt
    nutzlast = muster(200, 5)
    m = mesh_pb2.FromRadio()
    m.id = 77
    p = m.packet
    setattr(p, "from", 0xDEADBEEF)
    p.to = RUNDRUF
    p.channel = 1
    p.decoded.portnum = portnums_pb2.PortNum.PRIVATE_APP
    p.decoded.payload = nutzlast
    p.decoded.bitfield = 1
    p.id = 0x0BADF00D
    p.rx_time = 1_790_000_000
    p.rx_snr = -7.25
    p.hop_limit = 2
    p.hop_start = 3
    p.rx_rssi = -112
    p.relay_node = 0xEF
    p.transport_mechanism = mesh_pb2.MeshPacket.TransportMechanism.TRANSPORT_LORA
    fall("paket", m, {"art": "paket", "von": 0xDEADBEEF, "an": RUNDRUF, "kanal": 1,
                      "port": 256, "nutzlast": nutzlast.hex()})

    # Ein Textpaket auf Kanal 0 – die App filtert nach Port und Kanal
    m = mesh_pb2.FromRadio()
    setattr(m.packet, "from", 42)
    m.packet.to = 7
    m.packet.decoded.portnum = portnums_pb2.PortNum.TEXT_MESSAGE_APP
    m.packet.decoded.payload = "hallo".encode()
    fall("text", m, {"art": "paket", "von": 42, "an": 7, "kanal": 0, "port": 1,
                     "nutzlast": "hallo".encode().hex()})

    # Verschlüsselt, das Gerät kennt den Kanal nicht: nichts zum Lesen
    m = mesh_pb2.FromRadio()
    setattr(m.packet, "from", 9)
    m.packet.to = RUNDRUF
    m.packet.encrypted = muster(40, 1)
    fall("verschluesselt", m, {"art": "anderes"})

    m = mesh_pb2.FromRadio()
    m.my_info.my_node_num = 0xDEADBEEF
    m.my_info.reboot_count = 12
    m.my_info.min_app_version = 30200
    m.my_info.device_id = muster(16, 3)
    m.my_info.pio_env = "heltec-v3"
    fall("ich", m, {"art": "ich", "knoten": 0xDEADBEEF})

    m = mesh_pb2.FromRadio()
    lora = m.config.lora
    lora.use_preset = True
    lora.modem_preset = config_pb2.Config.LoRaConfig.ModemPreset.LONG_FAST
    lora.region = config_pb2.Config.LoRaConfig.RegionCode.EU_868
    lora.hop_limit = 3
    lora.tx_enabled = True
    lora.tx_power = 27
    lora.ignore_incoming.extend([1, 2, 0xFFFFFFFF])
    fall("lora", m, {"art": "lora", "region": 3, "hopLimit": 3, "senden": True, "preset": 0, "vorgabe": True})

    m = mesh_pb2.FromRadio()
    m.config.lora.modem_preset = config_pb2.Config.LoRaConfig.ModemPreset.MEDIUM_FAST
    fall("lora-neu", m, {"art": "lora", "region": 0, "hopLimit": 0, "senden": False, "preset": 4, "vorgabe": False})

    m = mesh_pb2.FromRadio()
    m.config.device.role = config_pb2.Config.DeviceConfig.Role.CLIENT
    m.config.device.node_info_broadcast_secs = 900
    fall("device", m, {"art": "anderes"})

    m = mesh_pb2.FromRadio()
    m.channel.index = 1
    m.channel.settings.name = "freedom"
    m.channel.settings.psk = PSK
    m.channel.settings.module_settings.position_precision = 0
    m.channel.role = channel_pb2.Channel.Role.SECONDARY
    fall("kanal", m, {"art": "kanal", "index": 1, "name": "freedom", "psk": PSK.hex(), "rolle": 2})

    m = mesh_pb2.FromRadio()
    m.channel.settings.psk = b"\x01"
    m.channel.settings.uplink_enabled = True
    m.channel.role = channel_pb2.Channel.Role.PRIMARY
    fall("kanal-primaer", m, {"art": "kanal", "index": 0, "name": "", "psk": "01", "rolle": 1})

    m = mesh_pb2.FromRadio()
    m.config_complete_id = 0x12345678
    fall("fertig", m, {"art": "fertig", "id": 0x12345678})

    m = mesh_pb2.FromRadio()
    m.queueStatus.free = 15
    m.queueStatus.maxlen = 16
    m.queueStatus.mesh_packet_id = 1234
    fall("warteschlange", m, {"art": "warteschlange", "frei": 15, "max": 16})

    m = mesh_pb2.FromRadio()
    m.rebooted = True
    fall("neustart", m, {"art": "neustart"})

    m = mesh_pb2.FromRadio()
    m.node_info.num = 5
    m.node_info.user.long_name = "Fremder Knoten"
    m.node_info.snr = 4.5
    fall("knoten", m, {"art": "anderes"})
    return faelle


def main():
    kopf = [{"laenge": n, "hex": (START + bytes([n >> 8, n & 0xFF])).hex()} for n in (5, 300, 512)]
    daten = {
        "quelle": "meshtastic 2.7.11",
        "kanal": {"name": "freedom", "psk": PSK.hex()},
        "kopf": kopf,
        "zumGeraet": zum_geraet(),
        "vomGeraet": vom_geraet(),
    }
    ziel = pathlib.Path(__file__).resolve().parent.parent / "packages/protocol/test/fixtures/meshtastic-referenz.json"
    zeile = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    teile = ["{" + ",".join(f"{zeile(k)}:{zeile(daten[k])}" for k in ("quelle", "kanal", "kopf"))]
    for k in ("zumGeraet", "vomGeraet"):
        teile.append(f',{zeile(k)}:[\n' + ",\n".join(zeile(f) for f in daten[k]) + "]")
    ziel.write_text("".join(teile) + "}\n")
    print(f"{len(daten['zumGeraet'])} + {len(daten['vomGeraet'])} Fälle → {ziel}")


if __name__ == "__main__":
    main()
