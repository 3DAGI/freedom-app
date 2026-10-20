/**
 * Gruppenanrufe im Knoten (B-34a, LK2–LK4 A): Zugänge nur mit gültiger Umgebung, je Teilnehmer ein JWT nach LiveKit
 * (so wie livekit-server es prüft), nur an den Besitzer aus einem Umschlag, nie im Log; der Dienst aus einem Skript.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_DVM_LIVEKIT, LocalSigner, MemoryRelay, OutboxPool, baueLivekitAnfrage, baueStatusAuftrag, buildJobRequest,
  buildPrivateJobRequest, generateKeypair, leseKnotenStatus, leseLivekitZugaenge, mitBesitzerNachweis, neueKopplung, openPrivateJobResponse,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { LIVEKIT_GEHEIMNIS_MIN, livekitAusUmgebung, livekitZugaenge } from "../src/livekit.js";

const GEHEIM = "g".repeat(LIVEKIT_GEHEIMNIS_MIN);
const ENV = { LIVEKIT_URL: "wss://knoten.example.org", LIVEKIT_API_KEY: "APIabc123", LIVEKIT_API_SECRET: GEHEIM };
const RAUM = "0f".repeat(16);

/** Ein JWT so prüfen, wie livekit-server es tut: HS256 mit dem Geheimnis zum Schlüssel in `iss`. */
function pruefeToken(token: string, geheimnisZu: (iss: string) => string | undefined) {
  const [kopf, inhalt, signatur] = token.split(".");
  const k = JSON.parse(Buffer.from(kopf!, "base64url").toString()) as { alg: string };
  const c = JSON.parse(Buffer.from(inhalt!, "base64url").toString()) as {
    iss: string; sub: string; nbf: number; exp: number; video: { room: string; roomJoin: boolean; canPublish: boolean; canSubscribe: boolean };
  };
  const geheimnis = geheimnisZu(c.iss);
  const echt = !!geheimnis && createHmac("sha256", geheimnis).update(`${kopf}.${inhalt}`).digest("base64url") === signatur;
  return { k, c, echt };
}

test("B-34a: Umgebung – nur mit Adresse, Schlüssel und langem Geheimnis, nie halb", () => {
  assert.deepEqual(livekitAusUmgebung({}), { grund: "aus (LIVEKIT_URL, LIVEKIT_API_KEY und LIVEKIT_API_SECRET setzen)" });
  assert.deepEqual(livekitAusUmgebung(ENV).dienst, { url: "wss://knoten.example.org", schluessel: "APIabc123", geheimnis: GEHEIM, gueltigSek: 3600 });
  assert.equal(livekitAusUmgebung({ ...ENV, LIVEKIT_URL: "wss://knoten.example.org/" }).dienst!.url, "wss://knoten.example.org");
  assert.match(livekitAusUmgebung({ ...ENV, LIVEKIT_URL: "" }).grund!, /LIVEKIT_URL ungültig/, "ein Geheimnis ohne Adresse ist ein Fehler, keine Wahl");
  assert.match(livekitAusUmgebung({ ...ENV, LIVEKIT_URL: "ws://knoten.example.org" }).grund!, /LIVEKIT_URL ungültig/);
  assert.match(livekitAusUmgebung({ ...ENV, LIVEKIT_API_KEY: "" }).grund!, /LIVEKIT_API_KEY/);
  assert.match(livekitAusUmgebung({ ...ENV, LIVEKIT_API_KEY: "a b" }).grund!, /LIVEKIT_API_KEY/);
  assert.match(livekitAusUmgebung({ ...ENV, LIVEKIT_API_SECRET: "kurz" }).grund!, /kürzer als 32/);
  for (const s of ["30", "100000", "x"]) assert.match(livekitAusUmgebung({ ...ENV, LIVEKIT_GUELTIG_SEK: s }).grund!, /LIVEKIT_GUELTIG_SEK/);
  assert.equal(livekitAusUmgebung({ ...ENV, LIVEKIT_GUELTIG_SEK: "600" }).dienst!.gueltigSek, 600);
});

test("B-34a: Zugänge – je Teilnehmer ein JWT nach LiveKit, nur für diesen Raum, frische Kennungen", () => {
  const d = livekitAusUmgebung(ENV).dienst!;
  const z = livekitZugaenge(d, RAUM, 5, 1_790_000_000);
  assert.equal(z.bis, 1_790_003_600);
  assert.equal(new Set(z.zugaenge.map((x) => x.kennung)).size, 5, "verschiedene Kennungen");
  for (const { kennung, token } of z.zugaenge) {
    const { k, c, echt } = pruefeToken(token, (iss) => (iss === "APIabc123" ? GEHEIM : undefined));
    assert.ok(echt, "mit dem Geheimnis zum Schlüssel signiert");
    assert.equal(k.alg, "HS256");
    assert.equal(c.sub, kennung, "Identität ist die zufällige Kennung, nie ein Schlüssel");
    assert.deepEqual(c.video, { room: RAUM, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true }, "nur dieser Raum, keine Verwaltung");
    assert.equal(c.exp, z.bis);
    assert.ok(c.nbf <= 1_790_000_000);
    assert.ok(!pruefeToken(token, () => "h".repeat(32)).echt, "ein anderes Geheimnis passt nicht");
  }
  assert.deepEqual(leseLivekitZugaenge(JSON.stringify(z), { raum: RAUM, anzahl: 5 }, 1_790_000_000), z, "die App liest sie");
  assert.notEqual(livekitZugaenge(d, RAUM, 1).zugaenge[0]!.kennung, livekitZugaenge(d, RAUM, 1).zugaenge[0]!.kennung);
});

async function aufbau(mitLivekit = true) {
  const relay = new MemoryRelay(`mem://livekit-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], livekit: mitLivekit ? livekitAusUmgebung(ENV).dienst : undefined,
    status: () => ({ fassung: "0.1.0", seit: 1, rollen: ["ki", "livekit"], modelle: [], relay: null }),
  }, pool);
  return { relay, pool, kp, k, provider };
}

const antworten = async (relay: MemoryRelay, s: LocalSigner) =>
  (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s)))).flatMap((a) => (a.ok ? [a.response] : []));

test("B-34a: der Besitzer bekommt Zugänge – versiegelt, nie im Log, zählt nicht als Auftrag", async () => {
  const { relay, pool, k, provider } = await aufbau();
  const s = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueLivekitAnfrage({ sitzung: s, kopplung: k, raum: RAUM, anzahl: 3 })).wrap);
  const log: string[] = [];
  const alt = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  let jobs;
  try {
    jobs = await provider.pollOnce();
  } finally {
    Object.assign(console, alt);
  }
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.outputPreview, "Zugänge zum Gruppenanruf an den Besitzer");
  const a = (await antworten(relay, s)).find((r) => r.kind === KIND_DVM_LIVEKIT + 1000);
  const z = leseLivekitZugaenge(a!.content, { raum: RAUM, anzahl: 3 });
  assert.ok(z, a!.content);
  assert.ok(z.zugaenge.every((x) => pruefeToken(x.token, () => GEHEIM).echt));
  const alles = log.join("\n");
  assert.ok(!z.zugaenge.some((x) => alles.includes(x.token) || alles.includes(x.kennung)) && !alles.includes(GEHEIM), "Zugänge und Geheimnis nie im Log");
  assert.equal((await relay.query({ kinds: [KIND_DVM_LIVEKIT + 1000] })).length, 0, "nie offen");
  // Status: Rolle „livekit“, der Zugang zählt nicht als Auftrag
  const st = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueStatusAuftrag({ sitzung: st, kopplung: k })).wrap);
  await provider.pollOnce();
  const status = leseKnotenStatus((await antworten(relay, st)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000)!.content)!;
  assert.deepEqual(status.rollen, ["ki", "livekit"]);
  assert.deepEqual(status.auftraege, { erledigt: 0, gratis: 0, abgelehnt: 0 });
});

test("B-34a: ohne Nachweis, fremd, ungültig gefragt oder ohne SFU keine Zugänge – feste Rückmeldung", async () => {
  const { relay, pool, kp, k, provider } = await aufbau();
  const fremd = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueLivekitAnfrage({ sitzung: fremd, kopplung: neueKopplung(kp.pk), raum: RAUM, anzahl: 2 })).wrap);
  const ohne = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({ kind: KIND_DVM_LIVEKIT, customerPubkey: ohne.publicKey(), input: JSON.stringify({ raum: RAUM, anzahl: 2 }), bidMsat: 0, providerPubkey: kp.pk });
  await pool.publish((await buildPrivateJobRequest({ request: kern, sessionSigner: ohne, providerPk: kp.pk })).wrap);
  // mit Nachweis, aber zu viele Zugänge (an `baueLivekitAnfrage()` vorbei)
  const gierig = new LocalSigner(generateKeypair().sk);
  const zuViel = mitBesitzerNachweis(buildJobRequest({ kind: KIND_DVM_LIVEKIT, customerPubkey: gierig.publicKey(), input: JSON.stringify({ raum: RAUM, anzahl: 26 }), bidMsat: 0, providerPubkey: kp.pk }), k);
  await pool.publish((await buildPrivateJobRequest({ request: zuViel, sessionSigner: gierig, providerPk: kp.pk })).wrap);
  assert.equal((await provider.pollOnce()).length, 0);
  for (const [s, text] of [[fremd, "Gruppenanruf nur für den Besitzer"], [ohne, "Gruppenanruf nur für den Besitzer"], [gierig, "Anfrage ungültig"]] as const) {
    const r = await antworten(relay, s);
    assert.ok(!r.some((x) => x.kind === KIND_DVM_LIVEKIT + 1000));
    assert.ok(r.some((x) => x.kind === 7000 && x.content.includes(text)), text);
  }
  const leer = await aufbau(false);
  const s = new LocalSigner(generateKeypair().sk);
  await leer.pool.publish((await baueLivekitAnfrage({ sitzung: s, kopplung: leer.k, raum: RAUM, anzahl: 1 })).wrap);
  await leer.provider.pollOnce();
  assert.ok((await antworten(leer.relay, s)).some((x) => x.kind === 7000 && x.content.includes("kein Gruppenanruf")));
});

test("B-34a: main.ts – Zugänge aus der Umgebung, Rolle „livekit“ nur dann, an den Provider", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const \{ dienst: livekit, grund: livekitGrund \} = livekitAusUmgebung\(process\.env\);/);
  assert.match(main, /if \(livekit\) statusRollen\.add\("livekit"\);/);
  assert.match(main, /\.\.\.\(vorschau \? \{ vorschau \} : \{\}\),\s*livekit,/);
  assert.doesNotMatch(main, /LIVEKIT_API_SECRET[^\n]*console\./, "das Geheimnis nie ins Log");
});

const skript = new URL("../../../scripts/livekit-einrichten.sh", import.meta.url).pathname;
const lauf = (...args: string[]) => spawnSync("bash", [skript, ...args], { encoding: "utf8" });

test("B-34a: livekit-einrichten.sh – Datei mit 0600, Signal nur lokal, kein eigener TURN, Protokoll ab warn; der Knoten nimmt die Ausgabe an", () => {
  const ordner = mkdtempSync(join(tmpdir(), "livekit-"));
  const ziel = join(ordner, "freedom", "livekit.yaml");
  const r = lauf(ziel, "knoten.example.org");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statSync(ziel).mode & 0o777, 0o600, "nur für den Besitzer lesbar");
  const conf = readFileSync(ziel, "utf8");
  for (const muss of ["port: 7880", "bind_addresses:\n  - 127.0.0.1", "tcp_port: 7881", "port_range_start: 50000", "port_range_end: 50100",
    "max_participants: 25", "turn:\n  enabled: false", "level: warn"]) {
    assert.ok(conf.includes(muss), muss);
  }
  assert.doesNotMatch(conf, /redis|webhook/i, "kein Redis, keine Meldungen nach außen");
  const env = Object.fromEntries(r.stdout.trim().split("\n").map((z) => [z.slice(0, z.indexOf("=")), z.slice(z.indexOf("=") + 1)]));
  assert.deepEqual(Object.keys(env), ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]);
  assert.match(env.LIVEKIT_API_SECRET!, /^[0-9a-f]{64}$/);
  assert.ok(conf.includes(`  ${env.LIVEKIT_API_KEY}: ${env.LIVEKIT_API_SECRET}`), "derselbe Schlüssel in Datei und Umgebung");
  const { dienst } = livekitAusUmgebung(env);
  assert.ok(dienst, "der Knoten nimmt sie an");
  assert.equal(dienst.url, "wss://knoten.example.org");
  // Nie überschreiben, ungültige Namen und Aufrufe gehen nicht durch, --docker nennt den Nutzer
  assert.equal(lauf(ziel, "knoten.example.org").status, 1);
  assert.equal(readFileSync(ziel, "utf8"), conf);
  for (const name of ["", "knoten example", "-knoten", "knoten;rm -rf ~", "a".repeat(200)]) assert.equal(lauf(join(ordner, `x-${Math.random()}.yaml`), name).status, 2, name.slice(0, 20));
  assert.equal(lauf(join(ordner, "y.yaml"), "knoten.example", "--anders").status, 2);
  const d = lauf(join(ordner, "d.yaml"), "knoten.example", "--docker");
  assert.deepEqual(d.stdout.trim().split("\n").map((z) => z.split("=")[0]), ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_UID", "LIVEKIT_GID"]);
  const da = join(ordner, "da.yaml");
  writeFileSync(da, "eigene Einstellungen");
  assert.equal(lauf(da, "knoten.example").status, 1);
  assert.equal(readFileSync(da, "utf8"), "eigene Einstellungen");
});

test("B-34a: Docker – livekit-server als eigener Dienst mit fester Fassung, nur mit Profil, Datei nie eingecheckt", () => {
  const wurzel = new URL("../../../", import.meta.url);
  const dc = readFileSync(new URL("docker-compose.yml", wurzel), "utf8");
  assert.match(dc, /livekit:\n\s+image: livekit\/livekit-server:v1\.13\.10\n[\s\S]*?profiles: \["livekit"\]/, "feste Fassung, nur mit Profil");
  assert.match(dc, /- \.\/livekit\.yaml:\/etc\/livekit\.yaml:ro/);
  for (const v of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) assert.match(dc, new RegExp(`${v}: "\\$\\{${v}:-\\}"`));
  assert.doesNotMatch(dc, /\$\{LIVEKIT_[A-Z_]+:\?/, "ein „:?“ bräche jedes docker compose up");
  assert.ok(readFileSync(new URL(".gitignore", wurzel), "utf8").split("\n").includes("livekit.yaml"), "nie einchecken");
});
