/**
 * B-36c2a: ein kleines Bitchat-Netz ohne Bluetooth – A und B sind Freedom-Kontakte, R dazwischen ein fremdes Gerät, das nur
 * weiterreicht. Ankündigen, erkennen, roh weiterreichen, auch in Verbindungen mit kleinerer Grenze (a1); Handshake und
 * Umschläge in der Sitzung (a2); dazu, was nicht gehen darf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { BITCHAT_KNOTEN, type BitchatAusgabe, BitchatKnoten } from "../src/bitchat-knoten.js";
import { BITCHAT_TYP, BitchatZusammensetzer, kodiereBitchat, leseBitchat, zerlegeBitchatRoh } from "../src/bitchat-paket.js";
import { BitchatTransport, NoiseXX, noiseSchluessel } from "../src/bitchat-noise.js";
import { bitchatUmschlagKlartext } from "../src/bitchat-kontakt.js";
import { generateKeypair } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import { giftWrapMitSigner } from "../src/gift-wrap.js";

const JETZT = 1_761_220_000_000;
const ident = (name: string) => ({ noise: x25519.utils.randomSecretKey(), signier: ed25519.utils.randomSecretKey(), name });
const mitte = (): number => 0.5;
const ICH_A = generateKeypair();
const OHNE = { eigeneSchluessel: [] as string[] };

/** Geräte und Verbindungen; `lauf()` stellt zu, bis nichts mehr unterwegs ist, und sammelt Umschläge je Gerät */
function netz(knoten: Record<string, BitchatKnoten>, kanten: [string, string, number][]) {
  const nach = new Map<string, [string, string]>(); // "<gerät>:<verbindung>" → [anderes Gerät, seine Verbindung]
  const verbindungen = new Map<string, { id: string; grenze: number }[]>();
  for (const [a, b, grenze] of kanten) {
    nach.set(`${a}:${b}`, [b, a]);
    nach.set(`${b}:${a}`, [a, b]);
    for (const [x, y] of [[a, b], [b, a]] as const) verbindungen.set(x, [...(verbindungen.get(x) ?? []), { id: y, grenze }]);
  }
  for (const [name, k] of Object.entries(knoten)) k.setzeVerbindungen(verbindungen.get(name) ?? []);
  const post = new Map<string, Uint8Array[]>();
  const gesehen: { von: string; an: string; wert: Uint8Array }[] = [];
  /** Mehrere Absender zugleich: ihre Werte laufen verschränkt */
  const lauf = (von: string | [string, BitchatAusgabe[] | null][], ausgabe?: BitchatAusgabe[] | null, jetzt = JETZT) => {
    const start = typeof von === "string" ? [[von, ausgabe ?? null] as [string, BitchatAusgabe[] | null]] : von;
    const offen = start.flatMap(([v, aus]) => (aus ?? []).map((a) => ({ von: v, ...a })));
    while (offen.length) {
      const a = offen.shift()!;
      const [an, ueber] = nach.get(`${a.von}:${a.id}`)!;
      gesehen.push({ von: a.von, an, wert: a.wert });
      const r = knoten[an]!.nimm(ueber, a.wert, jetzt);
      offen.push(...r.ausgabe.map((x) => ({ von: an, ...x })));
      post.set(an, [...(post.get(an) ?? []), ...r.umschlaege]);
    }
  };
  return { lauf, post, gesehen };
}

function aufbau() {
  const [ia, ib, ir] = [ident("anon1111"), ident("anon2222"), ident("anon3333")];
  const a = new BitchatKnoten(ia, { eigeneSchluessel: [ICH_A.pk], zufall: mitte });
  const b = new BitchatKnoten(ib, { eigeneSchluessel: ["bb".repeat(32)], zufall: mitte });
  const r = new BitchatKnoten(ir, { ...OHNE, zufall: mitte }); // ein Bitchat-Gerät ohne Kontakte
  a.setzeKontakte([{ person: "b", ...b.schluessel }]);
  b.setzeKontakte([{ person: "a", ...a.schluessel }]);
  // A – R mit Android-MTU, R – B mit iPhone-MTU: dort gehen Fragmente
  const n = netz({ a, b, r }, [["a", "r", 512], ["r", "b", 182]]);
  return { a, b, r, ia, n };
}

test("B-36c2a1: A und B erkennen sich über R an ihren Ankündigungen – R erkennt niemanden", () => {
  const { a, b, r, n } = aufbau();
  assert.deepEqual(a.inDerNaehe(JETZT), []);
  n.lauf("a", a.ankuendigung(JETZT));
  n.lauf("b", b.ankuendigung(JETZT));
  assert.deepEqual([a.inDerNaehe(JETZT), b.inDerNaehe(JETZT), r.inDerNaehe(JETZT)], [["b"], ["a"], []]);
  // Jede Ankündigung ging genau einmal über jede Verbindung: R reicht sie weiter, nie zurück, kein Echo
  assert.deepEqual(n.gesehen.map((g) => `${g.von}>${g.an}`), ["a>r", "r>b", "b>r", "r>a"]);
  const p = leseBitchat(n.gesehen[1]!.wert)!;
  assert.equal(p.typ, BITCHAT_TYP.ankuendigung);
  assert.equal(p.ttl, BITCHAT_KNOTEN.ttl - 1, "R zieht eins von der TTL ab");
  assert.deepEqual(p.absender, a.peerId, "Absender bleibt A");
  // Nach einer Minute ohne Ankündigung ist B nicht mehr in der Nähe; wer kein Kontakt mehr ist, auch nicht
  assert.deepEqual(a.inDerNaehe(JETZT + BITCHAT_KNOTEN.gesehenMs + 1), []);
  b.setzeKontakte([]);
  assert.deepEqual(b.inDerNaehe(JETZT), []);
});

test("B-36c2a1: Kontakte nur mit ihren beiden Schlüsseln, Doppeltes und Eigenes nie, Kaputtes nie", () => {
  const { a, ia } = aufbau();
  // Ein Gerät mit As Noise-Schlüssel, aber eigenem Signier-Schlüssel ist nicht A
  const falsch = new BitchatKnoten({ ...ident("anon1111"), noise: ia.noise }, OHNE);
  const c = new BitchatKnoten(ident("anon4444"), OHNE);
  c.setzeKontakte([{ person: "a", ...a.schluessel }]);
  falsch.setzeVerbindungen([{ id: "c", grenze: 512 }]);
  c.setzeVerbindungen([{ id: "f", grenze: 512 }, { id: "g", grenze: 512 }]);
  for (const w of falsch.ankuendigung(JETZT)) c.nimm("f", w.wert, JETZT);
  assert.deepEqual(c.inDerNaehe(JETZT), [], "Signier-Schlüssel passt nicht zum Kontakt");
  // Die echte Ankündigung von A gilt – ein zweites Mal kommt sie nicht weiter (Doppel), die eigene nie
  assert.deepEqual(new BitchatKnoten(ident("anon6666"), OHNE).ankuendigung(JETZT), [], "ohne Verbindungen geht nichts hinaus");
  a.setzeVerbindungen([{ id: "c", grenze: 512 }]);
  const w = a.ankuendigung(JETZT + 1)[0]!.wert;
  assert.equal(c.nimm("f", w, JETZT + 1).ausgabe.length, 1, "weiter an g");
  assert.deepEqual(c.inDerNaehe(JETZT + 1), ["a"]);
  assert.deepEqual(c.nimm("g", w, JETZT + 2).ausgabe, [], "doppelt");
  assert.deepEqual(a.nimm("c", w, JETZT + 2).ausgabe, [], "das eigene Paket");
  // Eine veränderte Ankündigung (anderer Name, alte Signatur) zählt nicht
  const d = new BitchatKnoten(ident("anon5555"), OHNE);
  d.setzeKontakte([{ person: "a", ...a.schluessel }]);
  const p = leseBitchat(w)!;
  const veraendert = kodiereBitchat({ ...p, nutzlast: Uint8Array.from(p.nutzlast).map((x, i) => (i === 2 ? x ^ 1 : x)) });
  d.nimm("x", veraendert, JETZT + 3);
  assert.deepEqual(d.inDerNaehe(JETZT + 3), []);
  for (const kaputt of [new Uint8Array(0), Uint8Array.of(1, 2, 3), w.subarray(0, 20)]) assert.deepEqual(d.nimm("x", kaputt, JETZT + 3).ausgabe, []);
});

test("B-36c2a1: R reicht ein großes Paket an B in Fragmenten bis 182 Byte weiter – roh, B setzt es wieder zusammen", () => {
  const { a, b, n } = aufbau();
  // Ein gerichtetes Paket von A an B mit 400 Byte Nutzlast (wie Chiffrat aus einer Noise-Sitzung), gepolstert
  const nutzlast = Uint8Array.from({ length: 400 }, (_, i) => (i * 7) & 0xff);
  const roh = kodiereBitchat(
    { version: 1, typ: BITCHAT_TYP.noiseVerschluesselt, ttl: 7, zeit: JETZT, absender: a.peerId, empfaenger: b.peerId, nutzlast },
    { polster: true },
  );
  assert.ok(roh.length > 182 && roh.length <= 512);
  n.lauf("a", [{ id: "r", wert: roh, versatzMs: 0 }]);
  const anB = n.gesehen.filter((g) => g.an === "b").map((g) => g.wert);
  assert.ok(anB.length >= 3 && anB.every((w) => w.length <= 182), "Fragmente in der Grenze");
  const z = new BitchatZusammensetzer();
  const ganz = anB.map((w) => z.nimm(leseBitchat(w)!, JETZT)).find((x) => x)!;
  assert.deepEqual([ganz.typ, ganz.absender, ganz.empfaenger, ganz.nutzlast], [BITCHAT_TYP.noiseVerschluesselt, a.peerId, b.peerId, nutzlast]);
  // Gerichtetes an B reicht B nicht weiter, und nichts geht zurück an A
  assert.equal(n.gesehen.filter((g) => g.von === "b").length, 0);
  assert.equal(n.gesehen.filter((g) => g.an === "a").length, 0);
});

test("B-36c2a1: roh zerlegen – Daten sind die Bytes, wie sie kamen; Unlesbares nicht; zu klein wirft", () => {
  const p = {
    version: 1 as const, typ: BITCHAT_TYP.noiseVerschluesselt, ttl: 3, zeit: JETZT,
    absender: Uint8Array.from({ length: 8 }, (_, i) => i + 1), empfaenger: Uint8Array.from({ length: 8 }, (_, i) => i + 11),
    nutzlast: Uint8Array.from({ length: 300 }, (_, i) => i & 0xff),
  };
  const roh = kodiereBitchat(p, { polster: true });
  const kennung = Uint8Array.of(9, 9, 9, 9, 9, 9, 9, 9);
  const teile = zerlegeBitchatRoh(roh, kennung, 182)!;
  assert.ok(teile.length >= 2);
  for (const t of teile) {
    assert.ok(kodiereBitchat(t).length <= 182);
    assert.deepEqual([t.typ, t.ttl, t.absender, t.empfaenger], [BITCHAT_TYP.fragment, 3, p.absender, p.empfaenger]);
  }
  // Die Daten der Fragmente zusammen sind genau die rohen Bytes – samt Polster, nicht neu kodiert
  const z = new BitchatZusammensetzer();
  const ganz = teile.map((t) => z.nimm(leseBitchat(kodiereBitchat(t))!, JETZT)).find((x) => x)!;
  assert.deepEqual(ganz.nutzlast, p.nutzlast);
  assert.equal(zerlegeBitchatRoh(Uint8Array.of(1, 2, 3), kennung, 182), null);
  assert.throws(() => zerlegeBitchatRoh(roh, kennung, 20));
});

/** Ein Umschlag an einen frischen Empfänger (die Person hinter dem Gerät spielt hier keine Rolle) */
async function umschlag(): Promise<Uint8Array> {
  const ich = new LocalSigner(generateKeypair().sk);
  const an = generateKeypair().pk;
  const w = await giftWrapMitSigner({ pubkey: ich.publicKey(), kind: 14, created_at: 1_800_000_000, tags: [], content: "über Bluetooth" }, ich, an, { nowSecs: 1_800_000_000 });
  return new TextEncoder().encode(JSON.stringify(w));
}

test("B-36c2a2: A und B öffnen über R eine Sitzung und tauschen Umschläge – R liest nichts", async () => {
  const { a, b, n } = aufbau();
  assert.equal(a.sende("b", await umschlag(), JETZT), null, "B noch nicht gesehen – nichts geht hinaus");
  n.lauf("a", a.ankuendigung(JETZT));
  n.lauf("b", b.ankuendigung(JETZT));
  const u = await umschlag();
  n.lauf("a", a.sende("b", u, JETZT));
  assert.deepEqual(n.post.get("b"), [u], "angekommen, genau einmal");
  assert.equal(n.post.get("r")?.length ?? 0, 0);
  // Über R ging nur Chiffrat: der Umschlag steht in keinem Wert
  const nadel = Buffer.from(u).toString("hex").slice(0, 64);
  assert.ok(n.gesehen.every((g) => !Buffer.from(g.wert).toString("hex").includes(nadel)));
  // Zwischen R und B nur Werte bis 182 Byte – Handshake und Chiffrat gingen in Fragmenten
  assert.ok(n.gesehen.filter((g) => g.an === "b" || g.von === "b").every((g) => g.wert.length <= 182));
  // Die Sitzung steht: der zweite Umschlag geht ohne Handshake, B antwortet A
  const vorher = n.gesehen.length;
  const u2 = await umschlag();
  n.lauf("a", a.sende("b", u2, JETZT + 1));
  assert.ok(n.gesehen.slice(vorher).every((g) => leseBitchat(g.wert)!.typ !== BITCHAT_TYP.noiseHandshake));
  assert.deepEqual(n.post.get("b")?.at(-1), u2);
  const u3 = await umschlag();
  n.lauf("b", b.sende("a", u3, JETZT + 2));
  assert.deepEqual(n.post.get("a"), [u3]);
});

test("B-36c2a2: Fremde bekommen keine Sitzung – wer B kennt, B ihn aber nicht, bekommt keine Antwort", async () => {
  const { b, r, n } = aufbau();
  n.lauf("r", r.ankuendigung(JETZT));
  r.setzeKontakte([{ person: "b", ...b.schluessel }]);
  n.lauf("b", b.ankuendigung(JETZT));
  const vorher = n.gesehen.length;
  const start = r.sende("b", await umschlag(), JETZT);
  assert.ok(start && start.length > 0, "R beginnt den Handshake");
  n.lauf("r", start);
  assert.equal(n.gesehen.slice(vorher).filter((g) => g.von === "b").length, 0, "B schweigt");
  assert.equal(n.post.get("b")?.length ?? 0, 0);
});

test("B-36c2a2: beide beginnen zugleich – die kleinere Peer-ID bleibt Initiator, beide Umschläge kommen an", async () => {
  const { a, b, n } = aufbau();
  n.lauf("a", a.ankuendigung(JETZT));
  n.lauf("b", b.ankuendigung(JETZT));
  const [ua, ub] = [await umschlag(), await umschlag()];
  // Beide Handshakes sind unterwegs, bevor einer ankommt
  n.lauf([["a", a.sende("b", ua, JETZT)], ["b", b.sende("a", ub, JETZT)]]);
  assert.deepEqual(n.post.get("b"), [ua]);
  assert.deepEqual(n.post.get("a"), [ub]);
  // Danach steht auf beiden Seiten dieselbe Sitzung
  const [ua2, ub2] = [await umschlag(), await umschlag()];
  n.lauf([["a", a.sende("b", ua2, JETZT + 1)], ["b", b.sende("a", ub2, JETZT + 1)]], undefined, JETZT + 1);
  assert.deepEqual([n.post.get("b")?.at(-1), n.post.get("a")?.at(-1)], [ua2, ub2]);
});

test("B-36c2a2: kein Klartext, keine eigene Kopie, ein abgelaufener Handshake beginnt neu", async () => {
  const { a, b, n } = aufbau();
  n.lauf("a", a.ankuendigung(JETZT));
  n.lauf("b", b.ankuendigung(JETZT));
  assert.equal(a.sende("b", new TextEncoder().encode("hallo"), JETZT), null, "nur Umschläge");
  const ich = new LocalSigner(ICH_A.sk);
  const eigene = await giftWrapMitSigner({ pubkey: ich.publicKey(), kind: 14, created_at: 1, tags: [], content: "x" }, ich, ich.publicKey(), { nowSecs: 1 });
  assert.equal(a.sende("b", new TextEncoder().encode(JSON.stringify(eigene)), JETZT), null, "die eigene Kopie geht nie hinaus");
  // Der erste Handshake geht verloren; nach der Frist beginnt der nächste Umschlag einen neuen
  const verloren = a.sende("b", await umschlag(), JETZT)!;
  assert.ok(verloren.length > 0);
  n.lauf("b", b.ankuendigung(JETZT + 1));
  const spaeter = JETZT + BITCHAT_KNOTEN.handshakeMs + 1;
  const u2 = await umschlag();
  n.lauf("a", a.sende("b", u2, spaeter), spaeter);
  assert.deepEqual(n.post.get("b"), [u2], "nur der neue – der alte wartete am verlorenen Handshake");
});

test("B-36c2a2: wer sich als Kontakt ausgibt, aber einen anderen Noise-Schlüssel hat, bekommt keine Sitzung", async () => {
  const { a, b, n } = aufbau();
  n.lauf("a", a.ankuendigung(JETZT));
  n.lauf("b", b.ankuendigung(JETZT));
  // Mallory schickt Handshakes mit As Peer-ID als Absender, aber mit eigenem statischem Schlüssel
  const m = new NoiseXX(true, noiseSchluessel());
  const an = (typ: number, nutzlast: Uint8Array) =>
    kodiereBitchat({ version: 1, typ, ttl: 7, zeit: JETZT + 5, absender: a.peerId, empfaenger: b.peerId, nutzlast });
  const r1 = b.nimm("r", an(BITCHAT_TYP.noiseHandshake, m.schreibe()), JETZT + 5);
  // B antwortet gepolstert, über 182 Byte also in Fragmenten
  const z = new BitchatZusammensetzer();
  const msg2 = r1.ausgabe.map((x) => z.nimm(leseBitchat(x.wert)!, JETZT + 5)).find((p) => p?.typ === BITCHAT_TYP.noiseHandshake)!;
  m.lies(msg2.nutzlast);
  const r3 = b.nimm("r", an(BITCHAT_TYP.noiseHandshake, m.schreibe()), JETZT + 6);
  assert.deepEqual(r3.umschlaege, []);
  const t = new BitchatTransport(m.teile());
  const klar = bitchatUmschlagKlartext(await umschlag(), [])!;
  const r4 = b.nimm("r", an(BITCHAT_TYP.noiseVerschluesselt, t.verschluessele(klar)), JETZT + 7);
  assert.deepEqual(r4.umschlaege, [], "B nimmt von Mallory nichts an");
  // A und B finden danach trotzdem zueinander
  const u = await umschlag();
  n.lauf("a", a.sende("b", u, JETZT + 8), JETZT + 8);
  assert.deepEqual(n.post.get("b"), [u]);
});
