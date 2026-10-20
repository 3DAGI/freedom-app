/**
 * Vorschau wie Replit (VKg1a): ein Projekt live unter eigenem Port – nur mit dem Zeichen aus der versiegelten
 * Antwort, nur Dateien im Projekt (kein `.git`, keine Verweise hinaus), echte Inhaltstypen, nichts zwischengespeichert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_KNOTEN_CODE, LocalSigner, MemoryRelay, OutboxPool, baueCodeAuftrag, generateKeypair, getTag, istVorschauAdresse,
  leseCodeAntwort, neueKopplung, openPrivateJobResponse, type CodeAktion,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { ProjektAblage } from "../src/projekte.js";
import { VORSCHAU_COOKIE, VORSCHAU_PORT, VorschauServer, vorschauAusUmgebung } from "../src/vorschau.js";

test("VKg1a: Umgebung – ohne VORSCHAU_URL aus, Ursprung ohne Pfad, eigener Port; ungültig hält den Start an", () => {
  assert.equal(vorschauAusUmgebung({}), null);
  assert.equal(vorschauAusUmgebung({ VORSCHAU_URL: " " }), null);
  assert.deepEqual(vorschauAusUmgebung({ VORSCHAU_URL: "http://192.168.1.20:3603" }), { einstellung: { basis: "http://192.168.1.20:3603", port: VORSCHAU_PORT, host: "0.0.0.0" } });
  assert.deepEqual(vorschauAusUmgebung({ VORSCHAU_URL: "https://vorschau.example.org/", VORSCHAU_PORT: "8080", VORSCHAU_HOST: "127.0.0.1" }),
    { einstellung: { basis: "https://vorschau.example.org", port: 8080, host: "127.0.0.1" } });
  for (const falsch of ["192.168.1.20", "ftp://h", "http://u:p@h", "http://h/pfad", "http://h/?x", "http://h/#x", "javascript:alert(1)"]) {
    assert.match(vorschauAusUmgebung({ VORSCHAU_URL: falsch })!.grund!, /VORSCHAU_URL/, falsch);
  }
  for (const port of ["0", "65536", "-1", "x", "80.5", "123456"]) assert.match(vorschauAusUmgebung({ VORSCHAU_URL: "http://h", VORSCHAU_PORT: port })!.grund!, /kein Port/, port);
  assert.match(vorschauAusUmgebung({ VORSCHAU_URL: "http://h", VORSCHAU_PORT: "7777" })!.grund!, /eigenen/, "nie der Port der App");
  assert.match(vorschauAusUmgebung({ VORSCHAU_URL: "http://h", VORSCHAU_PORT: "9000", RELAY_PORT: "9000" })!.grund!, /eigenen/);
});

/** Ein Projekt mit Seite, Unterordner, Geheimnissen daneben und Verweisen hinaus. */
function projekt() {
  const o = join(mkdtempSync(join(tmpdir(), "vorschau-")), "projekte");
  const p = join(o, "app");
  mkdirSync(join(p, "seiten"), { recursive: true });
  mkdirSync(join(p, ".git"));
  writeFileSync(join(p, "index.html"), "<h1>Start</h1>");
  writeFileSync(join(p, "app.js"), "console.log(1)");
  writeFileSync(join(p, "seiten", "index.html"), "<p>Seiten</p>");
  writeFileSync(join(p, "spiel.wasm"), Buffer.from([0, 97, 115, 109]));
  writeFileSync(join(p, ".git", "config"), "[core]");
  writeFileSync(join(p, ".env"), "GEHEIM=1");
  const draussen = join(o, "..", "node-key");
  writeFileSync(draussen, "SCHLUESSEL");
  symlinkSync(draussen, join(p, "schluessel.txt"));
  mkdirSync(join(o, "..", "anderes"));
  writeFileSync(join(o, "..", "anderes", "x.txt"), "ANDERES");
  symlinkSync(join(o, "..", "anderes"), join(p, "verweis"));
  return { o, p, ablage: new ProjektAblage(o) };
}

async function server(ablage: ProjektAblage) {
  const v = new VorschauServer(ablage, { basis: "http://knoten.example:3603", port: 0, host: "127.0.0.1" });
  const port = await v.starte();
  // node:http statt fetch: fetch glättet `..`, `%2e%2e` und Rückstriche im Pfad, bevor er den Server erreicht
  const hole = (pfad: string, o: { cookie?: string; method?: string } = {}) =>
    new Promise<{ status: number; headers: Map<string, string>; text: () => Promise<string> }>((ok, fehler) => {
      const r = request({ host: "127.0.0.1", port, path: pfad, method: o.method ?? "GET", headers: o.cookie ? { cookie: o.cookie } : {} }, (res) => {
        const teile: Buffer[] = [];
        res.on("data", (b: Buffer) => teile.push(b));
        res.on("end", () => {
          const headers = new Map(Object.entries(res.headers).map(([k, w]) => [k, Array.isArray(w) ? w.join(", ") : String(w)]));
          ok({ status: res.statusCode!, headers, text: async () => Buffer.concat(teile).toString() });
        });
      });
      r.on("error", fehler);
      r.end();
    });
  return { v, port, hole };
}

test("VKg1a: Adresse – Zeichen je Projekt bleibt gleich; der erste Aufruf setzt das Cookie und leitet auf / weiter", async () => {
  const { ablage } = projekt();
  const { v, hole } = await server(ablage);
  try {
    const a = v.adresse("app");
    assert.ok(istVorschauAdresse(a), a);
    assert.equal(v.adresse("app"), a);
    assert.notEqual(v.adresse("zwei"), a, "je Projekt ein eigenes Zeichen");
    assert.throws(() => v.adresse("../x"));
    const zeichen = new URL(a).pathname.slice(1, -1);
    const r = await hole(`/${zeichen}/`);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/");
    assert.equal(r.headers.get("set-cookie"), `${VORSCHAU_COOKIE}=${zeichen}; Path=/; HttpOnly; SameSite=Lax`);
    assert.equal((await hole(`/${zeichen}/seiten/`)).headers.get("location"), "/seiten/", "der Rest des Pfads bleibt");
    for (const fremd of [`/${zeichen}//boese.example/`, `/${zeichen}/\\boese.example/`, `/${zeichen}/\\/boese.example/`]) {
      assert.equal((await hole(fremd)).headers.get("location"), "/boese.example/", `nie eine fremde Adresse: ${fremd}`);
    }
    assert.equal((await hole(`/${"ab".repeat(32)}/`)).status, 404, "unbekanntes Zeichen");
    assert.equal((await hole("/")).status, 404, "ohne Cookie nichts");
    assert.equal((await hole("/", { cookie: `${VORSCHAU_COOKIE}=${"ab".repeat(32)}` })).status, 404);
  } finally {
    await v.schliesse();
  }
});

test("VKg1a: ausgeliefert nur Dateien im Projekt – live, mit Typ, ohne .git, .env, Verweise und Ausbrüche", async () => {
  const { p, ablage } = projekt();
  const { v, hole } = await server(ablage);
  try {
    const zeichen = new URL(v.adresse("app")).pathname.slice(1, -1);
    const cookie = `andere=1; ${VORSCHAU_COOKIE}=${zeichen}`;
    const start = await hole("/", { cookie });
    assert.equal(start.status, 200);
    assert.equal(await start.text(), "<h1>Start</h1>");
    assert.equal(start.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(start.headers.get("x-content-type-options"), "nosniff");
    assert.equal(start.headers.get("cache-control"), "no-store");
    assert.equal(start.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await hole("/app.js", { cookie })).headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal((await hole("/spiel.wasm", { cookie })).headers.get("content-type"), "application/wasm");
    assert.equal(await (await hole("/seiten/", { cookie })).text(), "<p>Seiten</p>");
    assert.equal(await (await hole("/seiten", { cookie })).text(), "<p>Seiten</p>");
    assert.equal(await (await hole("/konto/einstellungen", { cookie })).text(), "<h1>Start</h1>", "eigenes Routing der Seite");
    assert.equal((await hole("/fehlt.js", { cookie })).status, 404, "mit Endung kein Ersatz");
    const kopf = await hole("/app.js", { cookie, method: "HEAD" });
    assert.equal(kopf.headers.get("content-length"), "14");
    assert.equal((await hole("/app.js", { cookie, method: "POST" })).status, 405);
    // live: der Agent ändert, die nächste Anfrage zeigt es
    writeFileSync(join(p, "index.html"), "<h1>Neu</h1>");
    assert.equal(await (await hole("/", { cookie })).text(), "<h1>Neu</h1>");
    for (const verboten of [
      "/.git/config", "/.env", "/%2egit/config", "/%2e%2e/node-key", "/../node-key", "/seiten/%2e%2e/%2e%2e/node-key", "/a%2f..%2f..%2fnode-key",
      "/schluessel.txt", "/verweis/x.txt", "/seiten//index.html", "/%00", "/%E0%A4%A",
    ]) {
      const r = await hole(verboten, { cookie });
      assert.ok(r.status === 404 || r.status === 400, `${verboten}: ${r.status}`);
      const inhalt = await r.text();
      assert.ok(!/SCHLUESSEL|GEHEIM|ANDERES|\[core\]/.test(inhalt), verboten);
    }
    // zweite Wand für einen Tausch zwischen lstat und open: ein Verweis mitten im Pfad endet trotz O_NOFOLLOW draußen
    if (process.platform === "linux") {
      const oeffne = (v as unknown as { oeffne(o: string, e: string, k: string[]): Promise<{ fh: { close(): Promise<void> } } | null> }).oeffne.bind(v);
      assert.equal(await oeffne(p, p, ["verweis", "x.txt"]), null, "außerhalb des Projekts");
      const drin = await oeffne(p, p, ["seiten", "index.html"]);
      assert.ok(drin);
      await drin.fh.close();
    }
    // gebaute Seite vor den Quellen
    mkdirSync(join(p, "dist"));
    writeFileSync(join(p, "dist", "index.html"), "<h1>Gebaut</h1>");
    assert.equal(await (await hole("/", { cookie })).text(), "<h1>Gebaut</h1>");
    // ein Verweis als dist zählt nicht
    rmSync(join(p, "dist"), { recursive: true });
    symlinkSync(join(p, "seiten"), join(p, "dist"));
    assert.equal(await (await hole("/", { cookie })).text(), "<h1>Neu</h1>");
    // Projekt weg: nichts
    rmSync(p, { recursive: true });
    assert.equal((await hole("/", { cookie })).status, 404);
  } finally {
    await v.schliesse();
  }
});

test("VKg1a: über den Knoten – Adresse versiegelt an den Besitzer; ohne VORSCHAU_URL code-vorschau-aus", async () => {
  const relay = new MemoryRelay(`mem://vorschau-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair(), k = neueKopplung(kp.pk);
  const { ablage } = projekt();
  const v = new VorschauServer(ablage, { basis: "http://knoten.example:3603", port: 0, host: "127.0.0.1" });
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], projekte: ablage,
  }, pool);
  const frage = async (aktion: CodeAktion) => {
    const s = new LocalSigner(generateKeypair().sk);
    await pool.publish((await baueCodeAuftrag({ sitzung: s, kopplung: k, aktion })).wrap);
    await provider.pollOnce();
    return (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s))))
      .flatMap((x) => (x.ok ? [x.response] : []));
  };
  const aus = (await frage({ aktion: "vorschau", projekt: "app" })).find((r) => r.kind === 7000)!;
  assert.equal(getTag(aus, "fall"), "code-vorschau-aus");
  (provider as unknown as { cfg: { vorschau?: VorschauServer } }).cfg.vorschau = v;
  const an = leseCodeAntwort((await frage({ aktion: "vorschau", projekt: "app" })).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "vorschau");
  assert.deepEqual(an, { aktion: "vorschau", url: v.adresse("app") });
  assert.equal((await relay.query({ kinds: [7000, KIND_DVM_KNOTEN_CODE + 1000] })).length, 0, "nie offen");
});
