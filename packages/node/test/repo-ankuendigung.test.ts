/**
 * Schritt 5.9b: NIP-34-Spiegel – `scripts/mirror/repo-ankuendigung.mts` kündigt
 * das Repository des Projekts als Kind 30617 an, signiert mit dem
 * Spiegel-Schlüssel. Gegen die echte Relay-Rolle des Knotens; ohne Schlüssel
 * übersprungen, ein unlesbarer Schlüssel erscheint nie im Protokoll.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KIND_REPO_ANKUENDIGUNG, WebSocketRelay, generateKeypair, leseRepoAnkuendigung, toHex, verifyEvent } from "@freedomstack/protocol";
import { RelayRole } from "../src/relay-role.js";

const run = promisify(execFile);
const WURZEL = new URL("../../../", import.meta.url).pathname;
let port = 17_900;

async function ankuendigen(env: Record<string, string>, ...args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run("npx", ["--no-install", "tsx", "scripts/mirror/repo-ankuendigung.mts", ...args], {
      cwd: WURZEL, env: { ...process.env, SPIEGEL_NSEC: "", REPO_MAINTAINER: "", SPIEGEL_RELAYS: "", ...env },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    const f = e as { code?: number; stdout?: string; stderr?: string };
    return { code: f.code ?? 1, out: `${f.stdout ?? ""}${f.stderr ?? ""}` };
  }
}

test("5.9b: Repository-Ankündigung an den Relay – signiert vom Spiegel-Schlüssel, lesbar wie jedes NIP-34-Repo", async () => {
  const p = port++;
  const relay = new RelayRole({ port: p, retentionDays: 7, maxEventBytes: 64_000 });
  await relay.start();
  try {
    const spiegel = generateKeypair();
    const maintainer = generateKeypair().pk;
    const r = await ankuendigen({ SPIEGEL_NSEC: toHex(spiegel.sk), SPIEGEL_RELAYS: `ws://127.0.0.1:${p}`, REPO_MAINTAINER: `${maintainer},kaputt` });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /angekündigt, 1\/1 Relays/);
    assert.ok(!r.out.includes(toHex(spiegel.sk)), "der Schlüssel erscheint nie");

    const leser = new WebSocketRelay(`ws://127.0.0.1:${p}`, { timeoutMs: 3000, autoReconnect: false });
    const [ev] = await leser.query({ kinds: [KIND_REPO_ANKUENDIGUNG], authors: [spiegel.pk] });
    leser.close();
    assert.ok(ev && verifyEvent(ev));
    const repo = leseRepoAnkuendigung(ev);
    assert.equal(repo.id, "freedom-app");
    assert.deepEqual(repo.klon, ["https://github.com/3DAGI/freedom-app.git"], "Radicle ist in quellen.json noch Platzhalter");
    assert.deepEqual(repo.maintainer, [maintainer]);
  } finally {
    relay.stop();
  }
});

test("5.9b: ohne Schlüssel übersprungen, unlesbarer Schlüssel mit fester Meldung, kein Relay erreichbar: rot", async () => {
  const ohne = await ankuendigen({});
  assert.deepEqual([ohne.code, /übersprungen – Secret SPIEGEL_NSEC fehlt/.test(ohne.out)], [0, true]);

  const geheim = "nsec1dasistkeinschluessel";
  const kaputt = await ankuendigen({ SPIEGEL_NSEC: geheim });
  assert.equal(kaputt.code, 1);
  assert.match(kaputt.out, /SPIEGEL_NSEC unlesbar/);
  assert.ok(!kaputt.out.includes(geheim));

  const weg = await ankuendigen({ SPIEGEL_NSEC: toHex(generateKeypair().sk), SPIEGEL_RELAYS: `ws://127.0.0.1:${port++}` });
  assert.equal(weg.code, 1);
  assert.match(weg.out, /0\/1 Relays/);

  const trocken = JSON.parse((await ankuendigen({}, "--trocken")).out) as { kind: number; tags: string[][] };
  assert.equal(trocken.kind, KIND_REPO_ANKUENDIGUNG);
  assert.deepEqual(trocken.tags.find((t) => t[0] === "d"), ["d", "freedom-app"]);
});

test("5.9b: im Release-Job verdrahtet – nach den Spiegeln, mit ganzem Verlauf und dem Spiegel-Schlüssel", async () => {
  const { readFileSync } = await import("node:fs");
  const pages = readFileSync(new URL("../../../.github/workflows/pages.yml", import.meta.url), "utf8");
  const job = pages.slice(pages.indexOf("\n  spiegel:"));
  assert.match(job, /fetch-depth: 0/, "erster Commit nur mit ganzem Verlauf");
  assert.match(job, /- name: Repository per NIP-34 ankuendigen[\s\S]*?SPIEGEL_NSEC: \$\{\{ secrets\.SPIEGEL_NSEC \}\}[\s\S]*?run: npx --no-install tsx scripts\/mirror\/repo-ankuendigung\.mts/);
  assert.ok(job.indexOf("Spiegel hochladen") < job.indexOf("Repository per NIP-34"));
});
