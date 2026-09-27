// Spiegel hochladen (5.3b) – läuft in der CI (pages.yml, Job „spiegel“) mit der eben veröffentlichten Seite.
// Aufruf: npx tsx scripts/mirror/spiegeln.mts <site-ordner> <ergebnis.json>
//
// Je Spiegel: fehlt das Konto (Secret), wird er mit Grund übersprungen. Das Ergebnis
// (spiegel-ergebnis.json) nennt nur Quellen, die geprüft sind – den IPFS-CID rechnen wir
// selbst nach. Auf stdout steht eine Zusammenfassung für die Actions-Seite; Fehlermeldungen
// der Dienste nie ausgeben (nur Status), damit nichts Geheimes im Protokoll landet.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ipfsCid, leseQuellen, type Quelle, type SpiegelErgebnis } from "../../packages/protocol/src/index.ts";

const [ordner, ziel] = process.argv.slice(2);
if (!ordner || !ziel) {
  console.error("Aufruf: spiegeln.mts <site-ordner> <ergebnis.json>");
  process.exit(1);
}
const datei = readFileSync(join(ordner, "freedom.html"));
const sha = createHash("sha256").update(datei).digest("hex");
const ergebnis: SpiegelErgebnis = { version: 1, sha256: sha, quellen: [], uebersprungen: [] };
const zeilen: string[] = [];
let fehler = false;

function nimm(q: Quelle): void {
  if (leseQuellen({ quellen: [q] }).gesetzt.length === 1) ergebnis.quellen.push(q);
  else ergebnis.uebersprungen.push({ art: q.art, grund: "Form ungültig" });
}

// Torrent: build-site.sh legt ihn mit der Seite als Webseed an – hier nur übernehmen.
const magnet = join(ordner, "freedom.magnet");
if (existsSync(magnet)) nimm({ art: "torrent", url: readFileSync(magnet, "utf8").trim() });
else ergebnis.uebersprungen.push({ art: "torrent", grund: "kein freedom.magnet (SPIEGEL_BASIS_URL fehlte beim Bau)" });

// IPFS: CID selbst rechnen, bei Pinata anheften (A2), nur übernehmen, wenn Pinata denselben meldet.
const cid = ipfsCid(datei);
zeilen.push(`IPFS-CID (selbst gerechnet): \`${cid}\` – auf dem GX10 anheften: \`ipfs pin add ${cid}\``);
const jwt = process.env.PINATA_JWT;
if (!jwt) {
  ergebnis.uebersprungen.push({ art: "ipfs", grund: "Secret PINATA_JWT fehlt" });
} else {
  try {
    const form = new FormData();
    form.append("file", new Blob([datei], { type: "text/html" }), "freedom.html");
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    form.append("pinataMetadata", JSON.stringify({ name: `freedom-${sha.slice(0, 12)}.html` }));
    const res = await fetch(process.env.PINATA_API ?? "https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form, signal: AbortSignal.timeout(120_000),
    });
    const gemeldet = res.ok ? ((await res.json()) as { IpfsHash?: unknown }).IpfsHash : undefined;
    if (!res.ok) throw new Error(`Pinata antwortet ${res.status}`);
    if (gemeldet !== cid) throw new Error("Pinata meldet einen anderen CID – nicht übernommen");
    nimm({ art: "ipfs", url: `ipfs://${cid}` });
  } catch (e) {
    fehler = true;
    const grund = e instanceof Error && /^Pinata /.test(e.message) ? e.message : `Upload gescheitert (${e instanceof Error ? e.name : "Fehler"})`;
    ergebnis.uebersprungen.push({ art: "ipfs", grund });
  }
}

writeFileSync(ziel, `${JSON.stringify(ergebnis, null, 2)}\n`);
console.log(`### Spiegel für freedom.html \`${sha}\`\n`);
for (const q of ergebnis.quellen) console.log(`- ${q.art}: \`${q.url}\``);
for (const u of ergebnis.uebersprungen) console.log(`- ${u.art}: übersprungen – ${u.grund}`);
console.log(`\n${zeilen.join("\n")}\n\nIns Release-Manifest: Artefakt „spiegel-ergebnis“ laden, dann \`SPIEGEL_ERGEBNIS=spiegel-ergebnis.json node scripts/publish-release.mjs <version>\`.`);
process.exit(fehler ? 1 : 0);
