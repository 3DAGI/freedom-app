/**
 * Offene Räume nur über die Adresse des Gründers (Sammlung Neuordnung, B-7):
 * Gemerkt wird die Adresse, eine bloße Kennung bindet die App nur eindeutig an
 * einen Gründer; wer später eine Definition mit derselben Kennung schreibt,
 * übernimmt den Raum nicht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRoles, buildSpace, generateKeypair, gruenderZurKennung, raumAdresse, raumZustandFuer, signEvent } from "@freedomstack/protocol";
import { LS_RAEUME, MAX_RAEUME, beitreten, bindeKennung, istAdresse, kennungVon, raumEintraege } from "../src/oeffentliche-raeume.js";

const speicher = (anfang?: unknown) => {
  const m = new Map<string, string>();
  if (anfang !== undefined) m.set(LS_RAEUME, JSON.stringify(anfang));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), liste: () => JSON.parse(m.get(LS_RAEUME) ?? "[]") as string[] };
};
const GRUENDER = generateKeypair();
const FREMD = generateKeypair();
const ADRESSE = raumAdresse(GRUENDER.pk, "werkstatt-ab12cd");

test("B-7: Einträge – Adressen und alte Kennungen, Unlesbares und private Räume fallen weg", () => {
  assert.deepEqual(raumEintraege(speicher(["werkstatt-ab12cd", ADRESSE, ADRESSE, "mls:gruppe", "mit leerzeichen", 5, "x".repeat(65)])), ["werkstatt-ab12cd", ADRESSE]);
  assert.deepEqual(raumEintraege(speicher({ kein: "array" })), []);
  assert.deepEqual(raumEintraege({ getItem: () => "{kaputt" }), []);
  assert.equal(raumEintraege(speicher(Array.from({ length: MAX_RAEUME + 5 }, (_, i) => `r${i}`))).length, MAX_RAEUME);
  assert.equal(kennungVon(ADRESSE), "werkstatt-ab12cd");
  assert.equal(kennungVon("werkstatt-ab12cd"), "werkstatt-ab12cd");
  assert.equal(kennungVon("mls:gruppe"), null);
  assert.equal(kennungVon(`34700:${"g".repeat(64)}:space:x`), null, "keine Adresse, keine Kennung");
  assert.ok(istAdresse(ADRESSE));
  assert.ok(!istAdresse("werkstatt-ab12cd"));
});

test("B-7: Beitreten – eine Adresse ersetzt die alte Kennung desselben Raums, Ungültiges ändert nichts", () => {
  const s = speicher(["werkstatt-ab12cd", "anderer"]);
  assert.equal(beitreten(s, `  ${ADRESSE}  `), ADRESSE);
  assert.deepEqual(s.liste(), ["anderer", ADRESSE]);
  assert.equal(beitreten(s, ADRESSE), ADRESSE, "zweimal beitreten");
  assert.deepEqual(s.liste(), ["anderer", ADRESSE]);
  assert.equal(beitreten(s, "neu-raum"), "neu-raum");
  assert.deepEqual(s.liste(), ["anderer", ADRESSE, "neu-raum"]);
  assert.equal(beitreten(s, "mls:gruppe"), null, "private Räume nie in freedom.spaces");
  assert.equal(beitreten(s, "kein raum"), null);
  assert.deepEqual(s.liste(), ["anderer", ADRESSE, "neu-raum"]);
});

test("B-7: Binden – die Kennung wird an ihrer Stelle zur Adresse, doppelt bleibt einmal", () => {
  const s = speicher(["a", "werkstatt-ab12cd", "b"]);
  assert.equal(bindeKennung(s, "werkstatt-ab12cd", GRUENDER.pk), ADRESSE);
  assert.deepEqual(s.liste(), ["a", ADRESSE, "b"]);
  const d = speicher([ADRESSE, "werkstatt-ab12cd"]);
  bindeKennung(d, "werkstatt-ab12cd", GRUENDER.pk);
  assert.deepEqual(d.liste(), [ADRESSE]);
  const leer = speicher();
  bindeKennung(leer, "werkstatt-ab12cd", GRUENDER.pk);
  assert.deepEqual(leer.liste(), [ADRESSE]);
});

test("B-7: Übernahme – mit der gemerkten Adresse bleibt der Raum beim Gründer, eine bloße Kennung wird dann mehrdeutig", () => {
  const kanaele = [{ id: "allgemein", name: "allgemein", privacy: "offen" as const, writeRoles: [], position: 0 }];
  const echt = signEvent(buildSpace({ spaceId: "werkstatt-ab12cd", name: "Werkstatt", ownerPubkey: GRUENDER.pk, channels: kanaele }, 1_800_000_000), GRUENDER.sk);
  const rollen = signEvent(buildRoles("werkstatt-ab12cd", GRUENDER.pk, [{ id: "mod", name: "Moderator", rank: 50, permissions: ["moderieren"] }], 1_800_000_000), GRUENDER.sk);
  const s = speicher(["werkstatt-ab12cd"]);
  // Erstes Laden: eindeutig → gebunden
  const g = gruenderZurKennung("werkstatt-ab12cd", [echt, rollen]);
  assert.ok("besitzer" in g);
  const adresse = bindeKennung(s, "werkstatt-ab12cd", g.besitzer);
  // Später schreibt ein Fremder eine neuere Definition derselben Kennung
  const uebernahme = signEvent(buildSpace({ spaceId: "werkstatt-ab12cd", name: "Übernommen", ownerPubkey: FREMD.pk, channels: kanaele }, 1_800_000_900), FREMD.sk);
  const z = raumZustandFuer(adresse, [echt, rollen, uebernahme]);
  assert.equal(z?.space?.name, "Werkstatt");
  assert.equal(z?.ownerPubkey, GRUENDER.pk);
  // Wer jetzt erst mit der bloßen Kennung beitritt, bekommt keinen Gründer untergeschoben
  assert.deepEqual(gruenderZurKennung("werkstatt-ab12cd", [echt, rollen, uebernahme]), { fall: "mehrdeutig" });
});

test("B-7: verdrahtet – Raum nur aus der Adresse, Kennung nur eindeutig gebunden, Anlegen gibt die Adresse weiter", () => {
  const raeume = readFileSync(new URL("../src/shell/tabs/raeume.ts", import.meta.url), "utf8");
  assert.doesNotMatch(raeume, /buildSpaceState\(/, "nie die neueste Definition von irgendwem");
  const oeffne = raeume.slice(raeume.indexOf("async function oeffneRaum("), raeume.indexOf("function zeigeRaumArt("));
  assert.match(oeffne, /"#space": \[kennung\]/);
  assert.match(oeffne, /const g = gruenderZurKennung\(kennung, struktur, state\.keypair\?\.pk\);\s*if \(!\("besitzer" in g\)\) \{/);
  assert.ok(oeffne.indexOf("gruenderZurKennung(") < oeffne.indexOf("bindeKennung(localStorage, kennung, g.besitzer)"));
  assert.match(oeffne, /spacesUi\.state = raumZustandFuer\(adresse, struktur\) \?\? null;/);
  const anlegen = raeume.slice(raeume.indexOf("async function legeRaumAn"), raeume.indexOf("/** Name eines Kontakts"));
  assert.match(anlegen, /const adresse = raumAdresse\(state\.keypair\.pk, spaceId\);\s*raumBeitreten\(adresse\);/);
  assert.match(anlegen, /\{ art: "qr", name: "qr", label: t\("komm\.raumAdresseQr"\), wert: adresse \}/);
  const beitritt = raeume.slice(raeume.indexOf("if (join) join.onclick"), raeume.indexOf("// Mobil (C.2b2)"));
  assert.match(beitritt, /scannen: true/);
  // Tags tragen die Kennung, nie die Adresse
  assert.match(raeume, /const kennung = offeneKennung\(\);\s*if \(!state\.keypair \|\| !spacesUi\.spaceId \|\| !kennung\) return;/, "Moderieren nur mit Kennung");
  for (const stelle of ["spaceId: offeneKennung()!,", "buildRoleGrant(\n        kennung,", "buildHide(kennung,", "buildBan(kennung,", "buildRoleGrant(kennung, ich, pk,", "buildRoles(kennung, ich,"]) {
    assert.ok(raeume.includes(stelle), stelle);
  }
  // Vom Repo in den Raum: mit der ganzen Adresse, nicht nur der Kennung
  assert.match(raeume, /leseRaumAdresse\(k\.repo\?\.raum \?\? ""\) \? k\.repo!\.raum! : undefined;/);
});
