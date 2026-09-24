/**
 * Tests fuer die Raum-Schicht.
 *
 * Rechtesysteme scheitern fast immer an derselben Stelle: Jemand vergibt sich
 * selbst mehr, als er hat. Der Schwerpunkt liegt deshalb auf Rangfolge und
 * Selbstermaechtigung — und darauf, dass die Auskunft ueber Vertraulichkeit
 * nicht mehr verspricht, als sie halten kann.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  buildSpace, parseSpace, buildRoles, buildRoleGrant, buildSpaceState,
  permissionsOf, can, canWriteTo, buildChannelMessage, parseChannelMessage,
  buildThreads, unreadBadges, searchMessages, privacyInfo,
  Channel, Role, KIND_SPACE,
} from "../src/spaces.js";

const NOW = 1_800_000_000;
const S = "raum-1";
const BESITZER = generateKeypair();
const MOD = generateKeypair();
const MITGLIED = generateKeypair();
const FREMD = generateKeypair();

const kanaele: Channel[] = [
  { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 },
  { id: "ankuendigungen", name: "ankündigungen", privacy: "offen", writeRoles: ["mod"], position: 1 },
  { id: "intern", name: "intern", privacy: "verschluesselt", writeRoles: [], position: 2 },
];

const rollen: Role[] = [
  { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen","schreiben","threads","moderieren","rollen_vergeben"] },
  { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen","schreiben","threads"] },
];

const raumEv = (at = NOW) => signEvent(buildSpace({
  spaceId: S, name: "FreedomStack", ownerPubkey: BESITZER.pk, channels: kanaele,
}, at), BESITZER.sk);
const rollenEv = (kp = BESITZER, at = NOW) => signEvent(buildRoles(S, kp.pk, rollen, at), kp.sk);
const grant = (von: typeof BESITZER, an: string, ids: string[], at = NOW + 10) =>
  signEvent(buildRoleGrant(S, von.pk, an, ids, at), von.sk);

const basis = () => [raumEv(), rollenEv(),
  grant(BESITZER, MOD.pk, ["mod"]), grant(BESITZER, MITGLIED.pk, ["mitglied"])];

// ------------------------------------------------------------- Raum

test("Raum: Roundtrip mit Kanaelen", () => {
  const s = parseSpace(raumEv());
  assert.equal(s.spaceId, S);
  assert.equal(s.channels.length, 3);
  assert.equal(s.channels[0].id, "allgemein");
  assert.equal(s.channels[2].privacy, "verschluesselt");
});

test("Kanaele kommen in ihrer Reihenfolge", () => {
  const durcheinander = signEvent(buildSpace({
    spaceId: S, name: "X", ownerPubkey: BESITZER.pk,
    channels: [{ ...kanaele[0], position: 5 }, { ...kanaele[1], position: 1 }],
  }), BESITZER.sk);
  assert.equal(parseSpace(durcheinander).channels[0].id, "ankuendigungen");
});

test("Raum ohne Kennung wird abgelehnt", () => {
  const ev = signEvent(buildEvent(BESITZER.pk, KIND_SPACE, [["name", "X"]], ""), BESITZER.sk);
  assert.throws(() => parseSpace(ev), /ohne Kennung/);
});

// ------------------------------------------------------------- Rechte

test("Der Besitzer darf alles", () => {
  const st = buildSpaceState(S, basis());
  assert.equal(can(BESITZER.pk, "moderieren", st), true);
  assert.equal(can(BESITZER.pk, "kanaele_verwalten", st), true);
});

test("Rollen bringen genau ihre Rechte", () => {
  const st = buildSpaceState(S, basis());
  const p = permissionsOf(MITGLIED.pk, st);
  assert.equal(p.has("schreiben"), true);
  assert.equal(p.has("moderieren"), false);
});

test("Wer keine Rolle hat, hat nichts", () => {
  const st = buildSpaceState(S, basis());
  assert.equal(permissionsOf(FREMD.pk, st).size, 0);
});

test("Rollen kann nur der Besitzer definieren", () => {
  // Sonst legt sich jeder eine Rolle mit allen Rechten an.
  const st = buildSpaceState(S, [raumEv(), rollenEv(MOD)]);
  assert.equal(st.roles.size, 0);
  assert.ok(st.ignored.some((i) => /nur vom Besitzer/.test(i.reason)));
});

test("Ohne 'rollen_vergeben' kann niemand zuweisen", () => {
  const st = buildSpaceState(S, [...basis(), grant(MITGLIED, FREMD.pk, ["mitglied"], NOW + 20)]);
  assert.equal(st.grants.has(FREMD.pk), false);
  assert.ok(st.ignored.some((i) => /darf keine Rollen/.test(i.reason)));
});

test("DER Klassiker: ein Moderator macht sich selbst zum Hoeheren", () => {
  // Ohne Rangpruefung koennte ein Moderator sich die hoechste Rolle geben.
  const st = buildSpaceState(S, [...basis(), grant(MOD, MOD.pk, ["mod"], NOW + 20)]);
  assert.ok(st.ignored.some((i) => /über eigenem Rang/.test(i.reason)));
  // Seine urspruengliche Rolle bleibt, mehr nicht.
  assert.deepEqual(st.grants.get(MOD.pk), ["mod"]);
});

test("Ein Moderator darf niedrigere Rollen vergeben", () => {
  const st = buildSpaceState(S, [...basis(), grant(MOD, FREMD.pk, ["mitglied"], NOW + 20)]);
  assert.deepEqual(st.grants.get(FREMD.pk), ["mitglied"]);
});

test("Zuweisungen wirken in zeitlicher Reihenfolge", () => {
  // Ein frisch Berechtigter muss weitergeben koennen — aber erst danach.
  const st = buildSpaceState(S, [
    raumEv(), rollenEv(),
    grant(MOD, FREMD.pk, ["mitglied"], NOW + 5),       // zu frueh
    grant(BESITZER, MOD.pk, ["mod"], NOW + 10),
    grant(MOD, MITGLIED.pk, ["mitglied"], NOW + 20),   // jetzt gueltig
  ]);
  assert.equal(st.grants.has(FREMD.pk), false);
  assert.equal(st.grants.has(MITGLIED.pk), true);
});

// ------------------------------------------------------------- Kanaele

test("Ankuendigungskanal: alle lesen, wenige schreiben", () => {
  const st = buildSpaceState(S, basis());
  const ank = st.space!.channels.find((c) => c.id === "ankuendigungen")!;
  assert.equal(canWriteTo(MOD.pk, ank, st), true);
  assert.equal(canWriteTo(MITGLIED.pk, ank, st), false);
  // Im offenen Kanal darf das Mitglied sehr wohl.
  assert.equal(canWriteTo(MITGLIED.pk, st.space!.channels[0], st), true);
});

test("Der Besitzer schreibt ueberall", () => {
  const st = buildSpaceState(S, basis());
  for (const c of st.space!.channels) assert.equal(canWriteTo(BESITZER.pk, c, st), true);
});

test("Fremde schreiben nirgends", () => {
  const st = buildSpaceState(S, basis());
  for (const c of st.space!.channels) assert.equal(canWriteTo(FREMD.pk, c, st), false);
});

// ------------------------------------------------------------- Threads

const msg = (kp: typeof BESITZER, text: string, over: Record<string, unknown> = {}, at = NOW) =>
  signEvent(buildChannelMessage({
    authorPubkey: kp.pk, spaceId: S, channelId: "allgemein", content: text, mentions: [], ...over,
  } as never, at), kp.sk);

test("Nachricht: Roundtrip mit Thread-Bezug", () => {
  const m = parseChannelMessage(msg(MITGLIED, "Antwort", { threadRoot: "abc", replyTo: "def" }));
  assert.equal(m.threadRoot, "abc");
  assert.equal(m.replyTo, "def");
  assert.equal(m.channelId, "allgemein");
});

test("Threads werden aus Wurzel und Antworten gebaut", () => {
  const st = buildSpaceState(S, basis());
  const kanal = st.space!.channels[0];
  const wurzel = msg(MITGLIED, "Frage", {}, NOW);
  const evs = [wurzel,
    msg(MOD, "Antwort 1", { threadRoot: wurzel.id }, NOW + 10),
    msg(MITGLIED, "Antwort 2", { threadRoot: wurzel.id }, NOW + 20)];

  const { topLevel, threads } = buildThreads(evs, kanal, st);
  assert.equal(topLevel.length, 1);
  const t = threads.get(wurzel.id)!;
  assert.equal(t.replies.length, 2);
  assert.equal(t.participants.length, 2);
  assert.equal(t.lastActivity, NOW + 20);
});

test("Nachrichten ohne Schreibrecht erscheinen NICHT", () => {
  // Auf dem Relay stehen sie weiter — im Kanal nicht. Das ist derselbe
  // Mechanismus wie bei der Moderation.
  const st = buildSpaceState(S, basis());
  const { topLevel } = buildThreads([msg(FREMD, "Spam")], st.space!.channels[0], st);
  assert.equal(topLevel.length, 0);
});

test("Antwort auf eine nicht vorhandene Wurzel verschwindet", () => {
  // Sie als eigenstaendige Nachricht auszugeben waere irrefuehrend.
  const st = buildSpaceState(S, basis());
  const { topLevel, threads } = buildThreads(
    [msg(MITGLIED, "Antwort", { threadRoot: "gibtesnicht" })], st.space!.channels[0], st);
  assert.equal(topLevel.length, 0);
  assert.equal(threads.size, 0);
});

// ------------------------------------------------------ Ungelesenes

test("Ungelesenes zaehlt nur fremde Nachrichten nach dem Lesestand", () => {
  const nachrichten = [
    parseChannelMessage(msg(MOD, "a", {}, NOW + 10)),
    parseChannelMessage(msg(MITGLIED, "eigene", {}, NOW + 20)),
    parseChannelMessage(msg(MOD, "alt", {}, NOW - 100)),
  ];
  const b = unreadBadges(MITGLIED.pk, nachrichten, { lastRead: new Map([["allgemein", NOW]]) });
  assert.equal(b[0].unread, 1);
});

test("Erwaehnungen stehen oben — sie sind der Grund, warum jemand oeffnet", () => {
  const nachrichten = [
    parseChannelMessage(msg(MOD, "viel los", { channelId: "laut" }, NOW + 10)),
    parseChannelMessage(msg(MOD, "viel los", { channelId: "laut" }, NOW + 11)),
    parseChannelMessage(msg(MOD, "@du", { channelId: "still", mentions: [MITGLIED.pk] }, NOW + 12)),
  ];
  const b = unreadBadges(MITGLIED.pk, nachrichten, { lastRead: new Map() });
  assert.equal(b[0].channelId, "still");
  assert.equal(b[0].mentions, 1);
});

test("Suche findet, filtert und begrenzt", () => {
  const n = [
    parseChannelMessage(msg(MOD, "Treffen um 19 Uhr", {}, NOW + 10)),
    parseChannelMessage(msg(MITGLIED, "Treffen abgesagt", { channelId: "anderer" }, NOW + 20)),
  ];
  assert.equal(searchMessages("treffen", n).length, 2);
  assert.equal(searchMessages("treffen", n, { channelId: "allgemein" }).length, 1);
  assert.equal(searchMessages("treffen", n, { fromPubkey: MOD.pk }).length, 1);
  assert.equal(searchMessages("t", n).length, 0, "zu kurze Anfrage");
});

// ------------------------------------------------------ Vertraulichkeit

test("Offener Kanal verspricht keine Vertraulichkeit", () => {
  // "Privat" ist das Wort, bei dem Missverstaendnisse am teuersten sind.
  const t = privacyInfo(kanaele[0]);
  assert.match(t, /Jeder kann mitlesen/);
  assert.match(t, /nicht, wer lesen kann/);
});

test("Verschluesselter Kanal nennt seine Grenze", () => {
  const t = privacyInfo(kanaele[2]);
  assert.match(t, /Nur Mitglieder/);
  // Die unbequeme Wahrheit gehoert dazu.
  assert.match(t, /behält den Schlüssel/);
});
