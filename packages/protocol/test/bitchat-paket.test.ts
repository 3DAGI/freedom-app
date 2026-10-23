/**
 * B-36a1: das Bitchat-Paketformat Byte für Byte gegen bitchat-android (`fixtures/bitchat-referenz.json`, nur mit
 * `scripts/bitchat-referenz.sh` neu erzeugen) – Kopf, Polster, Signierdaten, Peer-ID (B-36a1), Ankündigung, Fragmente und
 * Zusammensetzen mit Grenzen (B-36a2); dazu Gegenproben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  BITCHAT_GRENZEN,
  BITCHAT_TYP,
  BITCHAT_ZUSAMMENSETZEN,
  BitchatFehler,
  type BitchatPaket,
  BitchatZusammensetzer,
  baueBitchatAnkuendigung,
  bitchatPeerId,
  bitchatSignierDaten,
  entpolstereBitchat,
  kodiereBitchat,
  kodiereBitchatFragment,
  leseBitchat,
  leseBitchatAnkuendigung,
  leseBitchatFragment,
  polstereBitchat,
  pruefeBitchatSignatur,
  signiereBitchat,
  zerlegeBitchat,
} from "../src/bitchat-paket.js";

interface RefPaket {
  fall: string;
  version: 1 | 2;
  typ: number;
  ttl: number;
  zeit: number;
  absender: string;
  empfaenger: string | null;
  route: string[] | null;
  nutzlast: string;
  signatur: string | null;
  roh: string;
  gepolstert: string;
  signierDaten: string;
}
const REF = JSON.parse(readFileSync(new URL("./fixtures/bitchat-referenz.json", import.meta.url), "utf8")) as {
  quelle: string;
  pakete: RefPaket[];
  ankuendigungen: { fall: string; name: string; hex: string }[];
  fragmente: { fall: string; hex: string }[];
  polster: { laenge: number; block: number; gepolstert: string }[];
};
const b = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));
const h = (x: Uint8Array): string => Buffer.from(x).toString("hex");
const muster = (n: number, s: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 37 + s) % 256);

function alsPaket(r: RefPaket): BitchatPaket {
  return {
    version: r.version,
    typ: r.typ,
    ttl: r.ttl,
    zeit: r.zeit,
    absender: b(r.absender),
    ...(r.empfaenger ? { empfaenger: b(r.empfaenger) } : {}),
    ...(r.route ? { route: r.route.map(b) } : {}),
    nutzlast: b(r.nutzlast),
    ...(r.signatur ? { signatur: b(r.signatur) } : {}),
  };
}

function gleich(g: BitchatPaket, r: RefPaket): void {
  assert.equal(g.version, r.version, r.fall);
  assert.equal(g.typ, r.typ, r.fall);
  assert.equal(g.ttl, r.ttl, r.fall);
  assert.equal(g.zeit, r.zeit, r.fall);
  assert.equal(h(g.absender), r.absender, r.fall);
  assert.equal(g.empfaenger ? h(g.empfaenger) : null, r.empfaenger, r.fall);
  assert.deepEqual(g.route?.map(h) ?? null, r.route, r.fall);
  assert.equal(g.signatur ? h(g.signatur) : null, r.signatur, r.fall);
}

test("B-36a1: die Referenz ist bitchat-android am festen Commit", () => {
  assert.equal(REF.quelle, "bitchat-android@dfc67dad41691128bc6e7425bd69f2f409cb5bbf");
  assert.equal(REF.pakete.length, 7);
});

test("B-36a1: Pakete – roh, gepolstert und Signierdaten wie bitchat-android; gelesen kommt dasselbe heraus", () => {
  for (const r of REF.pakete.filter((p) => p.fall !== "komprimiert")) {
    const p = alsPaket(r);
    assert.equal(h(kodiereBitchat(p)), r.roh, `${r.fall}: roh`);
    assert.equal(h(kodiereBitchat(p, { polster: true })), r.gepolstert, `${r.fall}: gepolstert`);
    assert.equal(h(bitchatSignierDaten(p)), r.signierDaten, `${r.fall}: Signierdaten (TTL 0, ohne Signatur, gepolstert)`);
    for (const draht of [r.roh, r.gepolstert]) {
      const g = leseBitchat(b(draht));
      assert.ok(g && !g.komprimiert, r.fall);
      gleich(g, r);
      assert.equal(h(g.nutzlast), r.nutzlast, r.fall);
    }
  }
});

test("B-36a1: gepackte Pakete anderer – Kopf gelesen, Nutzlast bleibt gepackt; Freedom packt nie", () => {
  const r = REF.pakete.find((p) => p.fall === "komprimiert")!;
  const g = leseBitchat(b(r.roh));
  assert.ok(g?.komprimiert);
  assert.equal(g.ungepackt, 300);
  gleich(g, r);
  assert.ok(g.nutzlast.length < 300, "die Bytes auf dem Draht, nicht entpackt");
  assert.equal(pruefeBitchatSignatur(g, new Uint8Array(32)), false, "über gepackte Nutzlast prüft Freedom keine Signatur");
  // Unser Kodierer packt dieselbe Nutzlast nicht – Flag 0x04 bleibt aus
  const eigen = kodiereBitchat(alsPaket(r));
  assert.equal(eigen[11] & 0x04, 0);
  assert.equal(h(leseBitchat(eigen)!.nutzlast), r.nutzlast);
});

test("B-36a1: Polster wie MessagePadding – nur bis 255 Byte, sonst bleibt es; Entpolstern nur mit gültigem PKCS#7", () => {
  for (const r of REF.polster) {
    const roh = muster(r.laenge, r.laenge);
    const gepolstert = polstereBitchat(roh);
    assert.equal(h(gepolstert), r.gepolstert, `Länge ${r.laenge}`);
    assert.equal(h(entpolstereBitchat(gepolstert)), h(roh), `Länge ${r.laenge}: zurück`);
  }
  assert.equal(h(entpolstereBitchat(b("0102030303"))), "0102", "drei Byte 03 – gültig");
  assert.equal(h(entpolstereBitchat(b("01020302"))), "01020302", "letztes Byte 02, davor 03 – kein Polster");
  assert.equal(h(entpolstereBitchat(b("0100"))), "0100", "0 ist kein Polster");
});

test("B-36a1: Signatur – Ed25519 über die Signierdaten; TTL darf sich unterwegs ändern, sonst nichts", () => {
  const sk = ed25519.utils.randomSecretKey();
  const pk = ed25519.getPublicKey(sk);
  const r = REF.pakete.find((p) => p.fall === "gerichtet-signiert")!;
  const p = signiereBitchat({ ...alsPaket(r), signatur: undefined }, sk);
  assert.ok(pruefeBitchatSignatur(p, pk));
  // über den Draht und mit kleinerer TTL (Weiterreichen) bleibt sie gültig
  const draht = kodiereBitchat({ ...p, ttl: 3 }, { polster: true });
  assert.ok(pruefeBitchatSignatur(leseBitchat(draht)!, pk));
  // Gegenproben
  assert.equal(pruefeBitchatSignatur({ ...p, nutzlast: muster(200, 3) }, pk), false, "andere Nutzlast");
  assert.equal(pruefeBitchatSignatur({ ...p, zeit: p.zeit + 1 }, pk), false, "andere Zeit");
  assert.equal(pruefeBitchatSignatur({ ...p, empfaenger: muster(8, 1) }, pk), false, "anderer Empfänger");
  assert.equal(pruefeBitchatSignatur(p, ed25519.getPublicKey(ed25519.utils.randomSecretKey())), false, "fremder Schlüssel");
  assert.equal(pruefeBitchatSignatur({ ...p, signatur: undefined }, pk), false, "ohne Signatur");
  assert.equal(pruefeBitchatSignatur(p, pk.slice(0, 31)), false, "Schlüssel falscher Länge");
  // Eine Ankündigung ab 100 Byte packte Bitchat – Freedom signiert sie nie
  assert.throws(
    () => signiereBitchat({ version: 1, typ: BITCHAT_TYP.ankuendigung, ttl: 7, zeit: 1, absender: muster(8, 1), nutzlast: muster(100, 1) }, sk),
    (e: unknown) => e instanceof BitchatFehler && e.fall === "ankuendigung-zu-gross",
  );
  assert.ok(signiereBitchat({ version: 1, typ: BITCHAT_TYP.ankuendigung, ttl: 7, zeit: 1, absender: muster(8, 1), nutzlast: muster(99, 1) }, sk).signatur);
});

test("B-36a2: Ankündigung – Name und Schlüssel wie bitchat-android, unter 100 Byte, ohne Nachbarn und Fähigkeiten", () => {
  const ohne = REF.ankuendigungen.find((a) => a.fall === "ohne-faehigkeiten")!;
  const eigen = baueBitchatAnkuendigung({ name: "anon", noise: muster(32, 11), signier: muster(32, 12) });
  assert.equal(h(eigen), ohne.hex);
  assert.ok(eigen.length < BITCHAT_GRENZEN.packen, "unter der Grenze, ab der Bitchat packt");
  assert.deepEqual(leseBitchatAnkuendigung(eigen), { name: "anon", noise: muster(32, 11), signier: muster(32, 12) });
  // Was ein Bitchat-Gerät sendet: Fähigkeiten (little endian) und Nachbarn (TLV 0x04) – gelesen, nie gesendet
  const mit = REF.ankuendigungen.find((a) => a.fall === "mit-faehigkeiten-und-nachbarn")!;
  const g = leseBitchatAnkuendigung(b(mit.hex));
  assert.equal(g?.name, "Ana ü");
  assert.equal(g?.faehigkeiten, 0x1a4n);
  assert.deepEqual(g?.nachbarn?.map(h), ["5152535455565758", "6162636465666768"]);
  // Zu lang für eine Ankündigung ohne Packen: abgelehnt, nie gesendet
  assert.throws(
    () => baueBitchatAnkuendigung({ name: "x".repeat(30), noise: muster(32, 1), signier: muster(32, 2) }),
    (e: unknown) => e instanceof BitchatFehler && e.fall === "ankuendigung-zu-gross",
  );
  // Gegenproben beim Lesen
  const name = b("0104616e6f6e");
  const noise = Buffer.concat([b("0220"), muster(32, 1)]);
  const signier = Buffer.concat([b("0320"), muster(32, 2)]);
  assert.equal(leseBitchatAnkuendigung(Buffer.concat([name, noise])), null, "ohne Signierschlüssel");
  assert.equal(leseBitchatAnkuendigung(Buffer.concat([b("0102c328"), noise, signier])), null, "kein UTF-8");
  assert.equal(leseBitchatAnkuendigung(Buffer.concat([name, noise, signier, b("0405")])), null, "abgeschnitten");
  assert.equal(leseBitchatAnkuendigung(Buffer.concat([name, noise, signier, b("0403010203")])), null, "Nachbarn nicht je 8 Byte");
  assert.equal(leseBitchatAnkuendigung(Buffer.concat([name, b("021f"), muster(31, 1), signier])), null, "Noise-Schlüssel 31 Byte");
  assert.ok(leseBitchatAnkuendigung(Buffer.concat([name, b("0702abcd"), noise, signier])), "Unbekanntes wird übersprungen");
});

test("B-36a2: Fragmente – Nutzlast wie FragmentPayload; ein großes Paket zerfällt in Teile unter der MTU und setzt sich wieder zusammen", () => {
  const mitte = REF.fragmente.find((f) => f.fall === "mitte")!;
  const eigen = kodiereBitchatFragment({ kennung: b("4041424344454647"), index: 1, gesamt: 3, typ: 0x11, daten: muster(50, 3) });
  assert.equal(h(eigen), mitte.hex);
  assert.deepEqual(leseBitchatFragment(eigen), { kennung: b("4041424344454647"), index: 1, gesamt: 3, typ: 0x11, daten: muster(50, 3) });
  const letztes = REF.fragmente.find((f) => f.fall === "letztes")!;
  assert.equal(h(kodiereBitchatFragment({ kennung: b("48494a4b4c4d4e4f"), index: 65534, gesamt: 65535, typ: 1, daten: muster(1, 0) })), letztes.hex);

  const gross = alsPaket(REF.pakete.find((p) => p.fall === "gross")!);
  const kennung = muster(8, 77);
  const teile = zerlegeBitchat(gross, kennung);
  assert.ok(teile.length > 4);
  const daten: Uint8Array[] = [];
  teile.forEach((t, i) => {
    const draht = kodiereBitchat(t);
    assert.ok(draht.length <= BITCHAT_GRENZEN.mtu, `Fragment ${i}: ${draht.length} Byte`);
    assert.equal(t.typ, BITCHAT_TYP.fragment);
    assert.equal(t.signatur, undefined, "Fragmente tragen keine Signatur – die steckt im ganzen Paket");
    assert.deepEqual([t.ttl, t.zeit, h(t.absender), h(t.empfaenger!)], [gross.ttl, gross.zeit, h(gross.absender), h(gross.empfaenger!)]);
    const f = leseBitchatFragment(leseBitchat(draht)!.nutzlast)!;
    assert.deepEqual([h(f.kennung), f.index, f.gesamt, f.typ], [h(kennung), i, teile.length, gross.typ]);
    daten.push(f.daten);
  });
  const ganz = leseBitchat(Buffer.concat(daten))!;
  assert.equal(h(kodiereBitchat(ganz)), h(kodiereBitchat(gross)), "zusammengesetzt = das ganze Paket samt Signatur");
  // Was in die MTU passt, bleibt ganz
  const klein = alsPaket(REF.pakete.find((p) => p.fall === "gerichtet-signiert")!);
  assert.deepEqual(zerlegeBitchat(klein, kennung), [klein]);
  // Gegenproben
  assert.equal(leseBitchatFragment(b("40414243444546470003000311")), null, "nur Kopf, keine Daten");
  assert.equal(leseBitchatFragment(b("4041424344454647000300031100")), null, "Index = Gesamt");
  assert.throws(() => kodiereBitchatFragment({ kennung: muster(7, 1), index: 0, gesamt: 1, typ: 1, daten: muster(1, 1) }), BitchatFehler);
});

test("B-36a1: Peer-ID – die ersten 8 Byte von SHA-256 über den Noise-Schlüssel", () => {
  const noise = muster(32, 11);
  assert.equal(h(bitchatPeerId(noise)), createHash("sha256").update(noise).digest("hex").slice(0, 16));
  assert.throws(() => bitchatPeerId(muster(31, 1)), BitchatFehler);
});

test("B-36a1: Gegenproben – Unlesbares ist null, falsche Form wird nie kodiert", () => {
  const r = REF.pakete.find((p) => p.fall === "v2-route")!;
  const roh = b(r.roh);
  assert.equal(leseBitchat(roh.subarray(0, 21)), null, "zu kurz");
  assert.equal(leseBitchat(roh.subarray(0, roh.length - 1)), null, "Signatur abgeschnitten");
  const v3 = roh.slice();
  v3[0] = 3;
  assert.equal(leseBitchat(v3), null, "Fassung 3");
  const zukunft = roh.slice();
  zukunft[3] = 0xff;
  assert.equal(leseBitchat(zukunft), null, "Zeit jenseits von 2^53 ms");
  const zuLang = roh.slice();
  new DataView(zuLang.buffer).setUint32(12, BITCHAT_GRENZEN.nutzlast + 1);
  assert.equal(leseBitchat(zuLang), null, "Nutzlast über 1 MiB");
  const p = alsPaket(r);
  const form = (x: Partial<BitchatPaket>) => () => kodiereBitchat({ ...p, ...x } as BitchatPaket);
  for (const [was, x] of [
    ["Absender 7 Byte", { absender: muster(7, 1) }],
    ["Empfänger 9 Byte", { empfaenger: muster(9, 1) }],
    ["Route in Fassung 1", { version: 1 as const }],
    ["TTL 256", { ttl: 256 }],
    ["Zeit negativ", { zeit: -1 }],
    ["Signatur 63 Byte", { signatur: muster(63, 1) }],
  ] as const) {
    assert.throws(form(x), (e: unknown) => e instanceof BitchatFehler && e.fall === "form", was);
  }
  assert.throws(form({ version: 1, route: undefined, nutzlast: new Uint8Array(0x10000) }), (e: unknown) => e instanceof BitchatFehler && e.fall === "zu-gross");
});

const fragment = (absender: Uint8Array, kennung: Uint8Array, index: number, gesamt: number, typ: number, daten: Uint8Array): BitchatPaket => ({
  version: 1,
  typ: BITCHAT_TYP.fragment,
  ttl: 7,
  zeit: 1761220000000,
  absender,
  nutzlast: kodiereBitchatFragment({ kennung, index, gesamt, typ, daten }),
});

test("B-36a2: Zusammensetzen – in beliebiger Reihenfolge, Doppeltes zählt einmal, heraus mit TTL 0", () => {
  const gross = alsPaket(REF.pakete.find((p) => p.fall === "gross")!);
  const teile = zerlegeBitchat(gross, muster(8, 5));
  const z = new BitchatZusammensetzer();
  const reihe = [...teile.keys()].reverse();
  let ganz = null;
  for (const [n, k] of reihe.entries()) {
    if (n === 1) assert.equal(z.nimm(teile[reihe[0]], 1000), null, "ein Fragment doppelt");
    ganz = z.nimm(teile[k], 1000);
    if (n < reihe.length - 1) assert.equal(ganz, null);
  }
  assert.ok(ganz);
  assert.equal(ganz.ttl, 0, "das Ganze wird nie weitergereicht – nur seine Fragmente");
  assert.equal(h(kodiereBitchat(ganz)), h(kodiereBitchat({ ...gross, ttl: 0 })));
  assert.equal(z.offen, 0);
  assert.equal(z.nimm(gross, 1000), null, "kein Fragment");
});

test("B-36a2: Zusammensetzen – Grenzen wie bitchat-android: Sätze, Frist, Bytes je Satz und insgesamt, Widersprüche", () => {
  const a = muster(8, 1);
  const k = (n: number): Uint8Array => muster(8, 100 + n);
  // Je Absender getrennt: dieselbe Kennung von zwei Geräten mischt sich nie
  const z = new BitchatZusammensetzer();
  assert.equal(z.nimm(fragment(a, k(0), 0, 2, 0x11, muster(10, 1)), 0), null);
  assert.equal(z.nimm(fragment(muster(8, 2), k(0), 1, 2, 0x11, muster(10, 2)), 0), null);
  assert.equal(z.offen, 2);
  // Widerspruch (andere Gesamtzahl) verwirft den ganzen Satz
  assert.equal(z.nimm(fragment(a, k(0), 1, 3, 0x11, muster(10, 1)), 0), null);
  assert.equal(z.offen, 1);
  // Nach der Frist vergessen
  assert.equal(z.nimm(fragment(a, k(9), 0, 2, 0x11, muster(10, 1)), BITCHAT_ZUSAMMENSETZEN.fristMs + 1), null);
  assert.equal(z.offen, 1, "der alte Satz ist weg, der neue offen");
  // Höchstens 64 offene Sätze – der 65. kommt nicht hinein
  const voll = new BitchatZusammensetzer();
  for (let n = 0; n < BITCHAT_ZUSAMMENSETZEN.offen; n++) voll.nimm(fragment(a, k(n), 0, 2, 0x11, muster(4, n)), 0);
  assert.equal(voll.offen, 64);
  assert.equal(voll.nimm(fragment(a, k(99), 0, 2, 0x11, muster(4, 1)), 0), null);
  assert.equal(voll.offen, 64);
  // Mehr als 256 Fragmente nimmt niemand an
  assert.equal(new BitchatZusammensetzer().nimm(fragment(a, k(1), 0, 257, 0x11, muster(4, 1)), 0), null);
  // Mehr als 1 MiB je Satz verwirft den Satz
  const block = new Uint8Array(65_536);
  const jeSatz = new BitchatZusammensetzer();
  for (let n = 0; n < 16; n++) jeSatz.nimm(fragment(a, k(2), n, 20, 0x11, block), 0);
  assert.equal(jeSatz.offen, 1);
  assert.equal(jeSatz.nimm(fragment(a, k(2), 16, 20, 0x11, block), 0), null);
  assert.equal(jeSatz.offen, 0, "über 1 MiB – der Satz ist weg");
  // Insgesamt höchstens 4 MiB: vier volle Sätze, der fünfte bekommt nichts
  const gesamt = new BitchatZusammensetzer();
  for (let s = 0; s < 4; s++) for (let n = 0; n < 16; n++) gesamt.nimm(fragment(a, k(10 + s), n, 20, 0x11, block), 0);
  assert.equal(gesamt.offen, 4);
  assert.equal(gesamt.nimm(fragment(a, k(20), 0, 2, 0x11, muster(4, 1)), 0), null);
  assert.equal(gesamt.offen, 4, "ein neuer Satz ohne Platz bleibt nicht offen");
  // Ein fertiger Satz mit anderem Typ als angekündigt zählt nicht
  const typ = new BitchatZusammensetzer();
  const echt = kodiereBitchat({ version: 1, typ: 0x11, ttl: 7, zeit: 1, absender: a, nutzlast: muster(600, 1) });
  typ.nimm(fragment(a, k(3), 0, 2, 0x10, echt.subarray(0, 300)), 0);
  assert.equal(typ.nimm(fragment(a, k(3), 1, 2, 0x10, echt.subarray(300)), 0), null, "Typ 0x10 angekündigt, 0x11 darin");
});
