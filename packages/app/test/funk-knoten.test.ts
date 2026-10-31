/**
 * B-32d3b: KI über Funk mit RNode an den eigenen Knoten – seine LXMF-Adresse aus dem Status (nur an den Besitzer), der
 * Auftrag mit Besitzer-Nachweis und ohne Gebot (der Knoten rechnet den Besitzer gratis), gesendet an diese Adresse, nie an
 * die Gegenstelle. Die Antwort kommt über den Rückweg des Knotens (B-32d3a) und denselben Empfang wie Meshtastic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_FUNK_WEITERLEITUNG, LocalSigner, generateKeypair, getTag, giftUnwrapMitSigner, istBesitzer, neueKopplung, openPrivateKundenEvent,
} from "@freedomstack/protocol";
import { baueFunkAuftrag, leseFunkKnoten } from "../src/ki-funk.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const KNOTEN = "ab".repeat(32);
const LXMF = "7f3a".repeat(8);

test("B-32d3b: der gemerkte Knoten – nur Schlüssel, Adresse und Rechenarbeit in genau dieser Form", () => {
  assert.deepEqual(leseFunkKnoten(JSON.stringify({ knoten: KNOTEN, lxmf: LXMF, powBits: 8 })), { knoten: KNOTEN, lxmf: LXMF, powBits: 8 });
  for (const kaputt of [
    null, "", "{", "[]", JSON.stringify({ knoten: KNOTEN, lxmf: LXMF }), JSON.stringify({ knoten: "zz".repeat(32), lxmf: LXMF, powBits: 8 }),
    JSON.stringify({ knoten: KNOTEN, lxmf: LXMF.toUpperCase(), powBits: 8 }), JSON.stringify({ knoten: KNOTEN, lxmf: `<${LXMF}>`, powBits: 8 }),
    JSON.stringify({ knoten: KNOTEN, lxmf: LXMF, powBits: 17 }), JSON.stringify({ knoten: KNOTEN, lxmf: LXMF, powBits: -1 }),
  ]) assert.equal(leseFunkKnoten(kaputt), null, String(kaputt));
});

test("B-32d3b: der Auftrag an den eigenen Knoten – Nachweis im versiegelten Kern, ohne Gebot; die Weiterleitung an ihn", async () => {
  const knoten = generateKeypair();
  const kopplung = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const a = await baueFunkAuftrag({ prompt: "Wie reinige ich Wasser?", bidMsat: 0, gateway: { pubkey: knoten.pk, powBits: 0, seit: 0 }, sitzung, kopplung });
  // Offen nur der Empfänger – Geheimnis und Nachweis stehen nur im Kern
  assert.deepEqual(a.auftrag.tags, [["p", knoten.pk]]);
  assert.ok(!JSON.stringify(a.auftrag).includes(kopplung.geheimnis));
  const r = await openPrivateKundenEvent(a.auftrag, new LocalSigner(knoten.sk));
  assert.ok(r.ok);
  assert.equal(r.request.id, a.requestId);
  assert.equal(getTag(r.request, "bid"), "0");
  assert.ok(istBesitzer(r.request, [kopplung.geheimnis], r.request.created_at), "der Knoten erkennt seinen Besitzer");
  const w = await giftUnwrapMitSigner(a.weiterleitung, new LocalSigner(knoten.sk));
  assert.ok(w.ok && w.inner?.kind === KIND_FUNK_WEITERLEITUNG, "die Weiterleitung an den Knoten als Gateway");
  // Ohne Kopplung kein Nachweis (Meshtastic-Gateway wie bisher)
  const fremd = await baueFunkAuftrag({ prompt: "x", bidMsat: 0, gateway: { pubkey: knoten.pk, powBits: 0, seit: 0 }, sitzung });
  const f = await openPrivateKundenEvent(fremd.auftrag, new LocalSigner(knoten.sk));
  assert.ok(f.ok && !istBesitzer(f.request, [kopplung.geheimnis], f.request.created_at));
});

test("B-32d3b: verdrahtet – Adresse aus dem Status, nur passend zur Kopplung, im Tresor; gratis an den Knoten, nie an die Gegenstelle", () => {
  const status = lies("shell/knoten-status-ui.ts");
  assert.match(status, /if \(s\) await merkeFunkKnoten\(k\.knoten, s\.lxmf, powBits\);/, "nur aus dem gelesenen Status");
  assert.match(status, /if \(lxmf\) await geheim\.setItem\(LS_RETICULUM_KNOTEN, JSON\.stringify\(\{ knoten, lxmf, powBits \}\)\);\n\s+else await geheim\.removeItem\(LS_RETICULUM_KNOTEN\);/);
  const funk = lies("shell/ki-ueber-funk.ts");
  assert.match(funk, /if \(!f \|\| !kopplung \|\| kopplung\.knoten !== f\.knoten\) return null;/, "nur der gekoppelte Knoten");
  assert.match(funk, /const hoechst = !eigen && Number\.isFinite\(bidSats\)/, "an den eigenen Knoten nie ein Gebot, keine Gutschrift");
  assert.match(funk, /zahlTags: kanal\?\.tags, kopplung: eigen\?\.kopplung,/);
  assert.match(lies("ki-funk.ts"), /const request = p\.kopplung \? mitBesitzerNachweis\(kern, p\.kopplung\) : kern;/, "der Nachweis vor dem Versiegeln");
  const ui = lies("shell/rnode-ui.ts");
  const senden = ui.slice(ui.indexOf("export async function sendeAnKnotenUeberReticulum"), ui.indexOf("export const rnodeLaeuft"));
  assert.match(senden, /const an = leseLxmfAdresse\(lxmf\);/);
  assert.doesNotMatch(senden, /GEGENSTELLE/, "an den Knoten, nie an die Gegenstelle");
  assert.match(lies("shell/tresor.ts"), /const GEHEIM_FEST = \[[^\]]*"freedom\.reticulum\.knoten"/, "verrät, über wen man funkt – im Tresor");
  assert.match(lies("reticulum-funk.ts"), /export const LS_RETICULUM_KNOTEN = "freedom\.reticulum\.knoten";/, "unter freedom.reticulum. – nie in der Sicherung");
});
