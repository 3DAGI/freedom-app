/**
 * Wecken im Knoten (B-12b, W1 A, W2 A): Kommt ein Umschlag an einen
 * beobachteten Schlüssel, geht an die passende Push-Adresse eine leere
 * Nachricht mit VAPID – nur einmal je Umschlag, gebremst je Adresse; was schon
 * da war, weckt nie; abgelaufene Adressen werden vergessen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEvent, generateKeypair, signEvent, MAX_TIME_JITTER_SECS } from "@freedomstack/protocol";
import { RelayRole } from "../src/relay-role.js";
import { WECKEN_ABSTAND_SEK, WECKEN_KONTAKT, WeckBuch, WeckDienst, ladeVapid, sendePush, vapidKopf, type WeckTreffer } from "../src/wecken.js";

const A = "https://fcm.googleapis.com/fcm/send/geraet-a", B = "https://updates.push.services.mozilla.com/wpush/v2/geraet-b";
const ordner = () => mkdtempSync(join(tmpdir(), "wecken-dienst-"));

test("B-12b: VAPID-Kopf – ES256-Token für den Ursprung der Adresse, prüfbar mit dem öffentlichen Schlüssel; leer, mit Thema und TTL", () => {
  const vapid = ladeVapid(join(ordner(), "vapid.json"))!;
  const k = vapidKopf(A, vapid, 1_790_000_000);
  assert.deepEqual(Object.keys(k).sort(), ["Authorization", "Content-Length", "TTL", "Topic", "Urgency"]);
  assert.equal(k["Content-Length"], "0");
  assert.equal(k.Topic, "freedom", "wartende Weckrufe ersetzen sich");
  const m = k.Authorization!.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, k.Authorization);
  assert.equal(m[4], vapid.oeffentlich);
  assert.deepEqual(JSON.parse(Buffer.from(m[1]!, "base64url").toString()), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(Buffer.from(m[2]!, "base64url").toString()), { aud: "https://fcm.googleapis.com", exp: 1_790_000_000 + 12 * 3600, sub: WECKEN_KONTAKT });
  const roh = Buffer.from(m[4]!, "base64url");
  const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: roh.subarray(1, 33).toString("base64url"), y: roh.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3]!, "base64url")), "Signatur gültig");
});

function aufbau() {
  const buch = new WeckBuch(join(ordner(), "wecken.json"));
  const vapid = ladeVapid(join(ordner(), "vapid.json"))!;
  let jetzt = 1_790_000_000;
  const liegt: WeckTreffer[] = [];
  const gesendet: { endpunkt: string; kopf: Record<string, string> }[] = [];
  const antwort = new Map<string, number | Error>();
  const dienst = new WeckDienst({
    buch, vapid, jetzt: () => jetzt,
    abfrage: async (schluessel, seit) => liegt.filter((t) => t.created_at >= seit && t.an.some((k) => schluessel.includes(k))),
    senden: async (endpunkt, kopf) => {
      gesendet.push({ endpunkt, kopf });
      const a = antwort.get(endpunkt) ?? 201;
      if (a instanceof Error) throw a;
      return a;
    },
  });
  return { buch, dienst, liegt, gesendet, antwort, spaeter: (s: number) => { jetzt += s; }, jetzt: () => jetzt };
}

test("B-12b: neue Post weckt genau die passende Adresse – einmal je Umschlag, auch zurückdatiert; was schon da war, weckt nie", async () => {
  const { buch, dienst, liegt, gesendet, spaeter, jetzt } = aufbau();
  const ich = generateKeypair().pk, geraet = generateKeypair().pk, fremd = generateKeypair().pk;
  buch.nimm({ aktion: "an", endpunkt: A, schluessel: [ich] });
  buch.nimm({ aktion: "an", endpunkt: B, schluessel: [geraet] });
  liegt.push({ id: "alt", created_at: jetzt() - 100, an: [ich] });
  assert.equal(await dienst.pruefe(), 0, "Grundstand: was schon da war, weckt nicht");
  liegt.push({ id: "neu", created_at: jetzt() - Math.floor(MAX_TIME_JITTER_SECS / 2), an: [ich] }, { id: "nicht-meins", created_at: jetzt(), an: [fremd] });
  assert.equal(await dienst.pruefe(), 1, "neu, obwohl einen Tag zurückdatiert");
  assert.deepEqual(gesendet.map((g) => g.endpunkt), [A], "nur die Adresse, deren Schlüssel Post bekam");
  assert.equal(await dienst.pruefe(), 0, "derselbe Umschlag weckt nicht noch einmal");
  // Gebremst je Adresse: neue Post gleich danach weckt erst nach dem Abstand
  liegt.push({ id: "gleich-danach", created_at: jetzt(), an: [ich] });
  assert.equal(await dienst.pruefe(), 0, "innerhalb des Abstands nicht");
  spaeter(WECKEN_ABSTAND_SEK);
  liegt.push({ id: "spaeter", created_at: jetzt(), an: [ich, geraet] });
  assert.equal(await dienst.pruefe(), 2, "nach dem Abstand wieder – beide Geräte");
  // Kein Inhalt, kein Absender: nur Adresse und Kopfzeilen
  for (const g of gesendet) assert.ok(!JSON.stringify(g.kopf).includes("spaeter") && !JSON.stringify(g.kopf).includes(ich));
});

test("B-12b: ein später gemeldeter Schlüssel beginnt mit Grundstand; ohne Anmeldung wird nicht gefragt", async () => {
  const { buch, dienst, liegt, gesendet, spaeter, jetzt } = aufbau();
  const ich = generateKeypair().pk, neu = generateKeypair().pk;
  let gefragt = 0;
  const leer = new WeckDienst({ buch: new WeckBuch(join(ordner(), "w.json")), vapid: ladeVapid(join(ordner(), "v.json"))!, abfrage: async () => { gefragt++; return []; } });
  assert.equal(await leer.pruefe(), 0);
  assert.equal(gefragt, 0, "ohne Anmeldung fragt der Knoten keine Relays");
  buch.nimm({ aktion: "an", endpunkt: A, schluessel: [ich] });
  await dienst.pruefe();
  liegt.push({ id: "fuer-neu", created_at: jetzt(), an: [neu] });
  buch.nimm({ aktion: "an", endpunkt: A, schluessel: [ich, neu] });
  spaeter(WECKEN_ABSTAND_SEK);
  assert.equal(await dienst.pruefe(), 0, "was für den neuen Schlüssel schon lag, weckt nicht");
  liegt.push({ id: "danach", created_at: jetzt(), an: [neu] });
  assert.equal(await dienst.pruefe(), 1);
  assert.equal(gesendet.length, 1);
});

test("B-12b: abgelaufene Adressen (404/410) werden vergessen, Fehler einer Adresse halten die andere nicht auf", async () => {
  const { buch, dienst, liegt, antwort, jetzt } = aufbau();
  const ich = generateKeypair().pk;
  buch.nimm({ aktion: "an", endpunkt: A, schluessel: [ich] });
  buch.nimm({ aktion: "an", endpunkt: B, schluessel: [ich] });
  await dienst.pruefe();
  antwort.set(A, 410);
  antwort.set(B, Object.assign(new Error("geheime Adresse https://updates…"), { name: "TimeoutError" }));
  const log: string[] = [];
  const alt = { log: console.log, warn: console.warn };
  console.log = console.warn = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  try {
    liegt.push({ id: "x", created_at: jetzt(), an: [ich] });
    assert.equal(await dienst.pruefe(), 0);
  } finally {
    Object.assign(console, alt);
  }
  assert.deepEqual(buch.alle().map((e) => e.endpunkt), [B], "410: vergessen; Fehler: bleibt");
  assert.deepEqual(log, ["[wecken] eine Push-Adresse ist abgelaufen und vergessen", "[wecken] Push gescheitert (TimeoutError)"], "nie die Adresse, nie die Meldung");
});

test("B-12b: sendePush schickt nie an private Ziele", async () => {
  await assert.rejects(sendePush("https://127.0.0.1/push", {}), { name: "AdresseAbgelehnt" });
  await assert.rejects(sendePush("https://[::1]/push", {}), { name: "AdresseAbgelehnt" });
});

test("B-12b: eigenes Relay – Kennung, Zeit und Empfänger der Umschläge an gemeldete Schlüssel, nie der Inhalt", async () => {
  const r = new RelayRole({ port: 0, retentionDays: 7, maxEventBytes: 64_000, umschlaegeSchuetzen: true });
  const knoten = generateKeypair(), ich = generateKeypair().pk, fremd = generateKeypair().pk;
  const intern = r.alsRelay(knoten.pk);
  const umschlag = (an: string) => { const w = generateKeypair(); return signEvent(buildEvent(w.pk, 1059, [["p", an]], "chiffrat"), w.sk); };
  const meins = umschlag(ich), seins = umschlag(fremd);
  for (const e of [meins, seins]) await intern.publish(e);
  assert.deepEqual(r.umschlaegeAn([ich], 0), [{ id: meins.id, created_at: meins.created_at, an: [ich] }]);
  assert.deepEqual(r.umschlaegeAn([], 0), []);
  assert.deepEqual(await intern.query({ kinds: [1059], "#p": [ich] }), [], "über den Pool sieht der Knoten sie weiter nicht");
});

test("B-12b: main.ts – Dienst nur mit Schlüssel und Buch, eigenes Relay immer, Pool außer mit WECKEN_RELAYS=eigen, im Takt", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /if \(vapid && weckBuch\) \{/);
  assert.match(main, /const eigen = relayRole\?\.umschlaegeAn\(schluessel, seit\) \?\? \[\];\s*if \(nurEigen\) return eigen;/);
  assert.match(main, /const nurEigen = process\.env\.WECKEN_RELAYS === "eigen";/);
  assert.match(main, /setInterval\(\(\) => void weckDienst\.pruefe\(\)\.catch\(\(e\) => console\.warn\(`\[wecken\] \$\{\(e as Error\)\.name\}`\)\), WECKEN_TAKT_MS\);/);
  assert.ok(main.indexOf("if (vapid && weckBuch) {") > main.indexOf("await relayRole.start();"), "erst nach dem Start des Relays");
});
