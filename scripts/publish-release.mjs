#!/usr/bin/env node
/**
 * Veroeffentlicht ein signiertes Release-Manifest auf den Relays.
 *
 * WARUM AUF DEN RELAYS UND NICHT NEBEN DER DATEI
 * Ein Manifest, das auf demselben Server liegt wie die Datei, ist wertlos: Wer
 * die Datei austauschen kann, tauscht das Manifest mit aus. Erst wenn die
 * Pruefsumme an einem anderen Ort steht — signiert, auf Relays, die dem
 * Verteiler nicht gehoeren — ist sie ein Beweis.
 *
 * Aufruf:
 *   RELEASE_SECRET_KEY=<hex64> node scripts/publish-release.mjs 1.2.0
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const version = process.argv[2];
if (!version) {
  console.error("Aufruf: node scripts/publish-release.mjs <version>");
  process.exit(1);
}

const sk = process.env.RELEASE_SECRET_KEY;
if (!sk || !/^[0-9a-f]{64}$/i.test(sk)) {
  console.error(
    "RELEASE_SECRET_KEY fehlt (64 Hex-Zeichen).\n" +
    "Dieser Schluessel ist der Vertrauensanker der gesamten Verteilung — er\n" +
    "gehoert offline, nicht in eine CI-Variable.",
  );
  process.exit(1);
}

const datei = "packages/app/dist/freedom.html";
const html = await readFile(datei);
const sha = createHash("sha256").update(html).digest("hex");

const { buildReleaseManifest, signEvent, keypairFromSecret, OutboxPool, WebSocketRelay } =
  await import("../packages/protocol/src/index.ts");

const sourcesRaw = process.env.RELEASE_SOURCES ?? "https://freedomstack.io/freedom.html";
const sources = sourcesRaw.split(",").map((s) => s.trim()).filter(Boolean);
if (sources.length < 2) {
  console.warn(
    "! Nur eine Bezugsquelle angegeben. Faellt sie aus, hilft das Manifest nur\n" +
    "  beim Pruefen, nicht beim Beschaffen. RELEASE_SOURCES mit magnet:/ipfs://\n" +
    "  ergaenzen.",
  );
}

const kp = keypairFromSecret(Uint8Array.from(Buffer.from(sk, "hex")));
const unsigned = buildReleaseManifest(
  {
    version,
    releasedAt: Math.floor(Date.now() / 1000),
    artifacts: [{ name: "freedom.html", sha256: sha, sizeBytes: html.length }],
    sources,
    notes: process.env.RELEASE_NOTES,
  },
  kp.pk,
);
const ev = signEvent(unsigned, kp.sk);

const relays = (process.env.RELEASE_RELAYS ?? "wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band")
  .split(",").map((u) => new WebSocketRelay(u.trim()));
const pool = new OutboxPool(relays, { minAcks: 1 });

const report = await pool.publish(ev);
console.log(`Version   : ${version}`);
console.log(`sha256    : ${sha}`);
console.log(`Signierer : ${kp.pk}`);
console.log(`Quellen   : ${sources.join(", ")}`);
console.log(`Relays ok : ${report.accepted.length}/${relays.length}`);
console.log("");
console.log("Diesen Pubkey in TRUSTED_SIGNERS der App eintragen, sonst prueft");
console.log("die App gegen niemanden.");
for (const r of relays) r.close?.();
