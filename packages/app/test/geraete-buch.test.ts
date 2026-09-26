/**
 * Schritt 8.6b: Geraete im Chat – wer eine Kopie bekommt, wem eine Nachricht
 * zugeordnet wird, wie schnell ein Entzug wirkt, und dass der Chat es nutzt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, buildDeviceGrant, buildDeviceRevoke, buildPrivateDm, generateKeypair, openPrivateDm, signEvent,
  type NostrEvent,
} from "@freedomstack/protocol";
import { GERAETE_FRISCH_MS, GeraeteBuch, ordneDmZu } from "../src/geraete-buch.js";

const T = 1_790_000_000;
const [o, d1, d2, k, kd, fremd] = Array.from({ length: 6 }, () => generateKeypair());
const vollmacht = (von: typeof o, geraet: string, label: string, at = T - 100) =>
  signEvent(buildDeviceGrant({ ownerPubkey: von.pk, devicePubkey: geraet, label, permissions: ["nachrichten"], expiresAt: T + 365 * 86_400 }, at), von.sk);
const entzug = (von: typeof o, geraet: string, at: number) => signEvent(buildDeviceRevoke(von.pk, geraet, "verloren", at), von.sk);

/** Relay-Ersatz: filtert nach kinds, authors und #p – und zaehlt die Abfragen. */
function relay(evs: NostrEvent[]) {
  const r = {
    evs, abfragen: 0, offline: false,
    abfrage: async (f: Record<string, unknown>): Promise<NostrEvent[]> => {
      r.abfragen++;
      if (r.offline) throw new Error("offline");
      const kinds = f.kinds as number[]; const authors = f.authors as string[] | undefined; const p = f["#p"] as string[] | undefined;
      return r.evs.filter((ev) => kinds.includes(ev.kind) && (!authors || authors.includes(ev.pubkey))
        && (!p || ev.tags.some((t) => t[0] === "p" && p.includes(t[1]!))));
    },
  };
  return r;
}

async function dm(von: typeof o, an: string, text: string, zeit = T, oeffner = o, auchFuer: string[] = []) {
  const b = await buildPrivateDm({ signer: new LocalSigner(von.sk), recipientPk: an, content: text, nowSecs: zeit, weitereEmpfaenger: [o.pk] });
  const wrap = [b.toRecipient, b.toSelf, ...b.weitere.map((w) => w.wrap)].find((w) => w.tags.some((t) => t[1] === oeffner.pk))!;
  const r = await openPrivateDm(wrap, new LocalSigner(oeffner.sk), undefined, { auchFuer });
  assert.ok(r.ok, "oeffnen");
  return r.dm;
}

test("8.6b: Kopien an aktive Geraete; das Buch fragt je Minute einmal, nach „vergiss“ sofort", async () => {
  let jetzt = T * 1000;
  const r = relay([vollmacht(o, d1.pk, "Handy"), vollmacht(o, d2.pk, "Laptop"), entzug(o, d2.pk, T - 50)]);
  const buch = new GeraeteBuch(r.abfrage, () => jetzt);
  assert.deepEqual(await buch.kopienFuer(o.pk), [d1.pk], "entzogenes Laptop bekommt nichts");
  assert.deepEqual((await buch.alle(o.pk)).sort(), [d1.pk, d2.pk].sort(), "gelesen wird auch, was es vorher schrieb");
  assert.equal(r.abfragen, 1);
  r.evs.push(entzug(o, d1.pk, T));
  assert.deepEqual(await buch.kopienFuer(o.pk), [d1.pk], "noch aus dem Buch");
  jetzt += GERAETE_FRISCH_MS;
  assert.deepEqual(await buch.kopienFuer(o.pk), [], "nach einer Minute wirkt der Entzug");
  r.evs.push(vollmacht(o, d2.pk, "Laptop neu", T + 10));
  buch.vergiss(o.pk);
  assert.equal((await buch.kopienFuer(o.pk)).length, 0, "Entzug bleibt – eine neue Vollmacht hebt ihn nicht auf");
  assert.equal(r.abfragen, 3);
  // Offline: der Fehler bleibt nicht im Buch
  const off = relay([]); off.offline = true;
  const b2 = new GeraeteBuch(off.abfrage, () => jetzt);
  await assert.rejects(b2.kopienFuer(o.pk));
  off.offline = false;
  assert.deepEqual(await b2.kopienFuer(o.pk), []);
});

test("8.6b: O liest – eigene, eigene Geraete, Geraete eines Kontakts", async () => {
  const r = relay([vollmacht(o, d1.pk, "Handy"), vollmacht(k, kd.pk, "Tablet")]);
  const buch = new GeraeteBuch(r.abfrage, () => T * 1000);
  const kontakt = (pk: string) => pk === k.pk;
  const auchFuer = await buch.alle(o.pk);

  const selbst = await dm(o, k.pk, "a", T, o);
  assert.deepEqual(await ordneDmZu(selbst, o.pk, buch, kontakt), { partner: k.pk, autor: o.pk, vonMir: true });

  const vomHandy = await dm(d1, k.pk, "b", T, o, auchFuer);
  assert.equal(vomHandy.partner, k.pk);
  assert.deepEqual(await ordneDmZu(vomHandy, o.pk, buch, kontakt), { partner: k.pk, autor: o.pk, vonMir: true, hinweis: "von deinem Gerät „Handy“" });

  const vomTablet = await dm(kd, o.pk, "c", T, o, auchFuer);
  assert.equal(vomTablet.partner, kd.pk, "das Protokoll kennt nur den Geraeteschluessel");
  assert.deepEqual(await ordneDmZu(vomTablet, o.pk, buch, kontakt), { partner: k.pk, autor: k.pk, vonMir: false, hinweis: "über Gerät „Tablet“" });

  const vonK = await dm(k, o.pk, "d", T, o, auchFuer);
  assert.deepEqual(await ordneDmZu(vonK, o.pk, buch, kontakt), { partner: k.pk, autor: k.pk, vonMir: false });
});

test("8.6b: Entzug – danach nicht mehr die Person, vorher nur mit Hinweis; fremde Vollmacht gewinnt nicht", async () => {
  const r = relay([vollmacht(o, d1.pk, "Handy"), entzug(o, d1.pk, T), vollmacht(k, kd.pk, "Tablet"), entzug(k, kd.pk, T)]);
  const buch = new GeraeteBuch(r.abfrage, () => (T + 10) * 1000);
  const kontakt = (pk: string) => pk === k.pk;
  const auchFuer = await buch.alle(o.pk);

  const dieb = await dm(d1, k.pk, "x", T + 5, o, auchFuer);
  const z1 = await ordneDmZu(dieb, o.pk, buch, kontakt);
  assert.deepEqual([z1.autor, z1.vonMir, z1.warnung, z1.hinweis], [d1.pk, false, true, "⚠ von deinem Gerät „Handy“ nach dem Entzug – nicht von dir"]);
  const zurueck = await ordneDmZu(await dm(d1, k.pk, "y", T - 5, o, auchFuer), o.pk, buch, kontakt);
  assert.deepEqual([zurueck.vonMir, zurueck.warnung], [true, true], "vorher datiert: gilt, aber mit Warnung (Zeitpunkt nur behauptet)");

  const kNach = await ordneDmZu(await dm(kd, o.pk, "z", T + 5, o, auchFuer), o.pk, buch, kontakt);
  assert.deepEqual([kNach.partner, kNach.autor, kNach.warnung], [kd.pk, kd.pk, true], "nicht in Ks Unterhaltung, nicht als K");
  assert.match(kNach.hinweis!, /Vollmacht entzogen/);

  // Ein Fremder bevollmaechtigt Ks Tablet fuer sich: K bleibt, weil K Kontakt ist
  const r2 = relay([vollmacht(k, kd.pk, "Tablet"), vollmacht(fremd, kd.pk, "gekapert", T - 10)]);
  const b2 = new GeraeteBuch(r2.abfrage, () => T * 1000);
  const z2 = await ordneDmZu(await dm(kd, o.pk, "w", T, o), o.pk, b2, kontakt);
  assert.equal(z2.partner, k.pk);
  const z3 = await ordneDmZu(await dm(kd, o.pk, "w", T, o), o.pk, b2, () => false);
  assert.deepEqual([z3.partner, z3.warnung, z3.hinweis], [kd.pk, true, "⚠ Gerät nicht eindeutig einer Person zugeordnet"], "ohne Kontakt: keiner der beiden");
});

test("8.6b: Verdrahtung – der Chat liest fuer die eigenen Geraete, ordnet zu und versiegelt an Geraete", () => {
  const kom = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  assert.match(kom, /openPrivateDm\(w, state\.signer, undefined, \{ auchFuer: \[ich, \.\.\.\(await geraeteBuch\.alle\(ich\)/);
  assert.match(kom, /await ordneDmZu\(r\.dm, ich, geraeteBuch, .*, selbst\)/);
  assert.match(kom, /weitereEmpfaenger: \[\.\.\.ihre!, \.\.\.meine!, ich\],/);
  assert.match(kom, /geraeteBuch\.kopienFuer\(pk\)/);
  const settings = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  assert.equal(settings.match(/geraeteBuch\.vergiss\(state\.keypair\.pk\)/g)?.length, 2, "nach Ausstellen und Entziehen");
});
