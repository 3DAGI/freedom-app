/**
 * Leak-Szenario „Repo im privaten Raum“ (Schritt 11.4b2): Ankündigung,
 * Bundle-Verweis samt Schlüssel, Patch und Status gehen so in die Gruppe, wie
 * `mlsSendeEvent()` sendet (`sendeEventInGruppe()`). Aufgezeichnet wird alles,
 * was ein Relay bekam: nur Kind 445 und die Einladung im Umschlag – keine
 * Kennung, kein Name, kein Betreff, kein Schlüssel. Ein Mitglied liest die
 * Events zurück, und die Repo-Ansicht baut daraus die Karte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  LocalSigner, fromHex, generateKeypair, gruppenRaum, raumRepoAnkuendigung, raumRepoBundle, raumRepoPatch, raumReposPrivat, raumRepoStatus,
  regelKeinKlartext, regelMlsGruppe, regelRaumRepoPrivat, toHex, lesePatch, type InneresEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { Mls, ladeMls } from "@freedomstack/mls";
import { veroeffentlicheKeyPackage } from "../../src/mls-keypackage.js";
import { empfangeGruppe, gruendeGruppe, nimmEinladungAn, oeffneEinladung, schreiteFort, sendeEventInGruppe, type MlsNetz } from "../../src/mls-nostr.js";
import { privateRaumKarten } from "../../src/repo-ansicht.js";

ladeMls(gunzipSync(readFileSync(new URL("../../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));

const KEY = "5a".repeat(32);
const KENNUNG = "geheimprojekt";
const BETREFF = "Geheime Änderung am Tor";
const PATCH = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] ${BETREFF}\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;

test("Repo im privaten Raum: Relays sehen nur Chiffretext – ein Mitglied liest Repo, Bundle und Patch", async () => {
  const gesehen: NostrEvent[] = [];
  const netz: MlsNetz = { async sendeAn(ev, urls) { gesehen.push(ev); return urls.length; }, async posteingang() { return ["wss://eingang.test"]; } };
  const person = () => {
    const kp = generateKeypair();
    const signer = new LocalSigner(kp.sk);
    return { pk: kp.pk, signer, mls: new Mls(signer, (id) => toHex(schnorr.sign(fromHex(id), kp.sk))), sichern: async () => {} };
  };
  const [a, b] = [person(), person()];
  const leer = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const kpB = await veroeffentlicheKeyPackage({ mls: b.mls, signer: b.signer, speicher: leer, sichern: b.sichern, senden: async () => 1 });
  const g = await gruendeGruppe({ mls: a.mls, netz, sichern: a.sichern, name: "", keyPackages: [kpB], relays: ["wss://gruppe.test"] });
  await nimmEinladungAn({ mls: b.mls, sichern: b.sichern, speicher: leer, einladung: (await oeffneEinladung(gesehen.find((e) => e.kind === 1059)!, b.signer))! });

  const repo = { eigentuemer: a.pk, id: KENNUNG };
  const schicke = (s: { art: number; tags: string[][]; text: string }) => sendeEventInGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe: g.gruppe, ...s });
  assert.ok(await schicke(raumRepoAnkuendigung(g.gruppe, { id: KENNUNG, name: "Geheimprojekt", klon: [] })));
  assert.ok(await schicke(raumRepoBundle(g.gruppe, { name: KENNUNG, blobId: "b".repeat(64), headSha: "c".repeat(40), branch: "main", message: "Stand", version: 1, schluessel: { alg: "aes-gcm", key: KEY, nonce: "6b".repeat(12), ox: "7c".repeat(32) } })));
  const patchId = await schicke(raumRepoPatch(g.gruppe, { repo, text: PATCH }));
  assert.ok(patchId);

  // Relays: nur Umschlag (Einladung) und Gruppen-Nachrichten, nichts vom Repo im Klartext
  assert.deepEqual([...new Set(gesehen.map((e) => e.kind))].sort(), [1059, 445]);
  assert.deepEqual(regelRaumRepoPrivat(gesehen, { repoIds: [KENNUNG], schluessel: [KEY] }), []);
  assert.deepEqual(regelKeinKlartext(gesehen, [KENNUNG, "Geheimprojekt", BETREFF, KEY]), []);
  assert.deepEqual(regelMlsGruppe(gesehen, { gruppenIds: [g.gruppe], identitaeten: [a.pk, b.pk] }), []);

  // Das Mitglied liest zurück (Gegenprobe: die Aufzeichnung ist echt)
  const innen: InneresEvent[] = [];
  for (const ev of gesehen.filter((e) => e.kind === 445)) {
    const r = await empfangeGruppe({ mls: b.mls, sichern: b.sichern, ev });
    innen.push(...r.nachrichten.map((n) => ({ id: n.inneres, von: n.von, art: n.art, tags: n.tags, text: n.text, zeit: n.zeit })));
    const w = r.wartezeit?.[g.gruppe];
    if (w !== undefined) {
      await new Promise((ok) => setTimeout(ok, w + 20));
      innen.push(...(await schreiteFort({ mls: b.mls, netz, sichern: b.sichern, gruppe: g.gruppe })).nachrichten.map((n) => ({ id: n.inneres, von: n.von, art: n.art, tags: n.tags, text: n.text, zeit: n.zeit })));
    }
  }
  const { zustand } = gruppenRaum(g.gruppe, innen, { admins: b.mls.admins(g.gruppe), mitglieder: b.mls.mitglieder(g.gruppe) });
  const privat = raumReposPrivat(g.gruppe, innen, zustand);
  const [karte] = privateRaumKarten({ gruppe: g.gruppe, ...privat }, b.pk);
  assert.equal(karte?.id, KENNUNG);
  assert.equal(karte?.privatRaum, g.gruppe, "Aktionen gehen nur in die Gruppe");
  assert.ok(karte?.bundle?.tags.some((t) => t[0] === "aes-gcm" && t[1] === KEY), "den Schlüssel bekommt das Mitglied – nur in der Gruppe");
  assert.equal(karte?.zeilen[0]?.patch.betreff, BETREFF);
  assert.equal(lesePatch(privat.patches[0]!).id, patchId, "Verweise über die Id des inneren Events");
  assert.ok(raumRepoStatus(g.gruppe, { patch: lesePatch(privat.patches[0]!), status: "angenommen", eigentuemer: a.pk }).tags.some((t) => t[0] === "e" && t[1] === patchId));
});
