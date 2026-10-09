/**
 * 11.3c1 (Entwurf AGENTEN-RAUM-ENTWURF.md P4/P5, F3 B, F4 A): Agenten auf dem Gerät.
 *
 * Beweist:
 *  - Anlegen mit eigenem Schlüssel (nie die Identität), Persona nur im Buch; Unsinn wirft; höchstens 20
 *  - Budget je Raum: Monat und Tag (UTC), nie darüber; neuer Tag/Monat beginnt neu; andere Einheit beginnt neu
 *  - „Budget erreicht“ je Zeitraum nur einmal
 *  - streng gelesen: falscher Schlüssel, kaputtes Budget, Doppeltes, Unsinn fallen weg
 *  - öffentliche Liste nur mit Agenten offener Räume, nie mit denen privater
 *  - Tresor: im Geheimen, nie in Sicherung oder Export; Anlegen erst nach dem Tresor;
 *    Einladen nur mit Recht, Karte vom Agenten, Hinweis ohne Erwähnung, als Gerät nie
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, fromHex, generateKeypair, raumAdresse, toHex, verifyEvent, waehleSicherung, filtereWiederherstellung, buildEvent } from "@freedomstack/protocol";
import { AGENTEN_BUCH_GRENZEN, AgentenBuch, LS_AGENTEN, leseAgentenBuch } from "../src/agenten-buch.js";
import type { GeheimSpeicher } from "../src/vault.js";

const JETZT = 1_790_000_000; // 2026-09-21, UTC
const speicher = (): GeheimSpeicher & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k), keys: () => [...m.keys()] };
};
const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");
const RAUM = raumAdresse("aa".repeat(32), "werkstatt");
const GRUPPE = "bb".repeat(32);
const DATEN = { name: "Lektor", persona: "Du liest Texte gegen.\nKurz und freundlich.", about: "Liest gegen", modell: "llama3.1:8b" };

test("11.3c1: Anlegen – eigener Schlüssel, Persona nur im Buch, Unsinn wirft", async () => {
  const s = speicher();
  const buch = new AgentenBuch(s, () => JETZT);
  const a = await buch.legeAn(DATEN);
  assert.equal(new LocalSigner(fromHex(a.sk)).publicKey(), a.pk);
  assert.deepEqual(buch.alle().map((x) => x.name), ["Lektor"]);
  assert.equal(buch.agent(a.pk)?.persona, DATEN.persona, "mehrzeilig erlaubt");
  const ev = await buch.signer(a.pk)!.signEvent(buildEvent(a.pk, 1, [], "x", JETZT));
  assert.ok(verifyEvent(ev) && ev.pubkey === a.pk, "signiert als Agent");
  assert.equal(buch.signer("cc".repeat(32)), null);
  for (const falsch of [{ ...DATEN, name: "" }, { ...DATEN, name: "x".repeat(65) }, { ...DATEN, persona: " " },
    { ...DATEN, persona: "x".repeat(AGENTEN_BUCH_GRENZEN.persona + 1) }, { ...DATEN, name: "A\u0007" }, { ...DATEN, persona: "a\u0000b" }]) {
    await assert.rejects(buch.legeAn(falsch), JSON.stringify(falsch).slice(0, 40));
  }
  for (let i = 1; i < AGENTEN_BUCH_GRENZEN.agenten; i++) await buch.legeAn({ ...DATEN, name: `A${i}` });
  await assert.rejects(buch.legeAn(DATEN), /20/);
});

test("11.3c1: Budget je Raum – Monat und Tag, nie darüber, neue Zeiträume beginnen neu", async () => {
  let jetzt = JETZT;
  const buch = new AgentenBuch(speicher(), () => jetzt);
  const a = await buch.legeAn(DATEN);
  assert.deepEqual(buch.reicht(a.pk, RAUM, 1), { ja: false, grund: "kein-raum" });
  for (const b of [{ einheit: "msat" as const, monat: 10, tag: 0 }, { einheit: "msat" as const, monat: 10, tag: 11 }, { einheit: "sats" as never, monat: 10, tag: 5 }]) {
    await assert.rejects(buch.setzeBudget(a.pk, RAUM, b));
  }
  await assert.rejects(buch.setzeBudget(a.pk, "irgendwas", { einheit: "msat", monat: 10, tag: 5 }));
  await buch.setzeBudget(a.pk, RAUM, { einheit: "msat", monat: 100_000, tag: 30_000 });
  assert.deepEqual(buch.reicht(a.pk, RAUM, 30_000), { ja: true });
  assert.deepEqual(buch.reicht(a.pk, RAUM, 30_001), { ja: false, grund: "tag" });
  await buch.buche(a.pk, RAUM, 25_000);
  assert.deepEqual(buch.reicht(a.pk, RAUM, 5_001), { ja: false, grund: "tag" });
  jetzt += 86_400; // nächster Tag, gleicher Monat
  await buch.buche(a.pk, RAUM, 30_000);
  jetzt += 86_400;
  await buch.buche(a.pk, RAUM, 30_000);
  jetzt += 86_400;
  assert.deepEqual(buch.reicht(a.pk, RAUM, 15_001), { ja: false, grund: "monat" }, "85 000 von 100 000 im Monat");
  assert.deepEqual(buch.reicht(a.pk, RAUM, 15_000), { ja: true });
  jetzt = Date.UTC(2026, 9, 1, 12) / 1000; // Oktober
  assert.deepEqual(buch.reicht(a.pk, RAUM, 30_000), { ja: true }, "neuer Monat");
  // Gleiche Einheit behält den Verbrauch, eine andere beginnt neu
  await buch.buche(a.pk, RAUM, 20_000);
  await buch.setzeBudget(a.pk, RAUM, { einheit: "msat", monat: 100_000, tag: 25_000 });
  assert.deepEqual(buch.reicht(a.pk, RAUM, 5_001), { ja: false, grund: "tag" });
  await buch.setzeBudget(a.pk, RAUM, { einheit: "lamports", monat: 1_000_000, tag: 100_000 });
  assert.deepEqual(buch.reicht(a.pk, RAUM, 100_000), { ja: true });
  assert.equal(buch.budget(a.pk, RAUM)?.einheit, "lamports");
  await assert.rejects(buch.buche(a.pk, RAUM, -1));
  assert.deepEqual(buch.reicht(a.pk, RAUM, -1), { ja: false, grund: "kein-raum" });
  await buch.entferneRaum(a.pk, RAUM);
  assert.deepEqual(buch.reicht(a.pk, RAUM, 1), { ja: false, grund: "kein-raum" });
});

test("11.3c1: „Budget erreicht“ je Zeitraum nur einmal", async () => {
  let jetzt = JETZT;
  const buch = new AgentenBuch(speicher(), () => jetzt);
  const a = await buch.legeAn(DATEN);
  await buch.setzeBudget(a.pk, RAUM, { einheit: "msat", monat: 10, tag: 5 });
  assert.equal(await buch.meldeEinmal(a.pk, RAUM, "tag"), true);
  assert.equal(await buch.meldeEinmal(a.pk, RAUM, "tag"), false);
  assert.equal(await buch.meldeEinmal(a.pk, RAUM, "monat"), true, "anderer Zeitraum");
  assert.equal(await buch.meldeEinmal(a.pk, RAUM, "monat"), false);
  jetzt += 86_400;
  assert.equal(await buch.meldeEinmal(a.pk, RAUM, "tag"), true, "neuer Tag");
});

test("11.3c1: streng gelesen – falscher Schlüssel, kaputtes Budget, Doppeltes, Unsinn", async () => {
  const s = speicher();
  const buch = new AgentenBuch(s, () => JETZT);
  const a = await buch.legeAn(DATEN);
  await buch.setzeBudget(a.pk, RAUM, { einheit: "msat", monat: 10, tag: 5 });
  const gut = JSON.parse(s.m.get(LS_AGENTEN)!)[0];
  const fremd = toHex(generateKeypair().sk);
  const faelle: [string, unknown][] = [
    ["Schlüssel passt nicht", { ...gut, sk: fremd }],
    ["Budget kaputt", { ...gut, raeume: [{ ...gut.raeume[0], tag: 11 }] }],
    ["Raum kein Ziel", { ...gut, raeume: [{ ...gut.raeume[0], raum: "werkstatt" }] }],
    ["Persona fehlt", { ...gut, persona: undefined }],
  ];
  for (const [was, o] of faelle) assert.deepEqual(leseAgentenBuch(JSON.stringify([o])), [], was);
  assert.equal(leseAgentenBuch(JSON.stringify([gut, gut])).length, 1, "doppelt");
  for (const roh of [null, "", "{", "{}", "[1]"]) assert.deepEqual(leseAgentenBuch(roh), [], String(roh));
  assert.equal(leseAgentenBuch(JSON.stringify([gut]))[0]?.raeume[0]?.raum, RAUM);
});

test("11.3c1: öffentliche Liste nur mit Agenten offener Räume", async () => {
  const buch = new AgentenBuch(speicher(), () => JETZT);
  const offen = await buch.legeAn({ ...DATEN, name: "Offen" });
  const privat = await buch.legeAn({ ...DATEN, name: "Privat" });
  await buch.legeAn({ ...DATEN, name: "Ohne Raum" });
  await buch.setzeBudget(offen.pk, RAUM, { einheit: "msat", monat: 10, tag: 5 });
  await buch.setzeBudget(privat.pk, GRUPPE, { einheit: "msat", monat: 10, tag: 5 });
  assert.deepEqual(buch.inOffenenRaeumen(), [offen.pk]);
  await buch.entferne(offen.pk);
  assert.deepEqual(buch.inOffenenRaeumen(), []);
  assert.equal(buch.agent(offen.pk), undefined, "Schlüssel weg");
});

test("11.3c1: Tresor, nie Sicherung; Anlegen und Einladen nach den Regeln", () => {
  assert.match(lies("shell/tresor.ts"), /"freedom\.agenten"\]/);
  assert.ok(!(LS_AGENTEN in waehleSicherung([LS_AGENTEN], () => "[]")), "nie in Sicherung oder Export");
  assert.ok(!(LS_AGENTEN in filtereWiederherstellung({ [LS_AGENTEN]: "[]" })), "auch nicht zurück");
  const sh = lies("shell/agenten.ts");
  assert.match(sh, /export const agentenBuch = new AgentenBuch\(geheim\);/);
  const i = (s: string) => { const n = sh.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.ok(i("if (!(await verlangeTresor(") < i("return agentenBuch.legeAn(d);"), "erst der Tresor");
  assert.match(sh, /if \(!state\.keypair \|\| alsGeraet\(\)\) throw/, "als Gerät nie");
  const einladen = sh.slice(i("export async function ladeAgentInOffenenRaum"));
  assert.ok(einladen.indexOf('can(besitzer, "rollen_vergeben", stand)') < einladen.indexOf("publish"), "erst das Recht");
  assert.match(einladen, /if \(stand\.ownerPubkey !== besitzer\) throw/, "Rolle nur vom Gründer");
  assert.match(einladen, /signer\.signEvent\(baueAgentKarte\(agentPk, \{\s*name: agent\.name, betrieb: "geraet", bezahlung: "einlader", besitzer,/, "Karte vom Agenten");
  assert.match(sh, /signiere\(baueAgentenListe\(besitzer, \[\.\.\.fremde, \.\.\.agentenBuch\.inOffenenRaeumen\(\)\]\)\)/, "Liste nur offene");
  assert.match(einladen, /channelId: kanal, mentions: \[\],/, "Hinweis ohne Erwähnung");
  assert.ok(!/persona/.test(einladen), "Persona bleibt auf dem Gerät (F4 A)");
});
