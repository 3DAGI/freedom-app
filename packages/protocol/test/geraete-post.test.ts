/**
 * Schritt 8.6b: Direktnachrichten an alle Geraete einer Person – Ziele,
 * Versiegeln, Oeffnen als Geraet, Zuordnung des Absenders, Entzug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import { buildDeviceGrant, buildDeviceRevoke } from "../src/devices.js";
import { buildPrivateDm, openPrivateDm } from "../src/private-dm.js";
import { absenderPerson, alleGeraete, nachrichtenGeraete } from "../src/geraete-post.js";
import { regelKeinKlartext } from "../src/leak-rules.js";

const T = 1_790_000_000;
const [o, d1, d2, d3, k, fremd] = [generateKeypair(), generateKeypair(), generateKeypair(), generateKeypair(), generateKeypair(), generateKeypair()];
const s = (x: { sk: Uint8Array }) => new LocalSigner(x.sk);
const vollmacht = (von: typeof o, geraet: string, perms: ("nachrichten" | "raeume")[], at = T - 100) =>
  signEvent(buildDeviceGrant({ ownerPubkey: von.pk, devicePubkey: geraet, label: `G-${geraet.slice(0, 4)}`, permissions: perms, expiresAt: T + 365 * 86_400 }, at), von.sk);
const GERAETE = [vollmacht(o, d1.pk, ["nachrichten", "raeume"]), vollmacht(o, d2.pk, ["raeume"]), vollmacht(o, d3.pk, ["nachrichten"]),
  signEvent(buildDeviceRevoke(o.pk, d3.pk, "verloren", T - 50), o.sk)];

test("8.6b: Kopien gehen an die aktiven Geraete mit „nachrichten“ – alle je bevollmaechtigten bleiben lesbar", () => {
  assert.deepEqual(nachrichtenGeraete(o.pk, GERAETE, T), [d1.pk]);
  assert.deepEqual(nachrichtenGeraete(k.pk, GERAETE, T), [], "ohne Vollmacht keine Geraete");
  assert.deepEqual(alleGeraete(o.pk, GERAETE).sort(), [d1.pk, d2.pk, d3.pk].sort());
  const unfug = signEvent({ ...buildDeviceGrant({ ownerPubkey: o.pk, devicePubkey: "zz", label: "x", permissions: ["nachrichten"], expiresAt: T + 99 }, T - 10) }, o.sk);
  assert.deepEqual(nachrichtenGeraete(o.pk, [...GERAETE, unfug], T), [d1.pk], "kein Hex – keine Kopie");
});

test("8.6b: K schreibt O – O und sein Geraet D1 oeffnen, D2 und D3 bekommen nichts; kein Klartext", async () => {
  const dm = await buildPrivateDm({ signer: s(k), recipientPk: o.pk, weitereEmpfaenger: [...nachrichtenGeraete(o.pk, GERAETE, T), o.pk, k.pk, "zz"], content: "Treffen um acht", nowSecs: T });
  assert.deepEqual(dm.weitere.map((w) => w.an), [d1.pk], "doppelte, eigene und ungueltige fallen weg");
  assert.deepEqual(regelKeinKlartext([dm.toRecipient, dm.toSelf, ...dm.weitere.map((w) => w.wrap)], ["Treffen um acht"]), []);
  const anD1 = dm.weitere[0]!.wrap;
  assert.equal((await openPrivateDm(anD1, s(d1))).ok, false, "ohne Wissen um die Hauptidentitaet: betrifft mich nicht");
  const r = await openPrivateDm(anD1, s(d1), undefined, { auchFuer: [o.pk] });
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.dm.partner, k.pk); assert.equal(r.dm.content, "Treffen um acht"); assert.equal(r.dm.id, dm.rumorId); }
  const anO = await openPrivateDm(dm.toRecipient, s(o));
  assert.ok(anO.ok && anO.dm.partner === k.pk);
  // Mit Ablauf: jede Kopie traegt ihn, je Umschlag eigener Zeitversatz
  const mitAblauf = await buildPrivateDm({ signer: s(k), recipientPk: o.pk, weitereEmpfaenger: [d1.pk], content: "kurz", ablaufSecs: 3600, nowSecs: T });
  assert.ok(mitAblauf.weitere[0]!.wrap.tags.some((t) => t[0] === "expiration" && Number(t[1]) >= T + 3600));
});

test("8.6b: D1 antwortet – K ordnet D1 der Person O zu; O liest die eigene Kopie", async () => {
  const dm = await buildPrivateDm({ signer: s(d1), recipientPk: k.pk, weitereEmpfaenger: [...nachrichtenGeraete(k.pk, GERAETE, T), o.pk, ...nachrichtenGeraete(o.pk, GERAETE, T)], content: "Passt, bis dann", nowSecs: T });
  assert.deepEqual(dm.weitere.map((w) => w.an), [o.pk]);
  const beiK = await openPrivateDm(dm.toRecipient, s(k));
  assert.ok(beiK.ok);
  if (!beiK.ok) return;
  assert.equal(beiK.dm.from, d1.pk);
  const z = absenderPerson(beiK.dm.from, beiK.dm.createdAt, GERAETE, { nowSecs: T });
  assert.deepEqual({ person: z.person, gueltig: z.gueltig, label: z.geraet?.label, entzogen: z.geraet?.entzogen }, { person: o.pk, gueltig: true, label: `G-${d1.pk.slice(0, 4)}`, entzogen: false });
  // O (Hauptschluessel) liest die Kopie, wenn es seine Geraete kennt
  const kopie = dm.weitere[0]!.wrap;
  assert.equal((await openPrivateDm(kopie, s(o))).ok, false);
  const beiO = await openPrivateDm(kopie, s(o), undefined, { auchFuer: alleGeraete(o.pk, GERAETE) });
  assert.ok(beiO.ok && beiO.dm.partner === k.pk);
});

test("8.6b: Entzug – vorher gilt (mit Hinweis), danach nicht; ohne Recht keine Zuordnung", () => {
  const vorher = absenderPerson(d3.pk, T - 60, GERAETE, { nowSecs: T });
  assert.deepEqual([vorher.gueltig, vorher.person, vorher.geraet?.entzogen], [true, o.pk, true], "vor dem Entzug – aber der Zeitpunkt ist nur behauptet");
  const nach = absenderPerson(d3.pk, T, GERAETE, { nowSecs: T });
  assert.deepEqual([nach.gueltig, nach.person, nach.geraet?.eigentuemer], [false, d3.pk, o.pk], "nicht mehr O – man sieht aber, wessen Geraet es war");
  assert.equal(absenderPerson(d2.pk, T, GERAETE, { nowSecs: T }).gueltig, false, "darf nicht „nachrichten“");
  assert.deepEqual(absenderPerson(k.pk, T, GERAETE, { nowSecs: T }), { person: k.pk, gueltig: true, grund: "eigener Schlüssel" });
});

test("8.6b: Fremde Vollmacht fuer ein fremdes Geraet – der Kontakt gewinnt, ohne Kontakt keiner", () => {
  const mitFremd = [...GERAETE, vollmacht(fremd, d1.pk, ["nachrichten"], T - 10)];
  const ohne = absenderPerson(d1.pk, T, mitFremd, { nowSecs: T });
  assert.deepEqual([ohne.gueltig, ohne.person], [false, d1.pk]);
  const mit = absenderPerson(d1.pk, T, mitFremd, { nowSecs: T, bevorzugt: (pk) => pk === o.pk });
  assert.deepEqual([mit.gueltig, mit.person], [true, o.pk]);
  const nurFremd = absenderPerson(d2.pk, T, [vollmacht(fremd, d2.pk, ["nachrichten"])], { nowSecs: T, bevorzugt: (pk) => pk === o.pk });
  assert.deepEqual([nurFremd.gueltig, nurFremd.person], [true, fremd.pk], "nur eine Vollmacht: sie gilt, auch ohne Kontakt");
});
