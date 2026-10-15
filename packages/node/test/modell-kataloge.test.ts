/**
 * Schritt E9-4: Der Knoten folgt nur den Modellkatalogen, die sein Betreiber
 * nennt (`MODELL_KATALOGE`), liest sie nur gültig signiert und je Adresse den
 * neuesten – und gibt daraus genau die Manifeste frei, die sie nennen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baueModellKatalog, generateKeypair, katalogAdresse, signEvent, type Keypair, type NostrEvent } from "@freedomstack/protocol";
import { KATALOGE_FRISCH_MS, KATALOGE_MAX, KatalogFreigaben, holeKataloge, katalogeAusUmgebung } from "../src/modell-kataloge.js";

const ANNA = generateKeypair(), BERT = generateKeypair(), FREMD = generateKeypair();
const [M1, M2, M3] = ["11".repeat(32), "22".repeat(32), "33".repeat(32)];
const katalog = (kp: Keypair, d: string, modelle: Array<{ modell: string; manifest?: string }>, zeit = 1_800_000_000): NostrEvent =>
  signEvent(baueModellKatalog({ kurator: kp.pk, d, titel: d, modelle }, zeit), kp.sk);

test("MODELL_KATALOGE: leer heißt keiner, Adressen streng, doppelte einmal, höchstens 20 – sonst kein Start", () => {
  assert.deepEqual(katalogeAusUmgebung({}), { adressen: [] });
  assert.deepEqual(katalogeAusUmgebung({ MODELL_KATALOGE: " " }), { adressen: [] });
  const a = katalogAdresse(ANNA.pk, "code"), b = katalogAdresse(BERT.pk, "texte");
  assert.deepEqual(katalogeAusUmgebung({ MODELL_KATALOGE: ` ${a}, ${b},${a} ` }), { adressen: [a, b] });
  for (const kaputt of [`30000:${ANNA.pk}:code`, `38080:${ANNA.pk.toUpperCase()}:code`, `${a},quatsch`, `38080:${ANNA.pk}:mit leer`]) {
    assert.ok(katalogeAusUmgebung({ MODELL_KATALOGE: kaputt }).grund, kaputt);
  }
  const viele = Array.from({ length: KATALOGE_MAX + 1 }, (_, i) => katalogAdresse(ANNA.pk, `k${i}`)).join(",");
  assert.match(katalogeAusUmgebung({ MODELL_KATALOGE: viele }).grund ?? "", /höchstens 20/);
});

test("Kataloge holen: nur nach den Kuratoren gefragt, nur gültig signiert, je Adresse der neueste, nur abonnierte", async () => {
  const gefragt: unknown[] = [];
  const alt = katalog(ANNA, "code", [{ modell: "qwen2.5:0.5b", manifest: M1 }], 100);
  const neu = katalog(ANNA, "code", [{ modell: "qwen2.5:0.5b", manifest: M2 }], 200);
  const anderer = katalog(ANNA, "texte", [{ modell: "qwen2.5:0.5b", manifest: M3 }]);
  const gefaelscht = { ...katalog(BERT, "code", [{ modell: "qwen2.5:0.5b", manifest: M3 }], 300), pubkey: ANNA.pk };
  const fremd = katalog(FREMD, "code", [{ modell: "qwen2.5:0.5b", manifest: M3 }]);
  const frage = async (f: unknown) => { gefragt.push(f); return [alt, neu, anderer, gefaelscht, fremd]; };
  const k = await holeKataloge(frage, [katalogAdresse(ANNA.pk, "code")]);
  assert.deepEqual(k.map((x) => x.modelle[0]!.manifest), [M2], "der neueste der abonnierten Adresse – nicht der andere Katalog desselben Kurators, nicht Gefälschtes oder Fremdes");
  assert.deepEqual(gefragt, [{ kinds: [38080], authors: [ANNA.pk], limit: 50 }]);
  assert.deepEqual(await holeKataloge(async () => { throw new Error("nie gefragt"); }, []), []);
});

test("Freigaben je Modell: aus allen abonnierten Katalogen, frisch gehalten, ohne Antwort keine", async () => {
  let jetzt = 0, fragen = 0, kaputt = false;
  const evs = [katalog(ANNA, "code", [{ modell: "Qwen2.5:0.5b", manifest: M1 }, { modell: "llama3.2:3b" }]), katalog(BERT, "x", [{ modell: "qwen2.5:0.5b", manifest: M2 }])];
  const f = new KatalogFreigaben(async () => { fragen++; if (kaputt) throw new Error("relays"); return evs; }, [katalogAdresse(ANNA.pk, "code"), katalogAdresse(BERT.pk, "x")], () => jetzt);
  assert.deepEqual([...await f.fuer("qwen2.5:0.5b")].sort(), [M1, M2]);
  assert.deepEqual([...await f.fuer("llama3.2:3b")], [], "ein Eintrag ohne Manifest gibt nichts frei");
  assert.equal(fragen, 1, "innerhalb der Frist nicht neu gefragt");
  jetzt = KATALOGE_FRISCH_MS;
  kaputt = true;
  assert.deepEqual([...await f.fuer("qwen2.5:0.5b")], [], "ohne Antwort keine Freigaben – nie die alten");
  assert.equal(fragen, 2);
  const ohne = new KatalogFreigaben(async () => { throw new Error("nie gefragt"); }, []);
  assert.deepEqual([...await ohne.fuer("qwen2.5:0.5b")], [], "ohne Abo wird nichts gefragt");
});

test("Verdrahtet: main.ts liest MODELL_KATALOGE (ungültig → kein Start) und gibt die Freigaben an den Lader", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const katalogWahl = katalogeAusUmgebung\(process\.env\);\n  if \(katalogWahl\.grund\) \{\n    console\.error\(`\[modell\] \$\{katalogWahl\.grund\} – der Knoten startet nicht`\);\n    process\.exit\(1\);/);
  assert.match(main, /freigaben: \(name\) => katalogFreigaben\.fuer\(name\),/);
});
