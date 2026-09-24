/**
 * Tests fuer Profil und Abzeichen.
 *
 * Ein Profil ist Freitext und eine fremde Bildadresse, die jeder Client
 * anzeigt — also genau die Stelle, an der ein boesartiges Profil dem
 * Betrachter schadet. Der Schwerpunkt liegt entsprechend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  buildProfile, parseProfileSafe, normalizeStyle, inspectPicture, inspectAbout,
  profileDisclosure, ACCENTS, ACCENT_HEX, DEFAULT_STYLE,
} from "../src/profile.js";
import {
  buildBadgeDefinition, parseBadgeDefinition, buildBadgeAward, collectBadges,
  badgeSourceLabel, KIND_BADGE_DEFINITION, KIND_BADGE_AWARD,
} from "../src/badges.js";
import { KIND_PROFILE } from "../src/kinds.js";

const ICH = generateKeypair();
const AUSSTELLER = generateKeypair();
const FREMD = generateKeypair();

// ------------------------------------------------------------- Profil

test("Profil: Roundtrip mit Aussehen", () => {
  const ev = signEvent(buildProfile(ICH.pk, {
    name: "Max", about: "Baut Dinge.", lud16: "max@wallet.cash",
    freedom_style: { accent: "tinte", layout: "karte", pattern: "raster" },
  }), ICH.sk);
  const p = parseProfileSafe(ev);
  assert.equal(p.name, "Max");
  assert.equal(p.style.accent, "tinte");
  assert.equal(p.style.layout, "karte");
});

test("Kaputtes Profil stuerzt den Betrachter nicht ab", () => {
  // Ein boesartiges fremdes Profil ist kein Fehler dessen, der es ansieht.
  const ev = signEvent(buildEvent(FREMD.pk, KIND_PROFILE, [], "{kein json"), FREMD.sk);
  const p = parseProfileSafe(ev);
  assert.equal(p.name, undefined);
  assert.deepEqual(p.style, DEFAULT_STYLE);
});

test("Erfundene Aussehen-Werte fallen auf die Voreinstellung zurueck", () => {
  // Liesse man sie durch, bestimmte ein fremdes Profil, was im Browser des
  // Betrachters gerendert wird.
  const s = normalizeStyle({ accent: "url(javascript:alert(1))", layout: 42, pattern: null });
  assert.deepEqual(s, DEFAULT_STYLE);
});

test("Jeder erlaubte Akzent hat einen Farbwert", () => {
  for (const a of ACCENTS) assert.match(ACCENT_HEX[a], /^#[0-9A-Fa-f]{6}$/);
});

test("Bilder: eigenes Netz ist der gute Fall", () => {
  const b = inspectPicture("freedom-blob:abc123");
  assert.equal(b.ok, true);
  assert.equal(b.kind, "blob");
  assert.equal(b.warning, undefined);
});

test("Fremde https-Bilder werden zugelassen UND gekennzeichnet", () => {
  // Wer das Bild dort ablegt, sieht die IP jedes Betrachters.
  const b = inspectPicture("https://fremd.example/bild.png");
  assert.equal(b.ok, true);
  assert.equal(b.kind, "extern");
  assert.match(b.warning!, /IP-Adresse aller/);
});

test("Gefaehrliche Bildadressen werden abgelehnt", () => {
  for (const url of [
    "javascript:alert(1)", "data:text/html,<script>", "http://unverschluesselt/x.png",
    "java\nscript:alert(1)", "file:///etc/passwd",
  ]) {
    assert.equal(inspectPicture(url).ok, false, url);
  }
});

test("Abgelehnte Bilder werden weggelassen, nicht durchgereicht", () => {
  const ev = signEvent(buildProfile(FREMD.pk, { picture: "javascript:alert(1)" }), FREMD.sk);
  assert.equal(parseProfileSafe(ev).picture, undefined);
});

test("Beschreibung: unsichtbare Zeichen raus, Laenge begrenzt", () => {
  const a = inspectAbout("Hallo\u200B\u200BWelt");
  assert.equal(a.clean, "HalloWelt");

  const lang = inspectAbout("x".repeat(900));
  assert.equal(lang.clean.length, 500);
  assert.equal(lang.truncated, true);
});

test("Offenlegung sagt VOR dem Speichern, was preisgegeben wird", () => {
  const z = profileDisclosure({
    name: "Max", about: "Text", lud16: "max@w.cash",
    picture: "https://fremd.example/x.png", chains: { solana: "So111" },
  });
  assert.ok(z.some((x) => /IP-Adresse/.test(x)));
  assert.ok(z.some((x) => /Lightning-Adresse ist öffentlich/.test(x)));
  // Die Solana-Historie ist das, woran am wenigsten gedacht wird.
  assert.ok(z.some((x) => /gesamten Historie/.test(x)));
});

test("Leeres Profil wird nicht als Versaeumnis dargestellt", () => {
  const z = profileDisclosure({});
  assert.match(z[0], /gültige Wahl/);
});

// ------------------------------------------------------------- Abzeichen

const definition = (kp: typeof ICH, id: string) =>
  signEvent(buildBadgeDefinition({
    id, name: `Abzeichen ${id}`, description: "Beschreibung", issuerPubkey: kp.pk,
  }), kp.sk);

const verleihung = (von: typeof ICH, id: string, an: string[], at = 1000) =>
  signEvent(buildBadgeAward(id, von.pk, an, at), von.sk);

test("Abzeichen: Roundtrip", () => {
  const d = parseBadgeDefinition(definition(AUSSTELLER, "gruender"));
  assert.equal(d.id, "gruender");
  assert.equal(d.issuerPubkey, AUSSTELLER.pk);
});

test("Verdiente Abzeichen stehen oben", () => {
  // Sie sind die einzigen, die ohne Vertrauen gelten.
  const b = collectBadges(ICH.pk,
    [definition(AUSSTELLER, "x"), verleihung(AUSSTELLER, "x", [ICH.pk])],
    [{ id: "monat", name: "Ein Monat Provider", description: "", basis: "30 aktive Tage" }]);
  assert.equal(b[0].source, "verdient");
  assert.equal(b[1].source, "verliehen");
});

test("Selbstvergebene werden gezeigt — aber als solche", () => {
  // Verstecken waere bevormundend, gleich aussehen lassen irrefuehrend.
  const b = collectBadges(ICH.pk, [definition(ICH, "der_beste"), verleihung(ICH, "der_beste", [ICH.pk])]);
  assert.equal(b.length, 1);
  assert.equal(b[0].source, "selbst");
  assert.match(badgeSourceLabel(b[0]), /sagt nichts/);
});

test("Fremde koennen sich kein fremdes Abzeichen verleihen", () => {
  // Der echte Angriff: FREMD signiert mit SEINEM Schluessel eine Verleihung,
  // deren a-Tag auf die Definition des AUSSTELLERS zeigt. Die Signatur ist
  // gueltig — nur der Aussteller stimmt nicht. Ohne diese Pruefung vergibt
  // sich jeder die Abzeichen aller anderen.
  const angriff = signEvent(
    buildEvent(FREMD.pk, KIND_BADGE_AWARD,
      [["a", `${KIND_BADGE_DEFINITION}:${AUSSTELLER.pk}:gruender`], ["p", FREMD.pk]], ""),
    FREMD.sk,
  );
  const b = collectBadges(FREMD.pk, [definition(AUSSTELLER, "gruender"), angriff]);
  assert.equal(b.length, 0, "nur der Aussteller selbst darf verleihen");
});

test("Verleihung ohne Definition zaehlt nicht", () => {
  const b = collectBadges(ICH.pk, [verleihung(AUSSTELLER, "gibtesnicht", [ICH.pk])]);
  assert.equal(b.length, 0);
});

test("Dasselbe Abzeichen zaehlt einmal", () => {
  const b = collectBadges(ICH.pk, [
    definition(AUSSTELLER, "x"),
    verleihung(AUSSTELLER, "x", [ICH.pk], 1000),
    verleihung(AUSSTELLER, "x", [ICH.pk], 2000),
  ]);
  assert.equal(b.length, 1);
});

test("Abzeichen anderer Leute tauchen bei mir nicht auf", () => {
  const b = collectBadges(ICH.pk, [definition(AUSSTELLER, "x"), verleihung(AUSSTELLER, "x", [FREMD.pk])]);
  assert.equal(b.length, 0);
});

test("Abzeichenbilder unterliegen denselben Regeln", () => {
  const ev = signEvent(buildBadgeDefinition({
    id: "boese", name: "X", description: "", image: "javascript:alert(1)",
    issuerPubkey: AUSSTELLER.pk,
  }), AUSSTELLER.sk);
  assert.equal(parseBadgeDefinition(ev).image, undefined);
});

test("Herkunft steht in der Anzeige, nicht in einem Hilfetext", () => {
  const verdient = collectBadges(ICH.pk, [],
    [{ id: "m", name: "M", description: "", basis: "30 aktive Tage" }])[0];
  assert.match(badgeSourceLabel(verdient), /30 aktive Tage/);
});

test("Kaputte Definition wird uebersprungen, nicht geworfen", () => {
  const ohneId = signEvent(buildEvent(AUSSTELLER.pk, KIND_BADGE_DEFINITION, [["name", "X"]], ""), AUSSTELLER.sk);
  assert.doesNotThrow(() => collectBadges(ICH.pk, [ohneId]));
});
