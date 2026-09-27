/**
 * Schritt 8.4a: Regeln der Relay-Rolle – Anmeldung (NIP-42), Annahme mit
 * Zugang, Umschläge nur an Angemeldete, Aufbewahrung (NIP-01/40), NIP-11.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ablaufVon, baueRelayInfo, brauchtAnmeldung, buildEvent, darfAusliefern, ersetzSchluessel, generateKeypair, istFluechtig, istNeuer,
  pruefeRelayAuth, pruefeSolUeberweisung, relayHost, relayNimmtAn, signEvent, solReferenz, type NostrEvent,
} from "../src/index.js";

const T0 = 1_800_000_000;
const kp = generateKeypair();
const ev = (kind: number, tags: string[][] = [], zeit = T0, k = kp): NostrEvent => signEvent(buildEvent(k.pk, kind, tags, "", zeit), k.sk);
const anmeldung = (tags: string[][], zeit = T0) => ev(22242, tags, zeit);
const ERWARTET = { challenge: "c".repeat(32), hosts: ["relay.example:7777"], jetzt: T0 };

test("8.4a: pruefeRelayAuth – nur Kind 22242, gültig signiert, dieselbe Challenge, dieser Relay, Zeit im Fenster", () => {
  const gut = anmeldung([["relay", "wss://Relay.Example:7777/"], ["challenge", ERWARTET.challenge]]);
  assert.deepEqual(pruefeRelayAuth(gut, ERWARTET), { ok: true, pubkey: kp.pk });
  const faelle: [unknown, RegExp][] = [
    [ev(1, [["relay", "wss://relay.example:7777"], ["challenge", ERWARTET.challenge]]), /Kind 22242/],
    [{ ...gut, content: "anders" }, /Signatur/],
    [anmeldung([["relay", "wss://relay.example:7777"], ["challenge", "d".repeat(32)]]), /Challenge/],
    [anmeldung([["relay", "wss://relay.example:7777"]]), /Challenge/],
    [anmeldung([["relay", "wss://relay.example"], ["challenge", ERWARTET.challenge]]), /anderen Relay/],
    [anmeldung([["relay", "https://relay.example:7777"], ["challenge", ERWARTET.challenge]]), /anderen Relay/],
    [anmeldung([["relay", "wss://relay.example:7777"], ["challenge", ERWARTET.challenge]], T0 + 601), /Fenster/],
    ["kein event", /Kind 22242/],
  ];
  for (const [e, grund] of faelle) {
    const r = pruefeRelayAuth(e, ERWARTET);
    assert.equal(r.ok, false);
    assert.match((r as { grund: string }).grund, grund);
  }
  assert.equal(pruefeRelayAuth(gut, { ...ERWARTET, challenge: "" }).ok, false, "ohne Challenge keine Anmeldung");
  assert.equal(relayHost("ftp://x"), null);
  assert.equal(relayHost("kaputt"), null);
});

test("8.4a: relayNimmtAn – offen alles außer Anmeldungen; beschränkt vom oder an Zugang", () => {
  const mitZugang = generateKeypair();
  const regel = { beschraenkt: true, hatZugang: (pk: string) => pk === mitZugang.pk };
  assert.equal(relayNimmtAn(ev(1), { beschraenkt: false, hatZugang: () => false }).ok, true);
  assert.equal(relayNimmtAn(ev(22242), { beschraenkt: false, hatZugang: () => true }).ok, false);
  assert.equal(relayNimmtAn(ev(1, [], T0, mitZugang), regel).ok, true);
  assert.equal(relayNimmtAn(ev(1059, [["p", mitZugang.pk]]), regel).ok, true);
  const nein = relayNimmtAn(ev(1059, [["p", kp.pk]]), regel);
  assert.equal(nein.ok, false);
  assert.match((nein as { grund: string }).grund, /^restricted:/);
});

test("8.4a: Umschläge nur an Angemeldete – ausliefern und nachfragen", () => {
  const bob = generateKeypair().pk;
  const u = ev(1059, [["p", bob]]);
  assert.equal(darfAusliefern(u, new Set(), true), false);
  assert.equal(darfAusliefern(u, new Set([bob]), true), true);
  assert.equal(darfAusliefern(u, new Set(), false), true, "ungeschützt wie bisher");
  assert.equal(darfAusliefern(ev(1, [["p", bob]]), new Set(), true), true, "nur Umschläge sind geschützt");
  assert.equal(brauchtAnmeldung({ kinds: [1059], "#p": [bob] }, new Set(), true), true);
  assert.equal(brauchtAnmeldung({ kinds: [1059] }, new Set([bob]), true), true, "alle Umschläge – nie");
  assert.equal(brauchtAnmeldung({ kinds: [1059], "#p": [bob] }, new Set([bob]), true), false);
  assert.equal(brauchtAnmeldung({ kinds: [1] }, new Set(), true), false);
  assert.equal(brauchtAnmeldung({}, new Set(), true), false, "ohne kinds: gefiltert statt abgewiesen");
  assert.equal(brauchtAnmeldung({ kinds: [1059] }, new Set(), false), false);
});

test("8.4a: Aufbewahrung – Ablauf (NIP-40), flüchtig, ersetzbar, neuere Fassung", () => {
  assert.equal(ablaufVon(ev(1, [["expiration", String(T0)]])), T0);
  assert.equal(ablaufVon(ev(1, [["expiration", "bald"]])), null);
  assert.equal(ablaufVon(ev(1)), null);
  assert.ok(istFluechtig(24133) && istFluechtig(20000) && !istFluechtig(30000) && !istFluechtig(1059));
  assert.equal(ersetzSchluessel(ev(0)), `0:${kp.pk}`);
  assert.equal(ersetzSchluessel(ev(10050)), `10050:${kp.pk}`);
  assert.equal(ersetzSchluessel(ev(30078, [["d", "x"]])), `30078:${kp.pk}:x`);
  assert.equal(ersetzSchluessel(ev(30078)), `30078:${kp.pk}:`);
  assert.equal(ersetzSchluessel(ev(1)), null);
  assert.equal(ersetzSchluessel(ev(1059)), null);
  const [a, b] = [ev(10002, [], T0), ev(10002, [], T0 + 1)];
  assert.ok(istNeuer(b, a) && !istNeuer(a, b));
  const [x, y] = [ev(10002, [["a", "1"]], T0), ev(10002, [["a", "2"]], T0)];
  assert.equal(istNeuer(x, y), x.id < y.id, "gleiche Zeit: die kleinere Id");
});

test("8.4a: NIP-11 nennt Schlüssel, NIPs, Grenzen und ob Umschläge geschützt sind", () => {
  const info = baueRelayInfo({
    name: "n", beschreibung: "b", pubkey: kp.pk, maxNachricht: 1000, aufbewahrungTage: 30, beschraenkt: false, umschlaegeGeschuetzt: true,
  }) as { pubkey: string; supported_nips: number[]; limitation: Record<string, unknown>; retention: { time: number }[]; freedom: Record<string, unknown> };
  assert.equal(info.pubkey, kp.pk);
  assert.deepEqual(info.supported_nips, [1, 11, 40, 42]);
  assert.deepEqual(info.limitation, { max_message_length: 1000, auth_required: false, payment_required: false, restricted_writes: false });
  assert.equal(info.retention[0].time, 30 * 86400);
  assert.equal(info.freedom.umschlaege_nur_an_angemeldete, true);
});

test("8.4b: NIP-11 nennt Preise je Schiene und die Kaufadresse – nur für eingerichtete Schienen", () => {
  const basis = { name: "n", beschreibung: "b", pubkey: kp.pk, maxNachricht: 1, aufbewahrungTage: 1, beschraenkt: true, umschlaegeGeschuetzt: true };
  const info = baueRelayInfo({ ...basis, kauf: { tage: 30, msat: 1_000_000, lamports: 5_000_000, url: "https://relay.example/zugang" } }) as {
    fees: { subscription: { amount: number; unit: string; period: number }[] }; payments_url: string;
  };
  assert.deepEqual(info.fees.subscription, [
    { amount: 1_000_000, unit: "msat", period: 30 * 86400 }, { amount: 5_000_000, unit: "lamports", period: 30 * 86400 },
  ]);
  assert.equal(info.payments_url, "https://relay.example/zugang");
  const nurSol = baueRelayInfo({ ...basis, kauf: { tage: 7, lamports: 1, url: "u" } }) as { fees: { subscription: { unit: string }[] } };
  assert.deepEqual(nurSol.fees.subscription.map((f) => f.unit), ["lamports"]);
  assert.equal("fees" in baueRelayInfo(basis), false);
});

test("8.4b: Solana-Pay-Referenz – 32 Zufallsbytes als Adresse; die Überweisung muss sie nennen", () => {
  const ref = solReferenz(new Uint8Array(32).fill(7));
  assert.match(ref, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.throws(() => solReferenz(new Uint8Array(31)));
  const an = solReferenz(new Uint8Array(32).fill(1));
  const tx = (konten: unknown[]) => ({ meta: { err: null }, transaction: { message: {
    accountKeys: konten,
    instructions: [{ program: "system", parsed: { type: "transfer", info: { source: "x", destination: an, lamports: 500 } } }],
  } } });
  assert.deepEqual(pruefeSolUeberweisung(tx([{ pubkey: "x" }, { pubkey: an }, { pubkey: ref }]), { an, lamports: 500, referenz: ref }), { status: "belegt" });
  assert.deepEqual(pruefeSolUeberweisung(tx(["x", an, ref]), { an, lamports: 500, referenz: ref }), { status: "belegt" });
  const ohne = pruefeSolUeberweisung(tx([{ pubkey: "x" }, { pubkey: an }]), { an, lamports: 500, referenz: ref });
  assert.equal(ohne.status, "falsch");
  assert.match((ohne as { grund: string }).grund, /Referenz fehlt/);
  assert.deepEqual(pruefeSolUeberweisung(tx([]), { an, lamports: 500 }), { status: "belegt" }, "ohne Referenz wie bisher");
});
