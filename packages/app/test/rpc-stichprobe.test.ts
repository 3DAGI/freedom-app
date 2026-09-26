/**
 * Schritt 5.8: Stichprobe gegen einen zweiten RPC-Anbieter in der App – wann
 * sie laeuft, was sie sagt und dass sie im echten Pfad haengt (Settings und
 * Wallet). Den Vergleich selbst prueft `protocol/test/rpc-pool.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RpcPool } from "@freedomstack/protocol";
import { STICHPROBE_ABSTAND_MS, stichprobeFaellig, stichprobenKonto, stichprobeText } from "../src/rpc-stichprobe.js";

test("5.8: hoechstens alle zehn Minuten, je Stichprobe genau eine eigene Adresse", () => {
  assert.equal(stichprobeFaellig(undefined, 1_000), true);
  assert.equal(stichprobeFaellig(1_000, 1_000 + STICHPROBE_ABSTAND_MS - 1), false);
  assert.equal(stichprobeFaellig(1_000, 1_000 + STICHPROBE_ABSTAND_MS), true);
  assert.equal(stichprobenKonto([]), undefined);
  assert.equal(stichprobenKonto(["A", "B", "C"], () => 0), "A");
  assert.equal(stichprobenKonto(["A", "B", "C"], () => 0.5), "B");
  assert.equal(stichprobenKonto(["A", "B", "C"], () => 0.9999999), "C");
});

test("5.8: Warnung nur bei Widerspruch – „nicht vergleichbar“ ist keine Entwarnung", () => {
  assert.deepEqual(stichprobeText({ anbieter: ["A", "B"], verglichen: ["netz", "blockhash", "kontostand"], warnungen: [], hinweise: [] }),
    { text: "Stichprobe A ↔ B: letzter Blockhash und Kontostand stimmen überein.", stufe: "ok" });
  assert.deepEqual(stichprobeText({ anbieter: ["A", "B"], verglichen: ["netz", "blockhash"], warnungen: [], hinweise: [] }),
    { text: "Stichprobe A ↔ B: letzter Blockhash stimmt überein.", stufe: "ok" });
  assert.deepEqual(stichprobeText({ anbieter: ["A", "B"], verglichen: ["netz", "blockhash"], warnungen: ["Kontostand weicht ab."], hinweise: [] }),
    { text: "Achtung, RPC-Anbieter widersprechen sich: Kontostand weicht ab.", stufe: "warnung" });
  // Nur das Netz verglichen (Blockhash blieb offen) → offen, nicht „ok“.
  assert.equal(stichprobeText({ anbieter: ["A", "B"], verglichen: ["netz"], warnungen: [], hinweise: ["Blockhash A → B: hinkt hinterher"] }).stufe, "offen");
  assert.deepEqual(stichprobeText({ anbieter: ["A"], verglichen: [], warnungen: [], hinweise: [] }),
    { text: "Stichprobe nicht möglich: keine Antwort", stufe: "offen" });
});

test("5.8: ein Anbieter mit falschem Kontostand wird in der App zur Warnung", async () => {
  const kontostand: Record<string, number> = { "https://a.test": 5, "https://b.test": 9 };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    const ergebnis = {
      getGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      getLatestBlockhash: { context: { slot: 7 }, value: { blockhash: "9zZkXyQm3vH7cP2rT8wLbN4sJfGdKa6uEo1xYiRqWn5B" } },
      isBlockhashValid: { context: { slot: 7 }, value: true },
      getBalance: { context: { slot: 7 }, value: kontostand[url.toString()] },
    }[method];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: ergebnis }));
  }) as unknown as typeof fetch;
  const pool = new RpcPool([{ url: "https://a.test", label: "A" }, { url: "https://b.test", label: "B" }], { fetchImpl });
  const t = stichprobeText(await pool.stichprobe({ konto: stichprobenKonto(["Kunde1111111111111111111111111111111111111"]) }));
  assert.equal(t.stufe, "warnung");
  assert.match(t.text, /Kontostand weicht ab: A meldet 5 Lamports, B 9\./);
});

test("5.8 verdrahtet: Settings ohne Adresse, Wallet mit einer zufaelligen eigenen – Anzeige nur ueber textContent", () => {
  const state = readFileSync(new URL("../src/shell/state.ts", import.meta.url), "utf8");
  assert.match(state, /const t = stichprobeText\(await pool\.stichprobe\(\)\);[\s\S]{0,200}zeile\.textContent = t\.text;\s*status\.append\(zeile\);/);
  assert.match(state, /return \(await ensureRpcPool\(\)\)\.stichprobe\(\{ konto \}\);/);

  const wallet = readFileSync(new URL("../src/shell/eingebaute-wallet.ts", import.meta.url), "utf8");
  const nachGuthaben = wallet.slice(wallet.indexOf('$("#solw-guthaben").textContent = `Guthaben: '));
  assert.match(nachGuthaben.slice(0, 250), /void guthabenStichprobe\(adressen\);/, "nach der Guthaben-Anzeige");
  assert.match(wallet, /if \(!stichprobeFaellig\(letzteStichprobe, Date\.now\(\)\)\) return;/);
  assert.match(wallet, /await rpcStichprobe\(stichprobenKonto\(adressen\)\)/);
  assert.match(wallet, /feld\.textContent = t\.stufe === "warnung" \? t\.text : "";/);

  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="solw-rpc" class="mono-sm err" role="status"><\/div>/);
  assert.match(html, /Voreingestellt sind vier Anbieter verschiedener Betreiber/);
});
