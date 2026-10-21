/**
 * Die Kasse (A-12a1) gegen das echte Squads v4 – das unveränderliche Programm von Mainnet und das von
 * Devnet, je in einem eigenen lokalen Validator. Gebaut wird mit `packages/protocol/src/kasse.ts`,
 * gesendet über kit wie in der App.
 *
 * Beweist für beide Programme:
 *  - „Mehrheit“: drei Mitglieder mit allen Rechten, Schwelle 2, ohne Verwalter, Miete zurück in den
 *    Tresor; die Art liest `kassenArt()` von der Kette; Einzahlen ist eine Überweisung an den Tresor
 *  - „Gründer entscheidet“: der Gründer mit allen Rechten, die übrigen schlagen nur vor, Schwelle 1,
 *    Zeitschloss 1 h
 *  - die Gebühr geht an das Schatzamt aus den Einstellungen des Programms; ein anderes lehnt Squads ab
 *  - Auszahlen (A-12a2): vorschlagen, abstimmen, ausführen, abschließen – Empfänger und Betrag von der
 *    Kette, ausgeführt erst ab der Schwelle, abgelehnt ab genug Gegenstimmen, die Miete zurück in den
 *    Tresor; bei „Gründer entscheidet“ stimmt und führt nur der Gründer aus, das Zeitschloss hält
 *
 * Die Einstellungen des Programms legt der Test selbst an (eigene Gebühr, eigenes Schatzamt) – das
 * Konto von Mainnet zu kopieren hieße, im Test das Netz zu fragen. Die Programme lädt `pruefen.sh`
 * mit fester Prüfsumme (`SQUADS_SO_MAINNET`, `SQUADS_SO_DEVNET`); fehlen sie, werden die Tests mit
 * Grund übersprungen, nie still grün – in `pruefen.sh` (und damit der CI) ist Überspringen ein Fehler.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  abschliessenAnweisung, abstimmenAnweisung, auszahlungVorschlagenAnweisungen, ausfuehrenAnweisung, kasseAnlegenAnweisung, kassenAdresse,
  kassenArt, kassenTransaktionAdresse, kassenTresor, kassenVorschlagAdresse, leseAuszahlungVonKette, leseKasse,
  leseProgrammEinstellungenVonKette, leseVorschlagVonKette, programmEinstellungenAdresse, SQUADS_PROGRAMM_ID, type KassenArt,
} from "../../../packages/protocol/src/kasse.js";
import {
  leseGuthaben, leseKonto, neuesterBlockhash, poolRpc, programmFehlerCode, sendeTransaktion, warteAufBestaetigung, txFehlerText, type SolRpc,
} from "../../../packages/protocol/src/kit-rpc.js";
import { alsDraht, baueTransaktion, signiereMit, solSchluesselAus } from "../../../packages/protocol/src/kit-transaktion.js";
import { ueberweisungAnweisung, type Instruction } from "../../../packages/protocol/src/kit-bruecke.js";
import { RpcPool } from "../../../packages/protocol/src/rpc-pool.js";

const PROGRAMME = { mainnet: process.env.SQUADS_SO_MAINNET ?? "", devnet: process.env.SQUADS_SO_DEVNET ?? "" };
const hatValidator = spawnSync("solana-test-validator", ["--version"]).status === 0;
const fehlt = Object.entries(PROGRAMME).filter(([, so]) => !so || !existsSync(so)).map(([netz]) => netz);
const skip = !hatValidator ? "solana-test-validator fehlt (pruefen.sh)" : fehlt.length ? `Squads-Programm fehlt: ${fehlt.join(", ")} (pruefen.sh)` : false;
if (skip && process.env.SQUADS_TESTS_PFLICHT === "1") throw new Error(`Squads-Tests nicht ausführbar: ${skip}`);

const GEBUEHR = 1_000_000n;
const SCHATZAMT = Keypair.generate().publicKey.toBase58();
// Squads: 6004 Unauthorized, 6008 InvalidProposalStatus, 6014 InvalidAccount, 6021 TimeLockNotReleased, 6033 InvalidRentCollector
const F = { NichtBerechtigt: 6004, FalscherStatus: 6008, FalschesKonto: 6014, Zeitschloss: 6021, FalscheMiete: 6033 } as const;

async function scheitert(p: Promise<unknown>, code: number): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(programmFehlerCode(e), code, `erwartet ${code}: ${String((e as Error).message).slice(0, 300)}`);
    return true;
  });
}

/** Die Einstellungen des Programms als Konto für `--account` – Form nach der IDL (ProgramConfig). */
function einstellungenKonto(datei: string): void {
  const daten = Buffer.concat([
    createHash("sha256").update("account:ProgramConfig").digest().subarray(0, 8),
    Keypair.generate().publicKey.toBuffer(), // Autorität – im Test niemand
    Buffer.from(new BigUint64Array([GEBUEHR]).buffer),
    new PublicKey(SCHATZAMT).toBuffer(),
    Buffer.alloc(64),
  ]);
  writeFileSync(datei, JSON.stringify({
    pubkey: programmEinstellungenAdresse(),
    account: { lamports: 2_000_000, data: [daten.toString("base64"), "base64"], owner: SQUADS_PROGRAMM_ID, executable: false, rentEpoch: 0, space: daten.length },
  }));
}

/** Ein Validator mit diesem Squads-Programm – Ports je Netz getrennt, damit beide nacheinander sauber starten. */
function mitValidator(netz: keyof typeof PROGRAMME, port: number) {
  let validator: ChildProcess | undefined;
  let ordner = "";
  let ledger = "";
  let beendet = false;
  let weg: Promise<never> = new Promise(() => {});
  const url = `http://127.0.0.1:${port}`;
  const rpc: SolRpc = poolRpc(new RpcPool([{ url }]));
  const log = () => {
    try { return readFileSync(join(ledger, "validator.log"), "utf8").trimEnd().split("\n").slice(-15).join("\n"); } catch { return "(kein validator.log)"; }
  };
  const solange = <T>(p: Promise<T>): Promise<T> => Promise.race([p, weg]);

  before(async () => {
    if (skip) return;
    ordner = mkdtempSync(join(tmpdir(), `squads-${netz}-`));
    ledger = join(ordner, "ledger");
    // Neben den Ledger, nicht hinein: `--reset` leert ihn vor dem Start
    const konto = join(ordner, "programm-einstellungen.json");
    einstellungenKonto(konto);
    validator = spawn("solana-test-validator", [
      "--reset", "--quiet", "--ledger", ledger, "--rpc-port", String(port), "--faucet-port", String(port + 2),
      "--dynamic-port-range", `${port + 3}-${port + 40}`, "--bpf-program", SQUADS_PROGRAMM_ID, PROGRAMME[netz],
      "--account", programmEinstellungenAdresse(), konto,
    ], { stdio: "ignore" });
    weg = new Promise<never>((_, nein) => validator!.on("exit", (code, signal) => {
      if (!beendet) nein(new Error(`Validator (${netz}) vorzeitig beendet (Code ${code}, Signal ${signal}):\n${log()}`));
    }));
    weg.catch(() => {});
    for (let i = 0; i < 120; i++) {
      try { await rpc.getVersion().send(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
  });
  after(() => {
    beendet = true;
    validator?.kill("SIGKILL");
    if (ordner) rmSync(ordner, { recursive: true, force: true });
  });

  /** Ein Konto mit Guthaben – Airdrop über web3.js (nur HTTP, kein Websocket), bestätigt über kit. */
  async function neuesKonto(sol = 2) {
    const k = Keypair.generate();
    const signatur = await solange(new Connection(url, "confirmed").requestAirdrop(k.publicKey, sol * 1e9));
    assert.equal(await solange(warteAufBestaetigung(rpc, signatur, 1n << 62n, { abstandMs: 200 })), null);
    return solSchluesselAus(k.secretKey);
  }

  /** Bauen, mit allen Schlüsseln signieren, senden (Vorabsimulation), bestätigen – wie die App. */
  async function sende(zahler: { geheim: Uint8Array; adresse: string }, anweisungen: Instruction[], weitere: Uint8Array[] = []) {
    const lebensdauer = await solange(neuesterBlockhash(rpc));
    let tx = baueTransaktion({ zahler: zahler.adresse, anweisungen, lebensdauer });
    for (const g of [zahler.geheim, ...weitere]) tx = signiereMit(tx, g) ?? assert.fail("Schlüssel passt nicht");
    const signatur = await solange(sendeTransaktion(rpc, alsDraht(tx)));
    const fehler = await solange(warteAufBestaetigung(rpc, signatur, lebensdauer.letzteHoehe, { abstandMs: 200 }));
    if (fehler) throw new Error(`abgelehnt: ${txFehlerText(fehler)}`);
  }

  async function legeAn(art: KassenArt, gruender: { geheim: Uint8Array; adresse: string }, weitere: string[], zeitschlossSek = 0, schatzamt?: string) {
    const createKey = solSchluesselAus(Keypair.generate().secretKey);
    const einstellungen = await solange(leseProgrammEinstellungenVonKette(rpc));
    assert.ok(einstellungen, "Einstellungen des Programms auf der Kette");
    const ix = kasseAnlegenAnweisung({
      ersteller: gruender.adresse, createKey: createKey.adresse, schatzamt: schatzamt ?? einstellungen.schatzamt, art, gruender: gruender.adresse, weitere, zeitschlossSek,
    });
    await sende(gruender, [ix], [createKey.geheim]);
    return kassenAdresse(createKey.adresse);
  }

  return { rpc, solange, neuesKonto, sende, legeAn };
}

for (const [netz, port] of [["mainnet", 21_000], ["devnet", 21_100]] as const) {
  describe(`A-12a: Kasse gegen Squads v4 (${netz})`, { skip }, () => {
    const v = mitValidator(netz, port);

    test("Mehrheit: alle Rechte, Schwelle 2, ohne Verwalter, Miete in den Tresor; Einzahlen an den Tresor", async () => {
      const gruender = await v.neuesKonto(), b = Keypair.generate().publicKey.toBase58(), c = Keypair.generate().publicKey.toBase58();
      const kasse = await v.legeAn("mehrheit", gruender, [b, c]);
      const stand = await v.solange(leseKasse(v.rpc, kasse));
      assert.ok(stand);
      assert.equal(kassenArt(stand), "mehrheit");
      assert.equal(stand.schwelle, 2);
      assert.equal(stand.verwalter, null);
      assert.equal(stand.zeitschlossSek, 0);
      assert.equal(stand.transaktionsIndex, 0n);
      assert.equal(stand.mieteAn, kassenTresor(kasse));
      assert.deepEqual(stand.mitglieder.map((m) => m.adresse).sort(), [gruender.adresse, b, c].sort());
      assert.ok(stand.mitglieder.every((m) => m.rechte === 7));

      const tresor = kassenTresor(kasse);
      await v.sende(gruender, [ueberweisungAnweisung({ von: gruender.adresse, an: tresor, lamports: 500_000_000n })]);
      assert.equal(await v.solange(leseGuthaben(v.rpc, tresor)), 500_000_000n);
    });

    test("Gründer entscheidet: nur er stimmt ab und führt aus, die übrigen schlagen vor; Zeitschloss 1 h", async () => {
      const gruender = await v.neuesKonto(), b = Keypair.generate().publicKey.toBase58();
      const kasse = await v.legeAn("gruender", gruender, [b], 3600);
      const stand = await v.solange(leseKasse(v.rpc, kasse));
      assert.ok(stand);
      assert.equal(kassenArt(stand), "gruender");
      assert.equal(stand.schwelle, 1);
      assert.equal(stand.zeitschlossSek, 3600);
      assert.deepEqual(new Map(stand.mitglieder.map((m) => [m.adresse, m.rechte])), new Map([[gruender.adresse, 7], [b, 1]]));
    });

    test("Gebühr an das Schatzamt aus den Einstellungen; ein anderes Schatzamt lehnt Squads ab", async () => {
      const gruender = await v.neuesKonto();
      const vorher = await v.solange(leseGuthaben(v.rpc, SCHATZAMT));
      await v.legeAn("gruender", gruender, []);
      assert.equal((await v.solange(leseGuthaben(v.rpc, SCHATZAMT))) - vorher, GEBUEHR);
      await scheitert(v.legeAn("gruender", gruender, [], 0, Keypair.generate().publicKey.toBase58()), F.FalschesKonto);
    });

    // ---- A-12a2: Auszahlen ----
    type Konto = { geheim: Uint8Array; adresse: string };
    const vorschlagen = (kasse: string, wer: Konto, empfaenger: string, lamports: bigint, index = 1n) =>
      v.sende(wer, auszahlungVorschlagenAnweisungen({ kasse, index, vorschlagender: wer.adresse, empfaenger, lamports }));
    const stimme = (kasse: string, wer: Konto, dafuer: boolean, index = 1n) =>
      v.sende(wer, [abstimmenAnweisung({ kasse, index, mitglied: wer.adresse, dafuer })]);
    async function fuehreAus(kasse: string, wer: Konto, index = 1n) {
      const t = await v.solange(leseAuszahlungVonKette(v.rpc, kasse, index));
      assert.ok(t?.auszahlung, "Auszahlung von der Kette");
      await v.sende(wer, [ausfuehrenAnweisung({ kasse, index, mitglied: wer.adresse, auszahlung: t.auszahlung })]);
    }
    const status = async (kasse: string, index = 1n) => (await v.solange(leseVorschlagVonKette(v.rpc, kasse, index)))?.status ?? null;
    async function kasseMitGeld(art: KassenArt, gruender: Konto, weitere: string[], zeitschlossSek = 0) {
      const kasse = await v.legeAn(art, gruender, weitere, zeitschlossSek);
      await v.sende(gruender, [ueberweisungAnweisung({ von: gruender.adresse, an: kassenTresor(kasse), lamports: 1_000_000_000n })]);
      return kasse;
    }

    test("A-12a2 Mehrheit: vorschlagen, ausführen erst ab zwei Stimmen, abschließen gibt die Miete in den Tresor", async () => {
      const a = await v.neuesKonto(), b = await v.neuesKonto(1), c = await v.neuesKonto(1);
      const kasse = await kasseMitGeld("mehrheit", a, [b.adresse, c.adresse]);
      const tresor = kassenTresor(kasse), x = Keypair.generate().publicKey.toBase58();
      await vorschlagen(kasse, a, x, 300_000_000n);
      const t = await v.solange(leseAuszahlungVonKette(v.rpc, kasse, 1n));
      assert.deepEqual(t, { kasse, ersteller: a.adresse, index: 1n, auszahlung: { empfaenger: x, lamports: 300_000_000n } });
      assert.equal((await v.solange(leseKasse(v.rpc, kasse)))?.transaktionsIndex, 1n);
      assert.equal(await status(kasse), "aktiv");

      await stimme(kasse, a, true);
      await scheitert(fuehreAus(kasse, b), F.FalscherStatus);
      await stimme(kasse, b, true);
      const v1 = await v.solange(leseVorschlagVonKette(v.rpc, kasse, 1n));
      assert.equal(v1?.status, "angenommen");
      assert.deepEqual([...v1!.dafuer].sort(), [a.adresse, b.adresse].sort());

      const vorher = await v.solange(leseGuthaben(v.rpc, tresor));
      await fuehreAus(kasse, c);
      assert.equal(await v.solange(leseGuthaben(v.rpc, x)), 300_000_000n);
      assert.equal(vorher - (await v.solange(leseGuthaben(v.rpc, tresor))), 300_000_000n, "nur der Betrag verlässt den Tresor");
      assert.equal(await status(kasse), "ausgefuehrt");

      const miete = (await v.solange(leseKonto(v.rpc, kassenVorschlagAdresse(kasse, 1n))))!.lamports
        + (await v.solange(leseKonto(v.rpc, kassenTransaktionAdresse(kasse, 1n))))!.lamports;
      await scheitert(v.sende(c, [abschliessenAnweisung({ kasse, index: 1n, mieteAn: c.adresse })]), F.FalscheMiete);
      const davor = await v.solange(leseGuthaben(v.rpc, tresor));
      await v.sende(c, [abschliessenAnweisung({ kasse, index: 1n, mieteAn: tresor })]);
      assert.equal((await v.solange(leseGuthaben(v.rpc, tresor))) - davor, miete, "die Miete beider Konten zurück in den Tresor");
      assert.equal(await status(kasse), null);
      assert.equal(await v.solange(leseAuszahlungVonKette(v.rpc, kasse, 1n)), null);
    });

    test("A-12a2 Mehrheit: zwei Gegenstimmen lehnen ab – nicht ausführbar, abschließbar", async () => {
      const a = await v.neuesKonto(), b = await v.neuesKonto(1), c = await v.neuesKonto(1);
      const kasse = await kasseMitGeld("mehrheit", a, [b.adresse, c.adresse]);
      await vorschlagen(kasse, a, Keypair.generate().publicKey.toBase58(), 100_000_000n);
      await stimme(kasse, b, false);
      assert.equal(await status(kasse), "aktiv");
      await stimme(kasse, c, false);
      assert.equal(await status(kasse), "abgelehnt");
      await scheitert(fuehreAus(kasse, a), F.FalscherStatus);
      await v.sende(a, [abschliessenAnweisung({ kasse, index: 1n, mieteAn: kassenTresor(kasse) })]);
      assert.equal(await status(kasse), null);
    });

    test("A-12a2 Gründer entscheidet: nur der Gründer stimmt ab und führt aus; das Zeitschloss hält die Ausführung", async () => {
      // zwei Kassen mit je 1 SOL, dazu Gebühr und Miete
      const g = await v.neuesKonto(3), b = await v.neuesKonto(1), x = Keypair.generate().publicKey.toBase58();
      const kasse = await kasseMitGeld("gruender", g, [b.adresse]);
      await vorschlagen(kasse, b, x, 200_000_000n);
      await scheitert(stimme(kasse, b, true), F.NichtBerechtigt);
      await stimme(kasse, g, true);
      assert.equal(await status(kasse), "angenommen");
      await scheitert(fuehreAus(kasse, b), F.NichtBerechtigt);
      await fuehreAus(kasse, g);
      assert.equal(await v.solange(leseGuthaben(v.rpc, x)), 200_000_000n);

      const mitSchloss = await kasseMitGeld("gruender", g, [], 3600);
      await vorschlagen(mitSchloss, g, x, 100_000_000n);
      await stimme(mitSchloss, g, true);
      assert.equal(await status(mitSchloss), "angenommen");
      await scheitert(fuehreAus(mitSchloss, g), F.Zeitschloss);
      assert.equal(await v.solange(leseGuthaben(v.rpc, x)), 200_000_000n, "vor Ablauf des Zeitschlosses geht nichts hinaus");
    });
  });
}
