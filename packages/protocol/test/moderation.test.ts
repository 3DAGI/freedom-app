/**
 * Tests fuer die Community-Moderation.
 *
 * Moderation ist ein Werkzeug mit zwei Schneiden: Sie soll gegen Missbrauch
 * helfen und kann selbst missbraucht werden. Die Tests pruefen deshalb vor
 * allem, wer sie NICHT ausueben darf und was sie ausdruecklich nicht kann.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  buildModeratorList, parseModeratorList, buildHide, buildBan,
  parseModerationAction, buildModerationState, applyModeration,
  canModerate, moderationInfo,
  KIND_COMMUNITY_MODERATORS, KIND_MODERATION_HIDE,
} from "../src/moderation.js";

const GRUENDER = generateKeypair();
const MOD = generateKeypair();
const FREMD = generateKeypair();
const NUTZER = generateKeypair();
const C = "community-1";

const nachricht = (kp: { pk: string; sk: Uint8Array }, text: string, id?: string): NostrEvent => {
  const ev = signEvent(buildEvent(kp.pk, 42, [["h", C]], text), kp.sk);
  return id ? { ...ev, id } : ev;
};

const modListe = (mods: string[], rules?: string, at = 1000) =>
  signEvent(buildModeratorList(C, GRUENDER.pk, mods, rules, at), GRUENDER.sk);

// ------------------------------------------------------------- Format

test("Moderatorenliste: Roundtrip", () => {
  const ev = modListe([MOD.pk], "Kein Spam, keine Gewaltaufrufe.");
  const m = parseModeratorList(ev);
  assert.equal(ev.kind, KIND_COMMUNITY_MODERATORS);
  assert.equal(m.communityId, C);
  assert.deepEqual(m.moderators, [MOD.pk]);
  assert.match(m.rules!, /Kein Spam/);
});

test("Massnahmen tragen eine Begruendung", () => {
  // Ohne Begruendung wirkt Moderation willkuerlich — und wird es meist auch.
  const ev = signEvent(buildHide(C, MOD.pk, "evt1", "Spam"), MOD.sk);
  const a = parseModerationAction(ev);
  assert.equal(a.kind, "hide");
  assert.equal(a.target, "evt1");
  assert.equal(a.reason, "Spam");
  assert.equal(ev.kind, KIND_MODERATION_HIDE);
});

test("Kaputte Massnahmen werden abgelehnt", () => {
  const ohneZiel = signEvent(buildEvent(MOD.pk, KIND_MODERATION_HIDE, [["h", C]], ""), MOD.sk);
  assert.throws(() => parseModerationAction(ohneZiel), /ohne Ziel/);
  const ohneCommunity = signEvent(buildEvent(MOD.pk, KIND_MODERATION_HIDE, [["e", "x"]], ""), MOD.sk);
  assert.throws(() => parseModerationAction(ohneCommunity), /ohne Community/);
});

// ------------------------------------------------- Wer darf moderieren

test("Nur benannte Moderatoren zaehlen", () => {
  // Ohne diese Pruefung waere "Moderation" ein Werkzeug fuer genau die Leute,
  // gegen die sie helfen soll.
  const st = buildModerationState(C, [
    modListe([MOD.pk]),
    signEvent(buildHide(C, FREMD.pk, "evt1", "gefaellt mir nicht"), FREMD.sk),
  ]);
  assert.equal(st.hiddenEvents.size, 0);
  assert.equal(st.ignored.length, 1);
  assert.match(st.ignored[0].reason, /nicht als Moderator/);
});

test("Der Gruender darf immer moderieren", () => {
  const st = buildModerationState(C, [
    modListe([MOD.pk]),
    signEvent(buildHide(C, GRUENDER.pk, "evt1", "Spam"), GRUENDER.sk),
  ]);
  assert.equal(st.hiddenEvents.size, 1);
  assert.equal(canModerate(GRUENDER.pk, st), true);
  assert.equal(canModerate(FREMD.pk, st), false);
});

test("Bei Moderatorenlisten gewinnt die NEUESTE", () => {
  // Der Gruender muss jemanden absetzen koennen. (Anders als beim Referral,
  // wo die frueheste zaehlt — dort geht es um eine Zuordnung, hier um eine
  // Vollmacht.)
  const st = buildModerationState(C, [
    modListe([MOD.pk], undefined, 1000),
    modListe([], undefined, 2000),
    signEvent(buildHide(C, MOD.pk, "evt1", "Spam"), MOD.sk),
  ]);
  assert.equal(canModerate(MOD.pk, st), false, "abgesetzt");
  assert.equal(st.hiddenEvents.size, 0);
});

test("Fremde Communities werden nicht beeinflusst", () => {
  // Keine netzweite Sperrliste: Die waere genau die zentrale Instanz, die das
  // Projekt nicht haben will.
  const andere = signEvent(buildHide("community-2", MOD.pk, "evt1", "Spam"), MOD.sk);
  const st = buildModerationState(C, [modListe([MOD.pk]), andere]);
  assert.equal(st.hiddenEvents.size, 0);
});

// ------------------------------------------------------------- Wirkung

test("Ausgeblendete Nachricht wird markiert, nicht entfernt", () => {
  const msg = nachricht(NUTZER, "Spam", "evt-spam");
  const st = buildModerationState(C, [
    modListe([MOD.pk]),
    signEvent(buildHide(C, MOD.pk, "evt-spam", "Werbung"), MOD.sk),
  ]);
  const r = applyModeration([msg], st, { enabled: true });
  assert.equal(r.length, 1, "nichts verschwindet aus der Liste");
  assert.equal(r[0].hidden, true);
  assert.equal(r[0].reason, "Werbung");
  assert.equal(r[0].by, MOD.pk);
});

test("Gesperrter Absender wird ausgeblendet — auch kuenftige Nachrichten", () => {
  const st = buildModerationState(C, [
    modListe([MOD.pk]),
    signEvent(buildBan(C, MOD.pk, NUTZER.pk, "wiederholter Spam"), MOD.sk),
  ]);
  const r = applyModeration([nachricht(NUTZER, "noch was"), nachricht(FREMD, "harmlos")], st, { enabled: true });
  assert.equal(r[0].hidden, true);
  assert.equal(r[1].hidden, false, "nur der Gesperrte");
});

test("ABSCHALTBAR: mit deaktivierter Moderation sieht der Nutzer alles", () => {
  // Das ist der Unterschied zwischen einer Hausordnung und einer Zensur: Die
  // eine gilt, weil man dazugehoeren will, die andere, weil man nicht anders
  // kann.
  const msg = nachricht(NUTZER, "Spam", "evt-spam");
  const st = buildModerationState(C, [
    modListe([MOD.pk]),
    signEvent(buildHide(C, MOD.pk, "evt-spam", "Werbung"), MOD.sk),
  ]);
  const r = applyModeration([msg], st, { enabled: false });
  assert.equal(r[0].hidden, false);
});

test("Ohne Moderation bleibt alles sichtbar", () => {
  const st = buildModerationState(C, []);
  const r = applyModeration([nachricht(NUTZER, "hallo")], st, { enabled: true });
  assert.equal(r[0].hidden, false);
  assert.equal(st.ownerPubkey, undefined);
});

// ------------------------------------------------------------- Auskunft

test("Auskunft nennt die Grenze: ausblenden ist nicht loeschen", () => {
  // Niemand kann ein Event von den Relays entfernen. Wer behauptet, er koenne
  // es, luegt — und das gehoert in die Auskunft, nicht ins Kleingedruckte.
  const st = buildModerationState(C, [modListe([MOD.pk], "Sei freundlich.")]);
  const t = moderationInfo(st, true);
  assert.match(t, /nicht löschen/);
  assert.match(t, /bleiben auf den Relays/);
  assert.match(t, /Sei freundlich/);
});

test("Auskunft sagt, ob die Moderation gerade greift", () => {
  const st = buildModerationState(C, [modListe([MOD.pk])]);
  assert.match(moderationInfo(st, true), /moderierte Ansicht/);
  assert.match(moderationInfo(st, false), /AUS/);
});

test("Auskunft fuer unmoderierte Community ist eindeutig", () => {
  const st = buildModerationState(C, []);
  assert.match(moderationInfo(st, true), /keine Moderation/);
});
