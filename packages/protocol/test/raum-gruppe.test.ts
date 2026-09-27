/**
 * Schritt 2.3a: private Räume als MLS-Gruppen – Rechte aus der Gruppe
 * (Admins = Moderatoren, von MLS belegt), Definition und Rollenliste nur von
 * Admins, Zuweisungen mit Rang, Löschen, Schreibrecht je Nachricht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ART_ADMIN_LOESCHUNG, ART_EIGENE_LOESCHUNG, ART_RAUM_CHAT, type InneresEvent, type InneresSenden,
  gruppenRaum, raumDefinition, raumLoeschung, raumNachricht, raumRollen, raumZuweisung,
} from "../src/raum-gruppe.js";
import { buildThreads, can, canWriteTo, type Channel } from "../src/spaces.js";
import { KIND_RAUM_MELDUNG, baueRaumMeldung, oeffneRaumMeldung } from "../src/raum-gruppe.js";
import { buildPrivateDm } from "../src/private-dm.js";
import { generateKeypair } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import { regelAutorNicht, regelKeinKlartext, regelPTagsNur } from "../src/leak-rules.js";

const RAUM = "a".repeat(64);
const [ADMIN, MOD, ANNA, BERT, EX] = ["1", "2", "3", "4", "5"].map((c) => c.repeat(64));
const KANAELE: Channel[] = [
  { id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 },
  { id: "ankuendigungen", name: "ankündigungen", privacy: "verschluesselt", writeRoles: ["mod"], position: 1 },
];
let n = 0;
/** `admin`: nur wo MLS es belegt (Löschen 4891) – sonst fehlt es, wie bei MDK. */
const ev = (von: string, s: InneresSenden, admin?: boolean, zeit = 1000 + n): InneresEvent =>
  ({ id: (++n).toString(16).padStart(64, "0"), von, art: s.art, tags: s.tags, text: s.text, zeit, ...(admin === undefined ? {} : { admin }) });

function grundausstattung(): InneresEvent[] {
  return [
    ev(ADMIN, raumDefinition(RAUM, { name: "Werkstatt", kanaele: KANAELE })),
    ev(ADMIN, raumRollen(RAUM, [
      { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "threads", "rollen_vergeben"] },
      { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben", "threads"] },
    ])),
  ];
}
const mitglieder = [ADMIN, MOD, ANNA, BERT];

test("2.3a: Definition und Rollenliste gelten nur von Admins – die eines Mitglieds wird verworfen", () => {
  const evs = grundausstattung();
  const fremd = ev(ANNA, raumDefinition(RAUM, { name: "Übernommen", kanaele: [] }), undefined, 5000);
  const r = gruppenRaum(RAUM, [...evs, fremd], { admins: [ADMIN], mitglieder });
  assert.equal(r.zustand.space?.name, "Werkstatt");
  assert.equal(r.zustand.space?.channels.length, 2);
  assert.ok(r.verworfen.some((v) => v.id === fremd.id && /nur Admins/.test(v.grund)));
  // Ein neuerer Admin-Stand gilt
  const neu = ev(ADMIN, raumDefinition(RAUM, { name: "Werkstatt 2", kanaele: KANAELE }), undefined, 6000);
  assert.equal(gruppenRaum(RAUM, [...evs, neu], { admins: [ADMIN], mitglieder }).zustand.space?.name, "Werkstatt 2");
  // Anderer Raum zählt nicht
  const anderer = ev(ADMIN, raumDefinition("b".repeat(64), { name: "Fremd", kanaele: KANAELE }), undefined, 7000);
  assert.equal(gruppenRaum(RAUM, [...evs, anderer], { admins: [ADMIN], mitglieder }).zustand.space?.name, "Werkstatt");
  // Wird der Autor abgesetzt, gilt seine Definition nicht mehr – bis ein heutiger Admin eine sendet
  assert.equal(gruppenRaum(RAUM, evs, { admins: [MOD], mitglieder }).zustand.space, undefined);
  const vomMod = ev(MOD, raumDefinition(RAUM, { name: "Neu", kanaele: KANAELE }));
  assert.equal(gruppenRaum(RAUM, [...evs, vomMod], { admins: [MOD], mitglieder }).zustand.space?.name, "Neu");
});

test("2.3a: Moderatoren sind die Admins der Gruppe – alle Rechte; Mitglieder ohne Zuweisung schreiben, moderieren nicht", () => {
  const r = gruppenRaum(RAUM, grundausstattung(), { admins: [ADMIN, MOD], mitglieder });
  const [allgemein, ankuendigungen] = r.zustand.space!.channels;
  assert.ok(can(MOD, "moderieren", r.zustand) && can(MOD, "rollen_vergeben", r.zustand));
  assert.ok(canWriteTo(MOD, ankuendigungen!, r.zustand), "Admin schreibt auch in Kanäle mit Schreibrollen");
  assert.ok(canWriteTo(ANNA, allgemein!, r.zustand));
  assert.ok(!canWriteTo(ANNA, ankuendigungen!, r.zustand));
  assert.ok(!can(ANNA, "moderieren", r.zustand));
  assert.ok(!can(ANNA, "rollen_vergeben", r.zustand));
});

test("2.3a: Zuweisungen – vom Admin gültig, ohne Recht oder über dem eigenen Rang verworfen, leere stummschaltet", () => {
  const evs = grundausstattung();
  const hochstufen = ev(ADMIN, raumZuweisung(RAUM, ANNA, ["mod"]));
  const selbst = ev(BERT, raumZuweisung(RAUM, BERT, ["mod"]));
  const zuHoch = ev(ANNA, raumZuweisung(RAUM, BERT, ["mod"]));
  const stumm = ev(ADMIN, raumZuweisung(RAUM, EX, []));
  const r = gruppenRaum(RAUM, [...evs, hochstufen, selbst, zuHoch, stumm], { admins: [ADMIN], mitglieder: [...mitglieder, EX] });
  const ankuendigungen = r.zustand.space!.channels[1]!;
  assert.ok(canWriteTo(ANNA, ankuendigungen, r.zustand), "Anna hat jetzt die Rolle mod");
  assert.ok(!canWriteTo(BERT, ankuendigungen, r.zustand));
  assert.ok(r.verworfen.some((v) => v.id === selbst.id && /darf keine Rollen/.test(v.grund)));
  assert.ok(r.verworfen.some((v) => v.id === zuHoch.id && /Rang/.test(v.grund)));
  assert.ok(!can(EX, "schreiben", r.zustand), "leere Zuweisung schaltet stumm");
  // Die interne Admin-Rolle lässt sich nicht vergeben
  assert.deepEqual(raumZuweisung(RAUM, BERT, ["__admin", "mod"]).tags.filter((t) => t[0] === "role"), [["role", "mod"]]);
  assert.throws(() => raumZuweisung(RAUM, "kein-pk", ["mod"]), /Mitglied ungültig/);
});

test("2.3a: Schreibrecht je Nachricht nach heutiger Rollenlage – ohne Recht verworfen, nach Absetzung auch Moderatorkanäle", () => {
  const evs = grundausstattung();
  const anna = ev(ANNA, raumNachricht({ kanal: "ankuendigungen", text: "darf ich nicht" }));
  const mod = ev(MOD, raumNachricht({ kanal: "ankuendigungen", text: "vom Moderator" }));
  const normal = ev(BERT, raumNachricht({ kanal: "allgemein", text: "hallo" }));
  const ohneKanal = ev(BERT, raumNachricht({ kanal: "gibt-es-nicht", text: "?" }));
  const alle = [...evs, anna, mod, normal, ohneKanal];
  const r = gruppenRaum(RAUM, alle, { admins: [ADMIN, MOD], mitglieder });
  const ids = r.nachrichten.map((m) => m.id);
  assert.ok(!ids.includes(anna.id) && r.verworfen.some((v) => v.id === anna.id && /Schreibrecht/.test(v.grund)));
  assert.ok(ids.includes(mod.id) && ids.includes(normal.id) && !ids.includes(ohneKanal.id));
  const ankuendigungen = r.zustand.space!.channels[1]!;
  assert.deepEqual(buildThreads(r.nachrichten, ankuendigungen, r.zustand).topLevel.map((m) => m.content), ["vom Moderator"]);
  // Moderator abgesetzt: keine Rechte mehr, seine Ankündigung verschwindet (für Chat belegt MLS keinen Admin-Stand)
  const ab = gruppenRaum(RAUM, alle, { admins: [ADMIN], mitglieder });
  assert.ok(!can(MOD, "moderieren", ab.zustand));
  assert.ok(!ab.nachrichten.some((m) => m.id === mod.id));
});

test("2.3a: Löschen – Admin jede Nachricht (4891), jeder die eigene (5); sonst verworfen", () => {
  const evs = grundausstattung();
  const a = ev(ANNA, raumNachricht({ kanal: "allgemein", text: "a" }));
  const b = ev(BERT, raumNachricht({ kanal: "allgemein", text: "b" }));
  const c = ev(BERT, raumNachricht({ kanal: "allgemein", text: "c" }));
  const d = ev(ANNA, raumNachricht({ kanal: "allgemein", text: "d" }));
  const adminLoescht = ev(ADMIN, raumLoeschung(a.id, true), true);
  // Von MLS belegt: beim Senden Admin – gilt, auch wenn er heute keiner mehr ist
  const exAdmin = ev(EX, raumLoeschung(c.id, true), true);
  const bertEigene = ev(BERT, raumLoeschung(b.id, false));
  const bertFremd = ev(BERT, raumLoeschung(d.id, false));
  const falscherAdmin = ev(BERT, raumLoeschung(d.id, true), false);
  assert.equal(adminLoescht.art, ART_ADMIN_LOESCHUNG);
  assert.equal(bertEigene.art, ART_EIGENE_LOESCHUNG);
  const r = gruppenRaum(RAUM, [...evs, a, b, c, d, adminLoescht, exAdmin, bertEigene, bertFremd, falscherAdmin], { admins: [ADMIN], mitglieder });
  assert.deepEqual(r.nachrichten.map((m) => m.content), ["d"]);
  assert.equal(r.verworfen.filter((v) => /nicht löschen/.test(v.grund)).length, 2);
});

test("2.3a: Kanalnachricht – h-Tag, Thread nach NIP-10, Erwähnungen; Rollenliste ohne interne Admin-Rolle", () => {
  const s = raumNachricht({ kanal: "allgemein", text: "x", threadRoot: "r", replyTo: "q", erwaehnt: [ANNA] });
  assert.equal(s.art, ART_RAUM_CHAT);
  assert.deepEqual(s.tags, [["h", "allgemein"], ["e", "r", "", "root"], ["e", "q", "", "reply"], ["p", ANNA, "", "mention"]]);
  const rollen = raumRollen(RAUM, [{ id: "__admin", name: "x", rank: 1, permissions: [] }, { id: "mod", name: "Mod", rank: 5, permissions: ["lesen"] }]);
  assert.deepEqual(rollen.tags.filter((t) => t[0] === "role").map((t) => t[1]), ["mod"]);
});

test("8.5: Meldung – je Moderator ein Umschlag, nie an sich selbst; Relays sehen weder Melder noch Inhalt", async () => {
  const [melder, mod1, mod2] = [generateKeypair(), generateKeypair(), generateKeypair()];
  const gruppe = "c".repeat(32);
  const ziel = "d".repeat(64);
  const wraps = await baueRaumMeldung({
    von: new LocalSigner(melder.sk), moderatoren: [mod1.pk, mod2.pk, mod1.pk, melder.pk], gruppe, ziel, autor: ANNA, grund: "spam", notiz: "Werbung im Kanal",
  });
  assert.equal(wraps.length, 2, "je Moderator einmal, nicht an den Melder");
  assert.deepEqual(wraps.map((w) => w.kind), [1059, 1059]);
  assert.deepEqual(regelPTagsNur(wraps, [mod1.pk, mod2.pk]), []);
  assert.deepEqual(regelAutorNicht(wraps, melder.pk), []);
  assert.deepEqual(regelKeinKlartext(wraps, ["Werbung im Kanal", ziel, gruppe, ANNA]), []);
  const anMod2 = wraps.find((w) => w.tags.some((t) => t[0] === "p" && t[1] === mod2.pk))!;
  const m = (await oeffneRaumMeldung(anMod2, new LocalSigner(mod2.sk)))!;
  assert.deepEqual([m.von, m.gruppe, m.ziel, m.autor, m.grund, m.notiz], [melder.pk, gruppe, ziel, ANNA, "spam", "Werbung im Kanal"]);
});

test("8.5: Meldung – nur der Moderator öffnet sie; eine DM ist keine Meldung; ungültige Angaben scheitern", async () => {
  const [melder, mod, fremd] = [generateKeypair(), generateKeypair(), generateKeypair()];
  const [w] = await baueRaumMeldung({ von: new LocalSigner(melder.sk), moderatoren: [mod.pk], gruppe: "c".repeat(32), ziel: "d".repeat(64), autor: ANNA, grund: "illegal" });
  assert.equal(await oeffneRaumMeldung(w!, new LocalSigner(fremd.sk)), null);
  const dm = await buildPrivateDm({ signer: new LocalSigner(melder.sk), recipientPk: mod.pk, content: "hallo" });
  assert.equal(await oeffneRaumMeldung(dm.toRecipient, new LocalSigner(mod.sk)), null);
  const s = new LocalSigner(melder.sk);
  await assert.rejects(baueRaumMeldung({ von: s, moderatoren: [mod.pk], gruppe: "c".repeat(32), ziel: "d".repeat(64), autor: ANNA, grund: "unbekannt" as never }), /Grund ungültig/);
  await assert.rejects(baueRaumMeldung({ von: s, moderatoren: [mod.pk], gruppe: "zz", ziel: "d".repeat(64), autor: ANNA, grund: "spam" }), /unvollständig/);
  await assert.rejects(baueRaumMeldung({ von: s, moderatoren: [melder.pk], gruppe: "c".repeat(32), ziel: "d".repeat(64), autor: ANNA, grund: "spam" }), /kein Moderator/);
  assert.equal(KIND_RAUM_MELDUNG, 1984, "NIP-56");
});
