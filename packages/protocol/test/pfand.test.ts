/**
 * RM2a: Cashu-Pfand im Protokoll.
 *
 * Beweist:
 *  - Rechnungen nach NUT-00 (hash_to_curve) und NUT-12 (hash_e, DLEQ) – gegen die Testvektoren der
 *    Spezifikation (cashubtc/nuts, `tests/00-tests.md`, `tests/12-tests.md`), auch Abweichungen;
 *  - `pruefePfand()` ohne Mint: echte gesperrte Token (eine Mint im Test signiert blind, mit DLEQ) gelten,
 *    jede Abweichung hat ihre Kennung – fremde Mint, unbekannter Schlüssel, falscher Beweis, fremde oder
 *    weitere Schlüssel, Frist fehlt oder zu nah, kein Rückweg, doppelt;
 *  - Tags im Kern hin und zurück, Kaputtes wirft `pfand-form`;
 *  - Angebot: Mints und Pfand-Schlüssel hin und zurück, fremde Angaben streng;
 *  - Leak-Regel: ein Pfand in einem offenen Event fällt auf, das Angebot nicht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  PFAND_GRENZEN, ProtokollFehler, buildCapabilities, cashuAngebotTags, generateKeypair, hashE, hashZuKurve, leseCashuAngebot,
  lesePfandTags, parseCapabilities, pfandTags, pruefeDleq, pruefePfand, regelKeineZahlungsdaten, signEvent,
  type NostrEvent, type PfandPruefung, type PfandToken,
} from "../src/index.js";

const P = secp256k1.Point;
const n = P.CURVE().n;
const zufall = (): bigint => (BigInt("0x" + randomBytes(32).toString("hex")) % (n - 1n)) + 1n;
const hex32 = (x: bigint) => x.toString(16).padStart(64, "0");

test("NUT-00: hash_to_curve wie in den Testvektoren", () => {
  const faelle: Array<[string, string]> = [
    ["0000000000000000000000000000000000000000000000000000000000000000", "024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725"],
    ["0000000000000000000000000000000000000000000000000000000000000001", "022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf"],
    ["0000000000000000000000000000000000000000000000000000000000000002", "026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f"],
  ];
  for (const [nachricht, punkt] of faelle) assert.equal(hashZuKurve(hexToBytes(nachricht)).toHex(true), punkt);
});

test("NUT-12: hash_e und der Beweis eines Tokens wie in den Testvektoren – jede Abweichung fällt auf", () => {
  const R = P.fromHex("020000000000000000000000000000000000000000000000000000000000000001");
  const C_ = P.fromHex("02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2");
  assert.equal(bytesToHex(hashE([R, R, R, C_])), "a4dc034b74338c28c6bc3ea49731f2a24440fc7c4affc08b31a93fc9fbe6401e");
  const A = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const token = {
    secret: "daf4dd00a2b68a0858a80450f52c8a7d2ccf87d375e43e216e0c571f089f63e9",
    C: "024369d2d22a80ecf78f3937da9d5f30c1b9f74f0c32684d583cca0fa6a61cdcfc",
    dleq: {
      e: "b31e58ac6527f34975ffab13e70a48b6d2b0d35abc4b03f0151f09ee1a9763d4",
      s: "8fbae004c59e754d71df67e392b6ae4e29293113ddc2ec86592a0431d16306d8",
      r: "a6d13fcd7a18442e6076f5e1e7c887ad5de40a019824bdfa9fe740d302e8d861",
    },
  };
  assert.ok(pruefeDleq(token, A));
  const anders = (h: string) => (h[0] === "a" ? "b" : "a") + h.slice(1);
  assert.ok(!pruefeDleq({ ...token, secret: anders(token.secret) }, A), "anderes Geheimnis");
  assert.ok(!pruefeDleq({ ...token, dleq: { ...token.dleq, e: anders(token.dleq.e) } }, A), "anderes e");
  assert.ok(!pruefeDleq({ ...token, dleq: { ...token.dleq, s: anders(token.dleq.s) } }, A), "anderes s");
  assert.ok(!pruefeDleq({ ...token, dleq: { ...token.dleq, r: anders(token.dleq.r) } }, A), "anderes r");
  assert.ok(!pruefeDleq(token, "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"), "andere Mint");
  assert.ok(!pruefeDleq({ ...token, C: "02" + "00".repeat(32) }, A), "kein Punkt");
  assert.ok(!pruefeDleq({ ...token, dleq: { ...token.dleq, e: "00".repeat(32) } }, A), "Skalar 0");
});

/** Eine Mint im Test: signiert blind nach NUT-00 und beweist es nach NUT-12. */
function testMint() {
  const k = zufall();
  const A = P.BASE.multiply(k).toHex(true);
  const signiere = (secret: string, amount: number, id = "00ad268c4d1f5826"): PfandToken => {
    const Y = hashZuKurve(new TextEncoder().encode(secret));
    const r = zufall();
    const B_ = Y.add(P.BASE.multiply(r));
    const C_ = B_.multiply(k);
    const p = zufall();
    const e = BigInt("0x" + bytesToHex(hashE([P.BASE.multiply(p), B_.multiply(p), P.fromHex(A), C_])));
    const s = (p + e * k) % n;
    const C = C_.subtract(P.fromHex(A).multiply(r));
    return { id, amount, secret, C: C.toHex(true), dleq: { e: hex32(e), s: hex32(s), r: hex32(r) } };
  };
  return { A, signiere };
}

const MINT = "https://mint.example.org";
const JETZT = 1_800_000_000;
const provider = P.BASE.multiply(zufall()).toHex(true);
const app = P.BASE.multiply(zufall()).toHex(true);
const sperre = (tags: string[][], an = provider) => JSON.stringify(["P2PK", { nonce: randomBytes(32).toString("hex"), data: an, tags }]);
const normal = () => [["locktime", String(JETZT + 3600)], ["refund", app]];

function aufbau() {
  const m = testMint();
  const gesehen = new Set<string>();
  const o: PfandPruefung = {
    schluessel: provider, mints: [MINT], jetzt: JETZT,
    mintSchluessel: (mint, keyset, betrag) => (mint === MINT && keyset === "00ad268c4d1f5826" && [1, 2, 4, 8, 16].includes(betrag) ? m.A : undefined),
    gesehen: (s) => gesehen.has(s),
  };
  return { m, o, gesehen };
}

test("pruefePfand: echte gesperrte Token gelten ohne Mint – Betrag und früheste Frist", () => {
  const { m, o } = aufbau();
  const token = [m.signiere(sperre(normal()), 16), m.signiere(sperre([["locktime", String(JETZT + 1800)], ["refund", app]]), 4)];
  assert.deepEqual(pruefePfand({ mint: MINT, token }, o), { ok: true, betrag: 20, frist: JETZT + 1800 });
  // Ausdrücklich ein Unterschreiber und SIG_INPUTS sind dasselbe
  const ausdruecklich = m.signiere(sperre([...normal(), ["n_sigs", "1"], ["sigflag", "SIG_INPUTS"]]), 2);
  assert.equal(pruefePfand({ mint: MINT, token: [ausdruecklich] }, o).ok, true);
  // Ohne Token: nichts übergeben, keine Frist – aber nur bei einer Mint aus der Liste
  assert.deepEqual(pruefePfand({ mint: MINT, token: [] }, o), { ok: true, betrag: 0 });
  assert.deepEqual(pruefePfand({ mint: "https://andere-mint.example.org", token: [] }, o), { ok: false, fall: "pfand-mint" });
});

test("pruefePfand: jede Abweichung hat ihre Kennung, und dann gilt keiner der Teile", () => {
  const { m, o, gesehen } = aufbau();
  const gut = m.signiere(sperre(normal()), 8);
  const fall = (token: PfandToken[], mint = MINT) => {
    const r = pruefePfand({ mint, token }, o);
    return r.ok ? "ok" : r.fall;
  };
  assert.equal(fall([gut], "https://andere-mint.example.org"), "pfand-mint");
  assert.equal(fall([gut, m.signiere(sperre(normal()), 3)]), "pfand-mint-schluessel", "Betrag ohne Schlüssel");
  assert.equal(fall([{ ...gut, id: "00ffffffffffffff" }]), "pfand-mint-schluessel", "unbekanntes Keyset");
  assert.equal(fall([testMint().signiere(sperre(normal()), 8)]), "pfand-dleq", "eine andere Mint hat signiert");
  assert.equal(fall([{ ...gut, C: m.signiere(sperre(normal()), 8).C }]), "pfand-dleq");
  assert.equal(fall([m.signiere(sperre(normal(), app), 8)]), "pfand-sperre", "auf einen anderen Schlüssel");
  assert.equal(fall([m.signiere(randomBytes(32).toString("hex"), 8)]), "pfand-sperre", "ungesperrt");
  assert.equal(fall([m.signiere(sperre([...normal(), ["pubkeys", app]]), 8)]), "pfand-sperre", "weitere Schlüssel");
  assert.equal(fall([m.signiere(sperre([...normal(), ["n_sigs", "2"]]), 8)]), "pfand-sperre");
  assert.equal(fall([m.signiere(sperre([...normal(), ["sigflag", "SIG_ALL"]]), 8)]), "pfand-sperre");
  assert.equal(fall([m.signiere(sperre([["refund", app]]), 8)]), "pfand-frist", "ohne Frist");
  assert.equal(fall([m.signiere(sperre([["locktime", String(JETZT + PFAND_GRENZEN.restSek - 1)], ["refund", app]]), 8)]), "pfand-frist", "zu nah");
  assert.equal(fall([m.signiere(sperre([["locktime", "1e12"], ["refund", app]]), 8)]), "pfand-frist");
  assert.equal(fall([m.signiere(sperre([["locktime", String(JETZT + 3600)]]), 8)]), "pfand-rueckweg");
  assert.equal(fall([m.signiere(sperre([["locktime", String(JETZT + 3600)], ["refund", "kein-schluessel"]]), 8)]), "pfand-rueckweg");
  assert.equal(fall([gut, gut]), "pfand-doppelt", "zweimal in derselben Anfrage");
  gesehen.add(gut.secret);
  assert.equal(fall([gut]), "pfand-doppelt", "schon angenommen");
});

test("Tags im Kern: hin und zurück; Kaputtes wirft pfand-form", () => {
  const { m } = aufbau();
  const token = [m.signiere(sperre(normal()), 16), m.signiere(sperre(normal()), 4)];
  const tags = pfandTags({ mint: MINT, token });
  assert.equal(tags.length, 1);
  assert.deepEqual(lesePfandTags([["p", "x"], ...tags]), { mint: MINT, token });
  assert.equal(lesePfandTags([["p", "x"]]), undefined);
  // Ohne neue Token (seit RM2b1): gerechnet wird gegen das schon Übergebene
  assert.deepEqual(lesePfandTags(pfandTags({ mint: MINT, token: [] })), { mint: MINT, token: [] });
  const json = tags[0]![2]!;
  const t0 = JSON.parse(json)[0];
  const kaputt: string[][][] = [
    [...tags, ...tags],
    [["pfand", "http://mint.example.org", json]],
    [["pfand", MINT + "/", json]],
    [["pfand", MINT, "kein json"]],
    [["pfand", MINT, "{}"]],
    [["pfand", MINT, JSON.stringify(Array(PFAND_GRENZEN.token + 1).fill(t0))]],
    [["pfand", MINT, JSON.stringify([{ ...t0, amount: 0 }])]],
    [["pfand", MINT, JSON.stringify([{ ...t0, amount: 1.5 }])]],
    [["pfand", MINT, JSON.stringify([{ ...t0, C: "04" + t0.C.slice(2) }])]],
    [["pfand", MINT, JSON.stringify([{ ...t0, id: "xyz" }])]],
    [["pfand", MINT, JSON.stringify([{ ...t0, dleq: { e: t0.dleq.e, s: t0.dleq.s } }])]],
    [["pfand", MINT, JSON.stringify([{ ...t0, secret: "x".repeat(PFAND_GRENZEN.geheimnis + 1) }])]],
  ];
  for (const k of kaputt) assert.throws(() => lesePfandTags(k), (e: unknown) => e instanceof ProtokollFehler && e.kennung === "pfand-form", JSON.stringify(k).slice(0, 80));
});

test("Angebot: Mints und Pfand-Schlüssel hin und zurück; fremde Angaben streng", () => {
  const kp = generateKeypair();
  const basis = { pubkey: kp.pk, tier: "classic" as const, models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false };
  const cashu = { mints: [MINT, "http://abcdefghijklmnop.onion"], schluessel: provider, fassung: 1 };
  const mit = parseCapabilities(signEvent(buildCapabilities({ ...basis, cashu }), kp.sk));
  assert.deepEqual(mit.cashu, cashu);
  assert.equal(parseCapabilities(signEvent(buildCapabilities(basis), kp.sk)).cashu, undefined, "ohne Angabe kein Pfand");
  // Unbrauchbares schreibt der Knoten nicht, und fremdes liest die App nicht
  assert.deepEqual(cashuAngebotTags({ mints: ["http://mint.example.org"], schluessel: provider, fassung: 1 }), []);
  assert.deepEqual(cashuAngebotTags({ mints: [MINT], schluessel: "kein", fassung: 1 }), []);
  const viele = Array.from({ length: 8 }, (_, i) => `https://m${i}.example.org`);
  assert.equal(leseCashuAngebot(cashuAngebotTags({ mints: [...viele, viele[0]!], schluessel: provider, fassung: 1 }))!.mints.length, PFAND_GRENZEN.mints);
  for (const tags of [
    [["cashu_pfand", provider, "1"]],
    [["cashu_mint", MINT]],
    [["cashu_mint", MINT], ["cashu_pfand", provider, "0"]],
    [["cashu_mint", MINT], ["cashu_pfand", provider, "x"]],
    [["cashu_mint", MINT], ["cashu_pfand", "04" + provider.slice(2), "1"]],
    [["cashu_mint", "https://u:p@mint.example.org"], ["cashu_pfand", provider, "1"]],
  ]) assert.equal(leseCashuAngebot(tags), undefined, JSON.stringify(tags));
});

test("Leak-Regel: ein Pfand in einem offenen Event fällt auf, das Angebot nicht", () => {
  const { m } = aufbau();
  const kp = generateKeypair();
  const offen = signEvent({ pubkey: kp.pk, kind: 5050, created_at: JETZT, tags: pfandTags({ mint: MINT, token: [m.signiere(sperre(normal()), 8)] }), content: "" }, kp.sk) as NostrEvent;
  assert.equal(regelKeineZahlungsdaten([offen]).length, 1);
  const angebot = signEvent(buildCapabilities({
    pubkey: kp.pk, tier: "classic", models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false,
    cashu: { mints: [MINT], schluessel: provider, fassung: 1 },
  }), kp.sk) as NostrEvent;
  assert.equal(regelKeineZahlungsdaten([angebot]).length, 0);
});
