/**
 * TURN einrichten (B-13b, T1 A, T2 A): Das Skript schreibt eine Datei für
 * coturn mit 0600, nur TURN-REST, ohne Weg in private Netze und ohne Log;
 * seine Ausgabe nimmt der Knoten an. Installer und Docker nutzen es.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnAusUmgebung, turnZugang } from "../src/turn.js";

const skript = new URL("../../../scripts/turn-einrichten.sh", import.meta.url).pathname;
const lauf = (...args: string[]) => spawnSync("bash", [skript, ...args], { encoding: "utf8" });

test("B-13b: turn-einrichten.sh – Datei mit 0600, nur TURN-REST, alle privaten Bereiche gesperrt, kein Log; der Knoten nimmt die Ausgabe an", () => {
  const ziel = join(mkdtempSync(join(tmpdir(), "turn-")), "freedom", "turnserver.conf");
  const r = lauf(ziel, "knoten.example.org");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statSync(ziel).mode & 0o777, 0o600, "nur für den Besitzer lesbar");
  const conf = readFileSync(ziel, "utf8");
  const zeilen = conf.split("\n").filter((z) => z && !z.startsWith("#"));
  const geheimnis = zeilen.find((z) => z.startsWith("static-auth-secret="))!.split("=")[1]!;
  assert.match(geheimnis, /^[0-9a-f]{64}$/, "zufällig, 64 Hex-Zeichen");
  for (const muss of ["use-auth-secret", "realm=knoten.example.org", "no-cli", "no-multicast-peers", "fingerprint", "log-file=/dev/null", "no-stdout-log",
    "listening-port=3478", "min-port=49160", "max-port=49200", "user-quota=4", "total-quota=40", "max-bps=500000"]) {
    assert.ok(zeilen.includes(muss), muss);
  }
  assert.ok(!zeilen.some((z) => /^(user|lt-cred-mech|allow-loopback-peers|cli-password)(=|$)/.test(z)), "keine festen Nutzer, kein Loopback, keine Konsole");
  // Kein Weg in private, lokale oder reservierte Netze
  const gesperrt = zeilen.filter((z) => z.startsWith("denied-peer-ip=")).map((z) => z.slice("denied-peer-ip=".length));
  for (const bereich of ["10.0.0.0-10.255.255.255", "172.16.0.0-172.31.255.255", "192.168.0.0-192.168.255.255", "127.0.0.0-127.255.255.255",
    "169.254.0.0-169.254.255.255", "100.64.0.0-100.127.255.255", "0.0.0.0-0.255.255.255", "224.0.0.0-255.255.255.255", "::-::1",
    "::ffff:0.0.0.0-::ffff:255.255.255.255", "fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]) {
    assert.ok(gesperrt.includes(bereich), bereich);
  }
  // Ausgabe für die Umgebung des Knotens – dasselbe Geheimnis, gültige Adressen
  const env = Object.fromEntries(r.stdout.trim().split("\n").map((z) => [z.slice(0, z.indexOf("=")), z.slice(z.indexOf("=") + 1)]));
  assert.deepEqual(Object.keys(env), ["TURN_SECRET", "TURN_URLS"]);
  assert.equal(env.TURN_SECRET, geheimnis);
  const { dienst } = turnAusUmgebung(env);
  assert.ok(dienst, "der Knoten nimmt sie an");
  assert.deepEqual(dienst.urls, ["turn:knoten.example.org:3478?transport=udp", "turn:knoten.example.org:3478?transport=tcp"]);
  assert.ok(turnZugang(dienst).passwort.length === 28);
  // Nie überschreiben: das Geheimnis darin gilt weiter
  const nochmal = lauf(ziel, "knoten.example.org");
  assert.equal(nochmal.status, 1);
  assert.equal(readFileSync(ziel, "utf8"), conf);
});

test("B-13b: turn-einrichten.sh – ungültige Namen und Aufrufe gehen nicht durch; --docker nennt den Nutzer", () => {
  const ordner = mkdtempSync(join(tmpdir(), "turn-"));
  for (const name of ["", "knoten example", "-knoten", "knoten;rm -rf ~", "knoten.example$", "a".repeat(200)]) {
    const r = lauf(join(ordner, `x-${Math.random()}.conf`), name);
    assert.equal(r.status, 2, `„${name.slice(0, 20)}“`);
  }
  assert.equal(lauf(join(ordner, "y.conf"), "knoten.example", "--anders").status, 2);
  const d = lauf(join(ordner, "d.conf"), "knoten.example", "--docker");
  assert.equal(d.status, 0, d.stderr);
  assert.deepEqual(d.stdout.trim().split("\n").map((z) => z.split("=")[0]), ["TURN_SECRET", "TURN_URLS", "TURN_UID", "TURN_GID"]);
  // Eine schon vorhandene Datei bleibt, wie sie ist
  const da = join(ordner, "da.conf");
  writeFileSync(da, "eigene Einstellungen");
  assert.equal(lauf(da, "knoten.example").status, 1);
  assert.equal(readFileSync(da, "utf8"), "eigene Einstellungen");
});

test("B-13b: Installer und Docker – optional, Geheimnis nur in Datei und Umgebung, coturn als eigener Dienst, nie eingecheckt", () => {
  const wurzel = new URL("../../../", import.meta.url);
  const sh = readFileSync(new URL("scripts/install-freedom.sh", wurzel), "utf8");
  spawnSync("bash", ["-n", new URL("scripts/install-freedom.sh", wurzel).pathname]);
  assert.match(sh, /TURN_ZEILEN="\$\(bash "\$FREEDOM_DIR\/scripts\/turn-einrichten\.sh" "\$TURN_CONF" "\$TURN_NAME"\)"/, "der Name nur als Argument");
  assert.match(sh, /^TURN_SECRET=\$\{TURN_SECRET:-\}$/m);
  assert.match(sh, /^TURN_URLS=\$\{TURN_URLS:-\}$/m);
  assert.match(sh, /ExecStart=\$\(command -v turnserver\) -c \$TURN_CONF/, "mit der eigenen Datei, das Geheimnis nie auf der Befehlszeile");
  assert.match(sh, /systemctl disable --now coturn/, "der Dienst des Pakets bleibt aus");
  assert.doesNotMatch(sh, /(ok|say|warn)[^\n]*\$TURN_SECRET/, "das Geheimnis nie ausgeben");
  const dc = readFileSync(new URL("docker-compose.yml", wurzel), "utf8");
  assert.match(dc, /coturn:\n\s+image: coturn\/coturn:4\.18\n[\s\S]*?profiles: \["anrufe"\]/, "feste Version, nur mit Profil");
  assert.match(dc, /- \.\/turnserver\.conf:\/etc\/coturn\/turnserver\.conf:ro/);
  assert.match(dc, /TURN_SECRET: "\$\{TURN_SECRET:-\}"/);
  assert.doesNotMatch(dc, /\$\{TURN_[A-Z]+:\?/, "ein „:?“ bräche jedes docker compose up");
  const ignoriert = readFileSync(new URL(".gitignore", wurzel), "utf8").split("\n");
  for (const d of ["turnserver.conf", ".env"]) assert.ok(ignoriert.includes(d), `${d} nie einchecken`);
});
