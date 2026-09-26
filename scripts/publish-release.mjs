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
 * K VON N (Schritt 5.2)
 * Die App erkennt eine Version erst als echt, wenn mindestens
 * RELEASE_MIN_SIGNATUREN (2) verschiedene Signierer aus TRUSTED_SIGNERS
 * dieselbe Nutzlast (Version + Dateien mit Pruefsumme) veroeffentlicht haben.
 * Jeder Signierer baut dieselbe Datei und fuehrt dieses Skript mit SEINEM
 * Schluessel aus – auf seinem Geraet. Der ausgegebene Nutzlast-Hash muss bei
 * allen gleich sein; Quellen und Notizen duerfen abweichen.
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

const { buildReleaseManifest, signEvent, keypairFromSecret, OutboxPool, WebSocketRelay, nutzlast, RELEASE_MIN_SIGNATUREN } =
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
const artifacts = [{ name: "freedom.html", sha256: sha, sizeBytes: html.length }];
const unsigned = buildReleaseManifest(
  {
    version,
    releasedAt: Math.floor(Date.now() / 1000),
    artifacts,
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
console.log(`Nutzlast  : ${nutzlast({ version, artifacts })}`);
console.log("");
console.log(`Echt wird diese Version erst, wenn ${RELEASE_MIN_SIGNATUREN} Signierer aus TRUSTED_SIGNERS`);
console.log("dieselbe Nutzlast veroeffentlicht haben – den Hash oben mit den anderen vergleichen.");
console.log("Neue Signierer: Pubkey in TRUSTED_SIGNERS der App eintragen.");
for (const r of relays) r.close?.();
