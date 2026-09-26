/**
 * Schritt 8.6c: Die App als Geraet – Geraetecode, Stand der eigenen
 * Vollmacht, Zuordnung auf dem Geraet, Sperren und Verdrahtung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, buildDeviceGrant, buildDeviceRevoke, buildPrivateDm, generateKeypair, openPrivateDm, signEvent, toHex,
  type NostrEvent,
} from "@freedomstack/protocol";
import { LS_GERAET_PERSON, geraeteCode, geraeteStand, leseGeraeteCode } from "../src/geraete-modus.js";
import { GeraeteBuch, ordneDmZu } from "../src/geraete-buch.js";

const T = 1_790_000_000;
const [o, d, d2, k] = Array.from({ length: 4 }, () => generateKeypair());
const vollmacht = (geraet: string, label: string, perms: ("nachrichten" | "raeume")[] = ["nachrichten"], bis = T + 86_400 * 365) =>
  signEvent(buildDeviceGrant({ ownerPubkey: o.pk, devicePubkey: geraet, label, permissions: perms, expiresAt: bis }, T - 100), o.sk);

test("8.6c: Geraetecode hin und zurueck – alles andere ist keiner", () => {
  const code = geraeteCode(o.pk, toHex(d.sk));
  assert.deepEqual(leseGeraeteCode(`  ${code.toUpperCase()} `), { person: o.pk, skHex: toHex(d.sk) });
  assert.equal(leseGeraeteCode(toHex(d.sk)), null, "blosses Hex bleibt ein Schluessel");
  assert.equal(leseGeraeteCode(`freedom-geraet:${o.pk}`), null);
  assert.equal(leseGeraeteCode(`freedom-geraet:${o.pk}:${toHex(d.sk)}:x`), null);
  assert.equal(leseGeraeteCode(`freedom-geraet:${o.pk.slice(1)}:${toHex(d.sk)}`), null);
  assert.throws(() => geraeteCode("x", toHex(d.sk)), /64-stelliges Hex/);
  assert.ok(LS_GERAET_PERSON.startsWith("freedom."), "Notfall-Loeschung erfasst ihn");
});

test("8.6c: Stand der eigenen Vollmacht – aktiv, ohne Recht, entzogen, abgelaufen, fehlt", () => {
  assert.deepEqual([geraeteStand(d.pk, o.pk, [vollmacht(d.pk, "Handy")], T).darfSchreiben, geraeteStand(d.pk, o.pk, [vollmacht(d.pk, "Handy")], T).status], [true, "aktiv"]);
  assert.equal(geraeteStand(d.pk, o.pk, [vollmacht(d.pk, "Handy", ["raeume"])], T).darfSchreiben, false);
  const entzogen = geraeteStand(d.pk, o.pk, [vollmacht(d.pk, "Handy"), signEvent(buildDeviceRevoke(o.pk, d.pk, "verloren", T - 10), o.sk)], T);
  assert.deepEqual([entzogen.status, entzogen.darfSchreiben], ["entzogen", false]);
  assert.equal(geraeteStand(d.pk, o.pk, [vollmacht(d.pk, "Handy", ["nachrichten"], T - 1)], T).status, "abgelaufen");
  assert.equal(geraeteStand(d.pk, o.pk, [], T).status, "fehlt");
  // Eine Vollmacht eines Fremden fuer dieses Geraet zaehlt nicht – die Person steht im Code
  const fremd = signEvent(buildDeviceGrant({ ownerPubkey: k.pk, devicePubkey: d.pk, label: "x", permissions: ["nachrichten"], expiresAt: T + 99 }, T - 5), k.sk);
  assert.equal(geraeteStand(d.pk, o.pk, [fremd], T).status, "fehlt");
});

test("8.6c: auf dem Geraet – K schreibt O, D liest; D und O erscheinen als „du“", async () => {
  const evs: NostrEvent[] = [vollmacht(d.pk, "Handy"), vollmacht(d2.pk, "Laptop")];
  const buch = new GeraeteBuch(async (f) => evs.filter((e) => (f.kinds as number[]).includes(e.kind) && (!f.authors || (f.authors as string[]).includes(e.pubkey))
    && (!f["#p"] || e.tags.some((t) => t[0] === "p" && (f["#p"] as string[]).includes(t[1]!)))), () => T * 1000);
  const auchFuer = [o.pk, ...(await buch.alle(o.pk))];
  const kontakt = (pk: string) => pk === k.pk;
  const lies = async (von: typeof o, an: string, weitere: string[]) => {
    const b = await buildPrivateDm({ signer: new LocalSigner(von.sk), recipientPk: an, content: "x", nowSecs: T, weitereEmpfaenger: weitere });
    const w = [b.toRecipient, b.toSelf, ...b.weitere.map((x) => x.wrap)].find((x) => x.tags.some((t) => t[1] === d.pk))!;
    const r = await openPrivateDm(w, new LocalSigner(d.sk), undefined, { auchFuer });
    assert.ok(r.ok);
    return r.ok ? ordneDmZu(r.dm, o.pk, buch, kontakt, d.pk) : null;
  };
  assert.deepEqual(await lies(k, o.pk, [d.pk]), { partner: k.pk, autor: k.pk, vonMir: false });
  assert.deepEqual(await lies(d, k.pk, [o.pk]), { partner: k.pk, autor: o.pk, vonMir: true }, "eigene Kopie ohne Hinweis");
  assert.deepEqual(await lies(o, k.pk, [d.pk]), { partner: k.pk, autor: o.pk, vonMir: true }, "vom Hauptschluessel");
  assert.deepEqual(await lies(d2, k.pk, [o.pk, d.pk]), { partner: k.pk, autor: o.pk, vonMir: true, hinweis: "von deinem Gerät „Laptop“" });
});

test("8.6c: Verdrahtung – Import mit Code, Anmelden beim Start, Senden nur mit Vollmacht, Sperren, Posteingang der Person", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const app = src("../src/shell/app.ts");
  assert.match(app, /const code = leseGeraeteCode\(eingabe\);/);
  assert.match(app, /setzeIdentitaet\(fromHex\(hex\), code\?\.person \?\? null\);/);
  assert.match(app, /else localStorage\.removeItem\(LS_GERAET_PERSON\);/, "ein normaler Import beendet den Geraetemodus");
  assert.match(app, /const person = localStorage\.getItem\(LS_GERAET_PERSON\);\s*setzeIdentitaet\(fromHex\(stored\), person && \/\^\[0-9a-f\]\{64\}\$\/\.test\(person\) \? person : null\);/);
  const state = src("../src/shell/state.ts");
  assert.match(state, /if \(state\.person\) \{\s*listenAbgeglichen = await posteingangDerPerson\(state\.person\);\s*return;/, "als Geraet keine eigenen Listen");
  assert.match(state, /pool\.addRelay\(new WebSocketRelay\(url, \{ timeoutMs: 8000 \}\)\)/);
  const kom = src("../src/shell/tabs/kommunikation.ts");
  assert.match(kom, /if \(alsGeraet\(\) && !meine!\.includes\(state\.keypair\.pk\)\) \{\s*toast\(/);
  assert.match(kom, /await veroeffentlicheDm\(dm\.toSelf, ich\);/);
  const settings = src("../src/shell/tabs/settings.ts");
  for (const f of ["export async function richteNachfolgeEin(", "async function bereiteWechselVor(", "async function fuegeGeraetHinzu("]) {
    const rumpf = settings.slice(settings.indexOf(f), settings.indexOf(f) + 200);
    assert.match(rumpf, /!nurHauptidentitaet\(/, `${f} gesperrt`);
  }
  assert.match(settings, /geraeteCode\(state\.keypair\.pk, th\(geraet\.sk\)\),\s*\);\s*geraet\.sk\.fill\(0\);/);
});
