/**
 * KI-Guthaben (RM2d): Stand für Kopf und Karte, Laden über die Zahlschienen, offene Ladungen abholen, Texte je Kennung.
 * Mit einer Mint auf dem Rechner (`CASHU_TEST_MINT`, `scripts/cashu-testmint.sh`) dazu der Weg gegen die echte Mint.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASHU_FAELLE, CashuFehler, CashuTopf, type CashuSpeicher } from "../src/cashu-topf.js";
import { getLang, setLang } from "../src/i18n.js";
import { CASHU_TEXT, cashuFehlerText, guthabenStand, holeOffene, ladeGuthaben, mintHost } from "../src/ki-guthaben.js";
import { waehrung } from "../src/texte/waehrung.js";

const MINT = process.env["CASHU_TEST_MINT"];
const ohneMint = !MINT && "CASHU_TEST_MINT fehlt (scripts/cashu-testmint.sh)";

/** Ein Topf als Attrappe: zeichnet die Aufrufe auf; `abholen` wirft, was `fehler` sagt. */
function attrappe(o: { mint?: string; fehler?: Record<string, CashuFehler>; offen?: Array<{ quote: string; betrag: number }> } = {}) {
  const aufrufe: string[] = [];
  const offen = [...(o.offen ?? [])];
  return {
    aufrufe,
    mint: () => o.mint,
    guthaben: () => 120,
    imPfand: () => 20,
    offeneLadungen: () => offen,
    gebuehrPpk: () => 100,
    ladeAnfrage: async (sats: number) => { aufrufe.push(`anfrage ${sats}`); return { quote: "q1", rechnung: "lnbc1rechnung" }; },
    abholen: async (quote: string) => {
      aufrufe.push(`abholen ${quote}`);
      const f = o.fehler?.[quote];
      if (f) throw f;
      return quote === "q1" ? 50 : 30;
    },
  };
}

test("RM2d: Stand – ohne Mint nichts, sonst Host, Guthaben, Pfand, offene Ladungen und Gebühr", () => {
  assert.deepEqual(guthabenStand(attrappe()), { mint: null, host: null, sats: 0, imPfand: 0, offen: 0, gebuehrPpk: 0 });
  const s = guthabenStand(attrappe({ mint: "https://mint.example.org/cashu", offen: [{ quote: "a", betrag: 30 }, { quote: "b", betrag: 12 }] }));
  assert.deepEqual(s, { mint: "https://mint.example.org/cashu", host: "mint.example.org", sats: 120, imPfand: 20, offen: 42, gebuehrPpk: 100 });
  assert.equal(mintHost("kaputt"), "kaputt");
});

test("RM2d: Laden – erst die geprüfte Rechnung, dann über die Schienen zahlen, dann abholen; ohne Antwort der Mint bleibt die Ladung offen", async () => {
  const topf = attrappe({ mint: "https://mint.example.org" });
  const gezahlt: Array<[string, number]> = [];
  const zahle = async (r: string, msat: number) => { topf.aufrufe.push("zahle"); gezahlt.push([r, msat]); };
  assert.deepEqual(await ladeGuthaben({ topf, zahle }, 50), { art: "geladen", sats: 50 });
  assert.deepEqual(topf.aufrufe, ["anfrage 50", "zahle", "abholen q1"]);
  assert.deepEqual(gezahlt, [["lnbc1rechnung", 50_000]], "genau die Rechnung der Mint, in msat");
  for (const f of ["unbezahlt", "mint-netz"] as const) {
    const t2 = attrappe({ fehler: { q1: new CashuFehler(f) } });
    assert.deepEqual(await ladeGuthaben({ topf: t2, zahle: async () => undefined }, 50), { art: "offen", fall: f }, f);
  }
  // Ein anderer Fehler beim Abholen geht hinaus; scheitert die Zahlung, wird nichts abgeholt und nichts wiederholt
  await assert.rejects(ladeGuthaben({ topf: attrappe({ fehler: { q1: new CashuFehler("ausgegeben") } }), zahle: async () => undefined }, 50),
    (e: unknown) => e instanceof CashuFehler && e.fall === "ausgegeben");
  const t3 = attrappe();
  let versuche = 0;
  await assert.rejects(ladeGuthaben({ topf: t3, zahle: async () => { versuche++; throw new Error("Wallet sagt nein"); } }, 50), /Wallet sagt nein/);
  assert.equal(versuche, 1, "nie von selbst noch einmal");
  assert.deepEqual(t3.aufrufe, ["anfrage 50"]);
  // Prüft die Mint die Rechnung nicht (anderer Betrag), wird nie gezahlt
  const t4 = { ...attrappe(), ladeAnfrage: async () => { throw new CashuFehler("rechnung"); } };
  let gezahlt4 = false;
  await assert.rejects(ladeGuthaben({ topf: t4, zahle: async () => { gezahlt4 = true; } }, 50), (e: unknown) => e instanceof CashuFehler && e.fall === "rechnung");
  assert.equal(gezahlt4, false);
});

test("RM2d: offene Ladungen abholen – Abgeholtes zählt, Unbezahltes bleibt offen, schon Abgeholtes fällt weg, anderes geht hinaus", async () => {
  const topf = attrappe({
    offen: [{ quote: "q1", betrag: 50 }, { quote: "q2", betrag: 30 }, { quote: "q3", betrag: 7 }, { quote: "q4", betrag: 9 }],
    fehler: { q3: new CashuFehler("unbezahlt"), q4: new CashuFehler("ausgegeben") },
  });
  assert.deepEqual(await holeOffene(topf), { sats: 80, offen: 7 });
  const gesperrt = attrappe({ offen: [{ quote: "q1", betrag: 50 }], fehler: { q1: new CashuFehler("tresor") } });
  await assert.rejects(holeOffene(gesperrt), (e: unknown) => e instanceof CashuFehler && e.fall === "tresor");
});

test("RM2d: je Kennung des Topfs ein Satz in beiden Sprachen; andere Fehler über fehlerText()", () => {
  assert.deepEqual(Object.keys(CASHU_TEXT).sort(), [...CASHU_FAELLE].sort());
  for (const f of CASHU_FAELLE) {
    const text = waehrung[CASHU_TEXT[f]];
    assert.ok(text?.de && text.en, `${f}: Text in beiden Sprachen`);
  }
  const vorher = getLang();
  try {
    setLang("de");
    assert.equal(cashuFehlerText(new CashuFehler("mint-wechsel")), "Die Mint wechseln geht nur mit leerem Guthaben.");
    assert.ok(!cashuFehlerText(new Error("Meldung von außen")).includes("Cashu:"), "nie die Meldung des Fehlers selbst");
  } finally {
    setLang(vorher);
  }
});

test("RM2d: gegen die Mint – laden über ladeGuthaben(), offene Ladungen und Gebühr aus dem Topf", { skip: ohneMint }, async () => {
  const m = new Map<string, string>();
  const sp: CashuSpeicher = { getItem: (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } };
  const topf = new CashuTopf(sp, { tresorOffen: () => true, lokal: true });
  await topf.waehleMint(MINT!);
  // Die FakeWallet der Mint bezahlt ihre Rechnung selbst – „zahlen“ merkt sich nur, was offen war
  let offenBeimZahlen: Array<{ quote: string; betrag: number }> = [];
  const r = await ladeGuthaben({ topf, zahle: async () => { offenBeimZahlen = topf.offeneLadungen(); } }, 64);
  assert.deepEqual(r, { art: "geladen", sats: 64 });
  assert.equal(offenBeimZahlen.length, 1);
  assert.equal(offenBeimZahlen[0]!.betrag, 64);
  assert.deepEqual(topf.offeneLadungen(), [], "abgeholt");
  const s = guthabenStand(topf);
  assert.equal(s.sats, 64);
  const ks = (await (await fetch(`${MINT}/v1/keysets`)).json()) as { keysets: Array<{ unit: string; input_fee_ppk?: number }> };
  assert.equal(s.gebuehrPpk, Math.max(0, ...ks.keysets.filter((k) => k.unit === "sat").map((k) => k.input_fee_ppk ?? 0)));
});
