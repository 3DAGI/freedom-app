/**
 * A-17c: Cashu-Topf. Ohne Mint: Adressen und Tresor-Pflicht. Mit einer Mint auf diesem Rechner
 * (Nutshell mit FakeWallet, `scripts/cashu-testmint.sh`, Adresse in `CASHU_TEST_MINT`; ohne sie
 * überspringen sich diese Tests): Mint wählen, laden, senden und empfangen, gesperrt auf einen
 * Schlüssel (NUT-11), ohne Netz nur Nachweisbares (NUT-12), Höchstbetrag, doppelt Ausgegebenes,
 * Absturz mitten im Tausch – nichts geht verloren, nichts kommt doppelt zurück.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDecodedToken, getEncodedToken, type Token } from "@cashu/cashu-ts";
import { SICHERUNG_NIE, waehleSicherung } from "@freedomstack/protocol";
import { CASHU_HOECHST_SAT, CashuFehler, CashuTopf, LS_CASHU, pruefeMintAdresse, type CashuSpeicher } from "../src/cashu-topf.js";
import { filtereExport } from "../src/datenexport.js";

const MINT = process.env["CASHU_TEST_MINT"];
const ohneMint = !MINT && "CASHU_TEST_MINT fehlt (scripts/cashu-testmint.sh)";
const fall = (f: string) => (e: unknown) => e instanceof CashuFehler && e.fall === f;

/** Speicher wie `geheim`; `bricht` lässt ein Schreiben scheitern (Absturz). */
function speicher(): CashuSpeicher & { m: Map<string, string>; bricht?: (wert: string) => boolean } {
  const m = new Map<string, string>();
  const sp: CashuSpeicher & { m: Map<string, string>; bricht?: (wert: string) => boolean } = {
    m,
    getItem: (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      if (sp.bricht?.(v)) throw new Error("Absturz");
      m.set(k, v);
    },
  };
  return sp;
}
const topf = (sp = speicher(), offen = true) => new CashuTopf(sp, { tresorOffen: () => offen, lokal: true });

/** Laden mit der FakeWallet: die Mint bezahlt ihre Rechnung selbst. */
async function geladen(betrag: number, t = topf()): Promise<CashuTopf> {
  await t.waehleMint(MINT!);
  const { quote } = await t.ladeAnfrage(betrag);
  await t.abholen(quote);
  return t;
}

test("Mint-Adresse: https ohne Zugangsdaten, nicht im Heimnetz; .onion auch über http; lokal nur für Tests", () => {
  assert.equal(pruefeMintAdresse(" https://mint.example.org/ "), "https://mint.example.org");
  assert.equal(pruefeMintAdresse("https://mint.example.org/cashu/"), "https://mint.example.org/cashu");
  assert.equal(pruefeMintAdresse("http://abcdefghijklmnop.onion"), "http://abcdefghijklmnop.onion");
  for (const a of ["http://mint.example.org", "https://u:p@mint.example.org", "https://mint.example.org/?x=1", "https://localhost:3338",
    "https://127.0.0.1", "https://192.168.1.5", "https://[::1]", "https://mint.local", "https://mint", "ftp://mint.example.org", "kaputt"]) {
    assert.throws(() => pruefeMintAdresse(a), fall("mint-adresse"), a);
  }
  assert.equal(pruefeMintAdresse("http://127.0.0.1:3338/", { lokal: true }), "http://127.0.0.1:3338");
});

test("der Topf ist Bargeld: nie in der Sicherung, nie im Export, auch nicht aus einer fremden Datei", () => {
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_CASHU)));
  assert.deepEqual(waehleSicherung([LS_CASHU], (k) => (k === LS_CASHU ? "{}" : null)), {});
  assert.deepEqual(filtereExport({ [LS_CASHU]: "{}" }), {});
});

test("ohne gemerkten Stand: kein Empfangsschlüssel, kein Guthaben, keine Mint", () => {
  const t = topf();
  assert.throws(() => t.empfangsSchluessel(), fall("keine-mint"));
  assert.equal(t.guthaben(), 0);
  assert.equal(t.mint(), undefined);
  assert.throws(() => t.pruefeOhneNetz("cashuBx"), fall("keine-mint"));
});

test("Mint wählen und laden: nur geprüfte Rechnung, Höchstbetrag, unbezahlt, Tresor-Pflicht", { skip: ohneMint }, async () => {
  const sp = speicher();
  const t = topf(sp);
  assert.deepEqual(Object.keys(await t.waehleMint(MINT!)), ["name"]);
  assert.equal(t.mint(), MINT);
  assert.match(t.empfangsSchluessel(), /^0[23][0-9a-f]{64}$/);
  assert.equal(t.empfangsSchluessel(), t.empfangsSchluessel(), "derselbe Schlüssel");
  const { quote, rechnung } = await t.ladeAnfrage(100);
  assert.match(rechnung, /^lnbc/);
  assert.equal(await t.abholen(quote), 100);
  assert.equal(t.guthaben(), 100);
  await assert.rejects(t.abholen(quote), fall("unbezahlt"), "schon abgeholt");
  await assert.rejects(t.ladeAnfrage(CASHU_HOECHST_SAT), fall("zu-viel"));
  await assert.rejects(t.ladeAnfrage(1.5), fall("betrag"));
  await assert.rejects(t.waehleMint("https://andere-mint.example.org"), fall("mint-wechsel"), "Guthaben bei der alten");
  // Ohne offenen Tresor wird nichts geschrieben
  await assert.rejects(topf(sp, false).ladeAnfrage(10), fall("tresor"));
  assert.equal(JSON.parse(sp.m.get(LS_CASHU)!).offen.length, 0);
});

test("senden und empfangen: Wechselgeld bleibt, doppelt Ausgegebenes nie, fremde Mint und fehlende Beweise nie", { skip: ohneMint }, async () => {
  const a = await geladen(200);
  const b = topf();
  await b.waehleMint(MINT!);
  const token = await a.sende(50);
  assert.ok(a.guthaben() <= 150 && a.guthaben() >= 148, `Wechselgeld ${a.guthaben()}`);
  assert.equal(await b.empfange(token), b.guthaben());
  assert.ok(b.guthaben() >= 48 && b.guthaben() <= 50);
  await assert.rejects(b.empfange(token), fall("ausgegeben"));
  await assert.rejects(a.sende(10_000), fall("zu-wenig"));
  await assert.rejects(b.empfange("cashuBkaputt"), fall("token"));
  // Dasselbe Token mit anderer Mint oder ohne DLEQ (NUT-12)
  const t2 = await a.sende(10);
  const ids = (await (await fetch(`${MINT}/v1/keysets`)).json() as { keysets: { id: string }[] }).keysets.map((k) => k.id);
  const dec: Token = getDecodedToken(t2, ids);
  await assert.rejects(b.empfange(getEncodedToken({ ...dec, mint: "https://andere-mint.example.org" })), fall("fremde-mint"));
  await assert.rejects(b.empfange(getEncodedToken(dec, { removeDleq: true })), fall("ohne-dleq"));
  assert.ok((await b.empfange(t2)) > 0, "das echte Token geht");
});

test("gesperrt auf einen Schlüssel (NUT-11): nur er löst ein; ohne Netz nur Nachweisbares auf mich, einmal", { skip: ohneMint }, async () => {
  const a = await geladen(200);
  const b = topf();
  const c = topf();
  await b.waehleMint(MINT!);
  await c.waehleMint(MINT!);
  const token = await a.sende(20, { an: b.empfangsSchluessel() });
  await assert.rejects(c.empfange(token), fall("nicht-gesperrt"));
  assert.throws(() => c.pruefeOhneNetz(token), fall("nicht-gesperrt"));
  // Ohne Netz: geprüft gegen die gemerkten Schlüssel der Mint
  assert.ok(b.pruefeOhneNetz(token) >= 20);
  const betrag = await b.nimmOhneNetz(token);
  assert.equal(b.gesperrt(), betrag);
  assert.equal(await b.nimmOhneNetz(token), 0, "dasselbe Token zählt einmal");
  assert.equal(b.gesperrt(), betrag);
  assert.ok((await b.einloesen()) >= 20);
  assert.equal(b.gesperrt(), 0);
  assert.ok(b.guthaben() >= 20);
});

test("ohne Netz: ungesperrte Token nie, und der Höchstbetrag gilt auch für Gesperrtes", { skip: ohneMint }, async () => {
  const a = await geladen(300);
  const b = topf();
  await b.waehleMint(MINT!);
  assert.throws(() => b.pruefeOhneNetz("cashuBkaputt"), fall("token"));
  // Ungesperrt ist ohne Netz nichts wert – der Absender könnte es noch ausgeben
  const offen = await a.sende(5);
  assert.throws(() => b.pruefeOhneNetz(offen), fall("nicht-gesperrt"));
  // B ist fast voll: 9.990 sat
  const sp = speicher();
  const voll = await geladen(CASHU_HOECHST_SAT - 10, topf(sp));
  const gesperrt = await a.sende(20, { an: voll.empfangsSchluessel() });
  assert.throws(() => voll.pruefeOhneNetz(gesperrt), fall("zu-viel"));
  await assert.rejects(voll.empfange(gesperrt), fall("zu-viel"));
});

test("Absturz nach der Antwort der Mint: nachholen() bringt genau den Stand dieses Tauschs zurück", { skip: ohneMint }, async () => {
  const sp = speicher();
  const a = await geladen(100, topf(sp));
  const b = topf();
  await b.waehleMint(MINT!);
  // Ein früher gesendetes Token, das B noch nicht eingelöst hat – es darf nicht zurückkommen
  const frueher = await a.sende(10);
  const vorher = a.guthaben();
  // Das Schreiben nach dem Tausch scheitert (laufend wird geleert) – wie ein Absturz
  sp.bricht = (v) => JSON.parse(v).laufend === undefined && JSON.parse(sp.m.get(LS_CASHU)!).laufend !== undefined;
  await assert.rejects(a.sende(30));
  sp.bricht = undefined;
  const neu = topf(sp);
  assert.equal(neu.guthaben(), 0, "eingesetzt ist alles, laufend gemerkt");
  await assert.rejects(neu.sende(5), fall("laufend"));
  const zurueck = await neu.nachholen();
  assert.ok(zurueck <= vorher && zurueck >= vorher - 2, `zurück ${zurueck} von ${vorher}`);
  assert.equal(neu.guthaben(), zurueck);
  assert.equal(await neu.nachholen(), 0, "nichts mehr offen");
  // Das frühere Token gehört weiter B
  assert.ok((await b.empfange(frueher)) > 0);
});

test("Absturz beim Abholen einer Ladung: nachholen() holt die Token, die Ladung gilt als abgeholt", { skip: ohneMint }, async () => {
  const sp = speicher();
  const t = topf(sp);
  await t.waehleMint(MINT!);
  const { quote } = await t.ladeAnfrage(64);
  sp.bricht = (v) => JSON.parse(v).laufend === undefined && JSON.parse(sp.m.get(LS_CASHU)!).laufend !== undefined;
  await assert.rejects(t.abholen(quote));
  sp.bricht = undefined;
  const neu = topf(sp);
  assert.equal(await neu.nachholen(), 64);
  await assert.rejects(neu.abholen(quote), fall("ausgegeben"));
  assert.equal(neu.guthaben(), 64);
  await assert.rejects(neu.ladeAnfrage(CASHU_HOECHST_SAT - 64 + 1), fall("zu-viel"), "die Ladung zählt nicht doppelt");
});
