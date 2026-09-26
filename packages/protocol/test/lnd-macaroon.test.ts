/**
 * Schritt 8.3: Rechte einer LND-Macaroon lesen – der LP-Daemon startet nur
 * mit genau Rechnungen und Zahlungen, nie mit admin.macaroon.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LP_RECHTE_NOETIG, macaroonRechte, pruefeLpMacaroon } from "../src/lnd-macaroon.js";

/** Varint und Felder wie in LND (Macaroon v2 binaer, Kennung Version 3 + Protobuf). */
const varint = (n: number): number[] => { const o: number[] = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; };
const pb = (nr: number, d: number[]) => [...varint(nr * 8 + 2), ...varint(d.length), ...d];
const s = (t: string) => [...new TextEncoder().encode(t)];
function macaroon(ops: Record<string, string[]>): string {
  const id = [3, ...pb(1, Array(16).fill(7)), ...pb(2, [0x30]),
    ...Object.entries(ops).flatMap(([e, a]) => pb(3, [...pb(1, s(e)), ...a.flatMap((x) => pb(2, s(x)))]))];
  const bytes = [2, 1, ...varint(3), ...s("lnd"), 2, ...varint(id.length), ...id, 0, 0, 6, 32, ...Array(32).fill(9)];
  return Buffer.from(bytes).toString("hex");
}
const ADMIN = { address: ["read", "write"], info: ["read", "write"], invoices: ["read", "write"], macaroon: ["generate", "read", "write"],
  message: ["read", "write"], offchain: ["read", "write"], onchain: ["read", "write"], peers: ["read", "write"], signer: ["generate", "read"] };
const LP = { info: ["read"], invoices: ["read", "write"], offchain: ["read", "write"] };

test("8.3: Rechte werden gelesen wie in lncli printmacaroon – Anfang wie bei echten LND-Macaroons", () => {
  const hex = macaroon(LP);
  assert.ok(hex.startsWith("0201036c6e6402"), "Version 2, Ort „lnd“, dann die Kennung");
  assert.deepEqual(macaroonRechte(hex), [
    { entity: "info", actions: ["read"] }, { entity: "invoices", actions: ["read", "write"] }, { entity: "offchain", actions: ["read", "write"] },
  ]);
});

test("8.3: gebackene LP-Macaroon passt, admin.macaroon nicht", () => {
  assert.deepEqual(pruefeLpMacaroon(macaroon(LP)), { ok: true });
  assert.deepEqual(pruefeLpMacaroon(macaroon({ invoices: ["read", "write"], offchain: ["read", "write"] })), { ok: true }, "info:read ist nicht noetig");
  const admin = pruefeLpMacaroon(macaroon(ADMIN));
  assert.equal(admin.ok, false);
  assert.match((admin as { grund: string }).grund, /zu viel: .*macaroon:generate.*onchain:write.*peers:write/);
});

test("8.3: jedes zusätzliche Recht ist zu viel, jedes fehlende fehlt", () => {
  for (const extra of ["onchain:read", "peers:write", "macaroon:generate", "signer:generate", "address:write", "info:write"]) {
    const [e, a] = extra.split(":");
    const ops: Record<string, string[]> = { ...LP, [e!]: [...(LP[e as keyof typeof LP] ?? []), a!] };
    assert.equal(pruefeLpMacaroon(macaroon(ops)).ok, false, extra);
  }
  for (const weg of LP_RECHTE_NOETIG) {
    const [e, a] = weg.split(":");
    const ops = Object.fromEntries(Object.entries(LP).map(([k, v]) => [k, k === e ? v.filter((x) => x !== a) : v]));
    assert.match((pruefeLpMacaroon(macaroon(ops)) as { grund: string }).grund, new RegExp(`fehlt: ${weg}`));
  }
  assert.match((pruefeLpMacaroon(macaroon({})) as { grund: string }).grund, /fehlt: invoices:read, invoices:write, offchain:read, offchain:write/);
});

test("8.3: Unlesbares wird abgelehnt, nicht durchgewinkt", () => {
  for (const kaputt of ["", "zz", "0301036c6e64", "0201036c6e64", "02010a", macaroon(LP).slice(0, 40), "0201036c6e640205" + "04aabbccdd"]) {
    const r = pruefeLpMacaroon(kaputt);
    assert.equal(r.ok, false, kaputt);
    assert.match((r as { grund: string }).grund, /nicht lesbar/);
  }
});
