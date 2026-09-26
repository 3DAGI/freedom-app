/**
 * Leak-Szenario „MLS-Gruppe“ (Schritt 2.2b-c2): KeyPackages, Gründen,
 * Nachrichten, Einladen, Entfernen – so, wie `mls-nostr.ts` sendet. Geprüft
 * wird alles, was irgendein Relay bekam: nur Chiffretext, gehashte
 * Gruppen-Id, jede Nachricht von einem eigenen Wegwerf-Schlüssel, Einladungen
 * im Umschlag nur an die Eingeladenen. KeyPackages (Kind 30443) tragen die
 * Identität mit Absicht – sonst fände sie niemand (Marmot).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  LocalSigner, fromHex, generateKeypair, regelAutorNicht, regelKeinKind4, regelKeinKlartext, regelMlsGruppe, regelPTagsNur,
  toHex, type NostrEvent,
} from "@freedomstack/protocol";
import { KIND_KEY_PACKAGE, Mls, ladeMls } from "@freedomstack/mls";
import { veroeffentlicheKeyPackage } from "../../src/mls-keypackage.js";
import { aendereGruppe, empfangeGruppe, gruendeGruppe, nimmEinladungAn, oeffneEinladung, schreiteFort, sendeInGruppe, type MlsNetz } from "../../src/mls-nostr.js";

ladeMls(gunzipSync(readFileSync(new URL("../../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));

const TEXTE = ["Treffpunkt Hafen um sieben", "Bitte niemandem sagen", "Nur noch zu dritt"];
const NAME = "Hafenrunde Nord";
const GRUPPE = ["wss://gruppe.test"];

async function ablauf() {
  const gesehen: { ev: NostrEvent; urls: readonly string[] }[] = [];
  const eingaenge = new Map<string, string[]>();
  const netz: MlsNetz = {
    async sendeAn(ev, urls) { gesehen.push({ ev, urls }); return urls.length; },
    async posteingang(pk) { return eingaenge.get(pk) ?? []; },
  };
  const person = (name: string) => {
    const kp = generateKeypair();
    const signer = new LocalSigner(kp.sk);
    eingaenge.set(kp.pk, [`wss://eingang-${name}.test`]);
    return { pk: kp.pk, signer, mls: new Mls(signer, (id) => toHex(schnorr.sign(fromHex(id), kp.sk))), sichern: async () => {} };
  };
  const [a, b, c, d] = ["a", "b", "c", "d"].map(person) as [ReturnType<typeof person>, ReturnType<typeof person>, ReturnType<typeof person>, ReturnType<typeof person>];
  const leer = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const kp = (p: typeof a) => veroeffentlicheKeyPackage({ mls: p.mls, signer: p.signer, speicher: leer, sichern: p.sichern, senden: (ev) => netz.sendeAn(ev, [`wss://schreib-${p.pk.slice(0, 4)}.test`]) });
  const g = await gruendeGruppe({ mls: a.mls, netz, sichern: a.sichern, name: NAME, keyPackages: [await kp(b), await kp(c)], relays: GRUPPE });
  const annehmen = async (p: typeof a) => {
    const wrap = gesehen.filter((x) => x.ev.kind === 1059 && x.ev.tags.some((t) => t[1] === p.pk)).at(-1)!.ev;
    await nimmEinladungAn({ mls: p.mls, sichern: p.sichern, speicher: leer, einladung: (await oeffneEinladung(wrap, p.signer))! });
  };
  await annehmen(b);
  await annehmen(c);
  await sendeInGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe: g.gruppe, text: TEXTE[0]! });
  await sendeInGruppe({ mls: b.mls, netz, sichern: b.sichern, gruppe: g.gruppe, text: TEXTE[1]! });
  await aendereGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe: g.gruppe, einladen: [await kp(d)] });
  await annehmen(d);
  await aendereGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe: g.gruppe, entfernen: [c.pk] });
  await sendeInGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe: g.gruppe, text: TEXTE[2]! });
  // Gegenprobe: Die aufgezeichneten Events sind echt – Dora (seit der Einladung
  // dabei) liest den Commit zum Entfernen und die letzte Nachricht
  const gelesen: string[] = [];
  for (const { ev } of gesehen.filter((x) => x.ev.kind === 445).slice(-2)) {
    const r = await empfangeGruppe({ mls: d.mls, sichern: d.sichern, ev });
    gelesen.push(...r.nachrichten.map((n) => n.text));
    const w = r.wartezeit?.[g.gruppe];
    if (w !== undefined) {
      await new Promise((ok) => setTimeout(ok, w + 20));
      gelesen.push(...(await schreiteFort({ mls: d.mls, netz, sichern: d.sichern, gruppe: g.gruppe })).nachrichten.map((n) => n.text));
    }
  }
  return { gesehen, alle: gesehen.map((x) => x.ev), a, b, c, d, gruppe: g.gruppe, gelesen, pks: [a.pk, b.pk, c.pk, d.pk] };
}

test("MLS: kein Klartext, kein Gruppenname, kein Kind 4 – irgendwo", async () => {
  const { alle } = await ablauf();
  assert.ok(alle.length >= 10);
  assert.deepEqual(regelKeinKind4(alle), []);
  assert.deepEqual(regelKeinKlartext(alle, [...TEXTE, NAME]), []);
});

test("MLS: Gruppennachrichten mit gehashter Gruppen-Id, jede von eigenem Wegwerf-Schlüssel, nur an die Gruppen-Relays", async () => {
  const { gesehen, alle, gruppe, pks } = await ablauf();
  const nachrichten = gesehen.filter((x) => x.ev.kind === 445);
  assert.equal(nachrichten.length, 5, "3 Nachrichten + 2 Commits");
  assert.deepEqual(regelMlsGruppe(alle, { gruppenIds: [gruppe], identitaeten: pks }), []);
  for (const x of nachrichten) assert.deepEqual(x.urls, GRUPPE);
});

test("MLS: Einladungen nur im Umschlag, nicht von der Identität, p nur an Eingeladene, nur an deren Posteingang", async () => {
  const { gesehen, b, c, d, pks } = await ablauf();
  const umschlaege = gesehen.filter((x) => x.ev.kind === 1059);
  assert.equal(umschlaege.length, 3);
  for (const pk of pks) assert.deepEqual(regelAutorNicht(umschlaege.map((x) => x.ev), pk), []);
  assert.deepEqual(regelPTagsNur(umschlaege.map((x) => x.ev), [b.pk, c.pk, d.pk]), []);
  for (const x of umschlaege) {
    const an = x.ev.tags.find((t) => t[0] === "p")![1]!;
    assert.deepEqual(x.urls, [`wss://eingang-${["b", "c", "d"][[b.pk, c.pk, d.pk].indexOf(an)]}.test`]);
  }
});

test("MLS: offen sind nur die KeyPackages – von der Identität, mit Absicht; die Aufzeichnung ist echt", async () => {
  const { gesehen, gelesen } = await ablauf();
  assert.deepEqual([...new Set(gesehen.map((x) => x.ev.kind))].sort((x, y) => x - y), [445, 1059, KIND_KEY_PACKAGE]);
  assert.deepEqual(gelesen, [TEXTE[2]], "ein Mitglied liest, was die Relays nur als Chiffretext sahen");
});
