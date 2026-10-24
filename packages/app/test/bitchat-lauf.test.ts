/**
 * B-36c2b2: Bitchat in der App ohne Bluetooth – zwei Geräte, jedes mit echtem `BitchatKnoten` hinter einer nachgebauten Hülle
 * (was A sendet, holt B beim nächsten Schritt). Ankündigen, erkennen, Umschlag über Bitchat, Versatz; was nicht gehen darf.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BitchatKnoten, LocalSigner, generateKeypair, giftWrapMitSigner, type BitchatKontakt } from "@freedomstack/protocol";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { BITCHAT_LAUF, BitchatLauf } from "../src/bitchat-lauf.js";
import type { BitchatStand, BitchatWert } from "../src/shell/bitchat-huelle.js";

const ident = (name: string) => ({ noise: x25519.utils.randomSecretKey(), signier: ed25519.utils.randomSecretKey(), name });

function geraete() {
  let uhr = 1_761_220_000_000;
  const eingang: Record<"a" | "b", BitchatWert[]> = { a: [], b: [] };
  const post: Record<"a" | "b", Uint8Array[]> = { a: [], b: [] };
  const gesendet: { von: string; id: string; laenge: number }[] = [];
  const spaeter: number[] = [];
  let an = true;
  let zweite = false;
  const knoten = {
    a: new BitchatKnoten(ident("anon1111"), { eigeneSchluessel: [], zufall: () => 0.5 }),
    b: new BitchatKnoten(ident("anon2222"), { eigeneSchluessel: [], zufall: () => 0.5 }),
  };
  const kontakte: Record<"a" | "b", BitchatKontakt[]> = { a: [{ person: "b", ...knoten.b.schluessel }], b: [{ person: "a", ...knoten.a.schluessel }] };
  const lauf = (ich: "a" | "b", du: "a" | "b") => new BitchatLauf({
    knoten: knoten[ich],
    // A hat B als Peripheral verbunden (p1), B hat A als Central (z1) – Grenzen wie Android und iPhone
    stand: async (): Promise<BitchatStand> => ({
      stand: an ? "an" : "bereit", werbung: "an",
      verbindungen: !an ? [] : [{ id: ich === "a" ? "p1" : "z1", grenze: ich === "a" ? 512 : 182 }, ...(zweite && ich === "a" ? [{ id: "z9", grenze: 512 }] : [])],
    }),
    hole: async () => eingang[ich].splice(0),
    sende: async (id, wert) => { gesendet.push({ von: ich, id, laenge: wert.length }); eingang[du].push({ id: du === "a" ? "p1" : "z1", wert }); return true; },
    kontakte: () => kontakte[ich],
    post: (u) => post[ich].push(u),
    spaeter: (ms, f) => { spaeter.push(ms); f(); },
    jetzt: () => uhr,
  });
  return {
    a: lauf("a", "b"), b: lauf("b", "a"), post, gesendet, spaeter, kontakte,
    vor: (ms: number) => { uhr += ms; }, aus: () => { an = false; }, zweite: () => { zweite = true; },
  };
}

async function umschlag(): Promise<Uint8Array> {
  const ich = new LocalSigner(generateKeypair().sk);
  const w = await giftWrapMitSigner({ pubkey: ich.publicKey(), kind: 14, created_at: 1_800_000_000, tags: [], content: "über Bitchat" }, ich, generateKeypair().pk, { nowSecs: 1_800_000_000 });
  return new TextEncoder().encode(JSON.stringify(w));
}

test("B-36c2b2: A und B kündigen sich an, erkennen sich und tauschen einen Umschlag über die Hülle", async () => {
  const g = geraete();
  assert.equal(g.a.sende("b", await umschlag()), false, "B noch nicht gesehen");
  await g.a.schritt();
  await g.b.schritt();
  await g.a.schritt();
  assert.deepEqual([g.a.inDerNaehe(), g.b.inDerNaehe()], [["b"], ["a"]]);
  const u = await umschlag();
  assert.equal(g.a.sende("b", u), true);
  // Handshake hin und her, dann der Umschlag – ein paar Schritte
  for (let i = 0; i < 4; i++) { await g.b.schritt(); await g.a.schritt(); }
  assert.deepEqual(g.post.b, [u], "genau einmal angekommen");
  assert.deepEqual(g.post.a, []);
  assert.ok(g.gesendet.filter((x) => x.von === "a").every((x) => x.laenge <= 512));
  assert.ok(g.gesendet.filter((x) => x.von === "b").every((x) => x.laenge <= 182), "B schreibt in die iPhone-Grenze");
});

test("B-36c2b2: angekündigt wird beim ersten Schritt, bei neuer Verbindung und sonst nur alle 30 s; aus heißt aus", async () => {
  const g = geraete();
  await g.a.schritt();
  const nachErstem = g.gesendet.length;
  assert.equal(nachErstem, 1, "eine Ankündigung");
  await g.a.schritt();
  assert.equal(g.gesendet.length, nachErstem, "nicht bei jedem Schritt");
  g.vor(BITCHAT_LAUF.ankuendigenMs);
  await g.a.schritt();
  assert.equal(g.gesendet.length, nachErstem + 1);
  // Eine neue Verbindung: gleich ankündigen, an beide – nicht erst nach 30 s
  g.zweite();
  await g.a.schritt();
  assert.deepEqual(g.gesendet.slice(nachErstem + 1).map((x) => x.id), ["p1", "z9"]);
  // Was A weiterreicht (Bs Ankündigung an z9), geht mit Versatz hinaus
  await g.b.schritt();
  assert.equal(g.spaeter.length, 0);
  await g.a.schritt();
  assert.ok(g.spaeter.length > 0 && g.spaeter.every((ms) => ms > 0), "weitergereicht mit Versatz");
  g.aus();
  const vorAus = g.gesendet.length;
  assert.equal(await g.a.schritt(), false, "ohne „an“ hält der Lauf an");
  assert.equal(g.gesendet.length, vorAus);
});

test("B-36c2b2: Fremde und Kontakte ohne Schlüssel bekommen nichts, nur Umschläge gehen hinaus", async () => {
  const g = geraete();
  g.kontakte.b = []; // B kennt A nicht
  await g.a.schritt();
  await g.b.schritt();
  await g.a.schritt();
  assert.deepEqual(g.b.inDerNaehe(), []);
  assert.equal(g.b.sende("a", await umschlag()), false);
  assert.equal(g.a.sende("b", new TextEncoder().encode("hallo")), false, "kein Klartext");
  assert.equal(g.a.sende("c", await umschlag()), false, "wer nicht in der Nähe ist");
});

test("B-36c2b2: verdrahtet – Bitchat vor Reticulum in zustellenDm, Start nur über die Hülle, Post wie aus dem Funk", () => {
  const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const post = lies("shell/tabs/posteingang.ts");
  const z = post.slice(post.indexOf("export async function zustellenDm"));
  assert.ok(z.indexOf("dmUeberBitchat(wrap, empfaenger)") > 0 && z.indexOf("dmUeberBitchat") < z.indexOf("dmUeberReticulum"), "erst Bitchat, dann Reticulum");
  assert.ok(z.indexOf("veroeffentlicheDm(wrap, empfaenger)") < z.indexOf("dmUeberBitchat"), "nur, wenn kein Relay sie nahm");
  const weg = lies("shell/bitchat-weg.ts");
  assert.match(weg, /const s = await bitchatStarten\(aufruf\);\n  if \(s !== "an" \|\| lauf\) return s;/, "der Lauf beginnt erst, wenn die Hülle „an“ meldet");
  assert.match(weg, /bitchatIdentitaet\(geheim\)/);
  assert.match(weg, /nimmPostAusFunk\(/);
  assert.match(weg, /eigeneSchluessel: state\.keypair \? \[state\.keypair\.pk\] : \[\]/, "die eigene Kopie geht nie hinaus");
  assert.match(weg, /const weiter = await l\.schritt\(\)\.catch\(\(\) => false\);\n    if \(lauf !== l\) return;/, "ein alter Takt endet");
  assert.doesNotMatch(weg, /setInterval|localStorage/);
});
