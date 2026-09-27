/**
 * Schritt 5.3b: Spiegel hochladen – Torrent mit Webseed, IPFS-CID wie
 * `ipfs add --cid-version=1`, Ergebnis eines Laufs, Upload-Skript.
 *
 * Die Sollwerte stammen aus den Referenz-Implementierungen (ipfs-unixfs-importer
 * mit den Kubo-Voreinstellungen, create-torrent/parse-torrent) – einmal
 * außerhalb des Repositorys gerechnet, hier fest eingetragen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { baueTorrent, ipfsCid, leseQuellen, quellenAusErgebnis } from "../src/index.js";

const daten = (n: number) => {
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = (i * 31 + (i >> 8)) % 251;
  return d;
};
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const SEED = "https://beispiel.org/app/freedom.html";

test("5.3b: Torrent – Infohash wie die Referenz, Webseed und .torrent im Magnet-Link, gleiche Eingabe gleiche Datei", () => {
  const a = baueTorrent(daten(1000), "freedom.html", [SEED]);
  assert.equal(a.infohash, "59a82544743b3888a33bef93c727cf42449f6de6");
  // Bencode: Schlüssel nach Bytes sortiert, Zahlen ganz
  assert.ok(text(a.torrent).startsWith("d4:infod6:lengthi1000e4:name12:freedom.html12:piece lengthi262144e6:pieces20:"));
  assert.equal(baueTorrent(daten(262_144 * 3 + 5), "freedom.html", [SEED]).infohash, "169661862bef7c419a4e65c73df7a33ee83b8950");
  assert.match(text(a.torrent), /8:url-listl37:https:\/\/beispiel\.org\/app\/freedom\.htmle/);
  assert.doesNotMatch(text(a.torrent), /creation date|created by|announce/, "nichts, was sich je Lauf ändert");
  assert.deepEqual(baueTorrent(daten(1000), "freedom.html", [SEED]).torrent, a.torrent);
  assert.equal(a.magnet, `magnet:?xt=urn:btih:${a.infohash}&dn=freedom.html&xl=1000&ws=${encodeURIComponent(SEED)}&xs=${encodeURIComponent("https://beispiel.org/app/freedom.torrent")}`);
  assert.deepEqual(leseQuellen({ quellen: [{ art: "torrent", url: a.magnet }] }).offen, [], "Form der Startseite und des Manifests");
  assert.throws(() => baueTorrent(daten(10), "freedom.html", ["http://beispiel.org/freedom.html"]), /https/);
  assert.throws(() => baueTorrent(new Uint8Array(), "freedom.html", [SEED]), /leer/);
  assert.throws(() => baueTorrent(daten(10), "../x.html", [SEED]), /Dateiname/);
});

test("5.3b: IPFS-CID wie ipfs add --cid-version=1 – Blatt, zwei Ebenen, mehr als 174 Verweise", () => {
  const faelle: [number, string, { stueck?: number; maxVerweise?: number }?][] = [
    [0, "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"],
    [1000, "bafkreicbbqpc7sfsjl52pqm2cwnuxv6htw6ka5i76kqpijxinurixsu6me"],
    [262_144, "bafkreiboxfyz6nqrd7nz5cidjkyniwpagwrkesdewgziauztf32a24tqdq"],
    [262_145, "bafybeicrglonmsmtbalrf3tqprqyrfrq7f3xz6pziwlmd6zaqtdmynjgee"],
    [26 * 262_144 + 123, "bafybeih6y3nilflnu34ytzlj2xg4olqww35to2mki4kucj2kbz2wkedzsq"],
    [1024 * 174, "bafybeichi6ce5dovrt4slrqzui6wyhzwtaizvtl52lepa5jixmtkxbtyou", { stueck: 1024 }],
    [1024 * 175, "bafybeidrzxoi76xrzrjmbjcq6xi3m2ewivoxm4unadop6f74pl2sto55bq", { stueck: 1024 }],
    [1024 * 400 + 7, "bafybeid2thefi4n4e77fn4dcqamnjrgaq43pwcsvsmhx2mn53ois37smai", { stueck: 1024 }],
  ];
  for (const [n, soll, opt] of faelle) assert.equal(ipfsCid(daten(n), opt), soll, `${n} Byte`);
  const cid = ipfsCid(daten(262_145));
  assert.deepEqual(leseQuellen({ quellen: [{ art: "ipfs", url: `ipfs://${cid}` }] }).offen, []);
  assert.deepEqual(leseQuellen({ quellen: [{ art: "ipfs", url: `ipfs://${ipfsCid(daten(10))}` }] }).offen, [], "auch ein einzelnes Blatt (bafk…)");
});

test("5.3b: Ergebnis eines Laufs – nur für dieselbe Datei, nur gültige Quellen", () => {
  const sha = "ab".repeat(32);
  const ipfs = `ipfs://${ipfsCid(daten(262_145))}`;
  const e = { version: 1, sha256: sha, quellen: [{ art: "ipfs", url: ipfs }, { art: "ipfs", url: "ipfs://kaputt" }, { art: "ftp", url: "ftp://x" }], uebersprungen: [] };
  assert.deepEqual(quellenAusErgebnis(e, sha.toUpperCase()), [{ art: "ipfs", url: ipfs }]);
  assert.deepEqual(quellenAusErgebnis(e, "cd".repeat(32)), [], "andere Datei");
  assert.deepEqual(quellenAusErgebnis({ ...e, version: 2 }, sha), []);
  for (const kaputt of [null, "x", {}, { version: 1, sha256: sha }]) assert.deepEqual(quellenAusErgebnis(kaputt, sha), []);
});

const run = promisify(execFile);
const WURZEL = new URL("../../../", import.meta.url).pathname;

async function spiegeln(env: Record<string, string>, ordner: string) {
  const ziel = join(ordner, "ergebnis.json");
  try {
    const { stdout } = await run("npx", ["--no-install", "tsx", "scripts/mirror/spiegeln.mts", ordner, ziel], { cwd: WURZEL, env: { ...process.env, PINATA_JWT: "", ...env } });
    return { code: 0, stdout, ergebnis: JSON.parse(readFileSync(ziel, "utf8")) };
  } catch (e) {
    const f = e as { code: number; stdout: string };
    return { code: f.code, stdout: f.stdout, ergebnis: JSON.parse(readFileSync(ziel, "utf8")) };
  }
}

test("5.3b: Upload-Skript – ohne Konto übersprungen, mit Pinata nur bei gleichem CID, Geheimes nie im Protokoll", async () => {
  const ordner = mkdtempSync(join(tmpdir(), "spiegel-"));
  const html = daten(300_000);
  writeFileSync(join(ordner, "freedom.html"), html);
  const sha = createHash("sha256").update(html).digest("hex");
  const cid = ipfsCid(html);

  // Ohne Secret und ohne Torrent: nichts gesetzt, jeder Grund genannt, Exit 0
  const ohne = await spiegeln({}, ordner);
  assert.equal(ohne.code, 0);
  assert.equal(ohne.ergebnis.sha256, sha);
  assert.deepEqual(ohne.ergebnis.quellen, []);
  assert.deepEqual(ohne.ergebnis.uebersprungen.map((u: { art: string }) => u.art), ["torrent", "ipfs"]);
  assert.match(ohne.stdout, /PINATA_JWT fehlt/);
  assert.match(ohne.stdout, new RegExp(`ipfs pin add ${cid}`));

  // Pinata-Ersatz: erst derselbe CID, dann ein anderer
  let antwort = cid;
  const anfragen: { auth?: string; laenge: number }[] = [];
  const server = createServer((req, res) => {
    let n = 0;
    req.on("data", (c: Buffer) => { n += c.length; });
    req.on("end", () => {
      anfragen.push({ auth: req.headers.authorization, laenge: n });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ IpfsHash: antwort, PinSize: n }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const api = `http://127.0.0.1:${(server.address() as { port: number }).port}/pinning/pinFileToIPFS`;
  try {
    writeFileSync(join(ordner, "freedom.magnet"), `${baueTorrent(html, "freedom.html", [SEED]).magnet}\n`);
    const mit = await spiegeln({ PINATA_JWT: "geheim-jwt", PINATA_API: api }, ordner);
    assert.equal(mit.code, 0);
    assert.deepEqual(mit.ergebnis.quellen.map((q: { art: string }) => q.art), ["torrent", "ipfs"]);
    assert.equal(mit.ergebnis.quellen[1].url, `ipfs://${cid}`);
    assert.equal(anfragen[0].auth, "Bearer geheim-jwt");
    assert.ok(anfragen[0].laenge > html.length, "die ganze Datei hochgeladen");
    assert.deepEqual(quellenAusErgebnis(mit.ergebnis, sha).map((q) => q.art), ["torrent", "ipfs"], "so liest publish-release.mjs es");

    antwort = ipfsCid(daten(10));
    const anders = await spiegeln({ PINATA_JWT: "geheim-jwt", PINATA_API: api }, ordner);
    assert.equal(anders.code, 1, "Job wird rot");
    assert.deepEqual(anders.ergebnis.quellen.map((q: { art: string }) => q.art), ["torrent"]);
    assert.match(anders.stdout, /anderen CID – nicht übernommen/);
    for (const r of [ohne, mit, anders]) assert.doesNotMatch(r.stdout + JSON.stringify(r.ergebnis), /geheim-jwt/);
  } finally {
    server.close();
  }
});

test("5.3b: Verdrahtung – Bau legt den Torrent an, pages.yml lädt nur beim Release hoch, publish-release nimmt das Ergebnis", () => {
  const q = (p: string) => readFileSync(join(WURZEL, p), "utf8");
  const bau = q("scripts/build-site.sh");
  assert.match(bau, /npx --no-install tsx scripts\/mirror\/torrent\.mts "\$OUT" "\$SPIEGEL_BASIS_URL"/);
  assert.match(bau, /npx --no-install tsx scripts\/spiegel-quellen\.mts "\$OUT"/);
  const pages = q(".github/workflows/pages.yml");
  assert.match(pages, /SPIEGEL_BASIS_URL: \$\{\{ steps\.pages\.outputs\.base_url \}\}/);
  assert.match(pages, /spiegel:\n    needs: deploy\n    if: github\.event_name == 'workflow_dispatch' && inputs\.spiegeln/);
  assert.match(pages, /PINATA_JWT: \$\{\{ secrets\.PINATA_JWT \}\}\n        run: npx --no-install tsx scripts\/mirror\/spiegeln\.mts seite spiegel-ergebnis\.json/);
  assert.equal((pages.match(/secrets\./g) ?? []).length, 1, "Secrets nur im Upload-Schritt");
  assert.match(q("scripts/publish-release.mjs"), /quellenAusErgebnis\(JSON\.parse\(await readFile\(process\.env\.SPIEGEL_ERGEBNIS, "utf8"\)\), sha\)/);
});
