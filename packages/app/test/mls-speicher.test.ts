/**
 * Schritt 2.2b-c: MLS-Zustand verschlüsselt in eigener IndexedDB, Schlüssel in
 * `geheim` – mit Tresor im Tresor, gesperrt: kein neuer Schlüssel; beschädigt
 * oder fremd verschlüsselt: laut scheitern; der letzte Stand gewinnt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, SICHERUNG_NIE, WIPE_DATENBANKEN, fromHex, generateKeypair, toHex } from "@freedomstack/protocol";
import { Mls, ladeMls } from "@freedomstack/mls";
import { LS_MLS_SCHLUESSEL, MlsVerlauf, MlsZustand, VERLAUF_MAX, mlsSchluessel } from "../src/mls-speicher.js";
import { SpeicherImRam, createVault, geheimSpeicher } from "../src/vault.js";

ladeMls(gunzipSync(readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));

class FakeStorage {
  werte = new Map<string, string>();
  getItem(k: string): string | null { return this.werte.get(k) ?? null; }
  setItem(k: string, v: string): void { this.werte.set(k, v); }
  removeItem(k: string): void { this.werte.delete(k); }
  key(i: number): string | null { return [...this.werte.keys()][i] ?? null; }
  get length(): number { return this.werte.size; }
}

const ohneTresor = () => {
  const ls = new FakeStorage();
  return { ls, geheim: geheimSpeicher(() => null, () => false, ls) };
};
const PROBE = new TextEncoder().encode("Gruppe Hafenrunde 4711 – Schlüsselmaterial");

test("Schlüssel: einmal erzeugt, danach derselbe; beschädigt → Fehler", async () => {
  const { ls, geheim } = ohneTresor();
  const k1 = await mlsSchluessel(geheim);
  const hex = ls.getItem(LS_MLS_SCHLUESSEL)!;
  assert.match(hex, /^[0-9a-f]{64}$/);
  const k2 = await mlsSchluessel(geheim);
  assert.equal(ls.getItem(LS_MLS_SCHLUESSEL), hex, "nicht neu erzeugt");
  const sp = new SpeicherImRam();
  await new MlsZustand(sp, k1).sichern(PROBE);
  assert.deepEqual(await new MlsZustand(sp, k2).laden(), PROBE);
  ls.setItem(LS_MLS_SCHLUESSEL, "zz".repeat(32));
  await assert.rejects(mlsSchluessel(geheim), /beschädigt/);
});

test("Schlüssel mit Tresor: liegt im Tresor, nicht in localStorage; gesperrt → kein neuer", async () => {
  const ls = new FakeStorage();
  const tresor = await createVault("passphrase lang genug", new SpeicherImRam());
  const geheim = geheimSpeicher(() => tresor, () => true, ls);
  await mlsSchluessel(geheim);
  assert.match(tresor.get(LS_MLS_SCHLUESSEL)!, /^[0-9a-f]{64}$/);
  assert.equal(ls.getItem(LS_MLS_SCHLUESSEL), null);
  tresor.lock();
  await assert.rejects(mlsSchluessel(geheim), /gesperrt/);
  assert.equal(ls.length, 0, "nichts nach localStorage ausgewichen");
});

test("Zustand: verschlüsselt abgelegt (kein Klartext, jedes Mal anders), zurück wie gesichert; leer → undefined", async () => {
  const k = await mlsSchluessel(ohneTresor().geheim);
  const sp = new SpeicherImRam();
  const z = new MlsZustand(sp, k);
  assert.equal(await z.laden(), undefined);
  await z.sichern(PROBE);
  const erster = sp.blob!;
  assert.ok(!Buffer.from(erster, "base64").toString("latin1").includes("Hafenrunde"));
  assert.ok(!erster.includes(Buffer.from(PROBE).toString("base64").slice(0, 16)));
  await z.sichern(PROBE);
  assert.notEqual(sp.blob, erster, "neuer IV je Sicherung");
  assert.deepEqual(await z.laden(), PROBE);
  await z.loeschen();
  assert.equal(await z.laden(), undefined);
});

test("Zustand: verändert oder mit anderem Schlüssel → Fehler, nie stiller Neuanfang", async () => {
  const sp = new SpeicherImRam();
  await new MlsZustand(sp, await mlsSchluessel(ohneTresor().geheim)).sichern(PROBE);
  const fremd = new MlsZustand(sp, await mlsSchluessel(ohneTresor().geheim));
  await assert.rejects(fremd.laden(), /beschädigt oder mit anderem Schlüssel/);
  const k = await mlsSchluessel(ohneTresor().geheim);
  const z = new MlsZustand(sp, k);
  await z.sichern(PROBE);
  const roh = Buffer.from(sp.blob!, "base64");
  roh[roh.length - 1]! ^= 1;
  sp.blob = roh.toString("base64");
  await assert.rejects(z.laden(), /beschädigt/);
});

test("Zustand: gleichzeitige Sicherungen nacheinander – der zuletzt übergebene Stand gewinnt", async () => {
  const z = new MlsZustand(new SpeicherImRam(), await mlsSchluessel(ohneTresor().geheim));
  const staende = [1, 2, 3].map((n) => new Uint8Array(1000).fill(n));
  await Promise.all(staende.map((s) => z.sichern(s)));
  assert.deepEqual(await z.laden(), staende[2]);
});

test("Zustand der echten Engine: sichern, laden, weiter Mitglied; Notfall-Löschung und Sicherung kennen ihn", async () => {
  const kp = [generateKeypair(), generateKeypair()];
  const [a, b] = kp.map((k) => {
    const signer = new LocalSigner(k.sk);
    return { pk: k.pk, signer, beweis: (id: string) => toHex(schnorr.sign(fromHex(id), k.sk)) };
  });
  const mlsA = new Mls(a.signer, a.beweis);
  const mlsB = new Mls(b.signer, b.beweis);
  const g = await mlsA.gruppeAnlegen("Hafenrunde", [await b.signer.signEvent(await mlsB.keyPackage("aa".repeat(32)))], ["wss://relay.test"]);
  await mlsB.beitreten(g.einladungen[0]!);
  const z = new MlsZustand(new SpeicherImRam(), await mlsSchluessel(ohneTresor().geheim));
  await z.sichern(mlsB.zustand());
  const b2 = new Mls(b.signer, b.beweis, await z.laden());
  assert.deepEqual(b2.gruppen(), [g.gruppe]);
  const s = await mlsA.senden(g.gruppe, "nach dem Laden");
  assert.deepEqual((await b2.empfangen(s.events[0]!)).nachrichten.map((n) => n.text), ["nach dem Laden"]);
  assert.ok(WIPE_DATENBANKEN.includes("freedom-mls"));
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_MLS_SCHLUESSEL)), "Schlüssel nie in der Zustandssicherung");
});

test("Bindung (2.2b-d1): unter einer anderen Identität lässt sich der Zustand nicht öffnen", async () => {
  const sp = new SpeicherImRam();
  const k = await mlsSchluessel(ohneTresor().geheim);
  await new MlsZustand(sp, k, "a".repeat(64)).sichern(PROBE);
  await assert.rejects(new MlsZustand(sp, k, "b".repeat(64)).laden(), /anderem Schlüssel/);
  await assert.rejects(new MlsZustand(sp, k).laden(), /anderem Schlüssel/, "ohne Bindung auch nicht");
  assert.deepEqual(await new MlsZustand(sp, k, "a".repeat(64)).laden(), PROBE);
});

test("Verlauf (2.2b-d1): je Id einmal, nach Zeit, höchstens VERLAUF_MAX; verschlüsselt zurück; beschädigt → Fehler", async () => {
  const k = await mlsSchluessel(ohneTresor().geheim);
  const sp = new SpeicherImRam();
  const v = new MlsVerlauf(new MlsZustand(sp, k, "x"));
  const e = (id: string, zeit: number) => ({ id, von: "ab".repeat(32), text: `Text ${id}`, zeit });
  assert.equal(v.nimmAuf("g", [e("2", 20), e("1", 10)]), 2);
  assert.equal(v.nimmAuf("g", [e("1", 10), e("3", 5)]), 1, "doppelte Id nicht noch einmal");
  assert.deepEqual(v.nachrichten("g").map((x) => x.id), ["3", "1", "2"]);
  assert.deepEqual(v.nachrichten("andere"), []);
  v.nimmAuf("voll", Array.from({ length: VERLAUF_MAX + 5 }, (_, i) => e(`v${i}`, i)));
  assert.equal(v.nachrichten("voll").length, VERLAUF_MAX);
  assert.equal(v.nachrichten("voll")[0]!.id, "v5", "die ältesten fallen heraus");
  await v.sichern();
  assert.ok(!Buffer.from(sp.blob!, "base64").toString("latin1").includes("Text 3"));
  const w = new MlsVerlauf(new MlsZustand(sp, k, "x"));
  await w.laden();
  assert.deepEqual(w.nachrichten("g"), v.nachrichten("g"));
  await new MlsZustand(sp, k, "x").sichern(new TextEncoder().encode(JSON.stringify({ nichts: 1 })));
  await assert.rejects(new MlsVerlauf(new MlsZustand(sp, k, "x")).laden(), /Verlauf beschädigt/);
  await w.loeschen();
  assert.equal(sp.blob, null);
});
