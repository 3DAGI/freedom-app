/**
 * Negentropy (B-35a, NIP-77, NG1 B): eigene Umsetzung, Byte für Byte wie die
 * Referenz (`hoytech/negentropy`, Vektoren aus `scripts/negentropy-referenz.mjs`),
 * dazu Abgleiche mit Zufallsmengen gegen die Mengenlehre und feindliche Nachrichten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NEG_GRENZEN, NegFehler, NegSpeicher, Negentropy } from "../src/index.js";

interface Fall {
  name: string; rahmen: number; mengen: [number, number, number, number, number]; erste: string;
  nachrichten: Array<{ bytes: number; sha256: string }>; habe: { anzahl: number; sha256: string }; brauche: { anzahl: number; sha256: string };
}
const REFERENZ = JSON.parse(readFileSync(new URL("fixtures/negentropy-referenz.json", import.meta.url), "utf8")) as { faelle: Fall[] };

/** Derselbe Zufall wie im Skript der Referenz (xorshift32). */
function zufall(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x;
  };
}
const id = (r: () => number) => Array.from({ length: 32 }, () => (r() & 0xff).toString(16).padStart(2, "0")).join("");
function mengen(seed: number, gemeinsam: number, nurA: number, nurB: number, zeiten: number) {
  const r = zufall(seed);
  const eintrag = () => ({ zeit: 1_700_000_000 + (r() % zeiten), id: id(r) });
  const g = Array.from({ length: gemeinsam }, eintrag);
  return { a: [...g, ...Array.from({ length: nurA }, eintrag)], b: [...g, ...Array.from({ length: nurB }, eintrag)] };
}
const speicher = (liste: Array<{ zeit: number; id: string }>) => {
  const s = new NegSpeicher();
  for (const e of liste) s.einfuegen(e.zeit, e.id);
  return s.versiegeln();
};
const sha = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const liste = (ids: string[]) => ({ anzahl: ids.length, sha256: createHash("sha256").update([...ids].sort().join(",")).digest("hex") });

/** Bis zum Ende abgleichen; alle Nachrichten und was die beginnende Seite gesammelt hat. */
function gleicheAb(client: Negentropy, relay: Negentropy) {
  const nachrichten: string[] = [], habe: string[] = [], brauche: string[] = [];
  let msg: string | null = client.beginne();
  for (let runde = 0; msg !== null && runde < 50; runde++) {
    nachrichten.push(msg);
    const { antwort } = relay.abgleich(msg);
    nachrichten.push(antwort!);
    const r = client.abgleich(antwort!);
    habe.push(...r.habe);
    brauche.push(...r.brauche);
    msg = r.antwort;
  }
  return { nachrichten, habe, brauche };
}

test("B-35a: Byte für Byte wie die Referenz – jede Nachricht und das Ergebnis, auch mit Rahmen und gleichen Zeiten", () => {
  assert.equal(REFERENZ.faelle.length, 7);
  for (const f of REFERENZ.faelle) {
    const { a, b } = mengen(...f.mengen);
    const r = gleicheAb(new Negentropy(speicher(a), f.rahmen), new Negentropy(speicher(b), f.rahmen));
    assert.equal(r.nachrichten[0], f.erste, `${f.name}: erste Nachricht`);
    assert.deepEqual(r.nachrichten.map((m) => ({ bytes: m.length / 2, sha256: sha(m) })), f.nachrichten, f.name);
    assert.deepEqual(liste(r.habe), f.habe, `${f.name}: habe`);
    assert.deepEqual(liste(r.brauche), f.brauche, `${f.name}: brauche`);
  }
});

test("B-35a: Zufallsmengen – habe und brauche sind genau die Unterschiede, mit und ohne Rahmen", () => {
  const r = zufall(42);
  for (let n = 0; n < 40; n++) {
    const { a, b } = mengen(r(), r() % 300, r() % 60, r() % 60, 1 + (r() % 500));
    const ergebnis = gleicheAb(new Negentropy(speicher(a), n % 2 ? 4096 : 0), new Negentropy(speicher(b), n % 2 ? 4096 : 0));
    const inA = new Set(a.map((x) => x.id)), inB = new Set(b.map((x) => x.id));
    assert.deepEqual([...ergebnis.habe].sort(), a.map((x) => x.id).filter((x) => !inB.has(x)).sort());
    assert.deepEqual([...ergebnis.brauche].sort(), b.map((x) => x.id).filter((x) => !inA.has(x)).sort());
  }
});

test("B-35a: feindliche Nachrichten – immer NegFehler mit Kennung, nie ein Absturz", () => {
  const relay = () => new Negentropy(speicher(mengen(9, 50, 0, 0, 10).a));
  const fall = (f: () => unknown) => {
    try {
      f();
      return "keiner";
    } catch (e) {
      assert.ok(e instanceof NegFehler, String(e));
      return e.fall;
    }
  };
  for (const kaputt of ["", "6", "zz", "61 00", "5f", "61", "6100", "610000", "610000ff", "6100000400", "61ffffffffffffffffff01"]) {
    const ergebnis = fall(() => relay().abgleich(kaputt));
    assert.ok(kaputt === "61" ? ergebnis === "keiner" : ergebnis === "neg.format", `${kaputt}: ${ergebnis}`);
  }
  // Id-Liste: mehr Ids angekündigt als da sind, oder über der Grenze
  assert.equal(fall(() => relay().abgleich("610000020a" + "00".repeat(32))), "neg.gross");
  assert.equal(fall(() => relay().abgleich("610000028")), "neg.format", "ungerade Länge");
  assert.equal(fall(() => relay().abgleich("6".repeat(NEG_GRENZEN.nachricht * 2 + 2))), "neg.gross");
  // eine andere Fassung: die antwortende Seite nennt ihre, die beginnende kann nichts tun
  assert.deepEqual(relay().abgleich("62"), { antwort: "61", habe: [], brauche: [] });
  const client = relay();
  client.beginne();
  assert.equal(fall(() => client.abgleich("62")), "neg.fassung");
  assert.equal(fall(() => client.beginne()), "neg.reihenfolge");
  // Speicher: nur 32 Byte Hex und ganze Zeiten, nie doppelt
  assert.equal(fall(() => new NegSpeicher().einfuegen(1, "ab")), "neg.format");
  assert.equal(fall(() => new NegSpeicher().einfuegen(-1, "ab".repeat(32))), "neg.format");
  const doppelt = new NegSpeicher();
  doppelt.einfuegen(1, "ab".repeat(32));
  doppelt.einfuegen(1, "ab".repeat(32));
  assert.equal(fall(() => doppelt.versiegeln()), "neg.format");
  assert.throws(() => new Negentropy(new NegSpeicher().versiegeln(), 1000), /Rahmen/);
});
