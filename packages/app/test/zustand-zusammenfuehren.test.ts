/**
 * Zusammenführen statt Überschreiben (B-5): Was nur auf dem Gerät steht,
 * bleibt; Einzelwerte kommen wie bisher aus der Sicherung; Konflikte gezählt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fuehreZusammen } from "../src/zustand-zusammenfuehren.js";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const lies = (werte: Record<string, string>) => (k: string) => werte[k] ?? null;

test("B-5: Unterhaltungen – beide Seiten bleiben, je Kennung die zuletzt aktive Fassung", () => {
  const sicherung = { "freedom.chats": JSON.stringify([{ id: A, type: "dm", name: "Alice", lastTs: 100 }, { id: B, type: "dm", name: "Bob", lastTs: 300 }]) };
  const lokal = { "freedom.chats": JSON.stringify([{ id: A, type: "dm", name: "Alice", lastTs: 200, ablaufSecs: 3600 }, { id: C, type: "dm", name: "Carol", lastTs: 50 }]) };
  const { werte, bericht } = fuehreZusammen(sicherung, lies(lokal));
  const chats = JSON.parse(werte["freedom.chats"]!) as Array<{ id: string; lastTs: number; ablaufSecs?: number }>;
  assert.deepEqual(chats.map((c) => c.id), [B, A, C], "nach Aktivität sortiert");
  assert.equal(chats.find((c) => c.id === A)?.ablaufSecs, 3600, "hier später geändert – die Fassung von hier");
  assert.deepEqual(bericht, { erhalten: 2, konflikte: 0 });
});

test("B-5: Räume und Kataloge vereinigt, Kataloge höchstens 20", () => {
  const sicherung = { "freedom.spaces": JSON.stringify(["r1", "r2"]), "freedom.kataloge": JSON.stringify(Array.from({ length: 19 }, (_, i) => `k${i}`)) };
  const lokal = { "freedom.spaces": JSON.stringify(["r2", "r3"]), "freedom.kataloge": JSON.stringify(["k0", "neu1", "neu2"]) };
  const { werte } = fuehreZusammen(sicherung, lies(lokal));
  assert.deepEqual(JSON.parse(werte["freedom.spaces"]!), ["r1", "r2", "r3"]);
  const kat = JSON.parse(werte["freedom.kataloge"]!) as string[];
  assert.equal(kat.length, 20);
  assert.ok(kat.includes("neu1") && !kat.includes("neu2"), "bis zur Grenze");
});

test("B-5: Lesestände und geprüfte Kontakte – je Eintrag das Späteste", () => {
  const sicherung = { "freedom.lastRead": JSON.stringify({ k1: 100, k2: 500 }), "freedom.kontakte.geprueft": JSON.stringify({ [A]: 10 }) };
  const lokal = { "freedom.lastRead": JSON.stringify({ k1: 300, k2: 200, k3: 50 }), "freedom.kontakte.geprueft": JSON.stringify({ [B]: 20 }) };
  const { werte } = fuehreZusammen(sicherung, lies(lokal));
  assert.deepEqual(JSON.parse(werte["freedom.lastRead"]!), { k1: 300, k2: 500, k3: 50 });
  assert.deepEqual(JSON.parse(werte["freedom.kontakte.geprueft"]!), { [A]: 10, [B]: 20 });
});

test("B-5: Mandate – je Kontakt das zuerst gesehene, auch wenn es hier steht", () => {
  const sicherung = { "freedom.mandate": JSON.stringify({ [A]: { neu: B, gesehen: 500 } }) };
  const lokal = { "freedom.mandate": JSON.stringify({ [A]: { neu: C, gesehen: 100 }, [B]: { neu: C, gesehen: 700 } }) };
  const { werte } = fuehreZusammen(sicherung, lies(lokal));
  assert.deepEqual(JSON.parse(werte["freedom.mandate"]!), { [A]: { neu: C, gesehen: 100 }, [B]: { neu: C, gesehen: 700 } });
  const umgekehrt = fuehreZusammen({ "freedom.mandate": JSON.stringify({ [A]: { neu: B, gesehen: 50 } }) }, lies(lokal));
  assert.deepEqual(JSON.parse(umgekehrt.werte["freedom.mandate"]!)[A], { neu: B, gesehen: 50 }, "früher in der Sicherung gesehen – das gilt");
});

test("B-5: Namen – beide Seiten, verschieden gilt die Sicherung und zählt als Konflikt", () => {
  const sicherung = { "freedom.petnames": JSON.stringify({ [A]: "Alice", [B]: "Bob" }) };
  const lokal = { "freedom.petnames": JSON.stringify({ [A]: "Ali", [C]: "Carol" }) };
  const { werte, bericht } = fuehreZusammen(sicherung, lies(lokal));
  assert.deepEqual(JSON.parse(werte["freedom.petnames"]!), { [A]: "Alice", [B]: "Bob", [C]: "Carol" });
  assert.deepEqual(bericht, { erhalten: 1, konflikte: 1 });
});

test("B-5: Einzelwerte wie bisher aus der Sicherung; Unlesbares fällt auf die Sicherung zurück", () => {
  const sicherung = { "freedom.lang": "en", "freedom.profile": JSON.stringify({ name: "Neu" }), "freedom.chats": JSON.stringify([{ id: A, lastTs: 1 }]) };
  const lokal = { "freedom.lang": "de", "freedom.profile": JSON.stringify({ name: "Alt" }), "freedom.chats": "{kaputt" };
  const { werte, bericht } = fuehreZusammen(sicherung, lies(lokal));
  assert.equal(werte["freedom.lang"], "en");
  assert.equal(werte["freedom.profile"], sicherung["freedom.profile"]);
  assert.equal(werte["freedom.chats"], sicherung["freedom.chats"], "kaputt hier – die Sicherung, nichts erfunden");
  assert.deepEqual(bericht, { erhalten: 0, konflikte: 0 });
  assert.deepEqual(Object.keys(werte).sort(), Object.keys(sicherung).sort(), "nur Einträge der Sicherung werden geschrieben");
});

test("B-5: verdrahtet – Wiederherstellen und Einlesen führen zusammen, erst nach Rückfrage", () => {
  const s = ["settings", "sicherung", "mesh"].map((d) => readFileSync(new URL(`../src/shell/tabs/${d}.ts`, import.meta.url), "utf8")).join("\n");
  const wieder = s.slice(s.indexOf("async function stelleZustandWieder("), s.indexOf("async function stelleZustandWieder(") + 2500);
  assert.match(wieder, /const \{ werte, bericht \} = fuehreZusammen\(daten, \(k\) => \(istGeheimnis\(k\) \? geheim\.getItem\(k\) : localStorage\.getItem\(k\)\)\);/);
  assert.ok(wieder.indexOf("await bestaetige(") < wieder.indexOf("for (const [k, v] of Object.entries(werte))"), "erst fragen, dann schreiben");
  assert.doesNotMatch(wieder, /confirm\(/, "kein Browser-Dialog mehr");
});
