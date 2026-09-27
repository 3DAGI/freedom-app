/**
 * Schritt 8.4c: Relay-Zugang in der App kaufen – Preis aus NIP-11, Angebot vor
 * dem Zahlen geprüft, bezahlt über die Zahlschienen (SOL mit Referenz), vom
 * Relay bestätigt; anmelden (NIP-42) nur bei eigenen und gekauften Relays.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { generateKeypair, solReferenz, zahle, type Beleg, type Zahlanfrage } from "@freedomstack/protocol";
import { kaufeRelayZugang, leseRelayPreise, merkeZugang, pruefeAngebot, zugaenge, type RelayPreise } from "../src/relay-kauf.js";
import { SolanaRail } from "../src/rails.js";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";

const RELAY = "wss://relay.example";
const ich = generateKeypair().pk;
const ADRESSE = solReferenz(new Uint8Array(32).fill(5));
const antwort = (daten: unknown, status = 200) => new Response(JSON.stringify(daten), { status, headers: { "Content-Type": "application/json" } });
const info = (extra: Record<string, unknown> = {}) => ({
  pubkey: "ab".repeat(32),
  limitation: { payment_required: true },
  fees: { subscription: [{ amount: 1_000_000, unit: "msat", period: 30 * 86400 }, { amount: 5_000_000, unit: "lamports", period: 30 * 86400 }] },
  payments_url: "https://relay.example/zugang",
  freedom: { umschlaege_nur_an_angemeldete: true },
  ...extra,
});
const PREISE: RelayPreise = { tage: 30, msat: 1_000_000, lamports: 5_000_000, kaufUrl: "https://relay.example/zugang", beschraenkt: true, umschlaegeGeschuetzt: true };

test("8.4c: Preise aus NIP-11 – nur mit Kaufadresse beim Relay selbst und einem Zeitraum", async () => {
  const f = (d: unknown) => (async () => antwort(d)) as unknown as typeof fetch;
  assert.deepEqual(await leseRelayPreise(RELAY, f(info())), PREISE);
  assert.equal(await leseRelayPreise(RELAY, f(info({ payments_url: "https://fremd.example/zugang" }))), null, "fremde Kaufadresse bekäme Schlüssel und Geld");
  assert.equal(await leseRelayPreise(RELAY, f(info({ fees: {} }))), null, "verkauft nichts");
  assert.equal(await leseRelayPreise(RELAY, f(info({ fees: { subscription: [{ amount: 1, unit: "msat", period: 86400 }, { amount: 1, unit: "lamports", period: 7 * 86400 }] } }))), null, "zwei Zeiträume");
  assert.equal(await leseRelayPreise("https://kein.relay", f(info())), null);
  const nurSol = await leseRelayPreise(RELAY, f(info({ fees: { subscription: [{ amount: 7, unit: "lamports", period: 86400 }, { amount: -1, unit: "msat", period: 86400 }] } })));
  assert.deepEqual([nurSol?.msat, nurSol?.lamports, nurSol?.tage], [undefined, 7, 1]);
});

test("8.4c: Angebot vor dem Zahlen geprüft – eigener Schlüssel, angekündigter Preis, Rechnung auf genau diesen Betrag", () => {
  const sk = knotenSchluessel();
  const pre = randomBytes(32);
  const bolt11 = rechnung(sk, "lnbc10u", pre);
  const hash = createHash("sha256").update(pre).digest("hex");
  const ln = { id: "a".repeat(32), pubkey: ich, schiene: "lightning", sats: 1000, bolt11, hash };
  assert.deepEqual(pruefeAngebot(ln, { pubkey: ich, schiene: "lightning", preise: PREISE }),
    { id: "a".repeat(32), ziel: bolt11, betrag: { einheit: "msat", wert: 1_000_000 }, zweck: "relay", notiz: "Relay-Zugang" });
  const faelle: [Record<string, unknown>, RegExp][] = [
    [{ ...ln, pubkey: generateKeypair().pk }, /passt nicht/],
    [{ ...ln, sats: 999 }, /anderen Preis/],
    [{ ...ln, bolt11: rechnung(sk, "lnbc20u", pre) }, /anderen Betrag/],
    [{ ...ln, hash: "00".repeat(32) }, /anderen Betrag/],
    [{ ...ln, schiene: "solana" }, /passt nicht/],
  ];
  for (const [a, grund] of faelle) assert.throws(() => pruefeAngebot(a, { pubkey: ich, schiene: "lightning", preise: PREISE }), grund);
  const ref = solReferenz(randomBytes(32));
  const sol = { id: "b".repeat(32), pubkey: ich, schiene: "solana", lamports: 5_000_000, adresse: ADRESSE, referenz: ref };
  assert.deepEqual(pruefeAngebot(sol, { pubkey: ich, schiene: "solana", preise: PREISE }),
    { id: "b".repeat(32), ziel: ADRESSE, betrag: { einheit: "lamports", wert: 5_000_000 }, zweck: "relay", referenz: ref });
  assert.throws(() => pruefeAngebot({ ...sol, lamports: 6_000_000 }, { pubkey: ich, schiene: "solana", preise: PREISE }), /anderen Preis/);
  assert.throws(() => pruefeAngebot({ ...sol, referenz: "kaputt" }, { pubkey: ich, schiene: "solana", preise: PREISE }), /Referenz/);
});

test("8.4c: Kauf mit SOL – Angebot vor dem Zahlen gemerkt, Referenz in der Zahlung, Signatur an den Relay; bestätigt heißt Zugang", async () => {
  const ref = solReferenz(randomBytes(32));
  const gesendet: [string, unknown][] = [];
  let bestaetigt = false;
  const f = (async (url: string, o: RequestInit) => {
    gesendet.push([url, JSON.parse(String(o.body))]);
    if (url === PREISE.kaufUrl) return antwort({ id: "c".repeat(32), pubkey: ich, schiene: "solana", lamports: 5_000_000, adresse: ADRESSE, referenz: ref });
    return antwort(bestaetigt ? { bezahlt: true, bis: 1_900_000_000 } : { bezahlt: false, grund: "Überweisung noch nicht bestätigt" });
  }) as unknown as typeof fetch;
  const speicher = new Map<string, string>();
  const ls = { getItem: (k: string) => speicher.get(k) ?? null, setItem: (k: string, v: string) => void speicher.set(k, v) };
  const reihenfolge: string[] = [];
  const zahlung = async (a: Zahlanfrage): Promise<Beleg> => {
    reihenfolge.push(`zahle ${a.referenz}`);
    assert.ok(zugaenge(ls)[RELAY]?.offen, "vor dem Zahlen gemerkt");
    return { rail: "solana", ziel: a.ziel, betrag: a.betrag, ref: "5".repeat(88), zeit: 1 };
  };
  const erst = await kaufeRelayZugang({
    relay: RELAY, schiene: "solana", pubkey: ich, preise: PREISE, zahle: zahlung,
    merke: (z) => { reihenfolge.push("merke"); merkeZugang(ls, RELAY, z); }, f, warte: async () => {},
  });
  assert.equal(erst, null, "Relay bestätigt noch nicht");
  assert.deepEqual(reihenfolge.slice(0, 2), ["merke", `zahle ${ref}`]);
  assert.deepEqual(zugaenge(ls)[RELAY], { offen: { id: "c".repeat(32), kaufUrl: PREISE.kaufUrl, signatur: "5".repeat(88) } }, "bezahlt ist bezahlt – gemerkt zum erneuten Prüfen");
  assert.deepEqual(gesendet[1], [`${PREISE.kaufUrl}/${"c".repeat(32)}`, { signatur: "5".repeat(88) }]);
  bestaetigt = true;
  const { pruefeBeimRelay } = await import("../src/relay-kauf.js");
  assert.deepEqual(await pruefeBeimRelay(zugaenge(ls)[RELAY]!.offen!, { f, versuche: 1 }), { bis: 1_900_000_000 });
});

test("8.4c: SolanaRail nimmt die Referenz in die Überweisung; eine Referenz gibt es nur für SOL", async () => {
  const gebaut: unknown[][] = [];
  const rail = new SolanaRail({
    wallet: () => ({ adresse: solReferenz(new Uint8Array(32).fill(9)), signiereUndSende: async () => "4".repeat(88) }),
    baueUeberweisung: async (...x) => { gebaut.push(x); return {}; },
  });
  const ref = solReferenz(randomBytes(32));
  await zahle([rail], { ziel: ADRESSE, betrag: { einheit: "lamports", wert: 7 }, zweck: "relay", referenz: ref });
  assert.equal(gebaut[0]![3], ref);
  await assert.rejects(zahle([rail], { ziel: ADRESSE, betrag: { einheit: "lamports", wert: 7 }, zweck: "relay", referenz: "kaputt" }), /Referenz/);
});

test("8.4c: Verdrahtung – anmelden nur bei eigenen und gekauften Relays über den Signer; Kauf über die Zahlschienen; Referenz im Transfer", () => {
  const q = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const state = q("../src/shell/state.ts");
  assert.match(state, /return \[\.\.\.ladeEigeneRelays\(localStorage\), \.\.\.Object\.keys\(zugaenge\(localStorage\)\)\]\.some/);
  assert.match(state, /anmelden: async \(u, challenge\) => \(state\.keypair && darfAnmelden\(u\) \? signiere\(baueRelayAuth\(state\.keypair\.pk, u, challenge\)\) : null\)/);
  assert.match(state, /const relays = urls\.map\(\(url\) => relayVerbindung\(url, \{ timeoutMs: 8000 \}\)\);/);
  assert.doesNotMatch(state, /kiSitzungen[^\n]*baueRelayAuth|baueRelayAuth[^\n]*kiSitzungen/, "nie mit einem Sitzungsschlüssel");
  const settings = q("../src/shell/tabs/settings.ts");
  assert.match(settings, /zahle: \(a\) => zahle\(zahlschienen\(\), a\),/);
  assert.match(settings, /merke: \(z\) => merkeZugang\(localStorage, url, z\),/);
  assert.match(q("../src/sol-transfer.ts"), /if \(referenz\) ueberweisung\.keys\.push\(\{ pubkey: new web3\.PublicKey\(referenz\), isSigner: false, isWritable: false \}\);/);
  assert.match(q("../src/shell/index.html"), /id="relay-zugang-karte"/);
});
