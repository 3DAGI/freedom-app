/**
 * 11.5n: Pakete holen. Nur, was eine Sperrdatei mit Prüfsumme nennt (oder `paketHolen()` mit fester
 * Version), nur von der festen Liste, jede Prüfsumme nachgerechnet, abgelegt erst nach der Prüfung –
 * npm nach Inhalt wie im Cache von npm, PyPI unter dem Dateinamen; je Plattform nur die passenden
 * Räder. Mit Tor geht jeder Abruf durch den Proxy. Zum Schluss installieren npm und pip offline aus
 * dem Zwischenspeicher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PAKET_GRENZEN, PaketAbgelehnt, PaketKonto, holeAusSperre, leseNpmSperre, lesePipAnforderungen, paketHolen, paketPfad,
  passendeDateien, type PaketAbruf, type PaketArchiv,
} from "../src/pakete.js";

const sha512 = (b: Uint8Array | string) => createHash("sha512").update(b).digest("base64");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const ziel = () => mkdtempSync(join(tmpdir(), "pakete-"));
const fall = (f: string) => (e: unknown) => e instanceof PaketAbgelehnt && e.fall === f && !/probe|links/.test(e.message);
const X64 = { cpu: "x64", python: "cp312" };

/** Attrappe der Registries: je Adresse ein Inhalt (oder Status); merkt sich jede Anfrage. */
function registry(inhalt: Record<string, Uint8Array | string | number>): { abruf: PaketAbruf; gefragt: string[] } {
  const gefragt: string[] = [];
  const abruf: PaketAbruf = async (url) => {
    gefragt.push(url);
    const w = inhalt[url];
    if (w === undefined) return new Response("nicht da", { status: 404 });
    if (typeof w === "number") return new Response(null, { status: w });
    return new Response(typeof w === "string" ? w : w.slice());
  };
  return { abruf, gefragt };
}

function sperre(packages: Record<string, unknown>, lockfileVersion = 3): string {
  return JSON.stringify({ name: "p", lockfileVersion, requires: true, packages: { "": { name: "p" }, ...packages } });
}
const npmUrl = (n: string, v = "1.0.0") => `https://registry.npmjs.org/${n}/-/${n.split("/").pop()}-${v}.tgz`;

test("package-lock: installierte Pakete mit sha512 von der Liste; Verweise, Bündel, Arbeitsbereiche, andere Plattformen bleiben weg", () => {
  const a = "inhalt-a", b = "inhalt-b", esb = "esbuild-linux-x64";
  const text = sperre({
    "packages/werkzeug": { name: "werkzeug", version: "1.0.0" },
    "node_modules/werkzeug": { resolved: "packages/werkzeug", link: true },
    "node_modules/a": { version: "1.0.0", resolved: npmUrl("a"), integrity: `sha512-${sha512(a)}` },
    "node_modules/a/node_modules/b": { version: "1.0.0", resolved: npmUrl("b"), integrity: `sha1-abc sha512-${sha512(b)}` },
    "node_modules/c/node_modules/b": { version: "1.0.0", resolved: npmUrl("b"), integrity: `sha512-${sha512(b)}` },
    "node_modules/a/node_modules/gebuendelt": { version: "1.0.0", inBundle: true },
    "node_modules/@esbuild/linux-x64": { resolved: npmUrl("@esbuild/linux-x64", "0.25.0"), integrity: `sha512-${sha512(esb)}`, os: ["linux"], cpu: ["x64"], optional: true },
    "node_modules/@esbuild/darwin-arm64": { resolved: npmUrl("@esbuild/darwin-arm64", "0.25.0"), integrity: `sha512-${sha512("d")}`, os: ["darwin"], cpu: ["arm64"], optional: true },
    "node_modules/@esbuild/win32-x64": { resolved: npmUrl("@esbuild/win32-x64", "0.25.0"), integrity: `sha512-${sha512("w")}`, os: ["!linux"], optional: true },
    "node_modules/musl": { resolved: npmUrl("musl"), integrity: `sha512-${sha512("m")}`, libc: ["musl"], optional: true },
  });
  const x64 = leseNpmSperre(text, X64);
  assert.deepEqual(x64.map((p) => p.url).sort(), [npmUrl("@esbuild/linux-x64", "0.25.0"), npmUrl("a"), npmUrl("b")].sort(), "b nur einmal");
  assert.deepEqual(x64.find((p) => p.url === npmUrl("b"))?.pruef, { alg: "sha512", werte: [sha512(b)] });
  assert.deepEqual(leseNpmSperre(text, { cpu: "arm64" }).map((p) => p.url).sort(), [npmUrl("a"), npmUrl("b")].sort());
  assert.equal(leseNpmSperre(sperre({ "node_modules/a": { resolved: npmUrl("a"), integrity: `sha512-${sha512(a)}` } }, 2), X64).length, 1, "Fassung 2");
});

test("package-lock: fremde Quellen, fehlende Prüfsummen, alte Fassungen und zu viele Pakete lehnen die ganze Datei ab", () => {
  const gut = { integrity: `sha512-${sha512("x")}` };
  for (const resolved of [
    "https://evil.example/a/-/a-1.0.0.tgz", "http://registry.npmjs.org/a/-/a-1.0.0.tgz", "https://x.registry.npmjs.org/a/-/a-1.0.0.tgz",
    "https://registry.npmjs.org:8443/a/-/a-1.0.0.tgz", "https://u:p@registry.npmjs.org/a/-/a-1.0.0.tgz", "git+ssh://git@github.com/a/a.git",
    "file:../a-1.0.0.tgz",
  ]) {
    assert.throws(() => leseNpmSperre(sperre({ "node_modules/a": { ...gut, resolved } }), X64), fall("paket-quelle"), resolved);
  }
  assert.throws(() => leseNpmSperre(sperre({ "node_modules/a": { ...gut } }), X64), fall("paket-quelle"), "ohne resolved");
  for (const integrity of [undefined, `sha1-${createHash("sha1").update("x").digest("base64")}`, "sha512-kaputt", `sha256-${sha512("x")}`]) {
    assert.throws(() => leseNpmSperre(sperre({ "node_modules/a": { resolved: npmUrl("a"), integrity } }), X64), fall("paket-ohne-pruefsumme"), String(integrity));
  }
  for (const text of ["{", "null", "[]", sperre({}, 1), JSON.stringify({ lockfileVersion: 3 }), JSON.stringify({ lockfileVersion: 3, packages: null }), sperre({ "node_modules/a": "x" })]) {
    assert.throws(() => leseNpmSperre(text, X64), fall("paket-sperre"), text);
  }
  const viele: Record<string, unknown> = {};
  for (let i = 0; i <= PAKET_GRENZEN.pakete; i++) viele[`node_modules/p${i}`] = { resolved: npmUrl(`p${i}`), integrity: `sha512-${sha512(String(i))}` };
  assert.throws(() => leseNpmSperre(sperre(viele), X64), fall("paket-zu-viele"));
});

test("requirements.txt: nur feste Versionen mit --hash=sha256, wie pip-compile sie schreibt", () => {
  const h1 = sha256("1"), h2 = sha256("2"), h3 = sha256("3");
  const text = [
    "# pip-compile --generate-hashes",
    `requests[socks]==2.32.3 \\`,
    `    --hash=sha256:${h1} \\`,
    `    --hash=sha256:${h2}`,
    "    # via -r requirements.in",
    `typing_extensions==4.12.2 ; python_version < "3.13" --hash=sha256:${h3}`,
    "",
  ].join("\n");
  assert.deepEqual(lesePipAnforderungen(text), [
    { name: "requests", version: "2.32.3", sha256: [h1, h2] },
    { name: "typing_extensions", version: "4.12.2", sha256: [h3] },
  ]);
  const mit = (z: string) => `${z} --hash=sha256:${h1}`;
  assert.throws(() => lesePipAnforderungen("requests==2.32.3"), fall("paket-ohne-pruefsumme"));
  for (const z of ["--index-url https://evil.example/simple", "-e .", "-r andere.txt", mit("requests==2.32.3 --extra-index-url https://evil.example"), "requests==2.32.3 --hash=sha512:" + "a".repeat(128), `requests==2.32.3 --hash=sha256:${h1.toUpperCase()}`]) {
    assert.throws(() => lesePipAnforderungen(z), fall("paket-sperre"), z);
  }
  for (const z of [mit("requests>=2.0"), mit("requests"), mit("requests===2.32.3"), mit("requests==2.*"), mit("requests~=2.32")]) {
    assert.throws(() => lesePipAnforderungen(z), fall("paket-version"), z);
  }
  for (const z of [mit("requests @ https://evil.example/r.whl"), mit("../requests==1.0"), mit("_requests==1.0")]) {
    assert.throws(() => lesePipAnforderungen(z), fall("paket-name"), z);
  }
});

const rad = (datei: string): PaketArchiv => ({ registry: "pypi", url: `https://files.pythonhosted.org/packages/ab/${datei}`, datei, pruef: { alg: "sha256", werte: [sha256(datei)] } });

test("PyPI: nur die Räder für diese Plattform – rein vor plattformgebunden, sonst das Quellarchiv", () => {
  const np = [
    "numpy-2.1.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
    "numpy-2.1.0-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
    "numpy-2.1.0-cp312-cp312-manylinux_2_17_aarch64.manylinux2014_aarch64.whl",
    "numpy-2.1.0-cp312-cp312-musllinux_1_2_x86_64.whl",
    "numpy-2.1.0-cp312-cp312-macosx_14_0_arm64.whl",
    "numpy-2.1.0-cp312-cp312-win_amd64.whl",
    "numpy-2.1.0-cp313-cp313t-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
    "numpy-2.1.0.tar.gz",
  ].map(rad);
  assert.deepEqual(passendeDateien(np, X64).map((a) => a.datei), [np[1]!.datei]);
  assert.deepEqual(passendeDateien(np, { cpu: "arm64", python: "cp312" }).map((a) => a.datei), [np[2]!.datei]);
  assert.deepEqual(passendeDateien(np, { cpu: "x64" }).map((a) => a.datei), ["numpy-2.1.0.tar.gz"], "ohne Python-Fassung das Quellarchiv");
  assert.deepEqual(passendeDateien(np, { cpu: "x64", python: "3.12" }).map((a) => a.datei), ["numpy-2.1.0.tar.gz"], "ungültige Fassung");
  const abi3 = ["cryptography-43.0.0-cp39-abi3-manylinux_2_28_x86_64.whl", "cryptography-43.0.0-cp313-abi3-manylinux_2_28_x86_64.whl"].map(rad);
  assert.deepEqual(passendeDateien(abi3, X64).map((a) => a.datei), [abi3[0]!.datei], "abi3 nur ab einer älteren Fassung");
  const rein = ["six-1.16.0-py2.py3-none-any.whl", "six-1.16.0.tar.gz"].map(rad);
  assert.deepEqual(passendeDateien([...rein, ...np], X64).map((a) => a.datei), ["six-1.16.0-py2.py3-none-any.whl"]);
  assert.deepEqual(passendeDateien(np.slice(4, 6), X64), [], "nur macOS und Windows");
});

test("holeAusSperre (npm): holt nur von der Liste, prüft, legt nach Inhalt ab (0600) und holt Vorhandenes nicht noch einmal", async () => {
  const a = new TextEncoder().encode("archiv-a"), b = new TextEncoder().encode("archiv-b");
  const r = registry({ [npmUrl("a")]: a, [npmUrl("@s/b")]: b });
  const text = sperre({
    "node_modules/a": { resolved: npmUrl("a"), integrity: `sha512-${sha512(a)}` },
    "node_modules/@s/b": { resolved: npmUrl("@s/b"), integrity: `sha512-${sha512(b)}` },
  });
  const z = ziel(), konto = new PaketKonto(0);
  await holeAusSperre({ npm: text }, z, konto, { tor: null, abruf: r.abruf, plattform: X64, jetzt: () => 1 });
  assert.deepEqual(r.gefragt, [npmUrl("a"), npmUrl("@s/b")]);
  const hex = Buffer.from(sha512(a), "base64").toString("hex");
  const pfad = join(z, "npm", "_cacache", "content-v2", "sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
  assert.deepEqual(readFileSync(pfad), Buffer.from(a));
  assert.equal(lstatSync(pfad).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(z, "npm")).mode & 0o777, 0o700);
  assert.deepEqual({ bytes: konto.bytes, pakete: konto.pakete }, { bytes: a.length + b.length, pakete: 2 });
  await holeAusSperre({ npm: text }, z, konto, { tor: null, abruf: r.abruf, plattform: X64, jetzt: () => 1 });
  assert.equal(r.gefragt.length, 2, "schon geprüft abgelegt");
  // Zwei sha512 in `integrity`: abgelegt unter der, die passt – nur dort sucht npm
  const zwei = sperre({ "node_modules/a": { resolved: npmUrl("a"), integrity: `sha512-${sha512("anderes")} sha512-${sha512(a)}` } });
  const z2 = ziel();
  await holeAusSperre({ npm: zwei }, z2, new PaketKonto(0), { tor: null, abruf: r.abruf, plattform: X64, jetzt: () => 1 });
  assert.deepEqual(readFileSync(pfad.replace(z, z2)), Buffer.from(a));
});

test("holeAusSperre: falsche Prüfsumme, Fehler des Netzes, zu groß, Zeit und Verweise – nichts wird abgelegt, nach außen nur die Kennung", async () => {
  const a = new TextEncoder().encode("archiv-a");
  const text = sperre({ "node_modules/a": { resolved: npmUrl("a"), integrity: `sha512-${sha512(a)}` } });
  const versuche: Array<[string, PaketAbruf, PaketKonto?, number?]> = [
    ["paket-pruefsumme", registry({ [npmUrl("a")]: "anderes" }).abruf],
    ["paket-netz", registry({}).abruf],
    ["paket-netz", registry({ [npmUrl("a")]: 302 }).abruf],
    ["paket-netz", async () => { throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org links"); }],
    ["paket-zu-gross", async () => new Response(a.slice(), { headers: { "content-length": String(PAKET_GRENZEN.bytesJe + 1) } })],
    ["paket-zu-gross", registry({ [npmUrl("a")]: a }).abruf, Object.assign(new PaketKonto(0), { bytes: PAKET_GRENZEN.bytesGesamt - 4 })],
    ["paket-zeit", registry({ [npmUrl("a")]: a }).abruf, new PaketKonto(0), PAKET_GRENZEN.zeitMs + 1],
    ["paket-zu-viele", registry({ [npmUrl("a")]: a }).abruf, Object.assign(new PaketKonto(0), { pakete: PAKET_GRENZEN.pakete })],
  ];
  for (const [f, abruf, konto, jetzt] of versuche) {
    const z = ziel();
    await assert.rejects(holeAusSperre({ npm: text }, z, konto ?? new PaketKonto(0), { tor: null, abruf, plattform: X64, jetzt: () => jetzt ?? 1 }), fall(f), f);
    assert.ok(!existsSync(paketPfad(z, leseNpmSperre(text, X64)[0]!)), f);
  }
  // Ein Verweis an der Stelle der Datei: nie hindurch schreiben
  const z = ziel(), woanders = join(z, "woanders");
  const p = paketPfad(z, leseNpmSperre(text, X64)[0]!);
  mkdirSync(join(p, ".."), { recursive: true });
  symlinkSync(woanders, p);
  await assert.rejects(holeAusSperre({ npm: text }, z, new PaketKonto(0), { tor: null, abruf: registry({ [npmUrl("a")]: a }).abruf, plattform: X64, jetzt: () => 1 }), fall("paket-ablage"));
  assert.ok(!existsSync(woanders));
  await assert.rejects(holeAusSperre({ npm: " ".repeat(PAKET_GRENZEN.sperreBytes + 1) }, ziel(), new PaketKonto(0), { tor: null }), fall("paket-sperre"));
});

/** PyPI-JSON einer Version mit Dateien. */
const pypiJson = (dateien: Array<{ url: string; filename?: string; sha256: string }>) =>
  JSON.stringify({ info: {}, urls: dateien.map((d) => ({ url: d.url, filename: d.filename ?? d.url.split("/").pop(), digests: { sha256: d.sha256 } })) });

test("holeAusSperre (pip): Name nach PEP 503, nur genannte Prüfsummen, nur Dateien vom Archiv-Host, nur passende Räder", async () => {
  const cp312 = new TextEncoder().encode("rad-cp312"), cp311 = new TextEncoder().encode("rad-cp311"), quelle = new TextEncoder().encode("sdist");
  const u = (d: string) => `https://files.pythonhosted.org/packages/ab/cd/${d}`;
  const d312 = "Foo_Bar-1.0-cp312-cp312-manylinux_2_17_x86_64.whl", d311 = "Foo_Bar-1.0-cp311-cp311-manylinux_2_17_x86_64.whl";
  const r = registry({
    "https://pypi.org/pypi/foo-bar/1.0/json": pypiJson([
      { url: u(d311), sha256: sha256(cp311) },
      { url: u(d312), sha256: sha256(cp312) },
      { url: u("foo_bar-1.0.tar.gz"), sha256: sha256(quelle) },
      { url: `https://evil.example/${d312}`, sha256: sha256(cp312) },
      { url: u("anders.whl"), filename: "foo_bar-1.0-py3-none-any.whl", sha256: sha256(cp312) },
    ]),
    [u(d312)]: cp312, [u(d311)]: cp311, [u("foo_bar-1.0.tar.gz")]: quelle,
  });
  const z = ziel();
  const req = `Foo_Bar==1.0 --hash=sha256:${sha256(cp311)} --hash=sha256:${sha256(cp312)} --hash=sha256:${sha256(quelle)}`;
  await holeAusSperre({ pip: req }, z, new PaketKonto(0), { tor: null, abruf: r.abruf, plattform: X64, jetzt: () => 1 });
  assert.deepEqual(r.gefragt, ["https://pypi.org/pypi/foo-bar/1.0/json", u(d312)]);
  assert.deepEqual(readdirSync(join(z, "pypi")), [d312]);
  await assert.rejects(holeAusSperre({ pip: `Foo_Bar==1.0 --hash=sha256:${sha256("anderes")}` }, ziel(), new PaketKonto(0), { tor: null, abruf: r.abruf, plattform: X64 }), fall("paket-pruefsumme"));
  await assert.rejects(holeAusSperre({ pip: `Foo_Bar==1.0 --hash=sha256:${sha256(cp311)}` }, ziel(), new PaketKonto(0), { tor: null, abruf: r.abruf, plattform: { cpu: "arm64", python: "cp311" } }), fall("paket-plattform"));
  await assert.rejects(holeAusSperre({ pip: `Foo_Bar==1.0 --hash=sha256:${sha256(cp312)}` }, ziel(), new PaketKonto(0), { tor: null, abruf: registry({ "https://pypi.org/pypi/foo-bar/1.0/json": "{kaputt" }).abruf, plattform: X64 }), fall("paket-netz"));
});

test("paketHolen: nur feste Versionen, Metadaten und Archiv von der Liste, Prüfsumme für die Sperrdatei, höchstens 20 je Auftrag", async () => {
  const tgz = new TextEncoder().encode("tgz");
  const r = registry({
    "https://registry.npmjs.org/@scope%2fwerkzeug/1.2.3": JSON.stringify({ dist: { tarball: npmUrl("@scope/werkzeug", "1.2.3"), integrity: `sha512-${sha512(tgz)}` } }),
    [npmUrl("@scope/werkzeug", "1.2.3")]: tgz,
    "https://registry.npmjs.org/fremd/1.0.0": JSON.stringify({ dist: { tarball: "https://evil.example/fremd-1.0.0.tgz", integrity: `sha512-${sha512(tgz)}` } }),
    "https://registry.npmjs.org/ohne/1.0.0": JSON.stringify({ dist: { tarball: npmUrl("ohne"), shasum: "abc" } }),
  });
  const z = ziel(), konto = new PaketKonto(0), o = { tor: null, abruf: r.abruf, plattform: X64, jetzt: () => 1 };
  assert.deepEqual(await paketHolen("npm", "@scope/werkzeug", "1.2.3", z, konto, o), [{ url: npmUrl("@scope/werkzeug", "1.2.3"), pruefsumme: `sha512-${sha512(tgz)}` }]);
  assert.equal(konto.neue, 1);
  await assert.rejects(paketHolen("npm", "fremd", "1.0.0", z, konto, o), fall("paket-quelle"));
  await assert.rejects(paketHolen("npm", "ohne", "1.0.0", z, konto, o), fall("paket-ohne-pruefsumme"));
  for (const n of ["../x", "Gross", "a/b", "", "@s/../x"]) await assert.rejects(paketHolen("npm", n, "1.0.0", z, konto, o), fall("paket-name"), n);
  for (const v of ["^1.0.0", "latest", "1.0", "1.0.0 || 2.0.0"]) await assert.rejects(paketHolen("npm", "x", v, z, konto, o), fall("paket-version"), v);
  for (const n of ["../x", "-x", "x/y"]) await assert.rejects(paketHolen("pypi", n, "1.0", z, konto, o), fall("paket-name"), n);
  const whl = new TextEncoder().encode("whl");
  const u = "https://files.pythonhosted.org/packages/ab/cd/werkzeug-3.0.0-py3-none-any.whl";
  const p = registry({ "https://pypi.org/pypi/werkzeug/3.0.0/json": pypiJson([{ url: u, sha256: sha256(whl) }]), [u]: whl });
  assert.deepEqual(await paketHolen("pypi", "Werkzeug", "3.0.0", z, konto, { ...o, abruf: p.abruf }), [{ url: u, pruefsumme: `sha256:${sha256(whl)}` }]);
  konto.neue = PAKET_GRENZEN.neueJeAuftrag;
  await assert.rejects(paketHolen("pypi", "werkzeug", "3.0.0", z, konto, { ...o, abruf: p.abruf }), fall("paket-zu-viele"));
});

test("mit Tor: jeder Abruf geht an den Proxy, der Name bleibt bei ihm (Adresstyp 3) – nie daran vorbei", async () => {
  const gesehen: { atyp: number; host: string; port: number }[] = [];
  const proxy = net.createServer((c) => {
    let buf = Buffer.alloc(0), gruss = false;
    c.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (!gruss) {
        if (buf.length < 2 + (buf[1] ?? 0)) return;
        c.write(Buffer.from([5, 0]));
        buf = buf.subarray(2 + buf[1]!);
        gruss = true;
      }
      if (buf.length < 5 || buf.length < 5 + buf[4]! + 2) return;
      gesehen.push({ atyp: buf[3]!, host: buf.subarray(5, 5 + buf[4]!).toString(), port: buf.readUInt16BE(5 + buf[4]!) });
      c.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
    });
    c.on("error", () => {});
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const tor = { host: "127.0.0.1", port: (proxy.address() as AddressInfo).port };
  try {
    const text = sperre({ "node_modules/a": { resolved: npmUrl("a"), integrity: `sha512-${sha512("a")}` } });
    await assert.rejects(holeAusSperre({ npm: text }, ziel(), new PaketKonto(0), { tor, plattform: X64, jetzt: () => 1 }), fall("paket-netz"));
    await assert.rejects(paketHolen("pypi", "werkzeug", "3.0.0", ziel(), new PaketKonto(0), { tor, plattform: X64, jetzt: () => 1 }), fall("paket-netz"));
    assert.deepEqual(gesehen, [{ atyp: 3, host: "registry.npmjs.org", port: 443 }, { atyp: 3, host: "pypi.org", port: 443 }]);
  } finally {
    proxy.close();
  }
});

const hatNpm = (() => { try { execFileSync("npm", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("npm ci --offline installiert aus dem Zwischenspeicher, ohne Netz und ohne Skripte", { skip: !hatNpm && "npm fehlt" }, async () => {
  const quelle = ziel();
  writeFileSync(join(quelle, "package.json"), JSON.stringify({ name: "freedom-probe", version: "1.0.0", main: "index.js" }));
  writeFileSync(join(quelle, "index.js"), "module.exports = 42;\n");
  const datei = execFileSync("npm", ["pack", "--silent", "--pack-destination", quelle], { cwd: quelle }).toString().trim();
  const tgz = readFileSync(join(quelle, datei));
  const z = ziel(), projekt = ziel();
  const lock = sperre({ "node_modules/freedom-probe": { version: "1.0.0", resolved: npmUrl("freedom-probe"), integrity: `sha512-${sha512(tgz)}` } });
  await holeAusSperre({ npm: lock }, z, new PaketKonto(0), { tor: null, abruf: registry({ [npmUrl("freedom-probe")]: tgz }).abruf, plattform: X64, jetzt: () => 1 });
  writeFileSync(join(projekt, "package.json"), JSON.stringify({ name: "p", version: "1.0.0", dependencies: { "freedom-probe": "1.0.0" } }));
  writeFileSync(join(projekt, "package-lock.json"), lock);
  execFileSync("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(z, "npm")], { cwd: projekt, stdio: "ignore" });
  assert.equal(readFileSync(join(projekt, "node_modules", "freedom-probe", "index.js"), "utf8"), "module.exports = 42;\n");
});

const hatPip = (() => { try { execFileSync("python3", ["-m", "pip", "--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("pip install --no-index installiert aus dem Zwischenspeicher, nur mit den Prüfsummen", { skip: !hatPip && "pip fehlt" }, async () => {
  const bau = ziel(), name = "freedom_probe-1.0.0-py3-none-any.whl";
  // Ein kleinstes Rad, gebaut mit zipfile – ohne Netz und ohne Werkzeuge
  execFileSync("python3", ["-I", "-c", `
import sys, zipfile
info = "freedom_probe-1.0.0.dist-info/"
dateien = {"freedom_probe/__init__.py": "WERT = 42\\n", info + "METADATA": "Metadata-Version: 2.1\\nName: freedom-probe\\nVersion: 1.0.0\\n",
  info + "WHEEL": "Wheel-Version: 1.0\\nGenerator: test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n"}
with zipfile.ZipFile(sys.argv[1], "w") as z:
    for n, t in dateien.items(): z.writestr(n, t)
    z.writestr(info + "RECORD", "".join(n + ",,\\n" for n in dateien) + info + "RECORD,,\\n")
`, join(bau, name)]);
  const whl = readFileSync(join(bau, name));
  const u = `https://files.pythonhosted.org/packages/ab/cd/${name}`;
  const req = `freedom-probe==1.0.0 --hash=sha256:${sha256(whl)}\n`;
  const z = ziel(), ort = ziel();
  await holeAusSperre({ pip: req }, z, new PaketKonto(0), { tor: null, abruf: registry({ "https://pypi.org/pypi/freedom-probe/1.0.0/json": pypiJson([{ url: u, sha256: sha256(whl) }]), [u]: whl }).abruf, plattform: X64, jetzt: () => 1 });
  writeFileSync(join(bau, "requirements.txt"), req);
  execFileSync("python3", ["-I", "-m", "pip", "install", "--no-index", "--find-links", join(z, "pypi"), "--require-hashes", "-r", join(bau, "requirements.txt"), "--target", ort, "--disable-pip-version-check", "--no-cache-dir"], { stdio: "ignore" });
  assert.equal(readFileSync(join(ort, "freedom_probe", "__init__.py"), "utf8"), "WERT = 42\n");
});
