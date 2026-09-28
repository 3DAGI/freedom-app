/**
 * Schritt 8.15: Die Status-Seite (packages/website/dashboard.html) wertet nur
 * Öffentliches und Freiwilliges aus – `js/dashboard-daten.js`. Abnahme:
 * Selbstauskünfte (38010) und Quittungen bzw. ihre Zusammenfassungen ändern
 * nichts; Angebote stehen nach Erneuerung, nicht nach Leistung; Abdeckung nur
 * über der Schwelle; Werbe-Nennungen nur als Summe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_PERFORMANCE, KIND_PROVIDER_CAPABILITIES, K_ANONYMITY, KIND_COVERAGE, KIND_MODELL_KATALOG, KIND_REFERRAL_CLAIM, LAYER_CELL_DEGREES,
  KIND_RUF_ZUSAMMENFASSUNG, baueCoverageEintrag, baueModellKatalog, buildCapabilities, buildPerformanceEvent, buildReferralClaim,
  generateKeypair, signEvent, toCell, type NostrEvent,
} from "@freedomstack/protocol";

interface Daten {
  ereignisse: number;
  angebote: { pubkey: string; stufe: string; modelle: string[]; satsJe1k: number | null; lightning: boolean; solKanal: boolean; funkGateway: boolean }[];
  angebote7Tage: number;
  modelle: { name: string; anbieter: number }[];
  kataloge: { kurator: string; titel: string; modelle: number }[];
  kuratoren: number;
  abdeckung: Record<"online" | "lora" | "bluetooth", { zellen: number; knoten: number }> & { verdeckt: number };
  nennungen: { nennungen: number; werber: number };
}
interface Modul {
  KIND_ANGEBOT: number; KIND_KATALOG: number; KIND_ABDECKUNG: number; KIND_NENNUNG: number; K_SCHWELLE: number;
  filter(jetzt: number): { kinds: number[] }[];
  werteAus(events: unknown[], jetzt: number): Daten;
}
const pfad = new URL("../../website/js/dashboard-daten.js", import.meta.url);
const m = (await import(pfad.href)) as Modul;
const JETZT = Math.floor(Date.now() / 1000);

function angebot(o: { tier?: "free" | "classic" | "pro"; alter?: number; modelle?: string[]; preis?: number; lud16?: string; funk?: boolean } = {}) {
  const k = generateKeypair();
  const ev = signEvent(buildCapabilities({
    pubkey: k.pk, tier: o.tier ?? "classic", models: o.modelle ?? ["qwen3:8b"], textRatePerKTokenMsat: o.preis ?? 2000, tools: [], currentlyFree: false,
    ...(o.lud16 ? { lud16: o.lud16 } : {}), ...(o.funk ? { funkGateway: true } : {}),
  }, JETZT - (o.alter ?? 60)), k.sk);
  return { k, ev };
}

const flut = (k: { pk: string; sk: Uint8Array }, n: number): NostrEvent[] => Array.from({ length: n }, (_, i) => signEvent(buildPerformanceEvent({
  workerPubkey: k.pk, workType: "ai_job", units: 1, volumeMsat: 5_000_000, chain: "lightning", seasonId: "s", proofEventId: i.toString(16).padStart(64, "0"),
}, JETZT - i), k.sk));

test("8.15: dieselben Arten wie im Protokoll – und nur diese werden abgefragt", () => {
  assert.deepEqual([m.KIND_ANGEBOT, m.KIND_KATALOG, m.KIND_ABDECKUNG, m.KIND_NENNUNG, m.K_SCHWELLE],
    [KIND_PROVIDER_CAPABILITIES, KIND_MODELL_KATALOG, KIND_COVERAGE, KIND_REFERRAL_CLAIM, K_ANONYMITY]);
  const arten = m.filter(JETZT).flatMap((f) => f.kinds);
  assert.deepEqual(arten, [KIND_PROVIDER_CAPABILITIES, KIND_MODELL_KATALOG, KIND_COVERAGE, KIND_REFERRAL_CLAIM]);
  assert.ok(!arten.includes(KIND_PERFORMANCE) && !arten.includes(KIND_RUF_ZUSAMMENFASSUNG));
});

test("8.15 Abnahme: Selbstauskünfte und Quittungs-Zusammenfassungen ändern nichts – Reihenfolge nach Erneuerung", () => {
  const alt = angebot({ alter: 3600, preis: 900, lud16: "a@b.example" });
  const neu = angebot({ alter: 60, tier: "pro", modelle: ["qwen3:8b", "llama3.3:70b"], funk: true });
  const basis = [alt.ev, neu.ev];
  const fremd = { id: "ab".repeat(32), pubkey: alt.k.pk, created_at: JETZT, kind: KIND_RUF_ZUSAMMENFASSUNG, tags: [["provider", alt.k.pk, "999", "999", "1", "1", "0"]], content: "", sig: "" };
  const ohne = m.werteAus(basis, JETZT);
  const mit = m.werteAus([...basis, ...flut(alt.k, 300), fremd], JETZT);
  assert.deepEqual({ ...mit, ereignisse: 0 }, { ...ohne, ereignisse: 0 }, "300 Leistungs-Events und eine offene Zusammenfassung ändern nichts");
  assert.deepEqual(mit.angebote.map((a) => a.pubkey), [neu.k.pk, alt.k.pk], "zuletzt erneuert zuerst – nicht nach Leistung");
  assert.deepEqual(mit.angebote.map((a) => [a.stufe, a.lightning, a.funkGateway]), [["pro", false, true], ["classic", true, false]]);
  assert.equal(mit.angebote[1].satsJe1k, 0.9);
  assert.deepEqual(mit.modelle, [{ name: "qwen3:8b", anbieter: 2 }, { name: "llama3.3:70b", anbieter: 1 }]);
  assert.ok(mit.angebote.every((a) => !("jobs" in a) && !("sats" in a)));
});

test("8.15: Angebote nur frisch und je Provider das neueste; Unbrauchbares fällt weg", () => {
  const k = generateKeypair();
  const v = (alter: number, tier: "free" | "pro") => signEvent(buildCapabilities({ pubkey: k.pk, tier, models: [], textRatePerKTokenMsat: 0, tools: [], currentlyFree: true }, JETZT - alter), k.sk);
  const gestern = angebot({ alter: 2 * 86400 });
  const d = m.werteAus([v(600, "free"), v(60, "pro"), gestern.ev, { ...angebot().ev, tags: [["d", "x"], ["tier", "pro"]] }, { kaputt: true }, null], JETZT);
  assert.deepEqual(d.angebote.map((a) => [a.pubkey, a.stufe]), [[k.pk, "pro"]]);
  assert.equal(d.angebote7Tage, 2, "das von gestern zählt nur für die 7 Tage");
});

test("8.15: Abdeckung nur über der Schwelle, Kataloge nach Titel, Nennungen nur als Summe", () => {
  const zelle = toCell(48.137, 11.576, LAYER_CELL_DEGREES.lora);
  const lora = (n: number) => Array.from({ length: n }, () => baueCoverageEintrag({ layer: "lora", cell: zelle, region: "" }, JETZT - 60).event);
  const bt = baueCoverageEintrag({ layer: "bluetooth", cell: toCell(52.52, 13.405, LAYER_CELL_DEGREES.bluetooth), region: "" }, JETZT - 60).event;
  const online = baueCoverageEintrag({ layer: "online", cell: toCell(52.52, 13.405, LAYER_CELL_DEGREES.online), region: "" }, JETZT - 60).event;
  const d = m.werteAus([...lora(K_ANONYMITY), bt, online], JETZT);
  assert.deepEqual([d.abdeckung.lora, d.abdeckung.bluetooth, d.abdeckung.online, d.abdeckung.verdeckt],
    [{ zellen: 1, knoten: K_ANONYMITY }, { zellen: 0, knoten: 0 }, { zellen: 1, knoten: 1 }, 1], "ein einzelner Bluetooth-Knoten bleibt verdeckt");
  assert.equal(m.werteAus(lora(K_ANONYMITY - 1), JETZT).abdeckung.lora.zellen, 0);

  const kur = generateKeypair();
  const kat = (d: string, titel: string, modelle: string[]) => signEvent(baueModellKatalog({ kurator: kur.pk, d, titel, modelle: modelle.map((x) => ({ modell: x })) }, JETZT), kur.sk);
  const k2 = m.werteAus([kat("b", "Zweiter", ["a:1"]), kat("a", "Erster", ["a:1", "b:2"])], JETZT);
  assert.deepEqual(k2.kataloge.map((k) => [k.titel, k.modelle]), [["Erster", 2], ["Zweiter", 1]]);
  assert.equal(k2.kuratoren, 1);

  const w = generateKeypair();
  const geworben = [generateKeypair(), generateKeypair()];
  const nennung = (g: { pk: string; sk: Uint8Array }, werber: string, zeit: number) => signEvent(buildReferralClaim(g.pk, werber, zeit), g.sk);
  const n = m.werteAus([nennung(geworben[0], w.pk, JETZT - 100), nennung(geworben[0], generateKeypair().pk, JETZT), nennung(geworben[1], w.pk, JETZT)], JETZT);
  assert.deepEqual(n.nennungen, { nennungen: 2, werber: 1 }, "je Geworbenem die früheste Angabe; keine Liste der Werber");
});

test("8.15: die Seite nutzt nur die Auswertung und zeigt nichts Selbstberichtetes", () => {
  const seite = readFileSync(new URL("../../website/dashboard.html", import.meta.url), "utf8");
  assert.match(seite, /import \{ K_SCHWELLE, filter, werteAus \} from "\.\/js\/dashboard-daten\.js";/);
  assert.match(seite, /queryRelay\(r, filter\(jetzt\)\)/);
  assert.doesNotMatch(seite, /38010|kinds:\s*\[/, "keine eigene Abfrage an der Auswertung vorbei");
  assert.match(readFileSync(new URL("../../../scripts/build-site.sh", import.meta.url), "utf8"), /cp -r "\$W"\/js "\$OUT"\//, "js/ wird mit veröffentlicht");
});
