// Spiegel hochladen (5.3b, 5.3c) – läuft in der CI (pages.yml, Job „spiegel“) mit der eben veröffentlichten Seite.
// Aufruf: npx tsx scripts/mirror/spiegeln.mts <site-ordner> <ergebnis.json>
//
// Je Spiegel: fehlt das Konto (Secret), wird er mit Grund übersprungen. Das Ergebnis
// (spiegel-ergebnis.json) nennt nur Quellen, die geprüft sind – den IPFS-CID rechnen wir
// selbst nach, Blossom muss dieselbe Prüfsumme melden. Auf stdout steht eine Zusammenfassung
// für die Actions-Seite; Meldungen der Dienste nie ausgeben (nur Status und feste Texte),
// damit nichts Geheimes im Protokoll landet.
// Nur für Tests: PINATA_API, TURBO_URL, CODEBERG_GIT, SPIEGEL_QUELLEN ersetzen die Ziele.
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spiegelSchluessel as leseSchluessel } from "./schluessel.mts";
import {
  blossomAuth, blossomKopf, blossomQuelle, ipfsCid, keypairFromSecret, leseQuellen, signEvent,
  type Quelle, type QuellenArt, type SpiegelErgebnis,
} from "../../packages/protocol/src/index.ts";

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

/** Feste Texte, die ins Protokoll dürfen – alles andere nur mit dem Fehlernamen. */
class Meldung extends Error {}

function nimm(q: Quelle): void {
  if (leseQuellen({ quellen: [q] }).gesetzt.length === 1) ergebnis.quellen.push(q);
  else ergebnis.uebersprungen.push({ art: q.art, grund: "Form ungültig" });
}
const fehlt = (art: QuellenArt, grund: string) => ergebnis.uebersprungen.push({ art, grund });
async function versuche(art: QuellenArt, lauf: () => Promise<void>): Promise<void> {
  try {
    await lauf();
  } catch (e) {
    fehler = true;
    fehlt(art, e instanceof Meldung ? e.message : `Upload gescheitert (${e instanceof Error ? e.name : "Fehler"})`);
  }
}

// Torrent: build-site.sh legt ihn mit der Seite als Webseed an – hier nur übernehmen.
const magnet = join(ordner, "freedom.magnet");
if (existsSync(magnet)) nimm({ art: "torrent", url: readFileSync(magnet, "utf8").trim() });
else fehlt("torrent", "kein freedom.magnet (SPIEGEL_BASIS_URL fehlte beim Bau)");

// IPFS: CID selbst rechnen, bei Pinata anheften (A2), nur übernehmen, wenn Pinata denselben meldet.
const cid = ipfsCid(datei);
zeilen.push(`IPFS-CID (selbst gerechnet): \`${cid}\` – auf dem GX10 anheften: \`ipfs pin add ${cid}\``);
const jwt = process.env.PINATA_JWT;
if (!jwt) fehlt("ipfs", "Secret PINATA_JWT fehlt");
else await versuche("ipfs", async () => {
  const form = new FormData();
  form.append("file", new Blob([datei], { type: "text/html" }), "freedom.html");
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  form.append("pinataMetadata", JSON.stringify({ name: `freedom-${sha.slice(0, 12)}.html` }));
  const res = await fetch(process.env.PINATA_API ?? "https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form, signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Meldung(`Pinata antwortet ${res.status}`);
  if (((await res.json()) as { IpfsHash?: unknown }).IpfsHash !== cid) throw new Meldung("Pinata meldet einen anderen CID – nicht übernommen");
  nimm({ art: "ipfs", url: `ipfs://${cid}` });
});

// Blossom (A4): eigener Spiegel-Schlüssel, je Server eine Anmeldung nur für diese Datei.
function spiegelSchluessel(s: string): Uint8Array {
  try {
    return leseSchluessel(s);
  } catch (e) {
    throw new Meldung((e as Error).message);
  }
}
const nsec = process.env.SPIEGEL_NSEC;
const blossomServer = (process.env.BLOSSOM_SERVER ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!nsec) fehlt("blossom", "Secret SPIEGEL_NSEC fehlt");
else if (blossomServer.length === 0) fehlt("blossom", "Variable BLOSSOM_SERVER fehlt");
else await versuche("blossom", async () => {
  const kp = keypairFromSecret(spiegelSchluessel(nsec));
  zeilen.push(`Blossom-Schlüssel des Spiegels: \`${kp.pk}\``);
  for (const server of blossomServer) {
    await versuche("blossom", async () => {
      const u = URL.canParse(server) ? new URL(server) : null;
      if (!u || !(u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "127.0.0.1"))) throw new Meldung("BLOSSOM_SERVER: nur https://…-Adressen");
      const auth = blossomKopf(signEvent(blossomAuth(sha, kp.pk, Math.floor(Date.now() / 1000)), kp.sk));
      const res = await fetch(new URL("/upload", u), {
        method: "PUT", headers: { Authorization: auth, "Content-Type": "text/html" }, body: datei, signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Meldung(`${u.host}: antwortet ${res.status}`);
      const q = blossomQuelle(await res.json(), sha);
      if (!q) throw new Meldung(`${u.host}: Beschreibung passt nicht (Prüfsumme oder Adresse)`);
      nimm(q);
    });
  }
});

// Arweave (A3): über Turbo, bezahlt mit dem Guthaben der Spiegel-Wallet.
const jwk = process.env.ARWEAVE_JWK;
if (!jwk) fehlt("arweave", "Secret ARWEAVE_JWK fehlt");
else await versuche("arweave", async () => {
  let schluessel: unknown;
  try { schluessel = JSON.parse(jwk); } catch { throw new Meldung("ARWEAVE_JWK ist kein JSON (Inhalt der Schlüsseldatei)"); }
  const { TurboFactory } = await import("@ardrive/turbo-sdk");
  const dienst = process.env.TURBO_URL;
  const turbo = TurboFactory.authenticated({
    privateKey: schluessel as never,
    ...(dienst ? { uploadServiceConfig: { url: dienst }, paymentServiceConfig: { url: dienst } } : {}),
  });
  const r = await turbo.upload({
    data: datei,
    dataItemOpts: { tags: [{ name: "Content-Type", value: "text/html" }, { name: "App-Name", value: "FreedomStack" }, { name: "SHA-256", value: sha }] },
    signal: AbortSignal.timeout(300_000),
  });
  nimm({ art: "arweave", url: `ar://${r.id}` });
});

// Codeberg Pages (A1): die ganze Seite als Branch „pages“; die Adresse steht fest in spiegel/quellen.json.
const quellenDatei = process.env.SPIEGEL_QUELLEN ?? new URL("../../spiegel/quellen.json", import.meta.url);
const codeberg = leseQuellen(JSON.parse(readFileSync(quellenDatei, "utf8"))).gesetzt.find((q) => q.art === "codeberg");
const token = process.env.CODEBERG_TOKEN;
if (!codeberg) fehlt("codeberg", "Adresse in spiegel/quellen.json ist noch Platzhalter");
else if (!token) fehlt("codeberg", "Secret CODEBERG_TOKEN fehlt");
else await versuche("codeberg", async () => {
  const m = /^https:\/\/([a-z0-9-]+)\.codeberg\.page\/([A-Za-z0-9._-]+)\//i.exec(codeberg.url);
  if (!m) throw new Meldung("Adresse ohne Repository (https://<nutzer>.codeberg.page/<repo>/…)");
  const [, nutzer, repo] = m;
  const arbeit = mkdtempSync(join(tmpdir(), "codeberg-"));
  cpSync(ordner, arbeit, { recursive: true });
  // Token nur in der Umgebung von git – nie auf der Befehlszeile, nie in einer Ausgabe
  const env = { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${nutzer}:${token}`).toString("base64")}` };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: arbeit, stdio: "pipe", env });
  git("init", "-q", "-b", "pages");
  git("add", "-A");
  git("-c", "user.name=FreedomStack-Spiegel", "-c", "user.email=spiegel@freedomstack.invalid", "commit", "-q", "-m", `Spiegel ${sha.slice(0, 12)}`);
  try {
    git("push", "-q", "--force", process.env.CODEBERG_GIT ?? `https://codeberg.org/${nutzer}/${repo}.git`, "pages");
  } catch {
    throw new Meldung(`Push nach codeberg.org/${nutzer}/${repo} gescheitert (Token, Rechte, Repository?)`);
  }
  zeilen.push(`Codeberg: nach \`${nutzer}/${repo}\` (Branch pages) gepusht – ${codeberg.url} liefert nach kurzer Zeit aus.`);
});

writeFileSync(ziel, `${JSON.stringify(ergebnis, null, 2)}\n`);
console.log(`### Spiegel für freedom.html \`${sha}\`\n`);
for (const q of ergebnis.quellen) console.log(`- ${q.art}: \`${q.url}\``);
for (const u of ergebnis.uebersprungen) console.log(`- ${u.art}: übersprungen – ${u.grund}`);
console.log(`\n${zeilen.join("\n")}\n\nIns Release-Manifest: Artefakt „spiegel-ergebnis“ laden, dann \`SPIEGEL_ERGEBNIS=spiegel-ergebnis.json node scripts/publish-release.mjs <version>\`.`);
process.exit(fehler ? 1 : 0);
