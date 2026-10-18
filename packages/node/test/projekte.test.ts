/**
 * Vibecoden auf dem eigenen Knoten (A-31, VKc1): Projekte nur unter
 * `~/.freedom/projekte`, git je Projekt, nur für den Besitzer aus einem
 * Umschlag; eine Konfiguration im Projekt führt nie ein Programm aus, und ins
 * Log kommen keine Projektnamen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODE_GRENZEN, KIND_DVM_KNOTEN_CODE, KIND_DVM_KNOTEN_STATUS, LocalSigner, MemoryRelay, OutboxPool, baueCodeAuftrag, baueStatusAuftrag,
  generateKeypair, getTag, leseCodeAntwort, leseKnotenStatus, neueKopplung, openPrivateJobResponse, type CodeAktion,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { CodeAbgelehnt, ProjektAblage, projekteAusUmgebung } from "../src/projekte.js";

const ordner = () => join(mkdtempSync(join(tmpdir(), "projekte-")), "projekte");
/** git für den Test selbst – mit Namen, ohne die Einstellungen des Rechners. */
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).toString();

test("VKc1: Umgebung – nur VIBECODEN=1 schaltet ein, anderes hält den Start an", () => {
  for (const aus of [undefined, "", "0", " 0 "]) assert.equal(projekteAusUmgebung({ VIBECODEN: aus }, "/x"), null, String(aus));
  assert.equal(projekteAusUmgebung({ VIBECODEN: "1" }, "/x")!.ablage!.ordner, "/x");
  for (const falsch of ["ja", "true", "2"]) assert.match(projekteAusUmgebung({ VIBECODEN: falsch }, "/x")!.grund!, /weder 0 noch 1/);
});

test("VKc1: anlegen und auflisten – Ordner 0700, git mit main ohne Vorlagen, Schritte sind Commits", async () => {
  const o = ordner();
  const a = new ProjektAblage(o);
  assert.deepEqual(await a.liste(), [], "ohne Ordner leer");
  assert.equal(await a.pruefe(), true);
  assert.equal(statSync(o).mode & 0o777, 0o700);
  await a.neu("meine-app");
  const p = join(o, "meine-app");
  assert.equal(statSync(p).mode & 0o777, 0o700);
  assert.equal(readFileSync(join(p, ".git", "HEAD"), "utf8").trim(), "ref: refs/heads/main");
  assert.ok(!existsSync(join(p, ".git", "hooks")), "keine Vorlagen, keine Beispiel-Hooks");
  assert.doesNotMatch(readFileSync(join(p, ".git", "config"), "utf8"), /worktree/, "kein fester Pfad in der Konfiguration");
  let [eins] = await a.liste();
  assert.equal(eins!.name, "meine-app");
  assert.equal(eins!.schritte, 0);
  assert.ok(Math.abs(eins!.geaendert - Date.now() / 1000) < 60, "ohne Commit die Zeit des Ordners");
  writeFileSync(join(p, "index.html"), "<p>hallo</p>");
  git(p, "add", "-A");
  git(p, "commit", "-q", "-m", "eins", "--date=@1790000000");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "zwei"], {
    cwd: p, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_DATE: "@1790000100" },
  });
  [eins] = await a.liste();
  assert.deepEqual(eins, { name: "meine-app", schritte: 2, geaendert: 1_790_000_100 });
  // Nochmals anlegen ändert nichts
  await a.neu("meine-app");
  assert.equal((await a.liste())[0]!.schritte, 2);
  // Ein Ordner ohne git (von Hand hineinkopiert) bekommt eines
  mkdirSync(join(o, "kopie"));
  assert.deepEqual((await a.liste()).find((x) => x.name === "kopie")?.schritte, 0);
  await a.neu("kopie");
  assert.ok(existsSync(join(o, "kopie", ".git", "HEAD")));
  // Zuletzt geändert zuerst
  assert.deepEqual((await a.liste()).map((x) => x.name), ["kopie", "meine-app"]);
});

test("VKc1: nur gültige Namen, nur echte Ordner – Verweise, Dateien und Fremdes zählen nicht", async () => {
  const o = ordner();
  const a = new ProjektAblage(o);
  await a.pruefe();
  const draussen = mkdtempSync(join(tmpdir(), "draussen-"));
  symlinkSync(draussen, join(o, "verweis"));
  writeFileSync(join(o, "datei"), "x");
  for (const fremd of [".versteckt", "Gross", "mit.punkt"]) mkdirSync(join(o, fremd));
  assert.deepEqual(await a.liste(), []);
  for (const schlecht of ["../draussen", "a/b", "Gross", "", "a".repeat(41)]) await assert.rejects(a.neu(schlecht), /ungültig/, schlecht);
  await assert.rejects(a.neu("datei"), /ungültig/, "eine Datei wird kein Projekt");
  await assert.rejects(a.neu("verweis"), /ungültig/, "einem Verweis folgt der Knoten nicht");
  assert.ok(!existsSync(join(draussen, ".git")), "nichts außerhalb der Ablage");
});

test("VKc1: höchstens 100 Projekte – das 101. abgelehnt, vorhandene bleiben erreichbar", async () => {
  const o = ordner();
  const a = new ProjektAblage(o);
  await a.pruefe();
  for (let i = 0; i < CODE_GRENZEN.projekte; i++) mkdirSync(join(o, `p${i}`));
  await assert.rejects(a.neu("noch-eins"), (e: unknown) => e instanceof CodeAbgelehnt && e.fall === "code-zu-viele");
  await a.neu("p7");
  assert.equal((await a.liste()).length, CODE_GRENZEN.projekte);
});

test("VKc1: ohne git kein Projekt – Kennung code-git, kein halber Ordner", async () => {
  const o = ordner();
  const a = new ProjektAblage(o, { git: join(o, "gibt-es-nicht") });
  assert.equal(await a.pruefe(), false);
  await assert.rejects(a.neu("app"), (e: unknown) => e instanceof CodeAbgelehnt && e.fall === "code-git");
  assert.ok(!existsSync(join(o, "app")));
});

test("VKc1: eine Konfiguration im Projekt führt kein Programm aus – Gegenprobe mit gpg.program beim Lesen eines signierten Commits", async () => {
  const o = ordner();
  const a = new ProjektAblage(o);
  await a.neu("app");
  const p = join(o, "app");
  writeFileSync(join(p, "a"), "1");
  git(p, "add", "-A");
  git(p, "commit", "-q", "-m", "eins");
  // Ein Commit mit (unechter) Signatur – beim Lesen mit showSignature ruft git gpg.program
  const baum = git(p, "rev-parse", "HEAD^{tree}").trim();
  const sig = "-----BEGIN PGP SIGNATURE-----\n \n iQ==\n -----END PGP SIGNATURE-----";
  const roh = `tree ${baum}\nparent ${git(p, "rev-parse", "HEAD").trim()}\nauthor t <t@t> 1790000000 +0000\ncommitter t <t@t> 1790000000 +0000\ngpgsig ${sig}\n\nzwei\n`;
  const id = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: p, input: roh }).toString().trim();
  git(p, "update-ref", "refs/heads/main", id);
  const marke = join(o, "..", "ausgefuehrt");
  const skript = join(o, "..", "boese.sh");
  writeFileSync(skript, `#!/bin/sh\ntouch '${marke}'\nexit 1\n`, { mode: 0o700 });
  writeFileSync(join(p, ".git", "config"), readFileSync(join(p, ".git", "config"), "utf8") +
    `[log]\n\tshowSignature = true\n[gpg]\n\tprogram = ${skript}\n[core]\n\tfsmonitor = ${skript}\n\thooksPath = ${o}/..\n`);
  // Gegenprobe: ohne die festen Einstellungen führt git das Skript aus
  try { git(p, "log", "-1", "--all", "--format=%ct"); } catch { /* das Skript endet mit 1 */ }
  assert.ok(existsSync(marke), "Gegenprobe: die Konfiguration wäre gefährlich");
  execFileSync("rm", [marke]);
  const [eins] = await a.liste();
  assert.deepEqual(eins, { name: "app", schritte: 2, geaendert: 1_790_000_000 });
  assert.ok(!existsSync(marke), "der Knoten hat nichts aus der Konfiguration ausgeführt");
});

async function aufbau(projekte?: ProjektAblage) {
  const relay = new MemoryRelay(`mem://code-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], projekte,
    status: () => ({ fassung: "0.1.0", seit: 1, rollen: ["ki", "code"], modelle: [], relay: null }),
  }, pool);
  return { relay, pool, kp, k, provider };
}

const antworten = async (relay: MemoryRelay, s: LocalSigner) =>
  (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s)))).flatMap((a) => (a.ok ? [a.response] : []));

test("VKc1: der Besitzer legt an und listet auf – versiegelt, Namen nie im Log, zählt nicht als Auftrag", async () => {
  const o = ordner();
  const { relay, pool, k, provider } = await aufbau(new ProjektAblage(o));
  const schicke = async (aktion: CodeAktion) => {
    const s = new LocalSigner(generateKeypair().sk);
    await pool.publish((await baueCodeAuftrag({ sitzung: s, kopplung: k, aktion })).wrap);
    return s;
  };
  const log: string[] = [];
  const alt = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  let neu: LocalSigner, liste: LocalSigner;
  try {
    neu = await schicke({ aktion: "neu", projekt: "geheimes-projekt" });
    await provider.pollOnce();
    liste = await schicke({ aktion: "liste" });
    await provider.pollOnce();
  } finally {
    Object.assign(console, alt);
  }
  const a = (await antworten(relay, neu)).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!;
  assert.deepEqual(leseCodeAntwort(a.content, "neu"), { aktion: "neu", projekt: "geheimes-projekt" });
  assert.ok(existsSync(join(o, "geheimes-projekt", ".git", "HEAD")));
  const l = leseCodeAntwort((await antworten(relay, liste)).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "liste");
  assert.equal(l?.aktion === "liste" && l.projekte.map((p) => p.name).join(), "geheimes-projekt");
  assert.ok(!log.join("\n").includes("geheimes-projekt"), "der Projektname nie im Log");
  assert.equal((await relay.query({ kinds: [KIND_DVM_KNOTEN_CODE + 1000] })).length, 0, "nie offen");
  const st = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueStatusAuftrag({ sitzung: st, kopplung: k })).wrap);
  await provider.pollOnce();
  const status = leseKnotenStatus((await antworten(relay, st)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000)!.content)!;
  assert.deepEqual(status.rollen, ["ki", "code"]);
  assert.deepEqual(status.auftraege, { erledigt: 0, gratis: 0, abgelehnt: 0 });
});

test("VKc1: Fremde, ein anderes Geheimnis, Vibecoden aus, Lauf ohne Motor – abgelehnt mit festem Text oder Kennung", async () => {
  const o = ordner();
  const { relay, pool, kp, k, provider } = await aufbau(new ProjektAblage(o));
  const fremd = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueCodeAuftrag({ sitzung: fremd, kopplung: neueKopplung(kp.pk), aktion: { aktion: "neu", projekt: "fremd" } })).wrap);
  const lauf = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueCodeAuftrag({ sitzung: lauf, kopplung: k, aktion: { aktion: "auftrag", projekt: "app", text: "Baue etwas.", modus: "fragen" } })).wrap);
  assert.equal((await provider.pollOnce()).length, 0);
  const f = await antworten(relay, fremd);
  assert.ok(!f.some((x) => x.kind === KIND_DVM_KNOTEN_CODE + 1000));
  assert.ok(f.some((x) => x.kind === 7000 && x.content.includes("Code nur für den Besitzer")));
  assert.ok(!existsSync(join(o, "fremd")), "für Fremde legt der Knoten nichts an");
  const r = (await antworten(relay, lauf)).find((x) => x.kind === 7000)!;
  assert.equal(getTag(r, "fall"), "code-ohne-motor");
  assert.equal(getTag(r, "status"), "error");
  // Ohne Ablage (VIBECODEN aus): Kennung code-aus
  const aus = await aufbau();
  const s = new LocalSigner(generateKeypair().sk);
  await aus.pool.publish((await baueCodeAuftrag({ sitzung: s, kopplung: aus.k, aktion: { aktion: "liste" } })).wrap);
  await aus.provider.pollOnce();
  assert.equal(getTag((await antworten(aus.relay, s)).find((x) => x.kind === 7000)!, "fall"), "code-aus");
});

test("VKc1: main.ts – Ablage nur aus der Umgebung, Rolle „code“ nur mit git, an den Provider", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const projekteWahl = projekteAusUmgebung\(process\.env\);/);
  assert.match(main, /if \(projekte && !\(await projekte\.pruefe\(\)\)\)/);
  assert.match(main, /if \(projekte\) statusRollen\.add\("code"\);/);
  assert.match(main, /turn,\s*projekte,\s*agent: knotenAgent,\s*\.\.\.\(code \? \{ code \} : \{\}\),/);
  // VKc3a: der Motor nur mit Sandbox und Hermes, nur über hermesMotor() mit der Brücke
  assert.match(main, /if \(!sandbox\.ok\) console\.log\("\[code\] kein Motor/);
  assert.match(main, /code = new CodeLaeufe\(\{ ablage: projekte, motor: hermesMotor\(\{ hermes: hermesWahl\.hermes, ablage: projekte, bruecke,/);
  assert.doesNotMatch(main, /prozessMotor\(/, "nie ein Motor ohne Sandbox");
  const docker = readFileSync(new URL("../../../docker/node.Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /install -y --no-install-recommends aria2 bubblewrap git/, "VK-W2 A: git im Bild, VKb: bubblewrap für die Sandbox");
});

/** Ein Projekt mit drei Schritten: a.txt, dann b.txt, dann a.txt geändert. */
async function mitSchritten(a: ProjektAblage) {
  await a.neu("app");
  const ort = a.ort("app");
  writeFileSync(join(ort, "a.txt"), "eins\n");
  await a.sichere("app", 1);
  writeFileSync(join(ort, "b.txt"), "zwei\n");
  await a.sichere("app", 2);
  writeFileSync(join(ort, "a.txt"), "eins\ndrei\n");
  await a.sichere("app", 3);
  return ort;
}

test("VKe2: Verlauf – neueste zuerst, Nachricht, Zeit, Zahl der Dateien; ohne Commit leer", async () => {
  const a = new ProjektAblage(ordner());
  await a.neu("leer");
  assert.deepEqual(await a.verlauf("leer"), []);
  await mitSchritten(a);
  const v = await a.verlauf("app");
  assert.deepEqual(v.map((c) => [c.nachricht, c.dateien]), [["Schritt 3", 1], ["Schritt 2", 1], ["Schritt 1", 1]]);
  for (const c of v) assert.match(c.id, /^[0-9a-f]{40}$/);
  assert.ok(v[0]!.zeit > 1_700_000_000);
});

test("VKe2: Diff eines eigenen Commits – ohne Diff-Programme des Projekts; fremde Kennung code-commit", async () => {
  const o = ordner();
  const a = new ProjektAblage(o);
  const ort = await mitSchritten(a);
  const [drei] = await a.verlauf("app");
  const d = await a.diff("app", drei!.id);
  assert.equal(d.gekuerzt, false);
  assert.match(d.text, /^Subject: \[PATCH\] Schritt 3$/m, "wie git format-patch – die App liest es mit leseDiff()");
  assert.match(d.text, /\+drei/);
  // Ein Agent schreibt .gitattributes mit einem Diff-Treiber – ohne Eintrag in der Konfiguration des Knotens läuft nichts,
  // und --no-ext-diff/--no-textconv halten auch einen eingeschmuggelten fern
  writeFileSync(join(ort, ".gitattributes"), "*.txt diff=boese\n");
  writeFileSync(join(o, "boese.sh"), `#!/bin/sh\ntouch ${join(o, "AUSGEFUEHRT")}\n`, { mode: 0o755 });
  git(ort, "config", "diff.boese.textconv", join(o, "boese.sh"));
  git(ort, "config", "diff.boese.command", join(o, "boese.sh"));
  await a.diff("app", drei!.id);
  assert.ok(!existsSync(join(o, "AUSGEFUEHRT")), "kein Programm aus der Konfiguration des Projekts");
  await assert.rejects(a.diff("app", "ab".repeat(20)), (e: unknown) => e instanceof CodeAbgelehnt && e.fall === "code-commit");
  // eine Kennung, die es gibt, aber kein Commit ist (ein Baum) – ebenso
  const baum = git(ort, "rev-parse", `${drei!.id}^{tree}`).trim();
  await assert.rejects(a.diff("app", baum), (e: unknown) => e instanceof CodeAbgelehnt && e.fall === "code-commit");
});

test("VKe2: Diff über der Grenze – gekürzt, passt als JSON in den Umschlag", async () => {
  const a = new ProjektAblage(ordner());
  await a.neu("gross");
  writeFileSync(join(a.ort("gross"), "x.txt"), "\"\n".repeat(60_000));
  await a.sichere("gross", 1);
  const [c] = await a.verlauf("gross");
  const d = await a.diff("gross", c!.id);
  assert.equal(d.gekuerzt, true);
  assert.ok(JSON.stringify(d.text).length <= CODE_GRENZEN.diff);
});

test("VKe2: zurück – neuer Commit mit dem alten Baum, nichts geht verloren; nur Vorfahren von HEAD", async () => {
  const a = new ProjektAblage(ordner());
  const ort = await mitSchritten(a);
  const [drei, , eins] = await a.verlauf("app");
  const neu = await a.zurueck("app", eins!.id);
  assert.match(neu, /^[0-9a-f]{40}$/);
  assert.equal(readFileSync(join(ort, "a.txt"), "utf8"), "eins\n");
  assert.ok(!existsSync(join(ort, "b.txt")), "was erst später kam, ist im Arbeitsordner weg");
  const v = await a.verlauf("app");
  assert.deepEqual(v.map((c) => c.nachricht), [`Zurück auf ${eins!.id.slice(0, 7)}`, "Schritt 3", "Schritt 2", "Schritt 1"]);
  assert.equal(git(ort, "rev-parse", "HEAD^{tree}").trim(), git(ort, "rev-parse", `${eins!.id}^{tree}`).trim());
  // noch einmal dasselbe ändert nichts; zurück auf Schritt 3 holt alles wieder
  assert.equal(await a.zurueck("app", neu), "");
  await a.zurueck("app", drei!.id);
  assert.equal(readFileSync(join(ort, "b.txt"), "utf8"), "zwei\n");
  // ein Commit auf einem anderen Zweig führt nicht zu HEAD
  git(ort, "checkout", "-q", "-b", "daneben");
  writeFileSync(join(ort, "c.txt"), "x\n");
  git(ort, "add", "c.txt");
  git(ort, "commit", "-q", "-m", "daneben");
  const daneben = git(ort, "rev-parse", "HEAD").trim();
  git(ort, "checkout", "-q", "main");
  await assert.rejects(a.zurueck("app", daneben), (e: unknown) => e instanceof CodeAbgelehnt && e.fall === "code-commit");
});

test("VKe2: über den Knoten – Verlauf, Diff und zurück versiegelt an den Besitzer; zurück nie während eines Laufs", async () => {
  const o = ordner();
  const ablage = new ProjektAblage(o);
  await mitSchritten(ablage);
  const { relay, pool, k, provider } = await aufbau(ablage);
  const frage = async (aktion: CodeAktion) => {
    const s = new LocalSigner(generateKeypair().sk);
    await pool.publish((await baueCodeAuftrag({ sitzung: s, kopplung: k, aktion })).wrap);
    await provider.pollOnce();
    return antworten(relay, s);
  };
  const v = leseCodeAntwort((await frage({ aktion: "verlauf", projekt: "app" })).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "verlauf");
  assert.equal(v?.aktion === "verlauf" && v.commits.length, 3);
  const id = v!.aktion === "verlauf" ? v!.commits[2]!.id : "";
  const d = leseCodeAntwort((await frage({ aktion: "diff", projekt: "app", commit: id })).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "diff");
  assert.ok(d?.aktion === "diff" && d.commit === id && d.text.includes("+eins"));
  const fremd = (await frage({ aktion: "diff", projekt: "app", commit: "cd".repeat(20) })).find((r) => r.kind === 7000)!;
  assert.equal(getTag(fremd, "fall"), "code-commit");
  // Ein Lauf im Projekt: zurück abgelehnt (code-belegt)
  (provider as unknown as { cfg: { code?: { laeuftIn(p: string): boolean } } }).cfg.code = { laeuftIn: (p: string) => p === "app" } as never;
  const belegt = (await frage({ aktion: "zurueck", projekt: "app", commit: id })).find((r) => r.kind === 7000)!;
  assert.equal(getTag(belegt, "fall"), "code-belegt");
  assert.equal(readFileSync(join(o, "app", "a.txt"), "utf8"), "eins\ndrei\n", "nichts geändert");
  (provider as unknown as { cfg: { code?: unknown } }).cfg.code = undefined;
  const z = leseCodeAntwort((await frage({ aktion: "zurueck", projekt: "app", commit: id })).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "zurueck");
  assert.ok(z?.aktion === "zurueck" && /^[0-9a-f]{40}$/.test(z.commit));
  assert.equal(readFileSync(join(o, "app", "a.txt"), "utf8"), "eins\n");
});
