/**
 * B-32d2: Reticulum im Knoten (RN-W7–W10 A) – die RNode hängt über eine TCP-Brücke am Knoten. Ein Telefon mit eigener
 * RNode funkt in derselben „Luft“ (Attrappen aus `protocol/test`) an die LXMF-Adresse des Knotens; der Knoten reicht
 * Umschläge ins Netz, Weiterleitungsaufträge behält er. Dazu Umgebung, Identitätsdatei und Verdrahtung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FUNK_REGIONEN, LocalSigner, MeshKind, ReticulumFehler, Sendezeitkonto, baueWeiterleitung, buildPrivateDm, generateKeypair,
  lxmfAdresse, reticulumIdentitaet, rnodeOptionen, starteReticulum, type NostrEvent, type ReticulumFunk,
} from "@freedomstack/protocol";
import { UmschlagAnnahme } from "../src/gateway-role.js";
import {
  identitaetsSpeicher, reticulumAusUmgebung, reticulumIdentitaetDatei, starteReticulumGateway, verbindeRNodeTcp, type ReticulumEinstellung,
} from "../src/reticulum-gateway.js";
import { rnodeAttrappe, type Luft } from "../../protocol/test/rnode-attrappe.js";

const EU = FUNK_REGIONEN.find((r) => r.kennung === "eu-869")!;
const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

async function bis(bedingung: () => boolean, frist = 15_000): Promise<void> {
  const ende = Date.now() + frist;
  while (!bedingung()) {
    if (Date.now() > ende) throw new Error("Frist abgelaufen");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Die TCP-Brücke (wie socat): eine Verbindung, Bytes in beide Richtungen zur Attrappe. */
async function bruecke(luft: Luft): Promise<{ port: number; server: net.Server }> {
  const a = rnodeAttrappe({ luft });
  const server = net.createServer((sock) => {
    void a.port.open({ baudRate: 115200 }).then(() => {
      const schreiber = a.port.writable!.getWriter();
      sock.on("data", (d: Buffer) => void schreiber.write(new Uint8Array(d)));
      const leser = a.port.readable!.getReader();
      void (async () => {
        for (;;) {
          const { value, done } = await leser.read();
          if (done) break;
          sock.write(value);
        }
      })().catch(() => undefined);
      sock.on("close", () => void a.port.close());
      sock.on("error", () => undefined);
    });
  });
  await new Promise<void>((fertig) => server.listen(0, "127.0.0.1", fertig));
  return { port: (server.address() as net.AddressInfo).port, server };
}

/** Ein Telefon mit RNode über WebSerial – wie die App. */
async function telefon(luft: Luft): Promise<ReticulumFunk> {
  const { RNodeWebSerialInterface } = await import("@reticulum/core/src/interfaces/rnode-webserial.js");
  const rnode = new RNodeWebSerialInterface({
    ...rnodeOptionen({ region: EU.kennung, parameter: EU.vorgabe }), serialPort: rnodeAttrappe({ luft }).port, name: "telefon",
    autoReconnect: false, postOpenDelayMs: 0, detectTimeout: 2,
  });
  await rnode.connect();
  const m = new Map<string, string>();
  return starteReticulum({
    rnode, parameter: EU.vorgabe, konto: new Sendezeitkonto(), sendeFristMs: 5000, beiEmpfang: () => undefined,
    identitaet: await reticulumIdentitaet({ getItem: (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) }),
  });
}

test("B-32d2: Umgebung – rnode:host:port und Region Pflicht, eigene Werte nur in den Grenzen, sonst kein Start", () => {
  const gut = reticulumAusUmgebung({ FUNK_GATEWAY: "rnode:127.0.0.1:4404", RETICULUM_REGION: "eu-869" });
  assert.deepEqual(gut, { einstellung: { host: "127.0.0.1", port: 4404, region: "eu-869", parameter: EU.vorgabe } });
  const eigene = reticulumAusUmgebung({ FUNK_GATEWAY: "rnode:funk.lan:4404", RETICULUM_REGION: "eu-869", RETICULUM_WERTE: "869462500,125000,10,6,20" });
  assert.deepEqual("einstellung" in eigene && eigene.einstellung.parameter,
    { frequency: 869_462_500, bandwidth: 125_000, spreadingFactor: 10, codingRate: 6, txPower: 20 });
  for (const [env, grund] of [
    [{ FUNK_GATEWAY: "rnode:127.0.0.1", RETICULUM_REGION: "eu-869" }, /host:port/],
    [{ FUNK_GATEWAY: "rnode:127.0.0.1:4404" }, /RETICULUM_REGION/],
    [{ FUNK_GATEWAY: "rnode:127.0.0.1:4404", RETICULUM_REGION: "us-915" }, /RETICULUM_REGION/],
    [{ FUNK_GATEWAY: "rnode:127.0.0.1:4404", RETICULUM_REGION: "eu-869", RETICULUM_WERTE: "869525000,125000,8,5" }, /erwartet/],
    [{ FUNK_GATEWAY: "rnode:127.0.0.1:4404", RETICULUM_REGION: "eu-869", RETICULUM_WERTE: "869525000,125000,8,5,27" }, /leistung/],
    [{ FUNK_GATEWAY: "rnode:127.0.0.1:4404", RETICULUM_REGION: "eu-433", RETICULUM_WERTE: "869525000,125000,8,5,10" }, /frequenz/],
  ] as const) {
    const r = reticulumAusUmgebung(env);
    assert.ok("grund" in r && grund.test(r.grund), JSON.stringify(env));
  }
});

test("B-32d2: Identität in einer Datei (0600) – beim zweiten Mal dieselbe, eine kaputte nie ersetzt", async () => {
  const ordner = mkdtempSync(join(tmpdir(), "freedom-ret-"));
  const datei = reticulumIdentitaetDatei(ordner);
  assert.equal(datei, join(ordner, ".freedom", "reticulum-identitaet"));
  const a = await reticulumIdentitaet(identitaetsSpeicher(datei));
  assert.equal(statSync(datei).mode & 0o777, 0o600);
  assert.match(readFileSync(datei, "utf8"), /^[0-9a-f]{128}\n$/);
  const b = await reticulumIdentitaet(identitaetsSpeicher(datei));
  assert.equal(hex(await lxmfAdresse(b)), hex(await lxmfAdresse(a)));
  writeFileSync(datei, "kaputt\n");
  await assert.rejects(reticulumIdentitaet(identitaetsSpeicher(datei)), (e: unknown) => e instanceof ReticulumFehler && e.fall === "identitaet-kaputt");
  assert.equal(readFileSync(datei, "utf8"), "kaputt\n", "nie still eine neue Adresse");
});

test("B-32d2: über die Luft – ein Umschlag vom Telefon geht ins Netz, einmal; die Weiterleitung bleibt beim Knoten", { timeout: 90_000 }, async () => {
  const luft: Luft = new Set();
  const { port, server } = await bruecke(luft);
  const knoten = generateKeypair();
  const imNetz: NostrEvent[] = [];
  const log: string[] = [];
  const annahme = new UmschlagAnnahme({
    gateway: new LocalSigner(knoten.sk), log: (z) => log.push(z),
    netz: { publish: async (ev) => void imNetz.push(ev), query: async () => [] },
  });
  const einstellung: ReticulumEinstellung = { host: "127.0.0.1", port, region: EU.kennung, parameter: { ...EU.vorgabe } };
  const ordner = mkdtempSync(join(tmpdir(), "freedom-ret-"));
  const gateway = await starteReticulumGateway({
    einstellung, annahme, datei: reticulumIdentitaetDatei(ordner), log: (z) => log.push(z), rnode: { postOpenDelayMs: 0, detectTimeout: 2 },
  });
  const tel = await telefon(luft);
  try {
    const [alice, bob] = [generateKeypair(), generateKeypair()];
    const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "Treffen um 19 Uhr" });
    const roh = new TextEncoder().encode(JSON.stringify(dm.toRecipient));
    await tel.sende(gateway.adresse, roh, MeshKind.NostrEvent, [alice.pk]);
    await bis(() => imNetz.length > 0);
    assert.deepEqual(imNetz.map((e) => e.id), [dm.toRecipient.id]);
    assert.ok(gateway.zaehler.gesendet > 0, "auch was der Knoten selbst funkt (Antwort auf die Pfad-Anfrage), bucht sein Konto");

    // Der Weiterleitungsauftrag an den Knoten (25030) geht nie ins Netz
    const sitzung = new LocalSigner(generateKeypair().sk);
    const { wrap } = await baueWeiterleitung({ sitzung, gatewayPk: knoten.pk });
    await tel.sende(gateway.adresse, new TextEncoder().encode(JSON.stringify(wrap)), MeshKind.NostrEvent, []);
    await bis(() => log.includes("[funk] Sitzung gemerkt"));
    // Derselbe Umschlag ein zweites Mal: einmal im Netz genügt
    await tel.sende(gateway.adresse, roh, MeshKind.NostrEvent, [alice.pk]);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(imNetz.map((e) => e.id), [dm.toRecipient.id], "nur der Umschlag, einmal – die Weiterleitung nie");
    assert.ok(!log.some((z) => /[0-9a-f]{32}/.test(z)), "nichts mit Adressen oder Kennungen ins Log");
  } finally {
    await tel.stoppe().catch(() => undefined);
    await gateway.stoppe().catch(() => undefined);
    server.close();
  }
});

test("B-32d2: ohne Brücke kein Gateway – das erste Verbinden scheitert und hinterlässt keinen Versuch im Hintergrund", async () => {
  const zu = net.createServer();
  await new Promise<void>((fertig) => zu.listen(0, "127.0.0.1", fertig));
  const port = (zu.address() as net.AddressInfo).port;
  await new Promise<void>((fertig) => zu.close(() => fertig()));
  await assert.rejects(verbindeRNodeTcp({ host: "127.0.0.1", port, region: EU.kennung, parameter: EU.vorgabe }, { postOpenDelayMs: 0, detectTimeout: 1, neuSek: 1 }));
  // Lauscht jetzt jemand auf dem Port, ruft niemand mehr an
  let anrufe = 0;
  const spaeter = net.createServer((s) => { anrufe++; s.destroy(); });
  await new Promise<void>((fertig) => spaeter.listen(port, "127.0.0.1", fertig));
  await new Promise((r) => setTimeout(r, 2500));
  await new Promise<void>((fertig) => spaeter.close(() => fertig()));
  assert.equal(anrufe, 0);
});

test("B-32d2: verdrahtet – rnode: vor den anderen Wegen, Rolle erst nach dem Start, das Angebot nennt kein Funk-Gateway", () => {
  const main = lies("src/main.ts");
  assert.ok(main.indexOf('process.env.FUNK_GATEWAY?.startsWith("rnode:")') < main.indexOf("} else if (process.env.FUNK_GATEWAY) {"));
  assert.match(main, /const funk = await starteReticulumGateway\(\{ einstellung: r\.einstellung, annahme, datei: reticulumIdentitaetDatei\(\), log \}\);\n\s+statusRollen\.add\("gateway"\);/);
  assert.match(main, /if \("grund" in r\) \{\n\s+console\.error\(`\[funk\] Reticulum aus – \$\{r\.grund\}`\);/, "ungültig → kein Start");
  // KI-Antworten funkt der Knoten über Reticulum erst ab B-32d3 zurück – bis dahin wählt die App ihn dafür nicht
  assert.match(main, /funkGateway: funkGateway !== undefined,/);
  const gw = lies("src/gateway-role.ts");
  assert.match(gw, /await this\.annahme\.nimm\(JSON\.parse\(new TextDecoder\(\)\.decode\(st\.payload\)\) as NostrEvent, now\);/, "Meshtastic und Reticulum nehmen gleich an");
  const ret = lies("src/reticulum-gateway.ts");
  assert.doesNotMatch(ret, /\.announce\(|startAnnouncing|console\./, "von sich aus keine Ankündigung, das Log nur über den Aufrufer");
  const pkg = JSON.parse(lies("package.json")) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies["@reticulum/core"], "0.9.12", "dieselbe Fassung wie App und Protokoll");
});
