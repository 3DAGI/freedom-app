/**
 * B-32c2: Direktnachrichten über Reticulum (W3 A) – wenn kein Relay sie annimmt: erst direkt an die Adresse des Kontakts
 * (B-32c1), sonst an die Gegenstelle, die weiterreicht. Drei Apps mit je einer RNode-Attrappe in derselben „Luft“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FUNK_REGIONEN, MeshKind, ReticulumFehler, Sendezeitkonto, buildPrivateDm, generateKeypair, reticulumIdentitaet, starteReticulum,
  type ReticulumFunk,
} from "@freedomstack/protocol";
import { verbindeRNode, type FunkWahl } from "../src/rnode-funk.js";
import { funkZiele, stelleUeberFunkZu } from "../src/reticulum-funk.js";
import { rnodeAttrappe, type Luft } from "../../protocol/test/rnode-attrappe.js";

const EU = FUNK_REGIONEN[0]!;
const wahl: FunkWahl = { region: EU.kennung, parameter: { ...EU.vorgabe }, bestaetigt: 1_790_000_000 };
const [alice, bob] = [generateKeypair(), generateKeypair()];
const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

async function umschlag(): Promise<Uint8Array> {
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "Treffen um 19 Uhr" });
  return new TextEncoder().encode(JSON.stringify(dm.toRecipient));
}

async function app(luft: Luft, sendeFristMs = 5000) {
  const m = new Map<string, string>();
  const rnode = await verbindeRNode(rnodeAttrappe({ luft }).port, wahl, { postOpenDelayMs: 0, detectTimeout: 2 });
  const angekommen: Uint8Array[] = [];
  const funk: ReticulumFunk = await starteReticulum({
    rnode, parameter: wahl.parameter, konto: new Sendezeitkonto(), sendeFristMs,
    identitaet: await reticulumIdentitaet({ getItem: (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) }),
    beiEmpfang: (payload) => angekommen.push(payload),
  });
  return { funk, angekommen };
}

async function bis(bedingung: () => boolean, frist = 10_000): Promise<void> {
  const ende = Date.now() + frist;
  while (!bedingung()) {
    if (Date.now() > ende) throw new Error("Frist abgelaufen");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("B-32c2: Ziele – erst der Kontakt, dann die Gegenstelle, je Adresse einmal, nur 16 Byte", () => {
  const k = new Uint8Array(16).fill(1);
  const g = new Uint8Array(16).fill(2);
  assert.deepEqual(funkZiele(k, g).map((z) => z.art), ["kontakt", "gegenstelle"]);
  assert.deepEqual(funkZiele(null, g).map((z) => z.art), ["gegenstelle"]);
  assert.deepEqual(funkZiele(k, null).map((z) => z.art), ["kontakt"]);
  assert.deepEqual(funkZiele(k, new Uint8Array(16).fill(1)).map((z) => z.art), ["kontakt"], "der Kontakt ist selbst die Gegenstelle");
  assert.deepEqual(funkZiele(new Uint8Array(15), null), []);
  assert.deepEqual(funkZiele(null, null), []);
});

test("B-32c2: der Nächste nur nach einem Fehler – „sendezeit“ bricht ab, ohne Ziel „adresse“", async () => {
  const k = new Uint8Array(16).fill(1);
  const g = new Uint8Array(16).fill(2);
  const versucht: number[] = [];
  const sende = (fehler: Record<number, Error>) => async (an: Uint8Array) => {
    versucht.push(an[0]!);
    if (fehler[an[0]!]) throw fehler[an[0]!];
  };
  assert.equal(await stelleUeberFunkZu(funkZiele(k, g), sende({})), "kontakt");
  assert.equal(await stelleUeberFunkZu(funkZiele(k, g), sende({ 1: new Error("kein Pfad") })), "gegenstelle");
  await assert.rejects(stelleUeberFunkZu(funkZiele(k, g), sende({ 1: new ReticulumFehler("sendezeit") })), { fall: "sendezeit" });
  await assert.rejects(stelleUeberFunkZu(funkZiele(k, g), sende({ 1: new Error("a"), 2: new Error("b") })), { message: "b" });
  await assert.rejects(stelleUeberFunkZu([], sende({})), { fall: "adresse" });
  assert.deepEqual(versucht, [1, 1, 2, 1, 1, 2]);
});

test("B-32c2: über die Luft – der Kontakt direkt; ist er nicht da, nimmt die Gegenstelle", { timeout: 60_000 }, async () => {
  const luft: Luft = new Set();
  const a = await app(luft, 3000);
  const b = await app(luft);
  const c = await app(luft);
  try {
    const roh = await umschlag();
    const ziele = funkZiele(b.funk.adresse, c.funk.adresse);
    const sende = (an: Uint8Array) => a.funk.sende(an, roh, MeshKind.NostrEvent, [alice.pk]);
    assert.equal(await stelleUeberFunkZu(ziele, sende), "kontakt");
    await bis(() => b.angekommen.length > 0);
    assert.deepEqual(b.angekommen, [roh]);
    assert.equal(c.angekommen.length, 0, "die Gegenstelle bekommt nichts, wenn der Kontakt da ist");
    // Bob ist weg – die Gegenstelle nimmt
    await b.funk.stoppe();
    const fremd = funkZiele(new Uint8Array(16).fill(7), c.funk.adresse);
    assert.equal(await stelleUeberFunkZu(fremd, sende), "gegenstelle");
    await bis(() => c.angekommen.length > 0);
    assert.deepEqual(c.angekommen, [roh]);
  } finally {
    for (const s of [a, b, c]) await s.funk.stoppe().catch(() => undefined);
  }
});

test("B-32c2: verdrahtet – erst die Relays, dann Reticulum; die eigene Kopie nie; Post an mich gleich in den Posteingang", async () => {
  const post = lies("src/shell/tabs/posteingang.ts");
  const zu = post.slice(post.indexOf("export async function zustellenDm"));
  assert.ok(zu.indexOf("await veroeffentlicheDm(wrap, empfaenger)") < zu.indexOf("dmUeberReticulum(wrap, empfaenger"), "erst die Relays");
  assert.match(zu, /if \(!\(await dmUeberReticulum\(wrap, empfaenger, state\.keypair \? \[state\.keypair\.pk\] : \[\]\)\)\) throw e;/, "ohne Weg bleibt der Fehler des Netzes");
  const kom = lies("src/shell/tabs/kommunikation.ts");
  assert.match(kom, /zustellenDm\(dm\.toRecipient, c\.id\)/);
  assert.doesNotMatch(kom, /zustellenDm\(dm\.toSelf|zustellenDm\(k\.wrap/, "die eigene Kopie und Kopien an Geräte nie über Funk");
  assert.match(post, /if \(!ich \|\| w\.kind !== 1059 \|\| !w\.tags\.some\(\(t\) => t\[0\] === "p" && t\[1\] === ich\) \|\| dmCache\.has\(w\.id\)\) return false;\n  await nimmLivePost\(w, ich\);/);
  const mesh = lies("src/shell/tabs/mesh.ts");
  assert.ok(mesh.indexOf("const fuerMich = await postAusFunk(ev);") < mesh.indexOf("await pool.publish(ev as never)"), "erst in den eigenen Posteingang, dann weiter");
  assert.match(mesh, /async function postAusFunk\(ev: unknown\): Promise<boolean> \{\n  const \{ nimmPostAusFunk \} = await import\("\.\/posteingang\.js"\);/);
  const ui = lies("src/shell/rnode-ui.ts");
  const dm = ui.slice(ui.indexOf("export async function dmUeberReticulum"));
  assert.match(dm, /const funk = verbunden;\n  if \(!funk\) return false;/, "nur mit laufender RNode");
  assert.match(dm, /funkZiele\(leseLxmfAdresse\(funkAdressBuch\.adresseVon\(an, new Set\(kontakteJetzt\(\)\)\)\), leseLxmfAdresse\(geheim\.getItem\(LS_RETICULUM_GEGENSTELLE\)\)\)/);
  assert.match(dm, /stelleUeberFunkZu\(ziele, \(z\) => funk\.sende\(z, eventToMesh\(wrap\), MeshKind\.NostrEvent, eigeneSchluessel\)\)/);
  const { setLang, t } = await import("../src/i18n.js");
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    for (const k of ["set.rnodeSendetDm", "set.rnodeDmDirekt", "set.rnodeDmGegenstelle", "set.funkPostEmpfangen"]) assert.notEqual(t(k), k, `${k} (${sprache})`);
  }
  setLang("de");
});
