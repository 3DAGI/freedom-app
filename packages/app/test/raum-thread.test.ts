/**
 * Schritt C.2c: Antworten und Threads (B8). Eine Antwort kommt in offenen
 * und privaten Räumen mit Verweis an – auf die oberste Nachricht und, wo
 * gewählt, auf die Antwort im Thread; `buildThreads()` ordnet sie zu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  type Channel, type InneresEvent, type InneresSenden, buildChannelMessage, buildThreads, generateKeypair,
  gruppenRaum, parseChannelMessage, raumDefinition, raumNachricht, raumRollen, signEvent,
} from "@freedomstack/protocol";
import { antwortBezug } from "../src/raum-verlauf.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const raeume = quelle("../src/shell/tabs/raeume.ts");
const html = quelle("../src/shell/index.html");

const [A, B] = ["a", "b"].map((c) => c.repeat(64)) as [string, string];
const T = 1_790_000_000;
const oben = { id: "1".repeat(64), authorPubkey: A, createdAt: T };
const antwort = { id: "2".repeat(64), authorPubkey: B, createdAt: T + 10, threadRoot: oben.id };

test("C.2c: Bezug einer Antwort – Thread ist die oberste Nachricht, auf eine Antwort zusätzlich replyTo; nie sich selbst erwähnen", () => {
  assert.deepEqual(antwortBezug(oben, B), { threadRoot: oben.id, erwaehnt: [A] });
  assert.deepEqual(antwortBezug(antwort, A), { threadRoot: oben.id, replyTo: antwort.id, erwaehnt: [B] });
  assert.deepEqual(antwortBezug(oben, A).erwaehnt, []);
  assert.deepEqual(antwortBezug(antwort, B), { threadRoot: oben.id, replyTo: antwort.id, erwaehnt: [] });
});

test("C.2c: offener Raum – die Antwort kommt als Kind 42 mit root, reply und Erwähnung an und steht im Thread", () => {
  const ich = generateKeypair();
  const kanal: Channel = { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 };
  const nachricht = (content: string, zeit: number, bezug?: ReturnType<typeof antwortBezug>) => signEvent(buildChannelMessage({
    authorPubkey: ich.pk, spaceId: "probe", channelId: "allgemein", content, mentions: bezug?.erwaehnt ?? [],
    threadRoot: bezug?.threadRoot, replyTo: bezug?.replyTo,
  }, zeit), ich.sk);
  const wurzel = nachricht("Frage", T);
  const erste = nachricht("erste Antwort", T + 10, antwortBezug({ id: wurzel.id, authorPubkey: ich.pk }, ich.pk));
  // Antwort auf die erste Antwort – wie sendeRaumNachricht(true) in raeume.ts; als käme sie von B, damit er erwähnt wird
  const bezug = antwortBezug({ id: erste.id, authorPubkey: B, threadRoot: wurzel.id }, ich.pk);
  const ev = nachricht("ja", T + 20, bezug);
  const m = parseChannelMessage(ev);
  assert.equal(m.threadRoot, wurzel.id);
  assert.equal(m.replyTo, erste.id);
  assert.deepEqual(m.mentions, [B]);
  const st = { ownerPubkey: ich.pk, roles: new Map(), grants: new Map(), ignored: [] };
  const { topLevel, threads } = buildThreads([wurzel, erste, ev], kanal, st as never);
  assert.deepEqual(topLevel.map((x) => x.id), [wurzel.id], "Antworten stehen nicht im Kanal selbst");
  assert.deepEqual(threads.get(wurzel.id)?.replies.map((r) => r.id), [erste.id, ev.id]);
});

test("C.2c: privater Raum – das innere Event trägt denselben Verweis, gruppenRaum() gibt ihn an den Thread weiter", () => {
  const RAUM = "c".repeat(64);
  const [ADMIN, ANNA] = ["1", "3"].map((c) => c.repeat(64)) as [string, string];
  const kanaele: Channel[] = [{ id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 }];
  let n = 0;
  const ev = (von: string, s: InneresSenden): InneresEvent =>
    ({ id: (++n).toString(16).padStart(64, "0"), von, art: s.art, tags: s.tags, text: s.text, zeit: T + n });
  const wurzel = ev(ADMIN, raumNachricht({ kanal: "allgemein", text: "Frage" }));
  const ereignisse = [
    ev(ADMIN, raumDefinition(RAUM, { name: "Werkstatt", kanaele })),
    ev(ADMIN, raumRollen(RAUM, [{ id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben", "threads"] }])),
    wurzel,
  ];
  // wie sendePrivat(gruppe, kanal, text, bezug) in raum-mls.ts
  const bezug = antwortBezug({ id: wurzel.id, authorPubkey: ADMIN }, ANNA);
  const antwortEv = ev(ANNA, raumNachricht({ kanal: "allgemein", text: "Antwort", ...bezug }));
  const r = gruppenRaum(RAUM, [...ereignisse, antwortEv], { admins: [ADMIN], mitglieder: [ADMIN, ANNA] });
  const m = parseChannelMessage(r.nachrichten.find((e) => e.id === antwortEv.id)!);
  assert.equal(m.threadRoot, wurzel.id);
  assert.equal(m.replyTo, undefined, "auf die oberste Nachricht: nur root");
  assert.deepEqual(m.mentions, [ADMIN]);
  const { threads } = buildThreads(r.nachrichten, r.zustand.space!.channels[0]!, r.zustand);
  assert.deepEqual(threads.get(wurzel.id)?.replies.map((x) => x.content), ["Antwort"]);
});

test("C.2c: verdrahtet – „n Antworten“ und „Antworten“ öffnen den Thread, Senden mit Bezug, Thread-Spalte im HTML", () => {
  // B8: der Knopf „n Antworten“ hat einen Handler
  assert.match(raeume, /b\.dataset\.root = m\.id;\s*b\.addEventListener\("click", \(\) => oeffneThread\(m\.id\)\);/);
  assert.match(raeume, /knopf\(t\("raum\.antworten"\), "antworten", \(\) => oeffneThread\(m\.threadRoot \?\? m\.id, m\.id\)\)/);
  const senden = raeume.slice(raeume.indexOf("async function sendeRaumNachricht"), raeume.indexOf("/**\n * Einen Raum anlegen."));
  assert.match(senden, /const bezug = ziel \? antwortBezug\(ziel, state\.keypair\.pk\) : undefined;/);
  assert.match(senden, /threadRoot: bezug\?\.threadRoot, replyTo: bezug\?\.replyTo,/);
  assert.match(senden, /if \(imThread && !ziel\) return;/, "im Thread nie ohne Bezug senden");
  // Der Bezug im Thread nur als Text
  assert.match(raeume, /z\.append\(el\("div", t\("raum\.zitat", \{ name: nameVon\(bezug\.authorPubkey\), text: bezug\.content\.slice\(0, 80\) \}\), "msg-bezug"\)\);/);
  // Offener Thread nur im Speicher – nie in Adresse oder Verlauf des Browsers
  assert.doesNotMatch(raeume, /history\.(push|replace)State|location\.hash/);
  for (const id of ["thread-spalte", "thread-verlauf", "thread-msg", "thread-send", "thread-zu", "thread-antwort-an", "thread-antwort-weg"]) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
  }
  assert.match(raeume, /if \(e\.key === "Escape"\) schliesseThread\(\);/);
});
