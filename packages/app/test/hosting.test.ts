/**
 * Schritt 5.3a: Hosting-Anteil – die App liest freedom-spiegel.json von ihrer
 * eigenen Herkunft (neben freedom.html) und gibt das Zahlziel an die
 * Aufteilung; ohne Datei oder mit Platzhaltern bleibt der Anteil beim Provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { solReferenz } from "@freedomstack/protocol";

const SOL = solReferenz(new Uint8Array(32).fill(6));

test("5.3a: Zahlziel aus der Spiegel-Datei neben freedom.html – einmal je Sitzung, von der eigenen Herkunft", async () => {
  const g = globalThis as unknown as { location?: unknown; fetch: typeof fetch };
  const altFetch = g.fetch;
  const gefragt: string[] = [];
  g.location = { protocol: "https:", href: "https://spiegel.beispiel.org/ipfs/bafy/freedom.html" };
  g.fetch = (async (u: URL) => {
    gefragt.push(String(u));
    return new Response(JSON.stringify({ version: 1, zahlziel: { lud16: "PLATZHALTER:x", sol: SOL } }));
  }) as unknown as typeof fetch;
  try {
    const { hostingZahlziel } = await import("../src/shell/hosting.js");
    assert.deepEqual(await hostingZahlziel(), { sol: SOL }, "Platzhalter zählt nicht");
    await hostingZahlziel();
    assert.deepEqual(gefragt, ["https://spiegel.beispiel.org/ipfs/bafy/freedom-spiegel.json"], "neben freedom.html, nur einmal");
  } finally {
    g.fetch = altFetch;
    delete g.location;
  }
});

test("5.3a: Verdrahtung – Hosting in den Empfängern eines Auftrags; Build legt die Datei neben die App und füllt die Quellen", () => {
  const ki = readFileSync(new URL("../src/shell/ki-zahlung.ts", import.meta.url), "utf8");
  assert.match(ki, /const hosting = await hostingZahlziel\(\);\s*return \{/);
  assert.match(ki, /\.\.\.\(relays\.length > 0 \? \{ relays \} : \{\}\),\s*\.\.\.\(hosting \? \{ hosting \} : \{\}\),\s*\};/);
  const bau = readFileSync(new URL("../../../scripts/build-site.sh", import.meta.url), "utf8");
  assert.match(bau, /cp "\$ROOT\/spiegel\/freedom-spiegel\.json" "\$OUT"\/freedom-spiegel\.json/);
  assert.match(bau, /npx --no-install tsx scripts\/spiegel-quellen\.mts/);
  const start = readFileSync(new URL("../../website/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(start, /Alle Builds auch über IPFS\/Arweave\/Tor erreichbar/, "stimmte nie");
  assert.match(start, /<ul id="quellen"><!-- QUELLEN -->/);
});
