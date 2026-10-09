/**
 * Status meines Knotens (B-11a, L6 A): versiegelt mit Besitzer-Nachweis
 * gefragt, die Antwort nur in fester Form – Zahlen, feste Kennungen,
 * Modellnamen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_GIFT_WRAP, LocalSigner, STATUS_GRENZEN, STATUS_ROLLEN, baueStatusAuftrag, generateKeypair, getTag,
  istBesitzer, knotenStatusText, leseKnotenStatus, neueKopplung, openPrivateKundenEvent, type KnotenStatus,
} from "../src/index.js";

const beispiel = (): KnotenStatus => ({
  fassung: "0.1.0",
  seit: 1_790_000_000,
  rollen: ["ki", "relay", "speicher"],
  modelle: ["qwen3.8:27b", "nemotron-3.5-lightning:30b-a3b-nvfp4"],
  auftraege: { erledigt: 12, gratis: 4, abgelehnt: 1 },
  abgerechnetMsat: 84_000,
  speicher: { belegtBytes: 1_048_576, quotaBytes: 0, gehalten: 24 },
  relay: { events: 310, verbindungen: 3 },
});

test("B-11a: baueStatusAuftrag – versiegelt an den Knoten, Kern 5077 ohne Gebot, mit Nachweis; offen steht davon nichts", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap, requestId } = await baueStatusAuftrag({ sitzung, kopplung: k });
  assert.equal(wrap.kind, KIND_GIFT_WRAP);
  assert.equal(getTag(wrap, "p"), knoten.pk);
  const offen = JSON.stringify(wrap);
  for (const geheim of [k.geheimnis, sitzung.publicKey()]) assert.ok(!offen.includes(geheim), "nichts davon offen");
  // Das Kind steht nur im versiegelten Kern: offen nur 1059 mit dem Empfänger (eine Ziffernfolge im Zufall zu suchen, schlug gelegentlich an)
  assert.deepEqual(wrap.tags, [["p", knoten.pk]]);
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
  assert.ok(r.ok);
  assert.equal(r.request.id, requestId);
  assert.equal(r.request.kind, KIND_DVM_KNOTEN_STATUS);
  assert.equal(getTag(r.request, "bid"), "0");
  assert.ok(istBesitzer(r.request, [k.geheimnis], r.request.created_at), "mit Nachweis des Besitzers");
  assert.ok(!istBesitzer(r.request, [neueKopplung(knoten.pk).geheimnis], r.request.created_at), "ein anderes Geheimnis passt nicht");
});

test("B-11a: Antwort – gelesen wird genau, was geschrieben wurde; unbekannte Felder bleiben unbeachtet", () => {
  const s = beispiel();
  assert.deepEqual(leseKnotenStatus(knotenStatusText(s)), s);
  const ohne = { ...s, speicher: null, relay: null, rollen: [] as KnotenStatus["rollen"], modelle: [] };
  assert.deepEqual(leseKnotenStatus(knotenStatusText(ohne)), ohne);
  // Rollen in fester Reihenfolge, Unbekanntes im Eingang fällt beim Schreiben weg
  assert.deepEqual(leseKnotenStatus(knotenStatusText({ ...s, rollen: ["speicher", "ki"] }))!.rollen, ["ki", "speicher"]);
  const mehr = JSON.stringify({ ...JSON.parse(knotenStatusText(s)), zukunft: [{ stufe: "ok" }] });
  assert.deepEqual(leseKnotenStatus(mehr), s, "ein neuerer Knoten darf mehr melden");
  assert.ok(STATUS_ROLLEN.includes("ki") && STATUS_ROLLEN.includes("turn") && !(STATUS_ROLLEN as readonly string[]).includes("pruefer") && STATUS_ROLLEN.length === 11);
  // Eine Rolle, die diese Fassung nicht kennt (neuerer Knoten), bleibt unbeachtet – der Rest des Status gilt (seit B-13a)
  const neuer = JSON.stringify({ ...JSON.parse(knotenStatusText(s)), rollen: ["ki", "zukunft", "relay"] });
  assert.deepEqual(leseKnotenStatus(neuer)!.rollen, ["ki", "relay"]);
});

test("B-11a: Antwort – alles andere ist null", () => {
  const gut = JSON.parse(knotenStatusText(beispiel())) as Record<string, unknown>;
  const mit = (aenderung: Record<string, unknown>) => JSON.stringify({ ...gut, ...aenderung });
  for (const kaputt of [
    "", "{", "null", "[]", '"status"', "Speicher voll",
    mit({ fassung: "" }), mit({ fassung: "0.1.0 <b>" }), mit({ fassung: "x".repeat(STATUS_GRENZEN.fassungZeichen + 1) }), mit({ fassung: 1 }),
    mit({ seit: -1 }), mit({ seit: 1.5 }), mit({ seit: "1790000000" }),
    mit({ rollen: ["ki", "ki"] }), mit({ rollen: ["Root!"] }), mit({ rollen: [1] }), mit({ rollen: "ki" }),
    mit({ modelle: ["a", "a"] }), mit({ modelle: [""] }), mit({ modelle: ["x".repeat(STATUS_GRENZEN.modellZeichen + 1)] }),
    mit({ modelle: ["zeile\nzwei"] }), mit({ modelle: [7] }), mit({ modelle: Array.from({ length: STATUS_GRENZEN.modelle + 1 }, (_, i) => `m${i}`) }),
    mit({ auftraege: { erledigt: 1, gratis: 2, abgelehnt: 0 } }), mit({ auftraege: { erledigt: 1, gratis: 0 } }), mit({ auftraege: null }),
    mit({ abgerechnetMsat: -5 }), mit({ abgerechnetMsat: 2 ** 60 }),
    mit({ speicher: { belegtBytes: 1, quotaBytes: 2 } }), mit({ speicher: [] }), mit({ speicher: undefined }),
    mit({ relay: { events: "3", verbindungen: 1 } }),
    JSON.stringify({ ...gut, modelle: ["x"], fuell: "y".repeat(STATUS_GRENZEN.zeichen) }),
  ]) assert.equal(leseKnotenStatus(kaputt), null, kaputt.slice(0, 80));
});

test("B-11c: Selbstprüfung im Status – nur Kennungen, Zahlen und Fehlernamen; darf fehlen, ist sie da, zählt nur ganz richtig", () => {
  const einrichtung: KnotenStatus["einrichtung"] = [
    { schiene: "lightning", stufe: "ok", fall: "ln.ok", werte: { min: 1, max: 100_000 } },
    { schiene: "sol", stufe: "hinweis", fall: "sol.wenigGuthaben", werte: { lamports: 0, mindestLamports: 1_000_000 } },
    { schiene: "sol", stufe: "hinweis", fall: "sol.ketteUnerreichbar", werte: { fehler: "FetchError" } },
  ];
  const s = { ...beispiel(), einrichtung };
  assert.deepEqual(leseKnotenStatus(knotenStatusText(s)), s);
  assert.equal("einrichtung" in leseKnotenStatus(knotenStatusText(beispiel()))!, false, "ohne Prüfung kein Feld");
  const gut = JSON.parse(knotenStatusText(s)) as Record<string, unknown>;
  const mit = (b: unknown) => JSON.stringify({ ...gut, einrichtung: [b] });
  for (const kaputt of [
    mit({ schiene: "btc", stufe: "ok", fall: "ln.ok", werte: {} }),
    mit({ schiene: "sol", stufe: "gut", fall: "sol.ok", werte: {} }),
    mit({ schiene: "sol", stufe: "ok", fall: "Zahlkanal an, Adresse des Knotens 7xKX", werte: {} }),
    mit({ schiene: "sol", stufe: "ok", fall: "x.ok", werte: {} }),
    mit({ schiene: "sol", stufe: "ok", fall: "sol.ok" }),
    mit({ schiene: "sol", stufe: "ok", fall: "sol.ok", werte: { adresse: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" } }),
    mit({ schiene: "sol", stufe: "ok", fall: "sol.ok", werte: { fehler: "Fehler: 10.0.0.7" } }),
    mit({ schiene: "sol", stufe: "ok", fall: "sol.ok", werte: { lamports: -1 } }),
    mit({ schiene: "sol", stufe: "ok", fall: "sol.ok", werte: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 } }),
    JSON.stringify({ ...gut, einrichtung: "ok" }),
    JSON.stringify({ ...gut, einrichtung: Array.from({ length: STATUS_GRENZEN.befunde + 1 }, () => einrichtung[0]) }),
  ]) assert.equal(leseKnotenStatus(kaputt), null, kaputt.slice(-120));
});

test("E9-3b: Modelle im Status – eigenes Feld, nur Kennungen, Zahlen, Fehlernamen und Modellnamen; darf fehlen", () => {
  const modellPruefung: KnotenStatus["modellPruefung"] = {
    befunde: [
      { name: "qwen3.8:27b", stufe: "ok", fall: "modell.geprueft", werte: { dateien: 4, bytes: 17_000_000_000 } },
      { name: "nemotron-3.5-lightning", stufe: "hinweis", fall: "modell.ungeprueft", werte: {} },
      { name: "llama4:70b", stufe: "fehler", fall: "modell.passtNicht", werte: { brauchtGb: 48, hatGb: 32 } },
      { name: "gemma4:12b", stufe: "fehler", fall: "modell.ollamaLaden", werte: { fehler: "OllamaFehler" } },
    ],
    laeuft: { name: "mistral:7b", schritt: "laden", geladen: 1_000, gesamt: 4_000, seit: 1_790_000_100 },
  };
  const s = { ...beispiel(), modellPruefung };
  assert.deepEqual(leseKnotenStatus(knotenStatusText(s)), s);
  const ohneLauf = { ...beispiel(), modellPruefung: { befunde: [] } };
  assert.deepEqual(leseKnotenStatus(knotenStatusText(ohneLauf)), ohneLauf, "leer und ohne Laden");
  const vorher = { ...beispiel(), modellPruefung: { befunde: [], laeuft: { name: "mistral:7b", schritt: "manifest" as const, seit: 5 } } };
  assert.deepEqual(leseKnotenStatus(knotenStatusText(vorher)), vorher, "vor dem Laden ohne Bytes");
  assert.equal("modellPruefung" in leseKnotenStatus(knotenStatusText(beispiel()))!, false, "Knoten vor E9-3b: kein Feld");
  // Eine App vor E9-3b liest den Status weiter – das Feld ist neu, nicht in `einrichtung`
  assert.equal(JSON.parse(knotenStatusText(s)).einrichtung, undefined);

  const gut = JSON.parse(knotenStatusText(s)) as Record<string, unknown>;
  const mitBefund = (b: unknown) => JSON.stringify({ ...gut, modellPruefung: { befunde: [b] } });
  const mitLauf = (l: unknown) => JSON.stringify({ ...gut, modellPruefung: { befunde: [], laeuft: l } });
  for (const kaputt of [
    mitBefund({ name: "a:1", stufe: "ok", fall: "ln.ok", werte: {} }),
    mitBefund({ name: "a:1", stufe: "ok", fall: "modell.Ollama meldet: pull model manifest: file does not exist", werte: {} }),
    mitBefund({ name: "a:1", stufe: "gut", fall: "modell.geprueft", werte: {} }),
    mitBefund({ name: "", stufe: "ok", fall: "modell.geprueft", werte: {} }),
    mitBefund({ name: "a\u0000b", stufe: "ok", fall: "modell.geprueft", werte: {} }),
    mitBefund({ name: "x".repeat(STATUS_GRENZEN.modellZeichen + 1), stufe: "ok", fall: "modell.geprueft", werte: {} }),
    mitBefund({ name: "a:1", stufe: "ok", fall: "modell.geprueft", werte: { fehler: "http://10.0.0.7:11434" } }),
    mitBefund({ name: "a:1", stufe: "ok", fall: "modell.geprueft" }),
    mitLauf({ name: "a:1", schritt: "entpacken", seit: 1 }),
    mitLauf({ name: "a:1", schritt: "laden", geladen: -1, seit: 1 }),
    mitLauf({ name: "a:1", schritt: "laden" }),
    JSON.stringify({ ...gut, modellPruefung: { befunde: "ok" } }),
    JSON.stringify({ ...gut, modellPruefung: [] }),
    JSON.stringify({ ...gut, modellPruefung: { befunde: Array.from({ length: STATUS_GRENZEN.modellBefunde + 1 }, () => modellPruefung!.befunde[0]) } }),
  ]) assert.equal(leseKnotenStatus(kaputt), null, kaputt.slice(-160));
});

test("E9-3b: der Knoten schickt nie, was der Leser abwiese – ein Name aus der Umgebung macht den Status nicht unlesbar", () => {
  const s: KnotenStatus = {
    ...beispiel(),
    modellPruefung: {
      befunde: [
        { name: "qwen3.8:27b", stufe: "ok", fall: "modell.geprueft", werte: { dateien: 4, bytes: 1 } },
        { name: "kaputt\nname", stufe: "hinweis", fall: "modell.ungeprueft", werte: {} },
        { name: "b:1", stufe: "fehler", fall: "modell.fehler", werte: { fehler: "Error: ECONNREFUSED 127.0.0.1:11434" } },
        ...Array.from({ length: STATUS_GRENZEN.modellBefunde + 5 }, (_, i) => ({ name: `m${i}:1`, stufe: "hinweis" as const, fall: "modell.wartet", werte: {} })),
      ],
      laeuft: { name: "c:1", schritt: "entpacken" as never, seit: 1 },
    },
  };
  const gelesen = leseKnotenStatus(knotenStatusText(s));
  assert.ok(gelesen, "lesbar");
  assert.equal(gelesen.modellPruefung!.befunde.length, STATUS_GRENZEN.modellBefunde);
  assert.deepEqual(gelesen.modellPruefung!.befunde[0], s.modellPruefung!.befunde[0]);
  assert.ok(!gelesen.modellPruefung!.befunde.some((b) => b.name.includes("\n") || b.name === "b:1"), "Unlesbares fällt weg");
  assert.equal(gelesen.modellPruefung!.laeuft, undefined, "ein unbekannter Schritt fällt weg");
});
