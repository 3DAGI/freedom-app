/**
 * Schritt 4.5a: Auszahlung an die eigene Adresse. Geprüft wird, dass nur über
 * der Schwelle und höchstens einmal je Abstand ausgezahlt wird, die Rücklage
 * immer bleibt, nie an ein Programm oder an sich selbst gezahlt wird und nach
 * außen nur der Fehlername geht. Neben LP oder Relayer (derselbe Schlüssel)
 * bleibt sie aus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { AUSZAHLUNG_SCHWELLE, RUECKLAGE, SolAuszahlung } from "../src/sol-auszahlung.js";
import { kanalKasseAusUmgebung } from "../src/kanal-kasse.js";

const von = Keypair.generate().publicKey.toBase58();
const an = Keypair.generate().publicKey.toBase58();

function aufbau(p: { guthaben?: bigint; programm?: boolean; fehler?: Error } = {}) {
  const gesendet: TransactionInstruction[][] = [];
  const uhr = { jetzt: 1_900_000_000 };
  const konto = { guthaben: p.guthaben ?? 0n };
  const a = new SolAuszahlung({
    von, an,
    guthaben: async () => konto.guthaben,
    istProgramm: async () => p.programm === true,
    sende: async (ixs) => { if (p.fehler) throw p.fehler; gesendet.push(ixs); konto.guthaben = RUECKLAGE; return `sig${gesendet.length}`; },
    ueberweisung: (v, z, l) => SystemProgram.transfer({ fromPubkey: new PublicKey(v), toPubkey: new PublicKey(z), lamports: l }),
    jetzt: () => uhr.jetzt,
  });
  return { a, gesendet, uhr, konto };
}

test("unter der Schwelle: nichts; darüber: alles über der Rücklage an die eigene Adresse", async () => {
  const k = aufbau({ guthaben: RUECKLAGE + AUSZAHLUNG_SCHWELLE - 1n });
  assert.equal(await k.a.pruefe(), undefined);
  assert.equal(k.gesendet.length, 0);
  k.konto.guthaben = RUECKLAGE + 250_000_000n;
  assert.deepEqual(await k.a.pruefe(), { betrag: 250_000_000n, signatur: "sig1" });
  const [ix] = k.gesendet[0]!;
  assert.equal(ix!.programId.toBase58(), SystemProgram.programId.toBase58());
  assert.deepEqual(ix!.keys.map((x) => x.pubkey.toBase58()), [von, an]);
  assert.equal(Buffer.from(ix!.data).readBigUInt64LE(4), 250_000_000n, "Rücklage bleibt");
});

test("höchstens einmal je Abstand – auch nach einem Fehlversuch", async () => {
  const k = aufbau({ guthaben: RUECKLAGE + 500_000_000n });
  assert.ok(await k.a.pruefe());
  k.konto.guthaben = RUECKLAGE + 500_000_000n;
  k.uhr.jetzt += 3_600;
  assert.equal(await k.a.pruefe(), undefined, "eine Stunde später: noch nicht");
  k.uhr.jetzt += 86_400;
  assert.deepEqual(await k.a.pruefe(), { betrag: 500_000_000n, signatur: "sig2" });
  const f = aufbau({ guthaben: RUECKLAGE + 500_000_000n, fehler: Object.assign(new Error("RPC: Konto 10.0.0.7 gesperrt"), { name: "SendTransactionError" }) });
  assert.deepEqual(await f.a.pruefe(), { betrag: 500_000_000n, fehler: "SendTransactionError" }, "nur der Fehlername");
  assert.equal(await f.a.pruefe(), undefined, "kein sofortiger zweiter Versuch");
});

test("nie an ein Programm, nie an sich selbst, nie unter der Mietbefreiung", async () => {
  const p = aufbau({ guthaben: RUECKLAGE + 500_000_000n, programm: true });
  assert.deepEqual(await p.a.pruefe(), { betrag: 500_000_000n, fehler: "Auszahlungsadresse ist ein Programm" });
  assert.equal(p.gesendet.length, 0);
  const basis = { guthaben: async () => 0n, istProgramm: async () => false, sende: async () => "", ueberweisung: () => ({}) as TransactionInstruction };
  assert.throws(() => new SolAuszahlung({ ...basis, von, an: von }), /Adresse des Knotens/);
  assert.throws(() => new SolAuszahlung({ ...basis, von, an, ruecklage: 890_880n }), /Mietbefreiung/);
  assert.throws(() => new SolAuszahlung({ ...basis, von, an, schwelle: 1n }), /Schwelle/);
});

test("Einrichtung: nur mit NODE_SOL_PAYOUT und gültiger Adresse, nicht neben LP oder Relayer; die Kasse läuft auch ohne; verdrahtet in main.ts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "auszahlung-"));
  try {
    const schluessel = Keypair.generate();
    const pfad = join(dir, "id.json");
    writeFileSync(pfad, JSON.stringify([...schluessel.secretKey]));
    const o = { rpcUrl: "http://127.0.0.1:1", datei: join(dir, "kanaele.json"), standardSchluessel: pfad };
    const env = { ZAHLKANAL: "1", NODE_SOL_ADDRESS: schluessel.publicKey.toBase58() };
    const ohne = await kanalKasseAusUmgebung(env, o);
    assert.ok(ohne.kasse);
    assert.equal(ohne.auszahlung, undefined);
    assert.match(ohne.auszahlungGrund!, /NODE_SOL_PAYOUT setzen/);
    const kaputt = await kanalKasseAusUmgebung({ ...env, NODE_SOL_PAYOUT: "keine-adresse" }, o);
    assert.ok(kaputt.kasse, "die Kasse läuft trotzdem");
    assert.match(kaputt.auszahlungGrund!, /ungültig/);
    const selbst = await kanalKasseAusUmgebung({ ...env, NODE_SOL_PAYOUT: env.NODE_SOL_ADDRESS }, o);
    assert.match(selbst.auszahlungGrund!, /Adresse des Knotens/);
    for (const lp of [{ LP_ENABLED: "1" }, { RELAYER_ENABLED: "1" }]) {
      const geteilt = await kanalKasseAusUmgebung({ ...env, NODE_SOL_PAYOUT: an, ...lp }, o);
      assert.ok(geteilt.kasse);
      assert.equal(geteilt.auszahlung, undefined, "Liquidität von LP und Relayer bleibt");
      assert.match(geteilt.auszahlungGrund!, /denselben Schlüssel/);
    }
    assert.ok((await kanalKasseAusUmgebung({ ...env, NODE_SOL_PAYOUT: an, LP_ENABLED: "1", LP_SOL_MOCK: "1" }, o)).auszahlung, "LP mit Mock nutzt den Schlüssel nicht");
    const gut = await kanalKasseAusUmgebung({ ...env, NODE_SOL_PAYOUT: an, KANAL_AUSZAHLUNG_SCHWELLE_LAMPORTS: "50000000" }, o);
    assert.ok(gut.auszahlung instanceof SolAuszahlung);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const \{ kasse: kanalKasse, grund: kanalGrund, fall: kanalFall, auszahlung, auszahlungGrund \} = await kanalKasseAusUmgebung\(process\.env, \{/);
  const takt = main.slice(main.indexOf("const einloesen = async () => {"), main.indexOf("void einloesen();"));
  assert.ok(takt.indexOf("kanalKasse.loeseFaelligeEin()") < takt.indexOf("await auszahlung?.pruefe()"), "erst einlösen, dann auszahlen");
});
