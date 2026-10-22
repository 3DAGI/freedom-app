/**
 * Einem Lauf folgen (VKe, `folgeLauf()`): Kommen Ausgabe und Ergebnis in derselben Abfrage, gehen erst alle Schritte
 * an die Seite, dann das Ende – der Pool sortiert nach Sekunde, neu zuerst, und das Ergebnis stand sonst vorn: Die
 * Ausgabe ging verloren (Smoke-Teil „projekt“, gefunden in A-21e1). Ebenso vor einer Ablehnung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_DVM_KNOTEN_CODE, LocalSigner, buildEvent, buildJobResult, buildPrivateJobResponse, codeAntwortText, codeSchrittText,
  generateKeypair, signEvent, type CodeSchritt, type NostrEvent,
} from "@freedomstack/protocol";

// state.ts und tresor.ts lesen localStorage beim Laden – vor dem Import bereitstellen.
const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => { ls.set(k, String(v)); },
  removeItem: (k: string) => { ls.delete(k); },
  key: (i: number) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};
const { folgeLauf } = await import("../src/shell/knoten-weg-ui.js");

const knoten = generateKeypair();
const sitzung = new LocalSigner(generateKeypair().sk);
const auftrag = "c".repeat(64);
const versiegelt = async (ev: ReturnType<typeof buildEvent>): Promise<NostrEvent> =>
  (await buildPrivateJobResponse({ response: signEvent(ev, knoten.sk), providerSigner: new LocalSigner(knoten.sk), sessionPk: sitzung.publicKey() })).wrap;
const schritt = (s: CodeSchritt) => versiegelt(buildEvent(knoten.pk, 7000, [["e", auftrag], ["p", sitzung.publicKey()], ["status", "partial"]], codeSchrittText(s)));
const ergebnis = () => versiegelt(buildJobResult({
  providerPubkey: knoten.pk, requestId: auftrag, requestKind: KIND_DVM_KNOTEN_CODE, customerPubkey: sitzung.publicKey(),
  output: codeAntwortText({ aktion: "auftrag", ende: "fertig", schritte: 1, abschluss: "Fertig." }), amountMsat: 0,
}));
const ablehnung = () => versiegelt(buildEvent(knoten.pk, 7000, [["e", auftrag], ["p", sitzung.publicKey()], ["status", "error"], ["fall", "code-belegt"]], "belegt"));

function weg(abfragen: NostrEvent[][]) {
  let i = 0;
  return { sitzungPk: sitzung.publicKey(), publish: async () => {}, query: async () => abfragen[Math.min(i++, abfragen.length - 1)]!, schliesse: () => {} };
}

test("VKe: Ausgabe und Ergebnis in einer Abfrage, das Ergebnis vorn – die Ausgabe kommt trotzdem an, dann das Ende", async () => {
  const ausgabe: CodeSchritt = { nr: 1, art: "ausgabe", ausgabe: "hallo", code: 0, gekuerzt: false };
  const gesehen: CodeSchritt[] = [];
  const r = await folgeLauf(weg([[await ergebnis(), await schritt(ausgabe)]]), sitzung, auftrag, {
    zeitMs: 2_000, taktMs: 1, schritt: (s) => gesehen.push(s),
  });
  assert.deepEqual(gesehen, [ausgabe]);
  assert.ok(r && "ergebnis" in r && JSON.parse(r.ergebnis).ende === "fertig", JSON.stringify(r));
});

test("VKe: vor einer Ablehnung ebenso erst die Schritte; ohne Ende weiter nachfragen, jeder Umschlag nur einmal", async () => {
  const befehl: CodeSchritt = { nr: 1, art: "befehl", gedanke: "", befehl: "ls", wartet: false };
  const s1 = await schritt(befehl);
  const gesehen: CodeSchritt[] = [];
  const r = await folgeLauf(weg([[s1], [s1, await ablehnung(), await schritt({ nr: 1, art: "ausgabe", ausgabe: "x", code: 1, gekuerzt: false })]]),
    sitzung, auftrag, { zeitMs: 2_000, taktMs: 1, schritt: (s) => gesehen.push(s) });
  assert.deepEqual(gesehen.map((s) => [s.nr, s.art]), [[1, "befehl"], [1, "ausgabe"]], "der erste Schritt nur einmal");
  assert.deepEqual(r, { abgelehnt: "belegt", fall: "code-belegt" });
});
