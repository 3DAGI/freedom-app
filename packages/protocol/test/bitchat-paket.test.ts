/**
 * B-36a1: das Bitchat-Paketformat Byte für Byte gegen bitchat-android (`fixtures/bitchat-referenz.json`, nur mit
 * `scripts/bitchat-referenz.sh` neu erzeugen) – Kopf, Polster, Signierdaten, Peer-ID; dazu Gegenproben. Ankündigungen und
 * Fragmente der Referenz prüft B-36a2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  BITCHAT_GRENZEN,
  BITCHAT_TYP,
  BitchatFehler,
  type BitchatPaket,
  bitchatPeerId,
  bitchatSignierDaten,
  entpolstereBitchat,
  kodiereBitchat,
  leseBitchat,
  polstereBitchat,
  pruefeBitchatSignatur,
  signiereBitchat,
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
