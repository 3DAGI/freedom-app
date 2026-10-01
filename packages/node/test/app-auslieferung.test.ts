/**
 * Der Knoten liefert die App aus (B-10, L2 A): nur die beim Start geprüfte
 * Datei mit der angegebenen SHA-256, auf dem Port des Relays, aus dem Speicher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";
import { APP_GRUND_TEXT, appAusUmgebung, istAppPfad, ladeApp } from "../src/app-auslieferung.js";
import { RelayRole } from "../src/relay-role.js";

let portZaehler = 18_100;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const HTML = "<!doctype html><title>FreedomStack</title><p>App</p>\n";

function mitDatei<T>(inhalt: string, fn: (datei: string) => Promise<T>): Promise<T> {
  const ordner = mkdtempSync(join(tmpdir(), "freedom-app-"));
  const datei = join(ordner, "freedom.html");
  writeFileSync(datei, inhalt);
  return fn(datei).finally(() => rmSync(ordner, { recursive: true, force: true }));
}

async function mitRelay<T>(app: ConstructorParameters<typeof RelayRole>[0]["app"], fn: (basis: string) => Promise<T>): Promise<T> {
  const port = portZaehler++;
  const r = new RelayRole({ port, retentionDays: 7, maxEventBytes: 64_000, app });
  await r.start();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    r.stop();
  }
}

test("B-10: ladeApp – nur mit der erwarteten SHA-256; sonst ein fester Grund, nie die Datei", async () => {
  await mitDatei(HTML, async (datei) => {
    const ok = await ladeApp(datei, sha(HTML));
    assert.ok(ok.ok);
    assert.equal(ok.app.sha256, sha(HTML));
    assert.equal(ok.app.html.toString("utf8"), HTML);
    assert.ok((await ladeApp(datei, ` ${sha(HTML).toUpperCase()}\n`)).ok, "Groß/klein und Leerraum wie aus einer .sha256-Datei");
    assert.deepEqual(await ladeApp(datei, sha(HTML + " ")), { ok: false, grund: "summe-anders" });
    assert.deepEqual(await ladeApp(datei, sha(HTML).slice(1)), { ok: false, grund: "keine-summe" });
    assert.deepEqual(await ladeApp(datei, `${sha(HTML)}  freedom.html`), { ok: false, grund: "keine-summe" }, "nur die Summe, keine Zeile von sha256sum");
    assert.deepEqual(await ladeApp(`${datei}.fehlt`, sha(HTML)), { ok: false, grund: "nicht-lesbar" });
  });
  // Feste Texte fürs Log – nie ein Pfad oder eine Meldung des Systems
  for (const text of Object.values(APP_GRUND_TEXT)) assert.doesNotMatch(text, /\/tmp|ENOENT|EACCES/);
});

test("B-10: Umgebung – APP_SHA256 schaltet ein, APP_DATEI nennt die Datei, leere Werte gelten nicht", () => {
  const basis = "/opt/freedom/packages/node";
  assert.equal(appAusUmgebung({}, basis), undefined);
  assert.equal(appAusUmgebung({ APP_SHA256: "", APP_DATEI: "/x.html" }, basis), undefined, "leer aus der Umgebungsdatei = aus");
  assert.deepEqual(appAusUmgebung({ APP_SHA256: "ab" }, basis), { datei: resolve(basis, "../app/dist/freedom.html"), soll: "ab" }, "Standard: der Build im eigenen Checkout");
  assert.deepEqual(appAusUmgebung({ APP_SHA256: "ab", APP_DATEI: "" }, basis)?.datei, resolve(basis, "../app/dist/freedom.html"));
  assert.deepEqual(appAusUmgebung({ APP_SHA256: "ab", APP_DATEI: "/srv/freedom.html" }, basis)?.datei, "/srv/freedom.html");
  assert.equal(istAppPfad("/"), "app");
  assert.equal(istAppPfad("/freedom.html"), "app");
  assert.equal(istAppPfad("/freedom.html.sha256"), "summe");
  for (const anders of ["/index.html", "/../freedom.html", "/freedom.html/", "/zugang", "/app"]) assert.equal(istAppPfad(anders), undefined, anders);
});

test("B-10: Relay liefert genau die geprüfte Datei – mit Summe, ETag und Schutz vor fremden Rahmen; NIP-11 und WebSocket bleiben", async () => {
  await mitDatei(HTML, async (datei) => {
    const geladen = await ladeApp(datei, sha(HTML));
    assert.ok(geladen.ok);
    // nach dem Start geändert: hinaus geht trotzdem nur, was geprüft wurde
    writeFileSync(datei, "<script>boese()</script>");
    await mitRelay(geladen.app, async (basis) => {
      for (const pfad of ["/", "/freedom.html", "/?x=1"]) {
        const r = await fetch(basis + pfad);
        assert.equal(r.status, 200, pfad);
        assert.equal(await r.text(), HTML, pfad);
        assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(r.headers.get("etag"), `"${sha(HTML)}"`);
        assert.equal(r.headers.get("x-content-type-options"), "nosniff");
        assert.equal(r.headers.get("x-frame-options"), "DENY");
        assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'none'");
        assert.equal(r.headers.get("referrer-policy"), "no-referrer");
      }
      const summe = await fetch(`${basis}/freedom.html.sha256`);
      assert.equal(await summe.text(), `${sha(HTML)}\n`, "die Summe daneben – zum Vergleich mit der Website");
      const kopf = await fetch(`${basis}/freedom.html`, { method: "HEAD" });
      assert.equal(kopf.headers.get("content-length"), String(Buffer.byteLength(HTML)));
      assert.equal(await kopf.text(), "");
      const gleich = await fetch(`${basis}/`, { headers: { "If-None-Match": `"${sha(HTML)}"` } });
      assert.equal(gleich.status, 304, "unverändert: nichts erneut");
      // NIP-11 auf demselben Pfad bleibt, ebenso der Relay selbst
      const info = await fetch(`${basis}/`, { headers: { Accept: "application/nostr+json" } });
      assert.equal(info.headers.get("content-type"), "application/nostr+json");
      assert.equal((await info.json() as { name: string }).name, "Freedom-Relay");
      assert.equal((await fetch(`${basis}/index.html`)).headers.get("content-type"), "text/plain; charset=utf-8", "sonst nichts");
      const ws = new WebSocket(basis.replace(/^http/, "ws"));
      const erste = await new Promise<unknown[]>((ok, fail) => { ws.once("message", (m) => ok(JSON.parse(String(m)))); ws.once("error", fail); });
      ws.close();
      assert.equal(erste[0], "AUTH", "derselbe Port ist weiter der Relay");
    });
  });
});

test("B-10: ohne geprüfte App liefert der Relay keine Seite aus", async () => {
  await mitRelay(undefined, async (basis) => {
    for (const pfad of ["/", "/freedom.html", "/freedom.html.sha256"]) {
      const r = await fetch(basis + pfad);
      assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8", pfad);
      assert.equal(await r.text(), "Freedom-Relay – mit einem Nostr-Client verbinden.\n", pfad);
    }
  });
});

test("B-10: main.ts – nur mit RELAY_ENABLED, nur geprüft, Gründe als feste Texte", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const appWahl = appAusUmgebung\(process\.env, process\.cwd\(\)\);/);
  assert.match(main, /const appGeladen = appWahl \? await ladeApp\(appWahl\.datei, appWahl\.soll\) : undefined;/);
  assert.match(main, /console\.warn\(`\[app\] nicht ausgeliefert: \$\{APP_GRUND_TEXT\[appGeladen\.grund\]\}`\)/);
  assert.match(main, /app: appGeladen\?\.ok \? appGeladen\.app : undefined,/, "an den Relay nur eine geprüfte App");
  assert.match(main, /\} else if \(process\.env\.APP_SHA256\?\.trim\(\)\) \{\s*console\.warn\("\[app\] nicht ausgeliefert: nur mit RELAY_ENABLED=1/);
  // Die Relay-Rolle bekommt die App nur als Ergebnis von ladeApp() – kein readFile daneben
  const relay = readFileSync(new URL("../src/relay-role.ts", import.meta.url), "utf8");
  assert.doesNotMatch(relay.slice(relay.indexOf("private liefereApp("), relay.indexOf("private httpBasis(")), /readFile|createReadStream/);
  // Installer: die Summe nur geprüft in die Umgebungsdatei, gebaut wird im eigenen Checkout
  const sh = readFileSync(new URL("../../../scripts/install-freedom.sh", import.meta.url), "utf8");
  assert.match(sh, /^APP_SHA256=\$\{APP_SHA256:-\}$/m);
  assert.match(sh, /\[\[ "\$APP_SHA256" =~ \^\[0-9a-f\]\{64\}\$ \]\] \|\| die/, "keine Zeile in die Umgebungsdatei ohne Prüfung");
  assert.ok(sh.indexOf('[[ "$APP_SHA256" =~') < sh.indexOf("APP_SHA256=${APP_SHA256:-}"), "erst prüfen, dann schreiben");
});
