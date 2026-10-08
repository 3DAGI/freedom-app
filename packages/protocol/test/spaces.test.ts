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
  buildThreads, unreadBadges, searchMessages, privacyInfo, raumModeration,
  Channel, Role, KIND_SPACE, JEDER_ROLLE, JEDER_RECHTE,
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

test("Rolle für alle (B-22): Beigetretene schreiben, wo der Kanal es erlaubt – wie @everyone", () => {
  const jeder: Role = { id: JEDER_ROLLE, name: "Jeder", rank: 0, permissions: [...JEDER_RECHTE] };
  const mitJeder = (at = NOW + 1) => signEvent(buildRoles(S, BESITZER.pk, [...rollen, jeder], at), BESITZER.sk);
  const st = buildSpaceState(S, [raumEv(), mitJeder(), grant(BESITZER, MOD.pk, ["mod"])]);
  const [allgemein, ank] = st.space!.channels;
  assert.equal(canWriteTo(FREMD.pk, allgemein!, st), true, "ohne Zuweisung im offenen Kanal");
  assert.equal(canWriteTo(FREMD.pk, ank!, st), false, "#ankündigungen bleibt bei den Moderatoren");
  assert.equal(canWriteTo(MOD.pk, ank!, st), true);
  assert.deepEqual([...permissionsOf(FREMD.pk, st)].sort(), [...JEDER_RECHTE].sort());
  // Nennt ein Kanal die Rolle ausdrücklich, zählt sie dort wie eine zugewiesene
  const nurJeder: Channel = { id: "frei", name: "frei", privacy: "offen", writeRoles: [JEDER_ROLLE], position: 3 };
  assert.equal(canWriteTo(FREMD.pk, nurJeder, st), true);
  // Ohne die Rolle bleibt alles wie bisher: wer keine Rolle hat, schreibt nirgends
  const ohne = buildSpaceState(S, basis());
  assert.equal(canWriteTo(FREMD.pk, ohne.space!.channels[0]!, ohne), false);
  assert.equal(canWriteTo(FREMD.pk, nurJeder, ohne), false);
  // Neueste Rollenliste gilt: zurückgenommen heißt wieder zu
  const zu = buildSpaceState(S, [raumEv(), mitJeder(NOW + 1), rollenEv(BESITZER, NOW + 2)]);
  assert.equal(canWriteTo(FREMD.pk, zu.space!.channels[0]!, zu), false);
});

test("Rolle für alle (B-22): nur Grundrechte – kein Moderieren, Vergeben, Verwalten; nur vom Besitzer", () => {
  const zuViel: Role = { id: JEDER_ROLLE, name: "Jeder", rank: 99, permissions: ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben", "kanaele_verwalten", "repos_pflegen", "anheften"] };
  const st = buildSpaceState(S, [raumEv(), signEvent(buildRoles(S, BESITZER.pk, [...rollen, zuViel], NOW + 1), BESITZER.sk)]);
  assert.deepEqual([...permissionsOf(FREMD.pk, st)].sort(), [...JEDER_RECHTE].sort());
  for (const p of ["moderieren", "rollen_vergeben", "kanaele_verwalten", "repos_pflegen", "anheften"] as const) {
    assert.equal(can(FREMD.pk, p, st), false, p);
  }
  // Wer nur die Rolle für alle hat, vergibt keine Rollen – auch nicht sich selbst
  const selbst = buildSpaceState(S, [raumEv(), signEvent(buildRoles(S, BESITZER.pk, [...rollen, zuViel], NOW + 1), BESITZER.sk),
    grant(FREMD, FREMD.pk, ["mitglied"], NOW + 20)]);
  assert.equal(selbst.grants.has(FREMD.pk), false);
  // Ausblenden durch jemanden, der nur die Rolle für alle hat, zählt nicht
  const ziel = signEvent(buildEvent(MITGLIED.pk, 42, [["h", S]], "hallo", NOW + 30), MITGLIED.sk);
  const ausblenden = signEvent(buildEvent(FREMD.pk, 34551, [["d", `hide:${ziel.id}`], ["h", S], ["e", ziel.id]], "", NOW + 40), FREMD.sk);
  assert.equal(raumModeration(selbst, [ausblenden], [ziel]).hiddenEvents.size, 0);
  // Gegenprobe: derselbe Vorgang vom zugewiesenen Moderator zählt
  const mitMod = buildSpaceState(S, [raumEv(), signEvent(buildRoles(S, BESITZER.pk, [...rollen, zuViel], NOW + 1), BESITZER.sk), grant(BESITZER, MOD.pk, ["mod"])]);
  const vomMod = signEvent(buildEvent(MOD.pk, 34551, [["d", `hide:${ziel.id}`], ["h", S], ["e", ziel.id]], "", NOW + 40), MOD.sk);
  assert.equal(raumModeration(mitMod, [vomMod], [ziel]).hiddenEvents.size, 1);
  // Eine Rollenliste mit „jeder“ von jemand anderem zählt nicht (Rollen nur vom Besitzer)
  const fremd = buildSpaceState(S, [raumEv(), signEvent(buildRoles(S, FREMD.pk, [zuViel], NOW + 5), FREMD.sk)]);
  assert.equal(canWriteTo(FREMD.pk, fremd.space!.channels[0]!, fremd), false);
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
  // Seit 2.3: MLS – Entfernen wechselt den Schlüssel, Neue lesen nichts von vorher
  assert.match(t, /Das Entfernen wechselt den Schlüssel/);
  assert.match(t, /Neue Mitglieder lesen nur, was nach ihrem Eintritt kommt/);
});

// ------------------------------------------------------------- Übernahme (B-7)

test("B-7: Übernahme – die neueste Definition eines anderen zählt nur über die Adresse nicht", async () => {
  const { raumZustandFuer } = await import("../src/raum-repo.js");
  const { raumAdresse } = await import("../src/spaces.js");
  // Ein Fremder schreibt später eine Definition mit derselben Kennung und macht sich zum Gründer
  const uebernahme = signEvent(buildSpace({ spaceId: S, name: "Übernommen", ownerPubkey: FREMD.pk, channels: kanaele }, NOW + 100), FREMD.sk);
  const fremdeRollen = rollenEv(FREMD, NOW + 100);
  const alle = [...basis(), uebernahme, fremdeRollen];
  assert.equal(buildSpaceState(S, alle).ownerPubkey, FREMD.pk, "ohne Adresse gewinnt der Neueste – deshalb nie direkt");
  const z = raumZustandFuer(raumAdresse(BESITZER.pk, S), alle)!;
  assert.equal(z.space?.name, "FreedomStack");
  assert.equal(z.ownerPubkey, BESITZER.pk);
  assert.ok(can(MOD.pk, "moderieren", z), "Rollen des Gründers gelten weiter");
  assert.ok(!can(FREMD.pk, "moderieren", z), "der Fremde hat keine Rechte");
});

test("B-7: Gründer zur bloßen Kennung – eindeutig, eigener Schlüssel, mehrdeutig, keiner", async () => {
  const { gruenderZurKennung } = await import("../src/spaces.js");
  assert.deepEqual(gruenderZurKennung(S, basis()), { besitzer: BESITZER.pk });
  assert.deepEqual(gruenderZurKennung(S, [...basis(), raumEv(NOW + 50)]), { besitzer: BESITZER.pk }, "mehrere Fassungen desselben Gründers");
  const uebernahme = signEvent(buildSpace({ spaceId: S, name: "Übernommen", ownerPubkey: FREMD.pk, channels: kanaele }, NOW + 100), FREMD.sk);
  assert.deepEqual(gruenderZurKennung(S, [...basis(), uebernahme]), { fall: "mehrdeutig" });
  assert.deepEqual(gruenderZurKennung(S, [...basis(), uebernahme], BESITZER.pk), { besitzer: BESITZER.pk }, "der eigene Raum bleibt meiner");
  assert.deepEqual(gruenderZurKennung(S, [...basis(), uebernahme], MOD.pk), { fall: "mehrdeutig" }, "eigener Schlüssel nur, wenn er eine Definition schrieb");
  assert.deepEqual(gruenderZurKennung("anderer-raum", basis()), { fall: "keiner" });
  // Rollen, Zuweisungen und kaputte Definitionen zählen nicht als Gründer
  const kaputt = signEvent(buildEvent(FREMD.pk, KIND_SPACE, [["space", S]], ""), FREMD.sk);
  assert.deepEqual(gruenderZurKennung(S, [...basis(), rollenEv(FREMD), grant(FREMD, FREMD.pk, ["mod"]), kaputt]), { besitzer: BESITZER.pk });
  assert.deepEqual(gruenderZurKennung(S, []), { fall: "keiner" });
});

// ------------------------------------------------------------- Moderation offener Räume (B-19)

test("B-19: Ausblenden und Sperren nur mit „moderieren“ und nur gegen Niedrigere", async () => {
  const { raumModeration } = await import("../src/spaces.js");
  const { buildHide, buildBan, applyModeration } = await import("../src/moderation.js");
  const MOD2 = generateKeypair();
  const st = buildSpaceState(S, [...basis(), grant(BESITZER, MOD2.pk, ["mod"])]);
  const nachricht = (kp: typeof BESITZER, text: string, at = NOW + 100) =>
    signEvent(buildChannelMessage({ authorPubkey: kp.pk, spaceId: S, channelId: "allgemein", content: text, mentions: [] }, at), kp.sk);
  const vomMitglied = nachricht(MITGLIED, "Werbung");
  const vomBesitzer = nachricht(BESITZER, "Regeln");
  const vonMod2 = nachricht(MOD2, "Ich bin auch Moderator");
  const vomFremden = nachricht(FREMD, "Hallo");
  const nachrichten = [vomMitglied, vomBesitzer, vonMod2, vomFremden];
  const mass = (kp: typeof BESITZER, u: ReturnType<typeof buildHide>, at: number) => signEvent({ ...u, created_at: at }, kp.sk);
  const massnahmen = [
    mass(MOD, buildHide(S, MOD.pk, vomMitglied.id, "Werbung"), NOW + 200),        // zählt
    mass(MOD, buildBan(S, MOD.pk, FREMD.pk, "Spam"), NOW + 201),                  // zählt: ohne Rolle unter dem Mod
    mass(MOD, buildHide(S, MOD.pk, vomBesitzer.id, "weg damit"), NOW + 202),      // Gründer: nie
    mass(MOD, buildBan(S, MOD.pk, BESITZER.pk, "Putsch"), NOW + 203),             // Gründer: nie
    mass(MOD, buildBan(S, MOD.pk, MOD2.pk, "gleicher Rang"), NOW + 204),          // gleicher Rang: nie
    mass(MITGLIED, buildHide(S, MITGLIED.pk, vonMod2.id, "ich will"), NOW + 205), // ohne Recht
    mass(FREMD, buildBan(S, FREMD.pk, MITGLIED.pk, "Rache"), NOW + 206),          // ohne Recht
    mass(MOD, buildHide("anderer-raum", MOD.pk, vomFremden.id, "falscher Raum"), NOW + 207),
  ];
  const mod = raumModeration(st, massnahmen, nachrichten);
  assert.deepEqual([...mod.hiddenEvents.keys()], [vomMitglied.id]);
  assert.deepEqual([...mod.bannedPubkeys.keys()], [FREMD.pk]);
  assert.ok(mod.moderators.has(BESITZER.pk) && mod.moderators.has(MOD.pk) && !mod.moderators.has(MITGLIED.pk));
  assert.equal(mod.ignored.length, 5);
  // Der Gründer darf auch Moderatoren sperren
  const vomGruender = raumModeration(st, [mass(BESITZER, buildBan(S, BESITZER.pk, MOD2.pk, "abgesetzt"), NOW + 300)], nachrichten);
  assert.deepEqual([...vomGruender.bannedPubkeys.keys()], [MOD2.pk]);
  // Angewendet: Ausgeblendetes und Nachrichten Gesperrter sind markiert, der Rest bleibt
  const r = applyModeration(nachrichten, mod, { enabled: true });
  assert.deepEqual(r.map((x) => x.hidden), [true, false, false, true]);
  assert.equal(r[0]!.reason, "Werbung");
  // Ohne Raum-Zustand keine Moderation
  assert.equal(raumModeration(buildSpaceState(S, []), massnahmen, nachrichten).hiddenEvents.size, 0);
});

// ------------------------------------------------------------- Kanäle offener Räume (B-20)

test("B-20: Kanal-Event – Hin und zurück, entfernt, Fremdes und Übergroßes fällt weg", async () => {
  const { raumAdresse, baueRaumKanal, baueKanalEntfernung, leseRaumKanal, KANAL_GRENZEN, KIND_RAUM_KANAL } = await import("../src/spaces.js");
  const adr = raumAdresse(BESITZER.pk, S);
  const k: Channel = { id: "hilfe", name: "Hilfe", privacy: "offen", writeRoles: ["mod"], position: 3, topic: "Fragen" };
  const ev = signEvent(baueRaumKanal(MOD.pk, adr, k, NOW), MOD.sk);
  assert.equal(ev.kind, KIND_RAUM_KANAL);
  assert.deepEqual(ev.tags.slice(0, 3), [["d", `kanal:${S}:hilfe`], ["space", S], ["a", adr]]);
  assert.deepEqual(leseRaumKanal(ev), { adresse: adr, spaceId: S, kanalId: "hilfe", kanal: k, autor: MOD.pk, zeit: NOW });
  const weg = signEvent(baueKanalEntfernung(MOD.pk, adr, "hilfe", NOW), MOD.sk);
  assert.equal(leseRaumKanal(weg)?.kanal, null);
  // Bauen nur Gültiges – offene Räume sind nie verschlüsselt
  assert.throws(() => baueRaumKanal(MOD.pk, adr, { ...k, privacy: "verschluesselt" }), /Kanal ungültig/);
  assert.throws(() => baueRaumKanal(MOD.pk, adr, { ...k, id: "mit leerzeichen" }), /Kanal ungültig/);
  assert.throws(() => baueRaumKanal(MOD.pk, adr, { ...k, name: "x".repeat(KANAL_GRENZEN.name + 1) }), /Kanal ungültig/);
  assert.throws(() => baueRaumKanal(MOD.pk, `34700:${BESITZER.pk}:${S}`, k), /Kanal ungültig/);
  // Fremde Daten: jede Abweichung ergibt null
  const mit = (tags: string[][]) => signEvent(buildEvent(MOD.pk, KIND_RAUM_KANAL, tags, "", NOW), MOD.sk);
  const gut = ev.tags;
  const ersetze = (name: string, t: string[]) => gut.map((x) => (x[0] === name ? t : x));
  for (const kaputt of [
    ersetze("d", ["d", `kanal:${S}:anders`]),
    ersetze("space", ["space", "anderer-raum"]),
    ersetze("a", ["a", raumAdresse(FREMD.pk, "anderer-raum")]),
    gut.filter((x) => x[0] !== "a"),
    [...gut, ["entfernt", "hilfe"]],
    [...gut, ["channel", "hilfe", "Hilfe", "offen", "1", "", ""]],
    ersetze("channel", ["channel", "hilfe", "Hilfe", "verschluesselt", "3", "mod", ""]),
    ersetze("channel", ["channel", "hilfe", "", "offen", "3", "", ""]),
    ersetze("channel", ["channel", "hilfe", "Hilfe", "offen", "-1", "", ""]),
    ersetze("channel", ["channel", "hilfe", "Hilfe", "offen", "3", Array.from({ length: KANAL_GRENZEN.rollen + 1 }, (_, i) => `r${i}`).join("|"), ""]),
    ersetze("channel", ["channel", "hilfe", "Hilfe", "offen", "3", "", "t".repeat(KANAL_GRENZEN.thema + 1)]),
  ]) assert.equal(leseRaumKanal(mit(kaputt)), null, JSON.stringify(kaputt));
  assert.equal(leseRaumKanal({ ...ev, kind: KIND_SPACE }), null);
});

test("B-20: Kanäle von Berechtigten – neueste Aussage je Kanal, nur bis zum eigenen Rang", async () => {
  const { raumAdresse, baueRaumKanal, baueKanalEntfernung, mitRaumKanaelen } = await import("../src/spaces.js");
  const { raumZustandFuer } = await import("../src/raum-repo.js");
  const adr = raumAdresse(BESITZER.pk, S);
  const ADMIN = generateKeypair();
  // Rollen mit „kanaele_verwalten“; über dem Moderator steht ein Admin
  const mitKanaelen: Role[] = [
    { id: "admin", name: "Admin", rank: 80, permissions: ["lesen", "schreiben", "moderieren", "kanaele_verwalten"] },
    { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "moderieren", "kanaele_verwalten"] },
    { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben"] },
  ];
  const nurAdmins: Channel = { id: "vorstand", name: "vorstand", privacy: "offen", writeRoles: ["admin"], position: 5 };
  const raum = [
    signEvent(buildSpace({ spaceId: S, name: "FreedomStack", ownerPubkey: BESITZER.pk, channels: [...kanaele.slice(0, 2), nurAdmins] }, NOW), BESITZER.sk),
    signEvent(buildRoles(S, BESITZER.pk, mitKanaelen, NOW), BESITZER.sk),
    grant(BESITZER, ADMIN.pk, ["admin"]), grant(BESITZER, MOD.pk, ["mod"]), grant(BESITZER, MITGLIED.pk, ["mitglied"]),
  ];
  const kanal = (kp: typeof BESITZER, k: Channel, at: number) => signEvent(baueRaumKanal(kp.pk, adr, k, at), kp.sk);
  const weg = (kp: typeof BESITZER, id: string, at: number) => signEvent(baueKanalEntfernung(kp.pk, adr, id, at), kp.sk);
  const hilfe: Channel = { id: "hilfe", name: "hilfe", privacy: "offen", writeRoles: [], position: 2 };
  const ereignisse = [
    kanal(MOD, hilfe, NOW + 100),                                                             // neu: zählt
    kanal(MOD, { ...kanaele[0]!, name: "Allgemeines" }, NOW + 101),                           // umbenannt: zählt
    kanal(MOD, { ...kanaele[1]!, writeRoles: [] }, NOW + 102),                                // eigener Rang: zählt
    kanal(MOD, { ...nurAdmins, writeRoles: [] }, NOW + 103),                                  // über ihm: nie
    weg(MOD, "vorstand", NOW + 104),                                                          // über ihm: nie
    kanal(MOD, { id: "geheim", name: "geheim", privacy: "offen", writeRoles: ["admin"], position: 9 }, NOW + 105), // über ihm: nie
    kanal(MITGLIED, { ...hilfe, id: "spam", name: "spam" }, NOW + 106),                      // ohne Recht
    kanal(FREMD, { ...hilfe, id: "fremd", name: "fremd" }, NOW + 107),                        // ohne Recht
    kanal(ADMIN, { ...nurAdmins, name: "Vorstand" }, NOW + 108),                              // Admin darf
    kanal(MOD, { ...kanaele[0]!, name: "zu alt" }, NOW - 5),                                  // älter als die Definition
    kanal(MOD, { ...hilfe, id: "zukunft", name: "zukunft" }, NOW + 10_000),                   // zu weit voraus
  ];
  const jetzt = NOW + 1000;
  const z = raumZustandFuer(adr, [...raum, ...ereignisse], jetzt)!;
  const mit = mitRaumKanaelen(raumZustandFuer(adr, raum, jetzt)!, ereignisse, jetzt);
  assert.deepEqual(mit.space!.channels.map((c) => [c.id, c.name, c.writeRoles.join("|")]), [
    ["allgemein", "Allgemeines", ""], ["ankuendigungen", "ankündigungen", ""], ["hilfe", "hilfe", ""], ["vorstand", "Vorstand", "admin"],
  ]);
  assert.deepEqual(mit.ignored.map((i) => i.reason).sort(), [
    "Kanal über eigenem Rang", "Kanal über eigenem Rang", "Kanal über eigenem Rang", "darf keine Kanäle verwalten", "darf keine Kanäle verwalten",
  ]);
  // raumZustandFuer wendet sie an
  assert.deepEqual(z.space!.channels, mit.space!.channels);
  // Moderator entfernt „hilfe“, der Gründer bringt sie mit einer neueren Definition zurück
  const entfernt = mitRaumKanaelen(mit, [weg(MOD, "hilfe", NOW + 200)], jetzt);
  assert.ok(!entfernt.space!.channels.some((c) => c.id === "hilfe"));
  const zurueck = signEvent(buildSpace({ spaceId: S, name: "FreedomStack", ownerPubkey: BESITZER.pk, channels: [...kanaele.slice(0, 2), hilfe] }, NOW + 300), BESITZER.sk);
  const z2 = raumZustandFuer(adr, [...raum.slice(1), zurueck, ...ereignisse, weg(MOD, "hilfe", NOW + 200)], jetzt)!;
  assert.ok(mitRaumKanaelen(z2, [], jetzt).space!.channels.some((c) => c.id === "hilfe"), "die neuere Definition gilt");
  assert.equal(z2.space!.channels.find((c) => c.id === "allgemein")?.name, "allgemein", "auch für Umbenanntes: neueste Aussage");
  // Recht entzogen: Seine Änderungen fallen weg, auch zurückdatierte
  const abgesetzt = raumZustandFuer(adr, [...raum, grant(BESITZER, MOD.pk, ["mitglied"], NOW + 500), ...ereignisse], jetzt)!;
  assert.ok(!abgesetzt.space!.channels.some((c) => c.id === "hilfe"));
  assert.equal(abgesetzt.space!.channels.find((c) => c.id === "allgemein")?.name, "allgemein");
  // Nur an die Adresse dieses Gründers: dieselbe Kennung bei einem anderen Gründer zählt nicht
  const fremdeAdresse = signEvent(baueRaumKanal(MOD.pk, raumAdresse(FREMD.pk, S), { ...hilfe, id: "falsch", name: "falsch" }, NOW + 110), MOD.sk);
  assert.ok(!mitRaumKanaelen(mit, [fremdeAdresse], jetzt).space!.channels.some((c) => c.id === "falsch"));
  // Grenze: höchstens KANAL_GRENZEN.anzahl Kanäle aus Events
  const { KANAL_GRENZEN } = await import("../src/spaces.js");
  const viele = Array.from({ length: KANAL_GRENZEN.anzahl + 5 }, (_, i) => kanal(MOD, { ...hilfe, id: `k${i}`, name: `k${i}`, position: 10 + i }, NOW + 400 + i));
  const voll = mitRaumKanaelen(mit, viele, jetzt);
  assert.equal(voll.space!.channels.length, KANAL_GRENZEN.anzahl);
  assert.equal(voll.ignored.filter((i) => i.reason === "zu viele Kanäle").length, 9);
  // Ohne Raum bleibt alles, wie es ist
  const leer = buildSpaceState(S, []);
  assert.equal(mitRaumKanaelen(leer, ereignisse, jetzt), leer);
});

test("B-20c: darfKanalAendern – Gründer immer, sonst mit Recht und nur bis zum eigenen Rang; anlegen, ändern, entfernen", async () => {
  const { darfKanalAendern } = await import("../src/spaces.js");
  const rechte: Role[] = [
    { id: "admin", name: "Admin", rank: 80, permissions: ["kanaele_verwalten"] },
    { id: "mod", name: "Moderator", rank: 50, permissions: ["kanaele_verwalten"] },
    { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben"] },
  ];
  const st = buildSpaceState(S, [raumEv(), signEvent(buildRoles(S, BESITZER.pk, rechte, NOW), BESITZER.sk),
    grant(BESITZER, MOD.pk, ["mod"]), grant(BESITZER, MITGLIED.pk, ["mitglied"])]);
  const offen: Channel = { id: "x", name: "x", privacy: "offen", writeRoles: [], position: 0 };
  const nurMods: Channel = { ...offen, writeRoles: ["mod"] };
  const nurAdmins: Channel = { ...offen, writeRoles: ["admin"] };
  const unbekannt: Channel = { ...offen, writeRoles: ["gibt-es-nicht"] };
  // Moderator: anlegen, umbenennen, Moderatoren-Kanal, entfernen – alles bis zum eigenen Rang
  assert.ok(darfKanalAendern(MOD.pk, undefined, offen, st));
  assert.ok(darfKanalAendern(MOD.pk, offen, { ...offen, name: "y" }, st));
  assert.ok(darfKanalAendern(MOD.pk, offen, nurMods, st));
  assert.ok(darfKanalAendern(MOD.pk, nurMods, null, st));
  // über ihm nie: weder öffnen noch entfernen noch einschränken; unbekannte Rollen zählen als darüber
  assert.ok(!darfKanalAendern(MOD.pk, nurAdmins, offen, st));
  assert.ok(!darfKanalAendern(MOD.pk, nurAdmins, null, st));
  assert.ok(!darfKanalAendern(MOD.pk, offen, nurAdmins, st));
  assert.ok(!darfKanalAendern(MOD.pk, undefined, unbekannt, st));
  // ohne Recht nie, der Gründer immer
  assert.ok(!darfKanalAendern(MITGLIED.pk, undefined, offen, st));
  assert.ok(!darfKanalAendern(FREMD.pk, offen, null, st));
  assert.ok(darfKanalAendern(BESITZER.pk, nurAdmins, null, st));
  assert.ok(darfKanalAendern(BESITZER.pk, undefined, unbekannt, st));
});
