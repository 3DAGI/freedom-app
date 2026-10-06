#!/usr/bin/env python3
"""Referenz für den OpenTimestamps-Baustein (Schritt 5.10b, B-17) aus python-opentimestamps 0.4.5.

Erzeugt packages/protocol/test/fixtures/ots-referenz.json. Nur zum Nachbauen
der Referenz – weder Build noch Tests brauchen Python:

    python3 -m venv /tmp/ots && /tmp/ots/bin/pip install opentimestamps==0.4.5
    /tmp/ots/bin/python scripts/ots-referenz.py

Die Kalender-Antworten unten sind echt, abgeholt am 06.10.2026: ein
Zufallswert (DIGEST) an vier Kalender (POST /digest) und die Nachreichung
eines alten Stempels bei alice (GET /timestamp/<commitment>) – sie endet in
Bitcoin-Block 428648. Die Referenz rechnet jede Antwort nach und schreibt sie
byte-gleich zurück; dazu ein Bündel aus drei Werten mit festen Zufallszahlen
(wie der ots-Client) und ein Baum mit allen Operationen.
"""
import hashlib
import json
import pathlib

from opentimestamps.core.notary import BitcoinBlockHeaderAttestation, PendingAttestation
from opentimestamps.core.op import OpAppend, OpHexlify, OpKECCAK256, OpPrepend, OpReverse, OpRIPEMD160, OpSHA1, OpSHA256
from opentimestamps.core.serialize import BytesDeserializationContext, BytesSerializationContext
from opentimestamps.core.timestamp import DetachedTimestampFile, Timestamp, make_merkle_tree

DIGEST = "4b3a3e7da7b9f5ef4b711e19b3da8f7bef3747cbfb0f4ef1a1915da0bb00043f"
KALENDER = {
    "a.pool.opentimestamps.org": "f0085852ab27df612c3808f010ed9837b0f3b1034f7824c727d4fca59a08f120185118723dbaa00e04d2185808e9355a92ca41c5b874ad85aba52183c066398908f02030c7835eca4e967ea030f6ec938c447fc19e3ddaf45654e9924cd6df4581a58808f020c1d4355595838964dc16f4c988e10caf319f8f117a5f963f8830934bed2580f908f1046ac4bfe0f008b55e7269aeaac6a80083dfe30d2ef90c8e2e2d68747470733a2f2f616c6963652e6274632e63616c656e6461722e6f70656e74696d657374616d70732e6f7267",
    "alice.btc.calendar.opentimestamps.org": "f0080b97ff1618cea92a08f020d756ddbdd455ca9cdba13700d23f07b4193efd06a7849df121bba28ff494339a08f0107ec5072e99a41896888c8662eca98bb108f1209b7dc10ad61bd4982ba97e74fe5a97682c71020b0f2994cea0800cd1c7a38efe08f0205a8d5455216adfa94f03ce7403beacce883df2385a0597bea9cc7ae1cc98042e08f02047b5977dd4eb871c4ecfeaef13f7c637c63c6158876623427765b65fa80b50c408f1046ac4bfdef0085f112c649ca4d7950083dfe30d2ef90c8e2e2d68747470733a2f2f616c6963652e6274632e63616c656e6461722e6f70656e74696d657374616d70732e6f7267",
    "bob.btc.calendar.opentimestamps.org": "f00898d9999cbe23df0f08f0102664c4febcc22bc41467caa43839fed908f12088de7ea5512a05b0a46a1087fea230b4ce88a50c57f0811c85e488942738999008f1046ac4bfdff008c1f49d2feb3f8ae00083dfe30d2ef90c8e2c2b68747470733a2f2f626f622e6274632e63616c656e6461722e6f70656e74696d657374616d70732e6f7267",
    "finney.calendar.eternitywall.com": "f0106fb7174ab25ff7adfd815199a8f0490d08f12030e06a5d8c6fef42ea9c1d0645154f82e0068da489bb4b3bc8455fe5090f41fd08f0207fb09c609f4c1b4f0c7a13a652bb8ba81528358f30646f9061012a7e480223f008f120394c6838736e3942d880511fe3fee93ab0fda7e4c270ace4f31922203fdbb73108f1207a7b933478b46617de6a7745a914ded85b7b930eb2ec375b11e5b364dd4ba06f08f0200b269ef6624f87cb3ad800c3e51036f1f19dd94fbbec1c7332588d28b1af252008f1046ac4bfe1f008c8538694be3c4ec30083dfe30d2ef90c8e292868747470733a2f2f66696e6e65792e63616c656e6461722e657465726e69747977616c6c2e636f6d",
}
AUFWERTUNG_COMMITMENT = "57cfa5c46716df9bd9e83595bce439c58108d8fcc1678f30d4c6731c3f1fa6c79ed712c66fb1ac8d4e4eb0e7"
AUFWERTUNG = "08f1206563bb432a829ac8d6c54d1a9330d2240664cad8338dd05e63eec12a18a68d5008f020ba83ddbe2bd6772b4584b46eaed23606b712dd740a89e99e927571f77f64aa2108f120193c81e70e4472b52811fe7837ce1293b1d3542b244f27f44182af8287fc9f4e08f120c6c57696fcd39b4d992477889d04e6882829f5fe556304a281dce258b78a1f0708f1ae010100000001b592ca038eaa9c1b698a049b09be8ee8972b5d0eca29c19946027ba9248acb03000000004847304402200f992d5dbec6edb143f76c14e4538e0a50d66bae27c683cf4291e475287ec6af022010bae9443390aadbd2e2b8b9f757beea26d3f5c345f7e6b4d81b3d390edd381801fdffffff022eb142000000000023210338b2490eaa949538423737cd83449835d1061dca88f4ffaca7181bcac67d2095ac0000000000000000226a20f004678a06000808f120977ac39d89bb8b879d4a2c38fca48a040c82637936707fc452c9db1390b515c80808f02074268b23e614997d18c7c063d8d82d7e1db57b5fc4346cc47ac2c46d54168d710808f120560c45b854f8507c8bfacf2662fef269c208a7e5df5c3145cbce417ecacc595e0808f1200dba8721b9cd4ac7c2fcc7e15ba2cb9f2906bfc577c212747cd352d61b5d7fdb0808f12081107a010d527d18baa874bc99c19a3a7a25dfe110a4c8985bf30f6c3e77baed0808f020ca3cdcd7093498b3f180b38a9773207e52fca992c2db1d660fdfa1b329500c390808f020ca6c6464dd02ced64c9c82246ccfc626caa78d9e624cc11013e3b4bbc09e98910808f0201c7ae0feac018fa19bd8459a4ae971b3e6c816a87254317e0a9f0ec9425ba7610808f12090263a73e415a975dc07706772dbb6200ef0d0a23006218e65d4a5d8112067300808f12079530163b0d912249438628bd791ac9402fa707eb314c6237b0ef90271625c840808000588960d73d7190103e8941a"


def attestierungen(t):
    out = []
    for msg, a in sorted(t.all_attestations(), key=lambda x: x[0]):
        if isinstance(a, PendingAttestation):
            out.append([msg.hex(), "ausstehend", a.uri])
        elif isinstance(a, BitcoinBlockHeaderAttestation):
            out.append([msg.hex(), "bitcoin", a.height])
        else:
            out.append([msg.hex(), "unbekannt", ""])
    return out


def bytes_von(obj):
    c = BytesSerializationContext()
    obj.serialize(c)
    return c.getbytes()


def main():
    o = {"quelle": "python-opentimestamps 0.4.5", "digest": DIGEST, "kalender": [], "buendel": {}, "alleOps": {}}
    d = bytes.fromhex(DIGEST)
    for name, hexa in KALENDER.items():
        t = Timestamp.deserialize(BytesDeserializationContext(bytes.fromhex(hexa)), d)
        assert bytes_von(t).hex() == hexa
        o["kalender"].append({"name": name, "antwort": hexa, "attestierungen": attestierungen(t)})
    c = bytes.fromhex(AUFWERTUNG_COMMITMENT)
    t = Timestamp.deserialize(BytesDeserializationContext(bytes.fromhex(AUFWERTUNG)), c)
    assert bytes_von(t).hex() == AUFWERTUNG
    o["aufwertung"] = {"commitment": AUFWERTUNG_COMMITMENT, "antwort": AUFWERTUNG, "attestierungen": attestierungen(t)}

    # Bündel wie der ots-Client: Zufallszahl anhängen, sha256, Merkle-Baum, Spitze an den Kalender
    blaetter = [hashlib.sha256(x).digest() for x in (b"a", b"b", b"c")]
    nonces = [bytes([0x11] * 16), bytes([0x22] * 16), bytes([0x33] * 16)]
    dateien, wurzeln = [], []
    for blatt, nonce in zip(blaetter, nonces):
        datei = DetachedTimestampFile(OpSHA256(), Timestamp(blatt))
        wurzeln.append(datei.timestamp.ops.add(OpAppend(nonce)).ops.add(OpSHA256()))
        dateien.append(datei)
    spitze = make_merkle_tree(wurzeln)
    spitze.attestations.add(PendingAttestation("https://alice.btc.calendar.opentimestamps.org"))
    o["buendel"] = {
        "blaetter": [b.hex() for b in blaetter], "nonces": [n.hex() for n in nonces], "spitze": spitze.msg.hex(),
        "dateien": [bytes_von(x).hex() for x in dateien], "attestierungen": [attestierungen(x.timestamp) for x in dateien],
    }

    # Alle Operationen, zwei Arten von Attestierungen
    t0 = Timestamp(b"\x01\x02\x03")
    t1 = t0.ops.add(OpSHA1()).ops.add(OpRIPEMD160()).ops.add(OpKECCAK256()).ops.add(OpReverse()).ops.add(OpHexlify()).ops.add(OpPrepend(b"\xaa")).ops.add(OpSHA256())
    t1.attestations.add(BitcoinBlockHeaderAttestation(123456))
    t0.ops.add(OpAppend(b"\xbb\xcc")).attestations.add(PendingAttestation("https://bob.btc.calendar.opentimestamps.org"))
    o["alleOps"] = {"nachricht": "010203", "bytes": bytes_von(t0).hex(), "attestierungen": attestierungen(t0)}

    ziel = pathlib.Path(__file__).resolve().parent.parent / "packages/protocol/test/fixtures/ots-referenz.json"
    ziel.write_text(json.dumps(o, indent=1) + "\n")
    print("geschrieben:", ziel)


if __name__ == "__main__":
    main()
