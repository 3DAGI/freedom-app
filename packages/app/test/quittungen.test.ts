/**
 * Schritt 5.5b: Quittungen in der App – nur im Tresor, angelegt in
 * `handleAnswer()` (Lightning nach der Zahlung, Zahlkanal nach
 * `kanalAntwort()`), und Rang und Stufe nur aus Quittungen. Abnahme:
 * gefälschte Leistungs-Events (38010) ohne Quittung ändern Stufe und Rang nicht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  KIND_PERFORMANCE, KIND_PROVIDER_CAPABILITIES, SICHERUNG_NIE, berechneRuf, buildCapabilities, buildPerformanceEvent, generateKeypair,
  kanalQuittung, lightningQuittung, signEvent, waehleSicherung, type NostrEvent, type OutboxPool, type ProviderTier, type Quittung,
} from "@freedomstack/protocol";
import { LS_QUITTUNGEN, OffeneAntworten, QUITTUNGEN_MAX, QuittungsBuch, reklamationenJeProvider } from "../src/quittungsbuch.js";
import { discoverProviders, matchProviders, stufeAusRuf } from "../src/matchmaking.js";
import type { EigeneReklamation } from "../src/streitfall.js";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";

const JETZT = Math.floor(Date.now() / 1000);
const KANAL = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function speicher(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function lnQuittung(provider: string, auftraege = 1, belegt = false): Quittung {
  const knoten = knotenSchluessel();
  const preimage = crypto.getRandomValues(new Uint8Array(32));
  return lightningQuittung({
    provider, rechnung: rechnung(knoten, "lnbc210n", preimage), preimage: bytesToHex(preimage), auftraege, zeit: JETZT,
    ...(belegt ? { providerKnoten: bytesToHex(secp256k1.getPublicKey(knoten, true)) } : {}),
  })!;
}

const kanalQ = (provider: string, anfrage: string, gutschrift = 10n) =>
  kanalQuittung({ provider, kanal: KANAL, gutschrift, preisLamports: 5, anfrage, zeit: JETZT })!;

test("5.5b: Quittungsbuch – je Zahlung eine Quittung, Unbrauchbares fällt weg, höchstens die neuesten 500", async () => {
  const s = speicher();
  const buch = new QuittungsBuch(s);
  const p = generateKeypair().pk;
  const ln = lnQuittung(p, 2);
  await buch.lege(ln);
  await buch.lege(ln);
  await buch.lege(kanalQ(p, "a".repeat(64)));
  await buch.lege(kanalQ(p, "a".repeat(64), 20n));
  assert.equal(buch.alle().length, 2, "dieselbe Zahlung ersetzt nur ihren Stand");
  assert.equal((buch.alle().find((q) => q.art === "kanal") as { gutschrift: string }).gutschrift, "20");

  // Verändertes oder Fremdes im Speicher gilt als keine Quittung
  const roh = JSON.parse(s.m.get(LS_QUITTUNGEN)!) as unknown[];
  s.m.set(LS_QUITTUNGEN, JSON.stringify([...roh, { ...ln, preimage: "00".repeat(32) }, { art: "bar" }, null]));
  assert.equal(buch.alle().length, 2);
  s.m.set(LS_QUITTUNGEN, "kein json");
  assert.deepEqual(buch.alle(), []);

  s.m.clear();
  for (let i = 0; i < QUITTUNGEN_MAX + 3; i++) await buch.lege({ ...kanalQ(p, i.toString(16).padStart(64, "0")), zeit: JETZT + i });
  const alle = buch.alle();
  assert.equal(alle.length, QUITTUNGEN_MAX);
  assert.equal(alle[0].zeit, JETZT + 3, "die ältesten fallen weg");
});

test("5.5b: Zahlkanal-Quittungen erst mit der Auszahlung auf der Kette belegt – je Kanal", async () => {
  const buch = new QuittungsBuch(speicher());
  const p = generateKeypair().pk;
  const ANDERER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  await buch.lege(kanalQ(p, "a".repeat(64), 10n));
  await buch.lege(kanalQ(p, "b".repeat(64), 30n));
  await buch.lege({ ...kanalQ(p, "c".repeat(64), 10n), kanal: ANDERER });
  await buch.lege(lnQuittung(p));
  assert.deepEqual(buch.offeneKanaele().sort(), [ANDERER, KANAL].sort());

  assert.equal(await buch.hebe(KANAL, 9n), 0, "noch nichts ausgezahlt");
  assert.equal(await buch.hebe(KANAL, 10n), 1, "bis zur ersten Gutschrift");
  assert.deepEqual(buch.offeneKanaele().sort(), [ANDERER, KANAL].sort());
  assert.equal(await buch.hebe(KANAL, 30n), 1);
  assert.deepEqual(buch.offeneKanaele(), [ANDERER], "der andere Kanal bleibt angekündigt");
  const stand = buch.alle().map((q) => [q.art, q.stand]);
  assert.deepEqual(stand.filter(([a]) => a === "kanal").map(([, s]) => s).sort(), ["angekuendigt", "belegt", "belegt"]);
  assert.equal(stand.find(([a]) => a === "lightning")?.[1], "angekuendigt", "Lightning hebt die Kette nicht");
});

test("5.5b: Reklamationen zählen nur, wenn der Prüfer recht gab; offene Antworten je Provider", () => {
  const a = generateKeypair().pk;
  const b = generateKeypair().pk;
  const r = (providerPk: string, ergebnis?: string) => ({ providerPk, ...(ergebnis ? { urteil: { ergebnis } } : {}) }) as unknown as EigeneReklamation;
  const je = reklamationenJeProvider([r(a, "erstattet"), r(a, "geteilt"), r(a, "bestaetigt"), r(a, "unentschieden"), r(b), r(b, "erstattet")]);
  assert.deepEqual([...je], [[a, 2], [b, 1]], "offen, bestätigt oder unentschieden ist nur eine Behauptung");

  const offen = new OffeneAntworten();
  offen.zaehle(a);
  offen.zaehle(a);
  offen.zaehle(b);
  assert.equal(offen.nimm(a), 2, "eine Zahlung deckt beide Antworten");
  assert.equal(offen.nimm(a), 1, "mindestens die bezahlte");
  assert.equal(offen.nimm(b), 1);
});

test("5.5b: Stufe – ohne Quittungen das Angebot, Quittungen heben, nur bestätigte Reklamationen senken", () => {
  const p = generateKeypair().pk;
  const ruf = (quittungen: Quittung[], rekl = 0) => berechneRuf({ quittungen, reklamationen: new Map(rekl ? [[p, rekl]] : []) }).get(p);
  assert.equal(stufeAusRuf("classic", undefined), "classic");
  assert.equal(stufeAusRuf("classic", ruf([lnQuittung(p)])), "classic", "eine bezahlte Antwort senkt kein Angebot");
  assert.equal(stufeAusRuf("free", ruf([lnQuittung(p, 12, true)])), "classic", "zwölf belegte Aufträge heben");
  assert.equal(stufeAusRuf("classic", ruf([lnQuittung(p, 60, true)])), "pro");
  assert.equal(stufeAusRuf("pro", ruf([lnQuittung(p, 3)], 1)), "free", "bestätigte Reklamation: nicht mehr als verdient");
  assert.equal(stufeAusRuf("free", ruf([lnQuittung(p, 60, true)], 1)), "free", "mit Reklamation hebt nichts über das Angebot");
});

/** Relay-Ersatz: liefert, was zum Filter passt, und merkt sich die Filter. */
function fakePool(events: NostrEvent[]) {
  const filter: { kinds?: number[]; authors?: string[] }[] = [];
  const pool = {
    query: async (f: { kinds?: number[] }) => {
      filter.push(f);
      return events.filter((e) => !f.kinds || f.kinds.includes(e.kind));
    },
  } as unknown as OutboxPool;
  return { pool, filter };
}

function angebot(tier: ProviderTier, preis = 1000) {
  const k = generateKeypair();
  const ev = signEvent(buildCapabilities({ pubkey: k.pk, tier, models: ["m"], textRatePerKTokenMsat: preis, tools: [], currentlyFree: false }, JETZT - 60), k.sk);
  return { k, ev };
}

/** Viele Leistungs-Events, die ein Provider über sich selbst veröffentlicht. */
function gefaelscht(k: { pk: string; sk: Uint8Array }, n: number): NostrEvent[] {
  return Array.from({ length: n }, (_, i) => signEvent(buildPerformanceEvent({
    workerPubkey: k.pk, workType: "ai_job", units: 1, volumeMsat: 1_000_000, chain: "lightning", seasonId: "s", proofEventId: i.toString(16).padStart(64, "0"),
  }, JETZT - i), k.sk));
}

test("5.5b Abnahme: gefälschte Leistungs-Events ohne Quittung ändern Stufe und Rang nicht", async () => {
  const ehrlich = angebot("classic", 2000);
  const faelscher = angebot("classic", 500);
  const caps = [ehrlich.ev, faelscher.ev];
  const flut = gefaelscht(faelscher.k, 300);

  const ohne = fakePool(caps);
  const mit = fakePool([...caps, ...flut]);
  const a = await discoverProviders(ohne.pool);
  const b = await discoverProviders(mit.pool);
  assert.deepEqual(b, a, "300 Selbstauskünfte ändern nichts");
  const f = b.find((p) => p.caps.pubkey === faelscher.k.pk)!;
  assert.deepEqual([f.trustScore, f.jobsCompleted, f.repTier, f.score, f.geprueft], [0, 0, "classic", -1, false]);
  assert.ok(mit.filter.every((x) => !x.kinds?.includes(KIND_PERFORMANCE)), "38010 wird nicht einmal abgefragt");
  assert.deepEqual(mit.filter.map((x) => x.kinds), [[KIND_PROVIDER_CAPABILITIES]]);

  // Mit einer eigenen Quittung steht der Bezahlte vorn – trotz höherem Preis und der Flut des anderen
  const ruf = berechneRuf({ quittungen: [lnQuittung(ehrlich.k.pk, 3)] });
  const gerankt = matchProviders(await discoverProviders(mit.pool, ruf), "classic");
  assert.deepEqual(gerankt.map((p) => p.caps.pubkey), [ehrlich.k.pk, faelscher.k.pk], "ungeprüfte bleiben wählbar, aber hinten");
  assert.equal(gerankt[0].geprueft, true);
  // Ohne Ruf entscheidet nur der Preis – nicht die Flut. Seit P2a (E7) gewichtet zufällig mit 1/Preis²
  // (hier 16 : 1 für den Günstigeren) – mit fester Zufallszahl, damit der Test nie würfelt
  assert.deepEqual(matchProviders(b, "classic", { zufall: () => 0.5 }).map((p) => p.caps.pubkey), [faelscher.k.pk, ehrlich.k.pk]);
  assert.deepEqual(matchProviders(b, "classic", { zufall: () => 0.01 }).map((p) => p.caps.pubkey), [ehrlich.k.pk, faelscher.k.pk], "der Teurere bekommt auch Verkehr");

  // Stufe: Die Flut hebt den Fälscher nicht über sein Angebot
  const pro = matchProviders(b, "pro");
  assert.deepEqual(pro, [], "classic-Angebote genügen „pro“ nicht – auch nicht mit 300 Events");

  // Bestätigte Reklamation: für classic nicht mehr wählbar, gratis schon
  const mitRekl = berechneRuf({ quittungen: [lnQuittung(faelscher.k.pk, 2)], reklamationen: new Map([[faelscher.k.pk, 1]]) });
  const danach = await discoverProviders(mit.pool, mitRekl);
  assert.deepEqual(matchProviders(danach, "classic").map((p) => p.caps.pubkey), [ehrlich.k.pk]);
  assert.ok(matchProviders(danach, "free").some((p) => p.caps.pubkey === faelscher.k.pk));
  // Die eigenen Provider (Allowlist) bleiben immer erlaubt
  assert.equal(matchProviders(danach, "free", { allowlist: [faelscher.k.pk] })[0].caps.pubkey, faelscher.k.pk);
});

test("5.5b: verdrahtet – je Stelle in handleAnswer() genau ein Aufruf, Rang und Relay-Suche ohne 38010", () => {
  const agent = lies("shell/tabs/agent.ts");
  assert.equal(agent.match(/quittungNachKanal\(/g)?.length, 1);
  assert.equal(agent.match(/quittungNachZahlung\(/g)?.length, 1);
  assert.match(agent, /await kanalAntwort\(r\.requestId, r\.amountLamports\);\n[^\n]*\n\s*void quittungNachKanal\(r\.providerPubkey, r\.requestId, r\.amountLamports\);/, "nach kanalAntwort()");
  assert.match(agent, /const charge = await sc\.chargeForResult\([^\n]*\n[^\n]*\n\s*void quittungNachZahlung\(r\.providerPubkey, abrechnung\.providerMsat, charge\);/, "nach der Zahlung");

  const state = lies("shell/state.ts");
  assert.match(state, /discoverProviders\(pool, aktuellerRuf\(\)\)/);
  assert.match(state, /trustedPubkeys: arbeiter/);
  assert.match(state, /const arbeiter = new Set\(\(await import\("\.\/quittungen\.js"\)\)\.aktuellerRuf\(\)\.keys\(\)\)/, "Relay-Angaben wiegen nur bei Bezahlten schwerer");
  for (const datei of ["shell/state.ts", "matchmaking.ts"]) assert.doesNotMatch(lies(datei), /KIND_PERFORMANCE|parsePerformance/, datei);

  assert.match(lies("shell/app.ts"), /abrufTakt\.melde\("quittungen", \(\) => import\("\.\/quittungen\.js"\)\.then\(\(q\) => q\.hebeKanalQuittungen\(\)\)/);
  // Nie offen: kein Relay, kein localStorage
  const quittungen = lies("shell/quittungen.ts") + lies("quittungsbuch.ts");
  assert.doesNotMatch(quittungen, /publish|veroeffentliche|localStorage|signiere/);
  assert.match(lies("shell/quittungen.ts"), /new QuittungsBuch\(geheim\)/);
});

test("5.5b: Quittungen nur im Tresor und nie in der Sicherung", () => {
  assert.match(lies("shell/tresor.ts"), /const GEHEIM_FEST = \[[^\]]*"freedom\.quittungen"/);
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_QUITTUNGEN)));
  assert.ok(!(LS_QUITTUNGEN in waehleSicherung([LS_QUITTUNGEN], () => "[]")));
});
