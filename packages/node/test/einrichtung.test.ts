/**
 * Schritt 8.2a: Selbstprüfung eines Provider-Knotens. Geprüft wird, dass die
 * Prüfung erkennt, was die App zum Bezahlen braucht (LNURL mit https,
 * CORS, kleine Beträge, eine echte Rechnung über den richtigen Betrag), den
 * Stand des Zahlkanals samt Auszahlung, nur Fehlernamen weitergibt – und
 * dass sie beim Start und im Installer läuft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { generatePreimage } from "@freedomstack/protocol";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";
import { befundeText, kettenBlick, pruefeEinrichtung, pruefeLightning, pruefeSol, type Antwort } from "../src/einrichtung.js";
import { kanalKasseAusUmgebung } from "../src/kanal-kasse.js";

const knoten = knotenSchluessel();

function lnurl(p: { cors?: string | null; min?: number; max?: number; callback?: string; prefix?: string; status?: number; wirft?: Error } = {}) {
  const gefragt: string[] = [];
  const holen = async (url: string): Promise<Antwort> => {
    gefragt.push(url);
    if (p.wirft) throw p.wirft;
    if (url.includes("/.well-known/lnurlp/")) {
      return {
        status: p.status ?? 200, cors: p.cors === undefined ? "*" : p.cors,
        json: { tag: "payRequest", callback: p.callback ?? "https://wallet.test/cb?x=1", minSendable: p.min ?? 1_000, maxSendable: p.max ?? 100_000_000, metadata: "[]" },
      };
    }
    return { status: 200, cors: "*", json: { pr: rechnung(knoten, p.prefix ?? "lnbc10n", generatePreimage()) } };
  };
  return { holen, gefragt };
}

test("Lightning: Adresse, die Rechnungen ausstellt – mit echter Rechnung über den kleinsten Betrag", async () => {
  const l = lnurl();
  const b = await pruefeLightning("Provider@Wallet.test", l.holen);
  assert.deepEqual(b.map((x) => x.stufe), ["ok"]);
  assert.match(b[0]!.text, /provider@wallet\.test stellt Rechnungen aus \(1 bis 100000 sats\)/);
  assert.equal(l.gefragt[0], "https://wallet.test/.well-known/lnurlp/provider");
  assert.equal(new URL(l.gefragt[1]!).searchParams.get("amount"), "1000", "1 sat, dazu die übrigen Parameter des Callbacks");
  assert.equal(new URL(l.gefragt[1]!).searchParams.get("x"), "1");
});

test("Lightning: was die App nicht bezahlen könnte, meldet die Prüfung", async () => {
  const stufen = async (lud16: string | undefined, p: Parameters<typeof lnurl>[0] = {}) => (await pruefeLightning(lud16, lnurl(p).holen)).map((x) => `${x.stufe}:${x.text}`);
  assert.match((await stufen(undefined))[0]!, /^fehler:NODE_LUD16 fehlt/);
  assert.match((await stufen("keine-adresse"))[0]!, /^fehler:.*keine Lightning-Adresse/);
  assert.match((await stufen("a@localhost"))[0]!, /^fehler:/, "lokale Hosts erreicht die App nicht");
  assert.match((await stufen("a@w.test", { status: 404 }))[0]!, /^fehler:.*HTTP 404/);
  assert.match((await stufen("a@w.test", { callback: "http://w.test/cb" })).at(-1)!, /^fehler:.*https-Callback/);
  assert.match((await stufen("a@w.test", { min: 0 })).at(-1)!, /^fehler:.*keine gültigen Beträge/);
  assert.match((await stufen("a@w.test", { prefix: "lnbc20n" })).at(-1)!, /^fehler:.*anderen Betrag/, "2 sat statt 1 sat");
  const cors = await stufen("a@w.test", { cors: null });
  assert.match(cors[0]!, /^hinweis:.*CORS/);
  assert.match(cors.at(-1)!, /^ok:/);
  const gross = await stufen("a@w.test", { min: 10_000_000, prefix: "lnbc100u" });
  assert.match(gross[0]!, /^hinweis:.*erst ab 10000 sats/);
  assert.match(gross.at(-1)!, /^ok:/);
  // Nur der Fehlername – nie die Meldung eines fremden Servers
  const f = await stufen("a@w.test", { wirft: Object.assign(new Error("interne Adresse 10.0.0.7 abgelehnt"), { name: "AbortError" }) });
  assert.deepEqual(f, ["fehler:a@w.test nicht erreichbar (AbortError)"]);
});

test("SOL: Zahlkanal, Programm, Guthaben für Gebühren und Auszahlung", async () => {
  const dir = mkdtempSync(join(tmpdir(), "einrichtung-"));
  try {
    const schluessel = Keypair.generate();
    const pfad = join(dir, "id.json");
    writeFileSync(pfad, JSON.stringify([...schluessel.secretKey]));
    const o = { rpcUrl: "http://127.0.0.1:1", datei: join(dir, "kanaele.json"), standardSchluessel: pfad };
    const payout = Keypair.generate().publicKey.toBase58();
    const basis = { ZAHLKANAL: "1", NODE_SOL_ADDRESS: schluessel.publicKey.toBase58() };
    const kette = (p: { bereit?: boolean; guthaben?: bigint; programm?: boolean; wirft?: boolean } = {}) => ({
      programmBereit: async () => { if (p.wirft) throw Object.assign(new Error("RPC 10.0.0.7"), { name: "FetchError" }); return p.bereit ?? true; },
      guthaben: async () => p.guthaben ?? 50_000_000n,
      istProgramm: async () => p.programm ?? false,
    });
    const pruefe = async (env: Record<string, string>, k = kette()) =>
      (await pruefeSol(env, { kanal: await kanalKasseAusUmgebung(env, o), kette: k })).map((x) => `${x.stufe}:${x.text}`);

    const gut = await pruefe({ ...basis, NODE_SOL_PAYOUT: payout });
    assert.deepEqual(gut.map((x) => x.split(":")[0]), ["ok", "ok", "ok"]);
    assert.match(gut[2]!, new RegExp(`Auszahlung an ${payout}`));

    assert.match((await pruefe({}))[0]!, /^hinweis:Zahlkanal aus \(ZAHLKANAL=1 setzen\) – Kunden zahlen dann nur mit Lightning/, "ohne Zahlkanal: eine Wahl");
    assert.match((await pruefe({ ZAHLKANAL: "1", NODE_SOL_ADDRESS: payout }))[0]!, /^fehler:.*passt nicht/, "Schlüssel passt nicht: Fehler");

    const knapp = await pruefe({ ...basis }, kette({ bereit: false, guthaben: 0n }));
    assert.match(knapp[1]!, /^hinweis:Das Kanal-Programm liegt auf dieser Kette noch nicht/);
    assert.match(knapp[2]!, /^hinweis:.*hat 0 SOL – für die Gebühren der Einlösungen braucht sie mindestens 0,001 SOL/);
    assert.match(knapp[3]!, /^hinweis:Auszahlung aus \(NODE_SOL_PAYOUT setzen\)/);

    assert.match((await pruefe({ ...basis, NODE_SOL_PAYOUT: "kaputt" })).at(-1)!, /^fehler:Auszahlung: NODE_SOL_PAYOUT ungültig/);
    assert.match((await pruefe({ ...basis, NODE_SOL_PAYOUT: payout }, kette({ programm: true }))).at(-1)!, /^fehler:.*ist ein Programm/);
    assert.match((await pruefe({ ...basis, NODE_SOL_PAYOUT: payout, RELAYER_ENABLED: "1" })).at(-1)!, /^hinweis:.*denselben Schlüssel/);
    const offline = await pruefe({ ...basis, NODE_SOL_PAYOUT: payout }, kette({ wirft: true }));
    assert.equal(offline[1], "hinweis:Kette nicht erreichbar (FetchError) – Programm und Guthaben ungeprüft");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Bericht: beide Schienen, Zeichen je Stufe; verdrahtet beim Start und als npm run pruefen", async () => {
  const b = await pruefeEinrichtung({ NODE_LUD16: "a@w.test" }, { holen: lnurl().holen, kanal: { grund: "aus (ZAHLKANAL=1 setzen)" } });
  assert.equal(befundeText(b), "✓ Lightning: a@w.test stellt Rechnungen aus (1 bis 100000 sats)\n! SOL: Zahlkanal aus (ZAHLKANAL=1 setzen) – Kunden zahlen dann nur mit Lightning");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const start = main.indexOf("await kanalKasseAusUmgebung(process.env");
  assert.ok(start > 0 && main.indexOf("pruefeEinrichtung(process.env", start) > start, "beim Start, mit dem Ergebnis der Kasse");
  assert.match(main, /kanal: \{ kasse: kanalKasse, grund: kanalGrund, auszahlung, auszahlungGrund \}/);
  assert.match(main, /void kettenBlick\(solRpc\)\.catch\(\(\) => undefined\)/, "ohne Kette trotzdem Lightning prüfen");
  await assert.rejects(kettenBlick(""), "leerer Endpunkt");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.pruefen, "node --import tsx src/pruefen.ts");
});

test("Installer: beide Schienen, SOL-Schlüssel nur mit 600, Prüfung am Ende, keine veralteten Versprechen", () => {
  const pfad = new URL("../../../scripts/install-freedom.sh", import.meta.url);
  execFileSync("bash", ["-n", pfad.pathname]);
  const sh = readFileSync(pfad, "utf8");
  for (const v of ["ZAHLKANAL", "NODE_SOL_ADDRESS", "SOLANA_KEYPAIR", "NODE_SOL_PAYOUT", "SOLANA_RPC_URL"]) {
    assert.match(sh, new RegExp(`^${v}=`, "m"), `${v} in der Umgebungsdatei`);
  }
  assert.match(sh, /chmod 600 "\$SOL_KEY_FILE"/);
  assert.match(sh, /npm run -s pruefen/);
  assert.doesNotMatch(sh, /Knappheitsbonus|DEIN-USER/);
});
