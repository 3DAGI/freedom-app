/**
 * B-32d1: Reticulum-Bausteine im Protokoll (RN-W8 A, RN-W10 A, `docs/RETICULUM-ENTWURF.md`) – Funkwerte je Region,
 * Identität und LXMF-Umschlag ohne App: so, wie der Knoten (B-32d2) sie braucht. Die Fälle mit RNode-Attrappe, Wahl und
 * Oberfläche prüft weiter die App.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair } from "../src/event.js";
import { buildPrivateDm } from "../src/private-dm.js";
import { MeshKind } from "../src/mesh-transport.js";
import { FUNK_REGIONEN, maxSendeleistungDbm, pruefeFunkParameter, rnodeOptionen, rnodeSendezeit } from "../src/funk-region.js";
import {
  LS_RETICULUM_IDENTITAET, ReticulumFehler, entpackeAusReticulum, leseLxmfAdresse, lxmfAdresse, reticulumIdentitaet, verpackeFuerReticulum,
} from "../src/reticulum-umschlag.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("B-32d1: Funkwerte ohne App – die Vorgabe jeder Region gilt, die Sperre der Region geht mit, außerhalb nichts", () => {
  for (const r of FUNK_REGIONEN) {
    // Der Knoten kennt keine bestätigte Wahl – nur Region und Parameter (RETICULUM_REGION)
    assert.deepEqual(rnodeOptionen({ region: r.kennung, parameter: r.vorgabe }), { ...r.vorgabe, airtimeLimitLong: r.maxSendezeitProzent });
    assert.ok(r.vorgabe.txPower <= maxSendeleistungDbm(r), `${r.kennung}: Vorgabe unter der Grenze`);
    const zuStark = { ...r.vorgabe, txPower: maxSendeleistungDbm(r) + 1 };
    assert.deepEqual(pruefeFunkParameter(r.kennung, zuStark), { ok: false, fall: "leistung" });
    assert.throws(() => rnodeOptionen({ region: r.kennung, parameter: zuStark }), RangeError);
  }
  assert.throws(() => rnodeOptionen({ region: "us-915", parameter: FUNK_REGIONEN[0]!.vorgabe }), RangeError, "keine Region ohne Quelle");
  // Ein volles Paket kostet mehr als ein kurzes – über 254 Byte zwei Rahmen
  const p = FUNK_REGIONEN[0]!.vorgabe;
  assert.ok(rnodeSendezeit(p, 500) > rnodeSendezeit(p, 254) && rnodeSendezeit(p, 254) > rnodeSendezeit(p, 10));
});

test("B-32d1: Identität und Umschlag ohne App – ein beliebiger Speicher, hin und zurück, Adressen aus Text", async () => {
  const daten = new Map<string, string>();
  const speicher = { getItem: (k: string) => daten.get(k) ?? null, setItem: async (k: string, v: string) => void daten.set(k, v) };
  const a = await reticulumIdentitaet(speicher);
  assert.match(daten.get(LS_RETICULUM_IDENTITAET)!, /^[0-9a-f]{128}$/);
  assert.equal(hex(await lxmfAdresse(await reticulumIdentitaet(speicher))), hex(await lxmfAdresse(a)), "beim zweiten Mal dieselbe");
  const b = await reticulumIdentitaet({ getItem: () => null, setItem: async () => undefined });
  const anB = await lxmfAdresse(b);

  const [alice, bob] = [generateKeypair(), generateKeypair()];
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "Treffen um 19 Uhr" });
  const roh = new TextEncoder().encode(JSON.stringify(dm.toRecipient));
  const draht = await verpackeFuerReticulum({ payload: roh, kind: MeshKind.NostrEvent, von: a, an: anB, eigeneSchluessel: [alice.pk] });
  assert.deepEqual(await entpackeAusReticulum(draht, anB), { kind: MeshKind.NostrEvent, payload: roh });
  assert.equal(await entpackeAusReticulum(draht, await lxmfAdresse(a)), null, "nur an die eigene Adresse");
  await assert.rejects(
    verpackeFuerReticulum({ payload: roh, kind: MeshKind.NostrEvent, von: a, an: anB, eigeneSchluessel: [bob.pk] }),
    (e: unknown) => e instanceof ReticulumFehler && e.fall === "inhalt",
    "nie die eigene DM-Kopie",
  );

  assert.equal(hex(leseLxmfAdresse(`<${hex(anB)}>`)!), hex(anB));
  for (const kaputt of ["", "zz".repeat(16), "ab".repeat(15), "ab".repeat(17), null]) assert.equal(leseLxmfAdresse(kaputt), null, String(kaputt));
});
