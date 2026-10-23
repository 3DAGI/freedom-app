/**
 * B-38b2: Text aus Sprache beim eigenen Knoten – Ton nur aus dem Blob-Netz und nur als WAV aus `baueWav()`, Whisper je
 * Auftrag in der Sandbox (hier ein nachgebautes `whisper-cli` in echtem bubblewrap), Antwort nur versiegelt an den Besitzer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_DVM_TEXT_AUS_SPRACHE, LocalSigner, MemoryRelay, OutboxPool, SPRACHE_GRENZEN, baueSpracheAuftrag, baueStatusAuftrag,
  baueWav, buildBlob, generateKeypair, leseKnotenStatus, leseTranskript, neueKopplung, openPrivateJobResponse, pruefeWav, verschluesseleDatei,
  type DateiSchluessel, type SpracheWahl,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { pruefeSandbox } from "../src/sandbox.js";
import { SpracheAbgelehnt, Whisper, whisperAusUmgebung, type WhisperDienst } from "../src/whisper.js";

const sinus = (sekunden: number) => baueWav(Int16Array.from({ length: sekunden * SPRACHE_GRENZEN.abtastrate }, (_, i) => Math.round(9000 * Math.sin(i / 7))));

test("B-38b2: Umgebung – ohne Modell aus, nie halb, Vorgaben für Threads und Frist", () => {
  const ordner = mkdtempSync(join(tmpdir(), "freedom-whisper-env-"));
  try {
    const modell = join(ordner, "ggml-base.bin");
    const cli = join(ordner, "whisper-cli");
    writeFileSync(modell, "m");
    writeFileSync(cli, "#!/bin/sh\n");
    assert.deepEqual(whisperAusUmgebung({}), { grund: "aus (WHISPER_MODELL setzen)" });
    assert.deepEqual(whisperAusUmgebung({ WHISPER_MODELL: modell, WHISPER_CLI: cli }).dienst, { cli, modell, gpu: false, threads: 4, fristSek: 600 });
    assert.equal(whisperAusUmgebung({ WHISPER_MODELL: modell, WHISPER_CLI: cli, WHISPER_GPU: "1", WHISPER_THREADS: "8" }).dienst?.gpu, true);
    for (const [env, grund] of [
      [{ WHISPER_MODELL: "ggml-base.bin", WHISPER_CLI: cli }, /WHISPER_MODELL ungültig/],
      [{ WHISPER_MODELL: join(ordner, "fehlt.bin"), WHISPER_CLI: cli }, /WHISPER_MODELL ungültig/],
      [{ WHISPER_MODELL: cli, WHISPER_CLI: cli }, /WHISPER_MODELL ungültig/],
      [{ WHISPER_MODELL: ordner + "/", WHISPER_CLI: cli }, /WHISPER_MODELL ungültig/],
      [{ WHISPER_MODELL: modell, WHISPER_CLI: join(ordner, "fehlt") }, /whisper-cli fehlt/],
      [{ WHISPER_MODELL: modell, WHISPER_CLI: "whisper-cli" }, /whisper-cli fehlt/],
      [{ WHISPER_MODELL: modell, WHISPER_CLI: cli, WHISPER_GPU: "ja" }, /WHISPER_GPU ungültig/],
      [{ WHISPER_MODELL: modell, WHISPER_CLI: cli, WHISPER_THREADS: "0" }, /WHISPER_THREADS ungültig/],
      [{ WHISPER_MODELL: modell, WHISPER_CLI: cli, WHISPER_FRIST_SEK: "5" }, /WHISPER_FRIST_SEK ungültig/],
    ] as const) {
      const r = whisperAusUmgebung(env);
      assert.equal(r.dienst, undefined, JSON.stringify(env));
      assert.match(r.grund!, grund);
    }
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

/** Ein `whisper-cli` zum Prüfen: liest den Ton, prüft die Argumente und schreibt `<of>.txt` – je nach Art anders. */
function attrappe(ordner: string, art: "gut" | "fehler" | "schlaeft" | "verweis" | "riesig"): string {
  const cli = join(ordner, `whisper-cli-${art}`);
  const pruefung = [
    `[ "$*" = "-m /modell/whisper.bin -f /arbeit/ton.wav -l de -t 2 -nt -np -otxt -of /arbeit/text -ng" ] || exit 7`,
    // Ton und Modell lesbar, das Modell nicht schreibbar, außer /arbeit nichts
    `[ -s /arbeit/ton.wav ] && [ -r /modell/whisper.bin ] || exit 8`,
    `if echo x > /modell/whisper.bin 2>/dev/null || touch /etc/x 2>/dev/null || [ -e /home/agent/.freedom ]; then exit 9; fi`,
  ];
  const aus = {
    gut: `printf ' Hallo Welt.\\r\\n\\033[31m rot \\n\\n  Zweite Zeile  \\n' > /arbeit/text.txt`,
    fehler: "exit 3",
    schlaeft: "sleep 30",
    verweis: "ln -s /etc/passwd /arbeit/text.txt",
    riesig: "head -c 70000 /dev/zero | tr '\\0' 'a' > /arbeit/text.txt",
  }[art];
  writeFileSync(cli, ["#!/bin/sh", ...pruefung, aus, ""].join("\n"));
  chmodSync(cli, 0o755);
  return cli;
}

test("B-38b2: whisper-cli in der Sandbox – eine Datei hinein, Text heraus, Steuerzeichen weg, der Ordner danach leer", async (t) => {
  if (!(await pruefeSandbox()).ok) return t.skip("bubblewrap geht hier nicht");
  const ordner = mkdtempSync(join(tmpdir(), "freedom-whisper-"));
  const basis = mkdtempSync(join(tmpdir(), "freedom-whisper-arbeit-"));
  try {
    const modell = join(ordner, "ggml.bin");
    writeFileSync(modell, "modell");
    const dienst = (art: Parameters<typeof attrappe>[1], frist = 20): WhisperDienst => ({ cli: attrappe(ordner, art), modell, gpu: false, threads: 2, fristSek: frist });
    assert.equal(await new Whisper(dienst("gut"), basis).transkribiere(sinus(1), "de"), "Hallo Welt.\nrot\nZweite Zeile");
    assert.deepEqual(readdirSync(basis), [], "Ton und Text sind weg");
    assert.equal(readFileSync(modell, "utf8"), "modell", "das Modell bleibt unverändert");
    for (const [art, fall, frist] of [["fehler", "sprache-whisper", 20], ["verweis", "sprache-whisper", 20], ["riesig", "sprache-whisper", 20], ["schlaeft", "sprache-zeit", 1]] as const) {
      await assert.rejects(new Whisper(dienst(art, frist), basis).transkribiere(sinus(1), "de"), (e: unknown) => e instanceof SpracheAbgelehnt && e.fall === fall, art);
      assert.deepEqual(readdirSync(basis), [], `${art}: der Ordner ist weg`);
    }
    // Andere Argumente (Sprache „en“) prüft die Attrappe streng – so sieht man, was wirklich übergeben wird
    await assert.rejects(new Whisper(dienst("gut"), basis).transkribiere(sinus(1), "en" as SpracheWahl), /sprache-whisper/);
    // Ein Auftrag zur Zeit
    const w = new Whisper(dienst("schlaeft", 2), basis);
    const erster = w.transkribiere(sinus(1), "de").catch((e: SpracheAbgelehnt) => e.fall);
    await assert.rejects(w.transkribiere(sinus(1), "de"), (e: unknown) => e instanceof SpracheAbgelehnt && e.fall === "sprache-belegt");
    assert.equal(await erster, "sprache-zeit");
  } finally {
    rmSync(ordner, { recursive: true, force: true });
    rmSync(basis, { recursive: true, force: true });
  }
});

test("B-38b3b3: ohne WHISPER_MODELL das geprüfte Modell – je Auftrag gefragt; ohne Modell kein Lauf und keine Rolle", async (t) => {
  const ordner = mkdtempSync(join(tmpdir(), "freedom-whisper-geprueft-"));
  const basis = mkdtempSync(join(tmpdir(), "freedom-whisper-arbeit-"));
  try {
    const leer = join(ordner, "whisper-cli-leer");
    writeFileSync(leer, "#!/bin/sh\n");
    let geprueft: string | null = null;
    const r = whisperAusUmgebung({ WHISPER_CLI: leer, WHISPER_THREADS: "2", WHISPER_FRIST_SEK: "20" }, () => geprueft);
    assert.equal(typeof r.dienst?.modell, "function", "ohne WHISPER_MODELL: je Auftrag gefragt");
    assert.match(whisperAusUmgebung({ WHISPER_CLI: join(ordner, "fehlt") }, () => null).grund!, /^aus – whisper-cli fehlt/);
    const fest = join(ordner, "ggml-fest.bin");
    writeFileSync(fest, "m");
    assert.equal(whisperAusUmgebung({ WHISPER_MODELL: fest, WHISPER_CLI: leer }, () => "/anders.bin").dienst?.modell, fest, "WHISPER_MODELL geht vor");
    // Ohne geprüftes Modell: nicht bereit, abgelehnt, bevor die Sandbox überhaupt startet
    const marke = join(ordner, "bwrap-lief");
    const bwrap = join(ordner, "bwrap");
    writeFileSync(bwrap, `#!/bin/sh\ntouch ${marke}\nexit 1\n`);
    chmodSync(bwrap, 0o755);
    const ohne = new Whisper({ ...r.dienst!, bwrap }, basis);
    assert.equal(ohne.bereit(), false);
    await assert.rejects(ohne.transkribiere(sinus(1), "de"), (e: unknown) => e instanceof SpracheAbgelehnt && e.fall === "sprache-whisper");
    assert.equal(existsSync(marke), false, "kein Lauf ohne Modell");
    assert.deepEqual(readdirSync(basis), []);
    // Mit geprüftem Modell: dasselbe Objekt nimmt es beim nächsten Auftrag
    const modell = join(ordner, "ggml-geprueft.bin");
    writeFileSync(modell, "modell");
    geprueft = modell;
    assert.equal(ohne.bereit(), true);
    if (!(await pruefeSandbox()).ok) return t.skip("bubblewrap geht hier nicht");
    const w = new Whisper({ ...r.dienst!, cli: attrappe(ordner, "gut") }, basis);
    assert.equal(await w.transkribiere(sinus(1), "de"), "Hallo Welt.\nrot\nZweite Zeile");
    geprueft = null; // die Datei änderte sich – `gepruefterWhisper()` nennt keins mehr
    await assert.rejects(w.transkribiere(sinus(1), "de"), (e: unknown) => e instanceof SpracheAbgelehnt && e.fall === "sprache-whisper");
  } finally {
    rmSync(ordner, { recursive: true, force: true });
    rmSync(basis, { recursive: true, force: true });
  }
});

async function aufbau(sprache?: ConstructorParameters<typeof DvmProvider>[0]["sprache"]) {
  const relay = new MemoryRelay(`mem://sprache-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], ...(sprache ? { sprache } : {}),
    status: () => ({ fassung: "0.1.0", seit: 1, rollen: ["ki", "sprache"], modelle: [], relay: null }),
  }, pool);
  return { relay, pool, kp, k, provider };
}

/** Den Ton wie die App ablegen: verschlüsselt, Stücke und Manifest signiert im Blob-Netz. */
async function lege(pool: OutboxPool, klartext: Uint8Array): Promise<{ blob: string; manifest: string; schluessel: DateiSchluessel }> {
  const ich = new LocalSigner(generateKeypair().sk);
  const { chiffrat, schluessel } = verschluesseleDatei(klartext);
  const { manifestEvent, chunkEvents, manifest } = await buildBlob({ name: "", mime: "application/octet-stream", bytes: chiffrat }, ich.publicKey(), { verschluesselt: true });
  for (const ev of chunkEvents) await pool.publish(await ich.signEvent(ev));
  const m = await ich.signEvent(manifestEvent);
  await pool.publish(m);
  return { blob: manifest.blobId, manifest: m.id, schluessel };
}

const antworten = async (relay: MemoryRelay, s: LocalSigner) =>
  (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s)))).flatMap((a) => (a.ok ? [a.response] : []));

test("B-38b2: der Besitzer bekommt den Text – Ton aus dem Blob-Netz, geprüft, versiegelt zurück, nichts im Log", async () => {
  const gesehen: Array<{ sekunden: number; sprache: SpracheWahl }> = [];
  const { relay, pool, k, provider } = await aufbau({
    transkribiere: async (wav, sprache) => {
      const p = pruefeWav(wav);
      assert.ok(p.ok);
      gesehen.push({ sekunden: p.sekunden, sprache });
      return "Geheimer Inhalt der Sprachnachricht";
    },
  });
  const ton = await lege(pool, sinus(2));
  const s = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueSpracheAuftrag({ sitzung: s, kopplung: k, auftrag: { ton, sprache: "de" } })).wrap);
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
  assert.equal(jobs[0]!.outputPreview, "Text aus Sprache (2 s Ton)");
  assert.deepEqual(gesehen, [{ sekunden: 2, sprache: "de" }]);
  const a = (await antworten(relay, s)).find((r) => r.kind === KIND_DVM_TEXT_AUS_SPRACHE + 1000);
  assert.deepEqual(leseTranskript(a!.content), { text: "Geheimer Inhalt der Sprachnachricht", sekunden: 2 });
  assert.equal((await relay.query({ kinds: [KIND_DVM_TEXT_AUS_SPRACHE + 1000] })).length, 0, "nie offen");
  const alles = log.join("\n");
  assert.ok(!alles.includes("Geheimer Inhalt") && !alles.includes(ton.schluessel.key), "weder Text noch Schlüssel im Log");
  // Status: Rolle „sprache“; der Auftrag zählt (gratis, wie jeder des Besitzers)
  const st = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueStatusAuftrag({ sitzung: st, kopplung: k })).wrap);
  await provider.pollOnce();
  const status = leseKnotenStatus((await antworten(relay, st)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000)!.content)!;
  assert.deepEqual(status.rollen, ["ki", "sprache"]);
  assert.deepEqual(status.auftraege, { erledigt: 1, gratis: 1, abgelehnt: 0 });
});

test("B-38b2: abgelehnt nur mit Kennung – Ton fehlt oder falsch, keine WAV, fremd, ohne Whisper", async () => {
  let gerufen = 0;
  const { relay, pool, kp, k, provider } = await aufbau({ transkribiere: async () => { gerufen++; return "x"; } });
  const gut = await lege(pool, sinus(1));
  const keineWav = await lege(pool, new TextEncoder().encode("RIFF – aber kein Ton"));
  const anderer = await lege(pool, sinus(1));
  const faelle: Array<[string, Parameters<typeof baueSpracheAuftrag>[0]["auftrag"]["ton"], string]> = [
    ["falscher Schlüssel", { ...gut, schluessel: anderer.schluessel }, "sprache-ton"],
    ["Manifest eines anderen Blobs", { ...gut, manifest: anderer.manifest }, "sprache-ton"],
    ["Blob gibt es nicht", { ...gut, blob: "ee".repeat(32) }, "sprache-ton"],
    ["keine WAV", keineWav, "sprache-wav"],
  ];
  const sitzungen = new Map<string, LocalSigner>();
  for (const [name, ton] of faelle) {
    const s = new LocalSigner(generateKeypair().sk);
    sitzungen.set(name, s);
    await pool.publish((await baueSpracheAuftrag({ sitzung: s, kopplung: k, auftrag: { ton, sprache: "auto" } })).wrap);
  }
  const fremd = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueSpracheAuftrag({ sitzung: fremd, kopplung: neueKopplung(kp.pk), auftrag: { ton: gut, sprache: "de" } })).wrap);
  assert.equal((await provider.pollOnce()).length, 0);
  assert.equal(gerufen, 0, "Whisper läuft nur mit geprüftem Ton");
  for (const [name, , fall] of faelle) {
    const r = await antworten(relay, sitzungen.get(name)!);
    assert.ok(!r.some((x) => x.kind === KIND_DVM_TEXT_AUS_SPRACHE + 1000), name);
    assert.ok(r.some((x) => x.kind === 7000 && x.tags.some((t) => t[0] === "fall" && t[1] === fall)), `${name}: ${fall}`);
  }
  assert.ok((await antworten(relay, fremd)).some((x) => x.kind === 7000 && x.content.includes("nur für den Besitzer")));
  const ohne = await aufbau();
  const s = new LocalSigner(generateKeypair().sk);
  await ohne.pool.publish((await baueSpracheAuftrag({ sitzung: s, kopplung: ohne.k, auftrag: { ton: await lege(ohne.pool, sinus(1)), sprache: "de" } })).wrap);
  await ohne.provider.pollOnce();
  assert.ok((await antworten(ohne.relay, s)).some((x) => x.kind === 7000 && x.content.includes("kein Text aus Sprache")));
});

test("B-38b2: verdrahtet – main.ts nur mit Modell und Sandbox, Rolle „sprache“, Repo-Bundles über denselben Abruf", () => {
  const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const main = lies("main.ts");
  assert.match(main, /const \{ dienst: whisperDienst, grund: whisperGrund \} = whisperAusUmgebung\(process\.env, \(\) => gepruefterWhisper\(leseStand\(modellDatei\(\)\)\)\);/);
  assert.match(main, /rollen: \[\.\.\.statusRollen\]\.filter\(\(r\) => r !== "sprache" \|\| !!sprache\?\.bereit\(\)\)/, "B-38b3b3: die Rolle nur mit Modell");
  assert.match(main, /const sb = await pruefeSandbox\(\);\n\s+if \(sb\.ok\) sprache = new Whisper\(whisperDienst\);/);
  assert.match(main, /if \(sprache\) statusRollen\.add\("sprache"\);/);
  assert.match(main, /\.\.\.\(sprache \? \{ sprache \} : \{\}\),/);
  assert.match(lies("repo-bundle.ts"), /await holeVerschluesselt\(pool, \{ blob: ref\.blobId, schluessel: ref\.schluessel, hoechstBytes: BUNDLE_GRENZEN\.bytes \}\)/);
  const w = lies("whisper.ts");
  assert.doesNotMatch(w, /console\.|spawn\(|execFile/, "nichts ins Log, kein Programm an der Sandbox vorbei");
  assert.match(w, /await fuehreAus\(befehl, \{/);
});
