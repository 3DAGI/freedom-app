/**
 * Schritt 2.2b-e2: Geräte in 1:1-MLS-Gruppen – wer hineingehört (Person und
 * gültige Geräte beider Seiten), was der Abgleich tut, und wann eine Gruppe
 * eine 1:1-Unterhaltung ist. Wem ein Gerät gehört, sagen nur die Vollmachten
 * der Person – ein Fremder kann sich nicht als Gerät eines Kontakts ausgeben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { abgleich, partnerDerGruppe, sollMitglieder, type GeraeteQuelle } from "../src/mls-geraete.js";

const pk = (c: string) => c.repeat(64);
const [ICH, MEIN_HANDY, MEIN_ALTES, KONTAKT, SEIN_HANDY, SEIN_ALTES, FREMD] = ["a", "b", "c", "d", "e", "f", "9"].map(pk) as string[];

/** Vollmachten: gültig (kopienFuer) und je ausgestellt (alle, auch entzogene). */
function quelle(gueltig: Record<string, string[]>, entzogen: Record<string, string[]> = {}): GeraeteQuelle & { fragen: string[] } {
  const fragen: string[] = [];
  return {
    fragen,
    async kopienFuer(p) { fragen.push(p); return gueltig[p!] ?? []; },
    async alle(p) { return [...(gueltig[p!] ?? []), ...(entzogen[p!] ?? [])]; },
  };
}

test("Soll: beide Personen und ihre gültigen Geräte – je Mitglied die Person (für den Posteingang)", async () => {
  const q = quelle({ [ICH!]: [MEIN_HANDY!], [KONTAKT!]: [SEIN_HANDY!] }, { [KONTAKT!]: [SEIN_ALTES!] });
  const soll = await sollMitglieder(ICH!, KONTAKT!, q);
  assert.deepEqual([...soll], [[ICH, ICH], [KONTAKT, KONTAKT], [MEIN_HANDY, ICH], [SEIN_HANDY, KONTAKT]]);
  assert.ok(!soll.has(SEIN_ALTES!), "entzogene nicht");
  // Wer sich selbst als Gerät des anderen führt, bleibt, was er ist
  const schief = await sollMitglieder(ICH!, KONTAKT!, quelle({ [KONTAKT!]: [ICH!] }));
  assert.equal(schief.get(ICH!), ICH);
  // Offline: Fehler geht durch – der Aufrufer sendet dann per NIP-17
  await assert.rejects(sollMitglieder(ICH!, KONTAKT!, { kopienFuer: async () => { throw new Error("offline"); }, alle: async () => [] }));
});

test("Abgleich: fehlende einladen, entzogene und fremde entfernen", () => {
  const soll = new Map([[ICH!, ICH!], [KONTAKT!, KONTAKT!], [SEIN_HANDY!, KONTAKT!]]);
  assert.deepEqual(abgleich([ICH!, KONTAKT!, SEIN_HANDY!], soll), { fehlen: [], zuViel: [] });
  assert.deepEqual(abgleich([ICH!, KONTAKT!, SEIN_ALTES!, FREMD!], soll), { fehlen: [SEIN_HANDY], zuViel: [SEIN_ALTES, FREMD] });
});

test("Partner einer Gruppe: die eine Person, der mit ihren Geräten alle übrigen gehören", async () => {
  const q = quelle({ [ICH!]: [MEIN_HANDY!], [KONTAKT!]: [SEIN_HANDY!] }, { [ICH!]: [MEIN_ALTES!], [KONTAKT!]: [SEIN_ALTES!] });
  assert.equal(await partnerDerGruppe([ICH!, KONTAKT!], ICH!, ICH!, q), KONTAKT);
  assert.equal(await partnerDerGruppe([SEIN_HANDY!, ICH!, MEIN_HANDY!, KONTAKT!], ICH!, ICH!, q), KONTAKT, "Reihenfolge egal");
  assert.equal(await partnerDerGruppe([ICH!, KONTAKT!, SEIN_ALTES!, MEIN_ALTES!], ICH!, ICH!, q), KONTAKT, "entzogene gehören noch zu ihrer Person – der Abgleich entfernt sie");
  // Als Gerät: `selbst` ist das Handy, `ich` die Person
  assert.equal(await partnerDerGruppe([ICH!, MEIN_HANDY!, KONTAKT!], ICH!, MEIN_HANDY!, q), KONTAKT);
});

test("Keine 1:1-Gruppe: zu dritt, mit Fremdem, ohne mich, nur meine eigenen Schlüssel", async () => {
  const q = quelle({ [ICH!]: [MEIN_HANDY!], [KONTAKT!]: [SEIN_HANDY!] });
  assert.equal(await partnerDerGruppe([ICH!, KONTAKT!, FREMD!], ICH!, ICH!, q), null);
  assert.equal(await partnerDerGruppe([KONTAKT!, SEIN_HANDY!], ICH!, ICH!, q), null, "ich bin nicht dabei");
  assert.equal(await partnerDerGruppe([ICH!, MEIN_HANDY!], ICH!, ICH!, q), null);
  // Ein Fremder führt den Kontakt als „sein Gerät“ – das macht die Gruppe nicht zur Unterhaltung mit dem Kontakt
  const angriff = quelle({ [ICH!]: [], [FREMD!]: [KONTAKT!] });
  assert.equal(await partnerDerGruppe([ICH!, KONTAKT!, FREMD!], ICH!, ICH!, angriff), FREMD, "höchstens mit dem, der das behauptet");
  const sauber = quelle({ [KONTAKT!]: [SEIN_HANDY!] });
  assert.equal(await partnerDerGruppe([ICH!, KONTAKT!, FREMD!], ICH!, ICH!, sauber), null, "als Gerät des Kontakts zählt nur, was der Kontakt ausstellt");
});
