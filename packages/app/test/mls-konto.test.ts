/**
 * Schritt 2.2b-d1: das MLS-Konto der App – gesperrt mit Bunker und als Gerät,
 * KeyPackage erst bei Bedarf und nur an die eigenen Relays, Einladung eines
 * Kontakts (nur 1:1, jede nur einmal), Nachrichten abholen in den Verlauf,
 * eine andere Identität verwirft den alten Stand. Echte Engine, Speicher im RAM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, fromHex, generateKeypair, toHex, type NostrEvent, type RelayFilter, type Signer } from "@freedomstack/protocol";
import { Mls } from "@freedomstack/mls";

// tresor.ts liest localStorage beim Laden – vor dem Import bereitstellen.
const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k), key: (i: number) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};
const { setzeIdentitaet, setzeSigner } = await import("../src/shell/state.js");
const { LS_MLS_EINLADUNGEN, LS_MLS_IDENTITAET, mlsAbgleichen, mlsEinladungAnnehmen, mlsErreichbar, mlsGesperrt, mlsKonto, mlsSendeAn, mlsVerlauf } =
  await import("../src/shell/mls-konto.js");
const { LS_MLS_KP, LS_MLS_PLATZ, sucheKeyPackages, veroeffentlicheKeyPackage } = await import("../src/mls-keypackage.js");
const { empfangeGruppe, gruendeGruppe, gruppenAbos, nimmEinladungAn, oeffneEinladung, sendeInGruppe } = await import("../src/mls-nostr.js");
const { mlsEngine } = await import("../src/mls-engine.js");
const { SpeicherImRam } = await import("../src/vault.js");
const { LS_EIGENE_RELAYS } = await import("../src/relay-satz.js");
const { AufzeichnungsRelay } = await import("./leak/aufzeichnung.js");

const gz = readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url));
await mlsEngine(async () => gz.toString("base64"));

// Netz aus Aufzeichnungs-Relays je Adresse; Posteingänge je Konto
const relays = new Map<string, InstanceType<typeof AufzeichnungsRelay>>();
const relay = (u: string) => relays.get(u) ?? (relays.set(u, new AufzeichnungsRelay()), relays.get(u)!);
const eingaenge = new Map<string, string[]>();
const netz = {
  async sendeAn(ev: NostrEvent, urls: readonly string[]) { for (const u of urls) await relay(u).publish(ev); return urls.length; },
  async posteingang(pk: string) { return eingaenge.get(pk) ?? []; },
};
const frage = async (f: RelayFilter, urls?: readonly string[]) => (await Promise.all((urls ?? [...relays.keys()]).map((u) => relay(u).query(f)))).flat();
const zustandRam = new SpeicherImRam();
const verlaufRam = new SpeicherImRam();
const u = { zustand: () => zustandRam, verlauf: () => verlaufRam, frage, netz };

const EIGENE = ["wss://ich-eins.test", "wss://ich-zwei.test"];
const ich = generateKeypair();
setzeIdentitaet(ich.sk);
eingaenge.set(ich.pk, ["wss://eingang-ich.test"]);

function kontakt(name: string) {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  eingaenge.set(kp.pk, [`wss://eingang-${name}.test`]);
  return { pk: kp.pk, signer, mls: new Mls(signer, (id) => toHex(schnorr.sign(fromHex(id), kp.sk))), sichern: async () => {} };
}
const bob = kontakt("bob");
const GRUPPE = ["wss://gruppe.test"];

test("Gesperrt: mit Bunker und als Gerät – keine Engine, kein Konto", () => {
  assert.equal(mlsGesperrt(), null);
  const fremd = new LocalSigner(generateKeypair().sk);
  const bunker: Signer = { publicKey: () => fremd.publicKey(), signEvent: (e) => fremd.signEvent(e), nip44Encrypt: (p, t) => fremd.nip44Encrypt(p, t), nip44Decrypt: (p, t) => fremd.nip44Decrypt(p, t) };
  setzeSigner(bunker);
  assert.match(mlsGesperrt()!, /Bunker/);
  assert.equal(mlsKonto(u), null);
  setzeIdentitaet(generateKeypair().sk, generateKeypair().pk);
  assert.match(mlsGesperrt()!, /Gerät/);
  assert.equal(mlsKonto(u), null);
  setzeIdentitaet(ich.sk);
});

test("KeyPackage: ohne eigene Relays nicht; dann nur an die eigenen, einmal – danach nicht fällig", async () => {
  assert.equal(await mlsErreichbar(u), false, "ohne eigene Relays (5.4a) nichts");
  ls.set(LS_EIGENE_RELAYS, JSON.stringify(EIGENE));
  assert.equal(await mlsErreichbar(u), true);
  for (const r of EIGENE) assert.deepEqual(relay(r).gesendet.map((e) => [e.kind, e.pubkey]), [[30443, ich.pk]]);
  assert.equal(await mlsErreichbar(u), false, "nicht fällig");
  assert.equal(ls.get(LS_MLS_IDENTITAET), ich.pk);
});

test("Einladung eines Kontakts: 1:1-Gruppe angenommen, dieselbe nicht zweimal; Nachrichten abholen in den Verlauf", async () => {
  const kps = await sucheKeyPackages({ pk: ich.pk, abfrage: async (f) => frage(f, EIGENE) });
  const g = await gruendeGruppe({ mls: bob.mls, netz, sichern: bob.sichern, name: "", keyPackages: kps, relays: GRUPPE });
  const wrap = relay("wss://eingang-ich.test").gesendet.at(-1)!;
  const { state } = await import("../src/shell/state.js");
  const e = (await oeffneEinladung(wrap, state.signer!))!;
  assert.equal(await mlsEinladungAnnehmen(e, u), g.gruppe);
  assert.equal(await mlsEinladungAnnehmen(e, u), null, "schon bearbeitet – kein zweiter Versuch, keine Engine");
  assert.ok(JSON.parse(ls.get(LS_MLS_EINLADUNGEN)!).includes(wrap.id));
  assert.equal(ls.get(LS_MLS_KP), undefined, "KeyPackage verbraucht – beim nächsten Öffnen neu");

  await sendeInGruppe({ mls: bob.mls, netz, sichern: bob.sichern, gruppe: g.gruppe, text: "Hallo über MLS" });
  await sendeInGruppe({ mls: bob.mls, netz, sichern: bob.sichern, gruppe: g.gruppe, text: "zweite" });
  assert.deepEqual([...(await mlsAbgleichen([g.gruppe], u))], [[g.gruppe, 2]]);
  assert.deepEqual((await mlsVerlauf(g.gruppe, u)).map((n) => [n.text, n.von]), [["Hallo über MLS", bob.pk], ["zweite", bob.pk]]);
  assert.deepEqual([...(await mlsAbgleichen([g.gruppe], u))], [[g.gruppe, 0]], "nichts doppelt");
  assert.ok(zustandRam.blob && verlaufRam.blob, "beides verschlüsselt abgelegt");
  assert.ok(!Buffer.from(verlaufRam.blob!, "base64").toString("latin1").includes("Hallo über MLS"));
});

test("Einladung in eine Gruppe zu dritt: beigetreten, aber keine 1:1-Unterhaltung", async () => {
  await mlsErreichbar(u);
  const carol = kontakt("carol");
  const kps = [...(await sucheKeyPackages({ pk: ich.pk, abfrage: async (f) => frage(f, EIGENE) })).slice(0, 1),
    await carol.signer.signEvent(await carol.mls.keyPackage("cd".repeat(32)))];
  await gruendeGruppe({ mls: bob.mls, netz, sichern: bob.sichern, name: "", keyPackages: kps, relays: GRUPPE });
  const { state } = await import("../src/shell/state.js");
  const e = (await oeffneEinladung(relay("wss://eingang-ich.test").gesendet.at(-1)!, state.signer!))!;
  assert.equal(await mlsEinladungAnnehmen(e, u), null);
});

test("Andere Identität: alter Stand, Platz und KeyPackage verworfen – nie unter der neuen geladen", async () => {
  const platzVorher = ls.get(LS_MLS_PLATZ);
  assert.ok(platzVorher);
  const neu = generateKeypair();
  setzeIdentitaet(neu.sk);
  const k = await mlsKonto(u)!;
  assert.equal(k.pk, neu.pk);
  assert.deepEqual(k.mls.gruppen(), []);
  assert.equal(ls.get(LS_MLS_PLATZ), undefined, "sonst verbände derselbe d-Tag beide Identitäten");
  assert.equal(ls.get(LS_MLS_KP), undefined);
  assert.equal(ls.get(LS_MLS_IDENTITAET), neu.pk);
  assert.equal(zustandRam.blob, null);
});

test("Senden (2.2b-d2): ohne KeyPackage des Kontakts null (Rückfall NIP-17); mit – Gruppe gegründet, Nachricht nur an die Gruppen-Relays, eigene im Verlauf; die Gruppe wird wiederverwendet", async () => {
  const dora = kontakt("dora");
  assert.equal(await mlsSendeAn(dora.pk, undefined, "hallo", u), null, "kein KeyPackage");
  // Dora: NIP-65-Liste und KeyPackage an ihre Schreib-Relays
  const schreib = "wss://schreib-dora.test";
  await netz.sendeAn(await dora.signer.signEvent({ pubkey: dora.pk, created_at: Math.floor(Date.now() / 1000), kind: 10002, tags: [["r", schreib]], content: "" }), [schreib]);
  const leer = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  await veroeffentlicheKeyPackage({ mls: dora.mls, signer: dora.signer, speicher: leer, sichern: dora.sichern, senden: (ev) => netz.sendeAn(ev, [schreib]) });

  const vorher = EIGENE.map((r) => relay(r).gesendet.length);
  const g = await mlsSendeAn(dora.pk, undefined, "erste über MLS", u);
  assert.ok(g, "Gruppe gegründet");
  const wrap = relay("wss://eingang-dora.test").gesendet.at(-1)!;
  assert.equal(wrap.kind, 1059, "Einladung an Doras Posteingang");
  const nachrichten = EIGENE.flatMap((r, i) => relay(r).gesendet.slice(vorher[i]).filter((e) => e.kind === 445));
  assert.equal(new Set(nachrichten.map((e) => e.id)).size, 1, "eine Nachricht an die Gruppen-Relays (eigener Satz)");
  assert.deepEqual((await mlsVerlauf(g!, u)).map((n) => n.text), ["erste über MLS"], "eigene Nachricht im Verlauf");
  assert.equal(await mlsSendeAn(dora.pk, g!, "zweite", u), g, "dieselbe Gruppe");

  // Dora liest beide
  const e = (await oeffneEinladung(wrap, dora.signer))!;
  await nimmEinladungAn({ mls: dora.mls, sichern: dora.sichern, speicher: leer, einladung: e });
  const abo = gruppenAbos(dora.mls)[0]!;
  const gelesen: string[] = [];
  const evs = [...new Map((await frage(abo.filter, abo.relays)).map((x) => [x.id, x])).values()];
  const reihenfolge = EIGENE.flatMap((r) => relay(r).gesendet).filter((x) => evs.some((y) => y.id === x.id));
  for (const ev of [...new Map(reihenfolge.map((x) => [x.id, x])).values()]) {
    gelesen.push(...(await empfangeGruppe({ mls: dora.mls, sichern: dora.sichern, ev })).nachrichten.map((n) => n.text));
  }
  assert.deepEqual(gelesen, ["erste über MLS", "zweite"]);
});
