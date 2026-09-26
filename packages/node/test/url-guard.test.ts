/**
 * Tests fuer den SSRF-Schutz.
 *
 * Jeder Fall hier entspricht einem realen Angriff auf einen Provider-Knoten,
 * der fremde URLs abruft. Die Liste ist bewusst laenger als "localhost geht
 * nicht" — genau die naheliegende Einzelpruefung ist die, die man umgeht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUrlSafe, isPrivateIPv4, isPrivateIPv6, isPrivateAddress } from "../src/url-guard.js";
import { FileIoExecutor } from "../src/tools.js";
import { KIND_DVM_FILE_IO } from "@freedomstack/protocol";

test("Adressbereiche: alle privaten IPv4-Bereiche werden erkannt", () => {
  for (const ip of [
    "127.0.0.1", "127.1.2.3",       // Loopback
    "10.0.0.1", "10.255.255.255",   // privat
    "172.16.0.1", "172.31.255.1",   // privat
    "192.168.0.1",                  // Heimnetz / Router
    "169.254.169.254",              // Cloud-Metadaten — der teuerste Fall
    "0.0.0.0", "100.64.0.1", "224.0.0.1",
  ]) {
    assert.equal(isPrivateIPv4(ip), true, `${ip} muss als privat gelten`);
  }
});

test("Adressbereiche: oeffentliche Adressen bleiben erlaubt", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "93.184.216.34"]) {
    assert.equal(isPrivateIPv4(ip), false, `${ip} ist oeffentlich`);
  }
});

test("Adressbereiche: IPv6 inklusive der eingebetteten IPv4-Formen", () => {
  assert.equal(isPrivateIPv6("::1"), true);
  assert.equal(isPrivateIPv6("fc00::1"), true);
  assert.equal(isPrivateIPv6("fe80::1"), true);
  // Der Klassiker: IPv4-mapped Loopback rutscht durch jede naive Pruefung.
  assert.equal(isPrivateIPv6("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIPv6("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateIPv6("2606:4700:4700::1111"), false);
  assert.equal(isPrivateAddress("::ffff:10.0.0.1"), true);
});

test("Guard: Cloud-Metadaten werden abgelehnt", async () => {
  const v = await checkUrlSafe("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
  assert.equal(v.allowed, false);
  assert.match(v.reason, /privat/);
});

test("Guard: lokale Dienste des Betreibers sind unerreichbar", async () => {
  for (const url of [
    "http://127.0.0.1:11434/api/tags",      // Ollama
    "http://localhost:8080/v1/getinfo",      // LND-REST
    "http://192.168.1.1/",                   // Router
    "http://[::1]:7777/",                    // Relay ueber IPv6
  ]) {
    const v = await checkUrlSafe(url);
    assert.equal(v.allowed, false, `${url} darf nicht erlaubt sein`);
  }
});

test("Guard: nur http und https", async () => {
  for (const url of ["file:///etc/passwd", "ftp://x.io/a", "gopher://x.io/", "data:text/html,x"]) {
    const v = await checkUrlSafe(url);
    assert.equal(v.allowed, false, `${url} muss abgelehnt werden`);
    assert.match(v.reason, /Schema|gültige URL/);
  }
});

test("Guard: Zugangsdaten in der URL werden abgelehnt", async () => {
  const v = await checkUrlSafe("http://user:pass@example.com/");
  assert.equal(v.allowed, false);
  assert.match(v.reason, /Zugangsdaten/);
});

test("Guard: Freigabeliste sperrt alles andere", async () => {
  const opts = { allowHosts: ["example.com"] };
  // Die Freigabeliste greift VOR der Namensaufloesung — deshalb ist dieser
  // Teil ohne Netz pruefbar, und genau so soll es auch sein: ein gesperrter
  // Host darf nicht einmal eine DNS-Abfrage ausloesen.
  const fremd = await checkUrlSafe("https://evil.io/a", opts);
  assert.equal(fremd.allowed, false);
  assert.match(fremd.reason, /Freigabeliste/);

  const subdomainFremd = await checkUrlSafe("https://example.com.evil.io/a", opts);
  assert.equal(subdomainFremd.allowed, false, "Suffix-Trick darf nicht durchgehen");

  // Erlaubter Host mit IP-Literal: kommt ohne DNS aus.
  const erlaubt = await checkUrlSafe("https://8.8.8.8/a", { allowHosts: ["8.8.8.8"] });
  assert.equal(erlaubt.allowed, true);
});

test("Guard: Testmodus kann private Ziele bewusst freigeben", async () => {
  const v = await checkUrlSafe("http://127.0.0.1:11434/", { allowPrivate: true });
  assert.equal(v.allowed, true);
  assert.match(v.reason, /Testmodus/);
});

test("Guard: oeffentliche IP direkt bleibt erlaubt", async () => {
  const v = await checkUrlSafe("https://8.8.8.8/");
  assert.equal(v.allowed, true);
});

test("Dateizugriff: absolute Pfade brechen nicht aus der Sandbox aus", async () => {
  const io = new FileIoExecutor("/tmp/freedom-ws-test");
  const r = await io.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "read /etc/passwd" });
  assert.equal(r.ok, false);
  assert.match(r.output, /absolute pfade/);
});

test("Dateizugriff: .. bricht nicht aus der Sandbox aus", async () => {
  const io = new FileIoExecutor("/tmp/freedom-ws-test");
  const r = await io.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "read ../../etc/passwd" });
  assert.equal(r.ok, false);
  assert.match(r.output, /ausserhalb workspace/);
});

test("Dateizugriff: Praefix-Kollision wird abgefangen", async () => {
  // "/tmp/ws-evil" beginnt mit "/tmp/ws" — ohne Trennzeichen in der Pruefung
  // waere das ein Ausbruch gewesen.
  const io = new FileIoExecutor("/tmp/ws");
  const r = await io.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "read ../ws-evil/geheim.txt" });
  assert.equal(r.ok, false);
  assert.match(r.output, /ausserhalb workspace/);
});

test("Dateizugriff: normaler Pfad im Workspace funktioniert weiter", async () => {
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  const dir = "/tmp/freedom-ws-ok";
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/notiz.txt`, "hallo");
  try {
    const io = new FileIoExecutor(dir);
    const r = await io.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "read notiz.txt" });
    assert.equal(r.ok, true);
    assert.equal(r.output, "hallo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("8.7 Fund: IPv4 in IPv6 auch in Hex-Schreibweise, NAT64 und 6to4 – wie new URL sie schreibt", async () => {
  for (const u of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[0:0:0:0:0:ffff:169.254.169.254]/",
    "http://[::a00:1]/", "http://[64:ff9b::a9fe:a9fe]/", "http://[2002:c0a8:101::1]/", "http://[ff02::1]/", "http://[fd00::1]/"]) {
    const v = await checkUrlSafe(u);
    assert.equal(v.allowed, false, `${u} → ${new URL(u).hostname}`);
  }
  assert.equal(isPrivateIPv6("2606:4700:4700::1111"), false, "oeffentliches IPv6 bleibt erlaubt");
  assert.equal(isPrivateIPv6("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateIPv6("kein:ipv6:::"), true, "unklare Form wird nicht erlaubt");
});
