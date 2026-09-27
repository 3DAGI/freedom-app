/**
 * Schritt 2.2b-d1: das MLS-Konto der App – gesperrt mit Bunker und ohne Tresor
 * (2.2b-e1), als Gerät ein eigenes Konto (2.2b-e1),
 * KeyPackage erst bei Bedarf und nur an die eigenen Relays, Einladung eines
 * Kontakts (nur 1:1, jede nur einmal), Nachrichten abholen in den Verlauf,
 * eine andere Identität verwirft den alten Stand. Echte Engine, Speicher im RAM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  LocalSigner, buildDeviceGrant, buildDeviceRevoke, fromHex, generateKeypair, gruppenRaum, raumDefinition, raumNachricht, signEvent, toHex,
  type NostrEvent, type RelayFilter, type Signer,
} from "@freedomstack/protocol";
import { Mls, type MlsNachricht } from "@freedomstack/mls";

// tresor.ts liest localStorage beim Laden – vor dem Import bereitstellen.
const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k), key: (i: number) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};
const { setzeIdentitaet, setzeSigner } = await import("../src/shell/state.js");
const {
  LS_MLS_EINLADUNGEN, LS_MLS_IDENTITAET, mlsAbgleichen, mlsEinladungAnnehmen, mlsErreichbar, mlsGesperrt, mlsGruende, mlsGruppenStand, mlsKonto,
  mlsLadeEin, mlsSendeAn, mlsSendeEvent, mlsSetzeAdmins, mlsVerlauf,
} = await import("../src/shell/mls-konto.js");
const { LS_MLS_KP, LS_MLS_PLATZ, sucheKeyPackages, veroeffentlicheKeyPackage } = await import("../src/mls-keypackage.js");
const { empfangeGruppe, gruendeGruppe, gruppenAbos, nimmEinladungAn, oeffneEinladung, schreiteFort, sendeEventInGruppe, sendeInGruppe } = await import("../src/mls-nostr.js");
const { mlsEngine } = await import("../src/mls-engine.js");
const { SpeicherImRam, createVault, geheimSpeicher } = await import("../src/vault.js");
const { LS_TRESOR } = await import("../src/shell/tresor.js");
const { GeraeteBuch } = await import("../src/geraete-buch.js");
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
// Mit Tresor (seit 2.2b-e1 Pflicht): der Schlüssel des Zustands liegt darin
const tresor = await createVault("passphrase lang genug", new SpeicherImRam());
// Vollmachten der Geräte (8.6b) aus demselben Netz
const buch = new GeraeteBuch((f) => frage(f as RelayFilter));
const u = { zustand: () => zustandRam, verlauf: () => verlaufRam, frage, netz, geheim: geheimSpeicher(() => tresor, () => true, localStorage), geraete: buch };

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

test("Gesperrt: ohne Tresor und mit Bunker – keine Engine, kein Konto; als Gerät nicht (2.2b-e1)", async () => {
  assert.match(mlsGesperrt()!, /nur mit Tresor/);
  assert.equal(mlsKonto(u), null);
  assert.equal(await mlsErreichbar(u), false, "ohne Tresor kein KeyPackage");
  assert.deepEqual(await mlsSendeAn(bob.pk, undefined, "x", u), { gesendet: false }, "ohne Tresor nie über MLS");
  ls.set(LS_TRESOR, "1");
  assert.equal(mlsGesperrt(), null);
  const fremd = new LocalSigner(generateKeypair().sk);
  const bunker: Signer = { publicKey: () => fremd.publicKey(), signEvent: (e) => fremd.signEvent(e), nip44Encrypt: (p, t) => fremd.nip44Encrypt(p, t), nip44Decrypt: (p, t) => fremd.nip44Decrypt(p, t) };
  setzeSigner(bunker);
  assert.match(mlsGesperrt()!, /Bunker/);
  assert.equal(mlsKonto(u), null);
  setzeIdentitaet(generateKeypair().sk, generateKeypair().pk);
  assert.equal(mlsGesperrt(), null, "als Gerät ein eigenes Konto");
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
  assert.deepEqual(await mlsEinladungAnnehmen(e, u), { gruppe: g.gruppe, partner: bob.pk });
  assert.equal(await mlsEinladungAnnehmen(e, u), null, "schon bearbeitet – kein zweiter Versuch, keine Engine");
  assert.ok(JSON.parse(ls.get(LS_MLS_EINLADUNGEN)!).includes(wrap.id));
  assert.equal(ls.get(LS_MLS_KP), undefined, "KeyPackage verbraucht – beim nächsten Öffnen neu");

  await sendeInGruppe({ mls: bob.mls, netz, sichern: bob.sichern, gruppe: g.gruppe, text: "Hallo über MLS" });
  // Ein Raum-Event (2.3a) ist keine Chat-Zeile – der 1:1-Verlauf nimmt nur Art 9
  assert.match((await sendeEventInGruppe({ mls: bob.mls, netz, sichern: bob.sichern, gruppe: g.gruppe, art: 34700, tags: [["space", g.gruppe], ["name", "kein Chat"]], text: "" }))!, /^[0-9a-f]{64}$/);
  await sendeInGruppe({ mls: bob.mls, netz, sichern: bob.sichern, gruppe: g.gruppe, text: "zweite" });
  assert.deepEqual([...(await mlsAbgleichen([g.gruppe], u))], [[g.gruppe, 2]]);
  assert.deepEqual((await mlsVerlauf(g.gruppe, u)).map((n) => [n.text, n.von]), [["Hallo über MLS", bob.pk], ["zweite", bob.pk]]);
  assert.deepEqual([...(await mlsAbgleichen([g.gruppe], u))], [[g.gruppe, 0]], "nichts doppelt");
  assert.ok(zustandRam.blob && verlaufRam.blob, "beides verschlüsselt abgelegt");
  assert.ok(!Buffer.from(verlaufRam.blob!, "base64").toString("latin1").includes("Hallo über MLS"));
});

test("Einladung in eine Gruppe zu dritt: beigetreten, aber keine 1:1-Unterhaltung – ein Raum (2.3b)", async () => {
  await mlsErreichbar(u);
  const carol = kontakt("carol");
  const kps = [...(await sucheKeyPackages({ pk: ich.pk, abfrage: async (f) => frage(f, EIGENE) })).slice(0, 1),
    await carol.signer.signEvent(await carol.mls.keyPackage("cd".repeat(32)))];
  const g = await gruendeGruppe({ mls: bob.mls, netz, sichern: bob.sichern, name: "", keyPackages: kps, relays: GRUPPE });
  const { state } = await import("../src/shell/state.js");
  const e = (await oeffneEinladung(relay("wss://eingang-ich.test").gesendet.at(-1)!, state.signer!))!;
  assert.deepEqual(await mlsEinladungAnnehmen(e, u), { gruppe: g.gruppe, partner: null }, "kein Partner – eine Gruppe zu mehreren");
  assert.equal(await mlsEinladungAnnehmen(e, u), null, "schon bearbeitet");
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
  assert.deepEqual(await mlsSendeAn(dora.pk, undefined, "hallo", u), { gesendet: false }, "kein KeyPackage");
  // Dora: NIP-65-Liste und KeyPackage an ihre Schreib-Relays
  const schreib = "wss://schreib-dora.test";
  await netz.sendeAn(await dora.signer.signEvent({ pubkey: dora.pk, created_at: Math.floor(Date.now() / 1000), kind: 10002, tags: [["r", schreib]], content: "" }), [schreib]);
  const leer = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  await veroeffentlicheKeyPackage({ mls: dora.mls, signer: dora.signer, speicher: leer, sichern: dora.sichern, senden: (ev) => netz.sendeAn(ev, [schreib]) });

  const vorher = EIGENE.map((r) => relay(r).gesendet.length);
  const { gruppe: g, gesendet } = await mlsSendeAn(dora.pk, undefined, "erste über MLS", u);
  assert.ok(g && gesendet, "Gruppe gegründet");
  const wrap = relay("wss://eingang-dora.test").gesendet.at(-1)!;
  assert.equal(wrap.kind, 1059, "Einladung an Doras Posteingang");
  const nachrichten = EIGENE.flatMap((r, i) => relay(r).gesendet.slice(vorher[i]).filter((e) => e.kind === 445));
  assert.equal(new Set(nachrichten.map((e) => e.id)).size, 1, "eine Nachricht an die Gruppen-Relays (eigener Satz)");
  assert.deepEqual((await mlsVerlauf(g!, u)).map((n) => n.text), ["erste über MLS"], "eigene Nachricht im Verlauf");
  assert.deepEqual(await mlsSendeAn(dora.pk, g!, "zweite", u), { gruppe: g, gesendet: true }, "dieselbe Gruppe");

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

test("Als Gerät (2.2b-e1): eigenes Konto unter dem Geräteschlüssel; KeyPackage nur an die Schreib-Relays der Person – ohne deren Liste keins", async () => {
  const person = generateKeypair();
  const geraet = generateKeypair();
  setzeIdentitaet(geraet.sk, person.pk);
  const vorher = EIGENE.map((r) => relay(r).gesendet.length);
  assert.equal(await mlsErreichbar(u), false, "ohne NIP-65-Liste der Person kein Ziel");
  const schreib = "wss://schreib-person.test";
  const liste = await new LocalSigner(person.sk).signEvent({ pubkey: person.pk, created_at: Math.floor(Date.now() / 1000), kind: 10002, tags: [["r", schreib, "write"]], content: "" });
  await netz.sendeAn(liste, [schreib]);
  assert.equal(await mlsErreichbar(u), true, "fällig, obwohl die vorige Identität eins hatte");
  assert.deepEqual(relay(schreib).gesendet.filter((e) => e.kind === 30443).map((e) => e.pubkey), [geraet.pk]);
  assert.deepEqual(EIGENE.map((r, i) => relay(r).gesendet.slice(vorher[i]).length), [0, 0], "nicht an die Relays einer anderen Identität");
  assert.equal((await mlsKonto(u)!).pk, geraet.pk);
  assert.equal(ls.get(LS_MLS_IDENTITAET), geraet.pk);
  assert.equal((await sucheKeyPackages({ pk: geraet.pk, abfrage: frage })).length, 1, "auffindbar");
  setzeIdentitaet(ich.sk);
});

// ---- 2.2b-e2: Gruppen mit Geräten (Entscheidung A) -----------------------

const VOLLMACHTEN = "wss://vollmachten.test";
const jetzt = () => Math.floor(Date.now() / 1000);
const leerSpeicher = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
async function vollmacht(person: { sk: Uint8Array; pk: string }, geraet: string) {
  await netz.sendeAn(signEvent(buildDeviceGrant({ ownerPubkey: person.pk, devicePubkey: geraet, label: "Handy", permissions: ["nachrichten"], expiresAt: jetzt() + 86_400 }, jetzt() - 100), person.sk), [VOLLMACHTEN]);
  buch.vergiss(person.pk);
}
async function nip65(person: { sk: Uint8Array; pk: string }, schreib: string) {
  await netz.sendeAn(signEvent({ pubkey: person.pk, created_at: jetzt(), kind: 10002, tags: [["r", schreib, "write"]], content: "" }, person.sk), [schreib]);
}
/** Ein Gerät mit eigenem Mls (ohne eigenen Posteingang), KeyPackage an `schreib`. */
async function mitKeyPackage(schreib: string) {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const x = { pk: kp.pk, sk: kp.sk, signer, mls: new Mls(signer, (id) => toHex(schnorr.sign(fromHex(id), kp.sk))), sichern: async () => {} };
  await veroeffentlicheKeyPackage({ mls: x.mls, signer: x.signer, speicher: leerSpeicher, sichern: x.sichern, senden: (ev) => netz.sendeAn(ev, [schreib]) });
  return x;
}
/** Alles lesen, was an den Gruppen-Relays liegt – in der Reihenfolge des Sendens. */
async function liesMit(p: { mls: Mls; sichern: () => Promise<void> }): Promise<string[]> {
  const texte: string[] = [];
  const merken = async (n: MlsNachricht[]) => { texte.push(...n.map((x) => x.text)); };
  const evs = EIGENE.flatMap((r) => relay(r).gesendet).filter((e) => e.kind === 445);
  for (const ev of [...new Map(evs.map((x) => [x.id, x])).values()]) await empfangeGruppe({ mls: p.mls, sichern: p.sichern, ev, merken }).catch(() => null);
  for (const g of p.mls.gruppen()) {
    const w = p.mls.wartezeit(g);
    if (w !== undefined) {
      await new Promise((r) => setTimeout(r, w + 20));
      await schreiteFort({ mls: p.mls, netz, sichern: p.sichern, gruppe: g, merken }).catch(() => null);
    }
  }
  return texte;
}
const einladungAn = (pk: string, eingang: string) => relay(eingang).gesendet.filter((w) => w.kind === 1059 && w.tags.some((t) => t[0] === "p" && t[1] === pk)).at(-1);

const ICH = generateKeypair();
const CLEO = generateKeypair();
let cleoGruppe = "";
let cleoHandy: Awaited<ReturnType<typeof mitKeyPackage>>;

test("2.2b-e2: Gründen mit den Geräten beider Seiten – alle Admin, Einladungen an Geräte an den Posteingang ihrer Person, jedes Gerät liest", async () => {
  setzeIdentitaet(ICH.sk);
  eingaenge.set(ICH.pk, ["wss://eingang-ich2.test"]);
  eingaenge.set(CLEO.pk, ["wss://eingang-cleo.test"]);
  await nip65(ICH, "wss://schreib-ich.test");
  await nip65(CLEO, "wss://schreib-cleo.test");
  const meinHandy = await mitKeyPackage("wss://schreib-ich.test");
  cleoHandy = await mitKeyPackage("wss://schreib-cleo.test");
  const cleo = { pk: CLEO.pk, signer: new LocalSigner(CLEO.sk), mls: new Mls(new LocalSigner(CLEO.sk), (id) => toHex(schnorr.sign(fromHex(id), CLEO.sk))), sichern: async () => {} };
  await veroeffentlicheKeyPackage({ mls: cleo.mls, signer: cleo.signer, speicher: leerSpeicher, sichern: cleo.sichern, senden: (ev) => netz.sendeAn(ev, ["wss://schreib-cleo.test"]) });
  await vollmacht(ICH, meinHandy.pk);
  await vollmacht(CLEO, cleoHandy.pk);

  const r = await mlsSendeAn(CLEO.pk, undefined, "an alle Geräte", u);
  assert.ok(r.gruppe && r.gesendet);
  cleoGruppe = r.gruppe;
  const { mls } = await mlsKonto(u)!;
  const alle = [ICH.pk, meinHandy.pk, CLEO.pk, cleoHandy.pk].sort();
  assert.deepEqual(mls.mitglieder(cleoGruppe).sort(), alle);
  assert.deepEqual(mls.admins(cleoGruppe).sort(), alle, "jede Seite darf eigene Geräte aufnehmen und entzogene entfernen");
  // Geräte haben keinen eigenen Posteingang: ihre Einladung liegt bei der Person
  for (const [geraet, eingang] of [[meinHandy, "wss://eingang-ich2.test"], [cleoHandy, "wss://eingang-cleo.test"]] as const) {
    const wrap = einladungAn(geraet.pk, eingang);
    assert.ok(wrap, "Einladung an den Posteingang der Person");
    assert.deepEqual(wrap!.tags.filter((t) => t[0] === "p").map((t) => t[1]), [geraet.pk], "adressiert nur an das Gerät");
    assert.ok(![ICH.pk, CLEO.pk].includes(wrap!.pubkey), "Umschlag von einem Wegwerf-Schlüssel");
    await nimmEinladungAn({ mls: geraet.mls, sichern: geraet.sichern, speicher: leerSpeicher, einladung: (await oeffneEinladung(wrap!, geraet.signer))! });
    assert.deepEqual(await liesMit(geraet), ["an alle Geräte"]);
  }
});

test("2.2b-e2: Entzug entfernt das Gerät vor der nächsten Nachricht; ein neues Gerät wird eingeladen; eins ohne KeyPackage → NIP-17, Gruppe bleibt", async () => {
  const { mls } = await mlsKonto(u)!;
  await netz.sendeAn(signEvent(buildDeviceRevoke(CLEO.pk, cleoHandy.pk, "verloren", jetzt()), CLEO.sk), [VOLLMACHTEN]);
  buch.vergiss(CLEO.pk);
  assert.deepEqual(await mlsSendeAn(CLEO.pk, cleoGruppe, "nach dem Entzug", u), { gruppe: cleoGruppe, gesendet: true });
  assert.ok(!mls.mitglieder(cleoGruppe).includes(cleoHandy.pk), "entzogenes Gerät entfernt");
  assert.deepEqual(await liesMit(cleoHandy), [], "und liest nichts mehr");

  const neu = await mitKeyPackage("wss://schreib-cleo.test");
  await vollmacht(CLEO, neu.pk);
  assert.deepEqual(await mlsSendeAn(CLEO.pk, cleoGruppe, "mit dem neuen", u), { gruppe: cleoGruppe, gesendet: true });
  assert.ok(mls.mitglieder(cleoGruppe).includes(neu.pk));
  const wrap = einladungAn(neu.pk, "wss://eingang-cleo.test")!;
  await nimmEinladungAn({ mls: neu.mls, sichern: neu.sichern, speicher: leerSpeicher, einladung: (await oeffneEinladung(wrap, neu.signer))! });
  assert.deepEqual(await liesMit(neu), ["mit dem neuen"], "ab seinem Beitritt");

  const ohne = generateKeypair();
  await vollmacht(CLEO, ohne.pk);
  const vorher = mls.mitglieder(cleoGruppe).sort();
  assert.deepEqual(await mlsSendeAn(CLEO.pk, cleoGruppe, "per NIP-17", u), { gruppe: cleoGruppe, gesendet: false }, "sonst bekäme dieses Gerät die Nachricht nicht");
  assert.deepEqual(mls.mitglieder(cleoGruppe).sort(), vorher);
});

test("2.2b-e2: Einladung mit Geräten ist die Unterhaltung mit der Person; mit einem Fremden keine (seit 2.3b: eine Gruppe zu mehreren)", async () => {
  const dana = generateKeypair();
  const d = { signer: new LocalSigner(dana.sk), mls: new Mls(new LocalSigner(dana.sk), (id) => toHex(schnorr.sign(fromHex(id), dana.sk))), sichern: async () => {} };
  const danaHandy = await mitKeyPackage("wss://schreib-dana.test");
  await vollmacht(dana, danaHandy.pk);
  const fremd = await mitKeyPackage("wss://schreib-fremd.test");
  await mlsErreichbar(u);
  for (const [dabei, partner] of [[[danaHandy], dana.pk], [[danaHandy, fremd], null]] as const) {
    const meine = await sucheKeyPackages({ pk: ICH.pk, abfrage: async (f) => frage(f, EIGENE) });
    const kps = [meine[0]!, ...(await Promise.all(dabei.map(async (x) => (await sucheKeyPackages({ pk: x.pk, abfrage: frage }))[0]!)))];
    const g = await d.mls.gruppeAnlegen("", kps, GRUPPE);
    const e = { von: dana.pk, relays: GRUPPE, wrap: g.einladungen.find((w) => w.tags.some((t) => t[1] === ICH.pk))! };
    assert.deepEqual(await mlsEinladungAnnehmen(e, u), { gruppe: g.gruppe, partner });
    await mlsErreichbar(u);
  }
});


test("2.3b: Raum – nur mit mir gegründet, eigene Kanäle im Stand; einladen nur mit KeyPackage, Einladung an den Posteingang; der Eingeladene liest ab dem Eintritt; Moderator per Commit", async () => {
  const g = (await mlsGruende("Werkstatt", u))!;
  assert.ok(g, "Gruppe an den eigenen Relays");
  const kanaele = [{ id: "allgemein", name: "allgemein", privacy: "verschluesselt" as const, writeRoles: [], position: 0 }];
  assert.equal(await mlsSendeEvent(g, raumDefinition(g, { name: "Werkstatt", kanaele }), u), true);
  const vorher = (await mlsGruppenStand(g, u))!;
  assert.deepEqual([vorher.admins, vorher.mitglieder], [[ICH.pk], [ICH.pk]]);
  assert.equal(gruppenRaum(g, vorher.ereignisse, vorher).zustand.space?.name, "Werkstatt", "eigene Definition im Stand – MLS entschlüsselt sie nicht zurück");
  assert.match(vorher.ereignisse[0]!.id, /^[0-9a-f]{64}$/, "Id des inneren Events, wie bei den Empfängern");
  assert.deepEqual(await mlsVerlauf(g, u), [], "kein Chat – der 1:1-Verlauf zeigt die Definition nicht");

  assert.equal(await mlsLadeEin(g, generateKeypair().pk, u), "kein KeyPackage");
  const eva = await mitKeyPackage("wss://schreib-eva.test");
  eingaenge.set(eva.pk, ["wss://eingang-eva.test"]);
  assert.equal(await mlsLadeEin(g, eva.pk, u), "eingeladen");
  const wrap = einladungAn(eva.pk, "wss://eingang-eva.test")!;
  assert.equal(await eva.mls.beitreten(wrap), g);
  assert.equal(await mlsSendeEvent(g, raumNachricht({ kanal: "allgemein", text: "Willkommen" }), u), true);
  assert.deepEqual(await liesMit(eva), ["Willkommen"], "ab dem Eintritt – die Definition davor nicht (darum sendet 2.3b den Raumstand neu)");

  // Ein Raum zu zweit ist kein 1:1-Chat: benannte Gruppe → Raum (sonst ersetzte er die Unterhaltung mit dem Einladenden)
  const meine = await sucheKeyPackages({ pk: ICH.pk, abfrage: async (f) => frage(f, EIGENE) });
  const zuZweit = await eva.mls.gruppeAnlegen("Evas Raum", [meine[0]!], GRUPPE);
  const e = { von: eva.pk, relays: GRUPPE, wrap: zuZweit.einladungen[0]! };
  assert.deepEqual(await mlsEinladungAnnehmen(e, u), { gruppe: zuZweit.gruppe, partner: null });
  await mlsErreichbar(u);

  assert.equal(await mlsSetzeAdmins(g, [ICH.pk, eva.pk], u), true);
  assert.deepEqual((await mlsGruppenStand(g, u))!.admins, [ICH.pk, eva.pk].sort());
  assert.equal(await mlsGruppenStand("ab".repeat(16), u), null, "fremde Gruppe");
});
