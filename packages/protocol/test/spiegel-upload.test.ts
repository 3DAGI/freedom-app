/**
 * Schritt 5.3b/c: Spiegel hochladen – Torrent mit Webseed, IPFS-CID wie
 * `ipfs add --cid-version=1`, Blossom-Anmeldung, Ergebnis eines Laufs,
 * Upload-Skript gegen Ersatz-Dienste (Pinata, Blossom, Turbo, git statt Codeberg).
 *
 * Die Sollwerte stammen aus den Referenz-Implementierungen (ipfs-unixfs-importer
 * mit den Kubo-Voreinstellungen, create-torrent/parse-torrent) – einmal
 * außerhalb des Repositorys gerechnet, hier fest eingetragen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { promisify } from "node:util";
import { bech32 } from "@scure/base";
import {
  baueTorrent, blossomAuth, blossomKopf, blossomQuelle, generateKeypair, ipfsCid, leseQuellen, quellenAusErgebnis, signEvent, verifyEvent,
  type NostrEvent,
} from "../src/index.js";

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
    const { stdout } = await run("npx", ["--no-install", "tsx", "scripts/mirror/spiegeln.mts", ordner, ziel], { cwd: WURZEL, env: { ...process.env, PINATA_JWT: "", SPIEGEL_NSEC: "", BLOSSOM_SERVER: "", ARWEAVE_JWK: "", CODEBERG_TOKEN: "", ...env } });
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
  assert.deepEqual(ohne.ergebnis.uebersprungen.map((u: { art: string }) => u.art), ["torrent", "ipfs", "blossom", "arweave", "codeberg"]);
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
  const schritt = /- name: Spiegel hochladen[\s\S]*?run: npx --no-install tsx scripts\/mirror\/spiegeln\.mts seite spiegel-ergebnis\.json/.exec(pages)?.[0] ?? "";
  for (const n of ["PINATA_JWT", "SPIEGEL_NSEC", "ARWEAVE_JWK", "CODEBERG_TOKEN"]) assert.match(schritt, new RegExp(`${n}: \\$\\{\\{ secrets\\.${n} \\}\\}`));
  assert.match(schritt, /BLOSSOM_SERVER: \$\{\{ vars\.BLOSSOM_SERVER \}\}/, "Server-Adressen sind nicht geheim");
  // Secrets nur im Upload-Schritt – und seit 5.9b der Spiegel-Schlüssel im Schritt der NIP-34-Ankündigung, sonst nirgends
  const nip34 = /- name: Repository per NIP-34 ankuendigen[\s\S]*?run: npx --no-install tsx scripts\/mirror\/repo-ankuendigung\.mts/.exec(pages)?.[0] ?? "";
  assert.deepEqual(nip34.match(/secrets\.\w+/g), ["secrets.SPIEGEL_NSEC"]);
  assert.equal((schritt.match(/secrets\./g) ?? []).length, 4);
  assert.equal((pages.match(/secrets\./g) ?? []).length, 5, "Secrets nur im Upload-Schritt und im NIP-34-Schritt");
  assert.match(q("scripts/publish-release.mjs"), /quellenAusErgebnis\(JSON\.parse\(await readFile\(process\.env\.SPIEGEL_ERGEBNIS, "utf8"\)\), sha\)/);
});

test("5.3c: Blossom – Anmeldung nur für diese Datei und zehn Minuten, Beschreibung nur mit derselben Prüfsumme", () => {
  const kp = generateKeypair();
  const sha = "ab".repeat(32);
  const ev = signEvent(blossomAuth(sha, kp.pk, 1_000), kp.sk);
  assert.ok(verifyEvent(ev));
  assert.equal(ev.kind, 24242);
  assert.deepEqual(ev.tags, [["t", "upload"], ["x", sha], ["expiration", "1600"]]);
  const kopf = blossomKopf(ev);
  assert.match(kopf, /^Nostr [A-Za-z0-9+/]+=*$/);
  assert.deepEqual(JSON.parse(Buffer.from(kopf.slice(6), "base64").toString("utf8")), ev);
  assert.throws(() => blossomAuth("xyz", kp.pk, 1_000), /Prüfsumme/);
  const url = `https://blossom.beispiel.org/${sha}.html`;
  assert.deepEqual(blossomQuelle({ url, sha256: sha, size: 5 }, sha), { art: "blossom", url });
  assert.equal(blossomQuelle({ url, sha256: "cd".repeat(32) }, sha), null, "andere Prüfsumme");
  assert.equal(blossomQuelle({ url: "https://blossom.beispiel.org/andere.html", sha256: sha }, sha), null);
  assert.equal(blossomQuelle({ url: `http://blossom.beispiel.org/${sha}`, sha256: sha }, sha), null, "nur https");
  for (const kaputt of [null, "x", {}]) assert.equal(blossomQuelle(kaputt, sha), null);
});

function ersatzDienst(antworte: (req: { method?: string; url?: string; auth?: string; body: Buffer }) => { status?: number; json: unknown }) {
  const anfragen: { method?: string; url?: string; auth?: string; body: Buffer }[] = [];
  const server = createServer((req, res) => {
    const teile: Buffer[] = [];
    req.on("data", (c: Buffer) => teile.push(c));
    req.on("end", () => {
      const a = { method: req.method, url: req.url, auth: req.headers.authorization, body: Buffer.concat(teile) };
      anfragen.push(a);
      const { status, json } = antworte(a);
      res.statusCode = status ?? 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(json));
    });
  });
  const bereit = new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  return { anfragen, bereit, schliesse: () => server.close() };
}

test("5.3c: Upload-Skript – Blossom, Arweave und Codeberg gegen Ersatz-Dienste; Geheimes nie im Protokoll", async () => {
  const ordner = mkdtempSync(join(tmpdir(), "spiegel-c-"));
  const html = daten(300_000);
  writeFileSync(join(ordner, "freedom.html"), html);
  const sha = createHash("sha256").update(html).digest("hex");
  const jetzt = Math.floor(Date.now() / 1000);

  // Blossom: prüft die Anmeldung wie ein echter Server; der zweite meldet eine falsche Prüfsumme
  const blossom = ersatzDienst(({ auth, body }) => {
    const ev = JSON.parse(Buffer.from((auth ?? "").replace(/^Nostr /, ""), "base64").toString("utf8")) as NostrEvent;
    const x = createHash("sha256").update(body).digest("hex");
    const gut = verifyEvent(ev) && ev.kind === 24242 && ev.tags.some((t) => t[0] === "x" && t[1] === x)
      && Number(ev.tags.find((t) => t[0] === "expiration")?.[1]) > jetzt;
    return gut ? { json: { url: `https://blossom.beispiel.org/${x}.html`, sha256: x, size: body.length, type: "text/html" } } : { status: 401, json: {} };
  });
  const falsch = ersatzDienst(() => ({ json: { url: `https://b.beispiel.org/${"0".repeat(64)}`, sha256: "0".repeat(64) } }));
  // Turbo: nimmt das signierte Datenobjekt an (ANS-104, die Datei steht am Ende)
  const turbo = ersatzDienst(() => ({ json: { id: "B".repeat(43), owner: "o", dataCaches: [], fastFinalityIndexes: [], winc: "0" } }));
  // Codeberg: ein leeres Repository statt codeberg.org
  const bare = mkdtempSync(join(tmpdir(), "codeberg-bare-"));
  execFileSync("git", ["init", "-q", "--bare", bare]);
  const quellen = join(ordner, "..", `quellen-${sha.slice(0, 8)}.json`);
  writeFileSync(quellen, JSON.stringify({ quellen: [{ art: "codeberg", url: "https://nutzer.codeberg.page/freedom-app/freedom.html" }] }));

  const kp = generateKeypair();
  const nsec = bech32.encode("nsec", bech32.toWords(kp.sk), 200);
  const jwk = generateKeyPairSync("rsa", { modulusLength: 4096, publicExponent: 65537 }).privateKey.export({ format: "jwk" });
  const [b1, b2, t] = await Promise.all([blossom.bereit, falsch.bereit, turbo.bereit]);
  const env = {
    SPIEGEL_NSEC: nsec, BLOSSOM_SERVER: `${b1},${b2}`, ARWEAVE_JWK: JSON.stringify(jwk), TURBO_URL: t,
    CODEBERG_TOKEN: "geheim-codeberg", CODEBERG_GIT: bare, SPIEGEL_QUELLEN: quellen,
  };
  try {
    const r = await spiegeln(env, ordner);
    assert.equal(r.code, 1, "ein Blossom-Server passte nicht → Job rot");
    assert.deepEqual(r.ergebnis.quellen, [
      { art: "blossom", url: `https://blossom.beispiel.org/${sha}.html` },
      { art: "arweave", url: `ar://${"B".repeat(43)}` },
    ]);
    assert.deepEqual(r.ergebnis.uebersprungen, [
      { art: "torrent", grund: "kein freedom.magnet (SPIEGEL_BASIS_URL fehlte beim Bau)" },
      { art: "ipfs", grund: "Secret PINATA_JWT fehlt" },
      { art: "blossom", grund: `${new URL(b2).host}: Beschreibung passt nicht (Prüfsumme oder Adresse)` },
    ]);
    assert.equal(blossom.anfragen[0].method, "PUT");
    assert.equal(blossom.anfragen[0].url, "/upload");
    assert.ok(turbo.anfragen.some((a) => a.url === "/v1/tx/arweave" && a.body.subarray(-html.length).equals(Buffer.from(html))), "Datei im signierten Datenobjekt");
    assert.deepEqual(execFileSync("git", ["--git-dir", bare, "show", "pages:freedom.html"]), Buffer.from(html), "ganze Seite im Branch pages");
    assert.equal(execFileSync("git", ["--git-dir", bare, "log", "-1", "--format=%s", "pages"], { encoding: "utf8" }).trim(), `Spiegel ${sha.slice(0, 12)}`);
    assert.match(r.stdout, new RegExp(`Blossom-Schlüssel des Spiegels: \`${kp.pk}\``));
    assert.match(r.stdout, /Codeberg: nach `nutzer\/freedom-app` \(Branch pages\) gepusht/);
    const protokoll = r.stdout + JSON.stringify(r.ergebnis);
    for (const geheim of [nsec, Buffer.from(kp.sk).toString("hex"), String(jwk.d), "geheim-codeberg", Buffer.from("nutzer:geheim-codeberg").toString("base64")]) {
      assert.ok(!protokoll.includes(geheim), "Geheimes im Protokoll");
    }

    // Unlesbarer Schlüssel, http-Server, JWK kein JSON, Codeberg ohne Repository: feste Texte, nichts übernommen
    writeFileSync(quellen, JSON.stringify({ quellen: [{ art: "codeberg", url: "https://nutzer.codeberg.page/" }] }));
    const kaputt = await spiegeln({ ...env, SPIEGEL_NSEC: "nsec1kaputt", ARWEAVE_JWK: "{kein json" }, ordner);
    assert.equal(kaputt.code, 1);
    assert.deepEqual(kaputt.ergebnis.quellen, []);
    assert.deepEqual(kaputt.ergebnis.uebersprungen.slice(2).map((u: { grund: string }) => u.grund), [
      "SPIEGEL_NSEC unlesbar (nsec1… oder 64 Hex-Zeichen)",
      "ARWEAVE_JWK ist kein JSON (Inhalt der Schlüsseldatei)",
      "Adresse ohne Repository (https://<nutzer>.codeberg.page/<repo>/…)",
    ]);
    const http = await spiegeln({ ...env, BLOSSOM_SERVER: "http://blossom.beispiel.org", ARWEAVE_JWK: "", CODEBERG_TOKEN: "" }, ordner);
    assert.match(http.stdout, /blossom: übersprungen – BLOSSOM_SERVER: nur https:\/\/…-Adressen/);
  } finally {
    blossom.schliesse();
    falsch.schliesse();
    turbo.schliesse();
  }
});
