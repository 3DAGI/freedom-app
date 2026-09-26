/**
 * Schritt 8.11b: Nachfolge in der App – Umschlaege einordnen, Stand lesen,
 * was die Ansicht fuer Vertraute anbietet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, baueAnteilAnfrage, baueAnteilUebergabe, baueAnteilUmschlag, buildPrivateDm, buildRecoveryClaim,
  buildSuccessionPlan, generateKeypair, neueTeilung, parseSuccessionPlan, secretHashOf, signEvent, splitSecret,
} from "@freedomstack/protocol";
import { LS_NACHFOLGE, type NachfolgeStand, leseStand, neuestePlaene, nimmUmschlag, schreibeStand, vertrautenZeilen } from "../src/nachfolge.js";

const TAG = 86_400;
const T0 = 1_790_000_000;
const besitzer = generateKeypair();
const [b, c, d] = [generateKeypair(), generateKeypair(), generateKeypair()];
const s = (k: { sk: Uint8Array }) => new LocalSigner(k.sk);
const leer = (): NachfolgeStand => leseStand(null);

async function einrichten() {
  const secretHash = secretHashOf(besitzer.sk);
  const teilung = neueTeilung();
  const teile = splitSecret(besitzer.sk, 3, 2);
  const guardians = [b.pk, c.pk, d.pk];
  const planEv = signEvent(buildSuccessionPlan({ ownerPubkey: besitzer.pk, guardians, threshold: 2, inactivityDays: 180, graceDays: 30, secretHash }, T0), besitzer.sk);
  const wraps = await Promise.all(teile.map((t, i) => baueAnteilUmschlag({ von: s(besitzer), an: guardians[i]!, anteil: t, schwelle: 2, anzahl: 3, secretHash, teilung, nowSecs: T0 })));
  return { planEv, plan: parseSuccessionPlan(planEv), wraps };
}
const meldung = (k: { pk: string; sk: Uint8Array }, at: number) => signEvent(buildRecoveryClaim(k.pk, besitzer.pk, "still", at), k.sk);

test("8.11b: Anteil, Anfrage und Uebergabe landen im Stand; anderes nicht", async () => {
  const { plan, wraps } = await einrichten();
  const stB = leer();
  assert.ok(await nimmUmschlag({ wrap: wraps[0]!, signer: s(b), stand: stB, plaene: async () => [plan] }));
  assert.equal(stB.anteile[besitzer.pk]?.index, 1);
  // Eine gewoehnliche DM gehoert nicht dazu
  const dm = await buildPrivateDm({ signer: s(c), recipientPk: b.pk, content: "hallo" });
  assert.equal(await nimmUmschlag({ wrap: dm.toRecipient, signer: s(b), stand: stB, plaene: async () => [plan] }), null);

  // C bekommt die Anfrage von B
  const stC = leer();
  await nimmUmschlag({ wrap: wraps[1]!, signer: s(c), stand: stC, plaene: async () => [plan] });
  const { wrap: anfrage } = await baueAnteilAnfrage({ von: s(b), an: c.pk, besitzer: besitzer.pk, teilung: stB.anteile[besitzer.pk]!.teilung });
  await nimmUmschlag({ wrap: anfrage, signer: s(c), stand: stC, plaene: async () => [plan] });
  await nimmUmschlag({ wrap: anfrage, signer: s(c), stand: stC, plaene: async () => [plan] });
  assert.equal(stC.anfragen.length, 1, "doppelt zaehlt einmal");

  // Uebergabe an B – nur angenommen, wenn B angefragt hat
  const uebergabe = await baueAnteilUebergabe({ von: s(c), anfrage: stC.anfragen[0]!, anteil: stC.anteile[besitzer.pk]! });
  assert.equal(await nimmUmschlag({ wrap: uebergabe, signer: s(b), stand: stB, plaene: async () => [plan] }), null);
  stB.angefragt[besitzer.pk] = T0;
  await nimmUmschlag({ wrap: uebergabe, signer: s(b), stand: stB, plaene: async () => [plan] });
  assert.equal(stB.erhalten[besitzer.pk]?.length, 1);
  assert.equal(stB.erhalten[besitzer.pk]![0]!.von, c.pk);
});

test("8.11b: Stand nur ueber den Speicher, Unfug faellt heraus", async () => {
  const daten = new Map<string, string>();
  const sp = { getItem: (k: string) => daten.get(k) ?? null, setItem: async (k: string, v: string) => { daten.set(k, v); } };
  const st = leer();
  st.angefragt[besitzer.pk] = T0;
  await schreibeStand(sp, st);
  assert.deepEqual(leseStand(sp).angefragt, { [besitzer.pk]: T0 });
  daten.set(LS_NACHFOLGE, JSON.stringify({ anteile: { kaputt: {} }, anfragen: "x", erhalten: [], angefragt: { [besitzer.pk]: "nein" } }));
  assert.deepEqual(leseStand(sp), leer());
  daten.set(LS_NACHFOLGE, "{kein json");
  assert.deepEqual(leseStand(sp), leer());
  // Ohne Speicher (kein Tresor): der Stand im Speicher
  assert.equal(leseStand(null, st), st);
});

test("8.11b: Ansicht – melden, anfordern, uebergeben und zusammensetzen erst nach Freigabe", async () => {
  const { plan, planEv, wraps } = await einrichten();
  const stB = leer();
  const stC = leer();
  await nimmUmschlag({ wrap: wraps[0]!, signer: s(b), stand: stB, plaene: async () => [plan] });
  await nimmUmschlag({ wrap: wraps[1]!, signer: s(c), stand: stC, plaene: async () => [plan] });
  const plaene = neuestePlaene([planEv], parseSuccessionPlan);
  const { wrap: anfrage } = await baueAnteilAnfrage({ von: s(b), an: c.pk, besitzer: besitzer.pk, teilung: stB.anteile[besitzer.pk]!.teilung });
  await nimmUmschlag({ wrap: anfrage, signer: s(c), stand: stC, plaene: async () => [plan] });

  // Vor der Freigabe
  let [zc] = vertrautenZeilen(stC, plaene, [], c.pk, T0 + 10 * TAG);
  assert.equal(zc!.passt, true);
  assert.equal(zc!.kannAnfordern, false);
  assert.equal(zc!.anfragen[0]!.darf.ok, false);

  // Nach Frist, zwei Meldungen und Wartezeit
  const events = [meldung(b, T0 + 181 * TAG), meldung(c, T0 + 182 * TAG)];
  [zc] = vertrautenZeilen(stC, plaene, events, c.pk, T0 + 213 * TAG);
  assert.equal(zc!.anfragen[0]!.darf.ok, true);
  assert.equal(zc!.gemeldet, true, "eigene Meldung zaehlt – kein zweites Melden");
  assert.equal(vertrautenZeilen(stC, plaene, [], c.pk, T0 + 213 * TAG)[0]!.gemeldet, false);
  let [zb] = vertrautenZeilen(stB, plaene, events, b.pk, T0 + 213 * TAG);
  assert.equal(zb!.kannAnfordern, true);
  assert.equal(zb!.kannZusammensetzen, false, "erst einer von zwei");

  stB.angefragt[besitzer.pk] = T0 + 213 * TAG;
  const uebergabe = await baueAnteilUebergabe({ von: s(c), anfrage: stC.anfragen[0]!, anteil: stC.anteile[besitzer.pk]! });
  await nimmUmschlag({ wrap: uebergabe, signer: s(b), stand: stB, plaene: async () => [plan] });
  [zb] = vertrautenZeilen(stB, plaene, events, b.pk, T0 + 213 * TAG);
  assert.equal(zb!.beisammen, 2);
  assert.equal(zb!.kannZusammensetzen, true);

  // Fremder Plan (ich bin nicht mehr Vertrauter): nichts anbieten
  const neuerPlan = signEvent(buildSuccessionPlan({ ownerPubkey: besitzer.pk, guardians: [c.pk, d.pk, generateKeypair().pk], threshold: 2, inactivityDays: 180, graceDays: 30, secretHash: plan.secretHash }, T0 + 1), besitzer.sk);
  [zb] = vertrautenZeilen(stB, neuestePlaene([planEv, neuerPlan], parseSuccessionPlan), events, b.pk, T0 + 213 * TAG);
  assert.equal(zb!.passt, false);
  assert.equal(zb!.kannAnfordern, false);
});

test("8.11b: verdrahtet – Einrichten versiegelt je Vertrautem, keine Datei mit allen Teilen", () => {
  const settings = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  const start = settings.indexOf("export async function richteNachfolgeEin(");
  const f = settings.slice(start, settings.indexOf("\n}\n", start));
  assert.match(f, /await baueAnteilUmschlag\(\{/);
  assert.match(f, /await veroeffentlicheDm\(wrap, guardians\[i\]!\);/);
  assert.match(f, /for \(const t of teile\) t\.data\.fill\(0\);/, "Teile danach genullt");
  assert.doesNotMatch(f, /createObjectURL|download/, "keine Datei mit allen Teilen mehr");
  const ui = readFileSync(new URL("../src/shell/nachfolge-ui.ts", import.meta.url), "utf8");
  assert.match(ui, /tresorEingerichtet\(\) \? geheim : null/, "Anteile nur im Tresor, sonst nur im Speicher");
  assert.doesNotMatch(ui, /\.innerHTML\s*=/);
  assert.doesNotMatch(ui, /localStorage\.(get|set|remove)Item/, "kein direkter Zugriff");
});
