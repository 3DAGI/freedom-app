/**
 * Schritt 5.1.4b: die öffentliche Nennung des Werbers (Kind 38052) – nach
 * Gebührenmodell A+ nur noch eine Statistik, keine Grundlage für Geld. Geprüft
 * wird, dass sich niemand Geworbene erschleichen kann: nur der Geworbene
 * selbst nennt, nur gültige Signaturen zählen, je Geworbenem die früheste
 * Angabe, keine Selbstwerbung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, generateKeypair, signEvent } from "../src/event.js";
import { KIND_REFERRAL_CLAIM, buildReferralClaim, parseReferralClaim, zaehleNennungen } from "../src/werbe-nennung.js";

const NOW = 1_800_000_000;
const [werber, anderer, g1, g2, g3] = Array.from({ length: 5 }, () => generateKeypair());
const nennung = (geworben: typeof werber, von: string, at = NOW) =>
  signEvent(buildReferralClaim(geworben.pk, von, at), geworben.sk);

test("Nennung: Selbstwerbung abgelehnt, Roundtrip, Unsinn verworfen", () => {
  assert.throws(() => buildReferralClaim(werber.pk, werber.pk), /Selbstwerbung/);
  const ev = nennung(g1, werber.pk);
  assert.equal(ev.kind, KIND_REFERRAL_CLAIM);
  assert.deepEqual(parseReferralClaim(ev), { referredPubkey: g1.pk, referrerPubkey: werber.pk, createdAt: NOW });
  const ohne = signEvent(buildEvent(g1.pk, KIND_REFERRAL_CLAIM, [["d", "referral"]], ""), g1.sk);
  assert.throws(() => parseReferralClaim(ohne), /ohne gültigen referrer/);
  assert.throws(() => parseReferralClaim(signEvent(buildEvent(g1.pk, 1, [], ""), g1.sk)), /kein Referral-Claim/);
});

test("Zählen: je Geworbenem einmal, die früheste Angabe gilt", () => {
  const claims = [
    nennung(g1, werber.pk, NOW - 100),
    nennung(g1, werber.pk, NOW - 50), // dieselbe Person noch einmal
    nennung(g2, anderer.pk, NOW - 200),
    nennung(g2, werber.pk, NOW - 10), // späterer Wechsel zählt nicht
    nennung(g3, werber.pk, NOW - 300),
  ];
  assert.equal(zaehleNennungen(claims, werber.pk), 2);
  assert.equal(zaehleNennungen(claims, anderer.pk), 1);
  assert.equal(zaehleNennungen([], werber.pk), 0);
});

test("Zählen: Fälschungen zählen nicht – nur der Geworbene kann sich als geworben nennen", () => {
  const echt = nennung(g1, werber.pk);
  // Der Werber trägt einen fremden Schlüssel als Autor ein: Signatur passt nicht
  const untergeschoben = { ...signEvent(buildReferralClaim(g2.pk, werber.pk, NOW), werber.sk), pubkey: g2.pk };
  const veraendert = { ...nennung(g3, anderer.pk), tags: [["d", "referral"], ["referrer", werber.pk], ["p", werber.pk]] };
  assert.equal(zaehleNennungen([echt, untergeschoben, veraendert], werber.pk), 1);
});
