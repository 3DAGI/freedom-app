/**
 * Ablauf für Repo-Aufträge (11.5c1, W3a A – nach mini-swe-agent): eine Aktion je Antwort, Formfehler, Marke am
 * Ende nur als erste Zeile und mit 0, Grenzen nach Schritten, Tokens und Zeit, Fehler von Modell und Sandbox.
 * Mit bubblewrap Ende zu Ende: Bundle → Arbeitsordner → Befehle in der Sandbox → Patch, den `git am` annimmt;
 * der Arbeitsordner ist danach weg, auch ohne Patch, und nichts geht ins Log.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { leseBundle } from "@freedomstack/protocol";
import { ENDE_MARKE, type RepoModellAntwort, type RepoNachricht, bearbeiteRepo, repoLauf } from "../src/repo-lauf.js";
import { SANDBOX_GRENZEN, type SandboxErgebnis, pruefeSandbox } from "../src/sandbox.js";

const bash = (befehl: string, vorher = "THOUGHT: weiter.") => `${vorher}\n\n\`\`\`bash\n${befehl}\n\`\`\``;
const ok = (ausgabe: string, code: number | null = 0): SandboxErgebnis => ({ code, ausgabe, gekuerzt: false, zeitUm: false });
const ENDE = `printf '%s\\n' ${ENDE_MARKE} 'Betreff' 'Zeile eins' 'Zeile zwei'`;

/** Ein Modell nach Drehbuch: gibt der Reihe nach die Antworten zurück und merkt, was es sah. */
function drehbuch(antworten: Array<string | RepoModellAntwort>) {
  const gesehen: RepoNachricht[][] = [];
  return {
    gesehen,
    modell: async (n: readonly RepoNachricht[]): Promise<RepoModellAntwort> => {
      gesehen.push(n.map((x) => ({ ...x })));
      const a = antworten[gesehen.length - 1];
      if (a === undefined) throw new Error("Drehbuch zu Ende");
      return typeof a === "string" ? { text: a, tokens: 10 } : a;
    },
  };
}

test("11.5c1: ein Befehl je Antwort in einer neuen Shell, Ausgabe als Beobachtung, Marke beendet mit Betreff und Beschreibung", async () => {
  const m = drehbuch([bash("ls -la"), bash(ENDE)]);
  const befehle: Array<{ befehl: readonly string[]; zeitMs: number }> = [];
  const r = await repoLauf({
    aufgabe: "Bitte a auf 2 setzen.", modell: m.modell,
    fuehre: async (befehl, zeitMs) => {
      befehle.push({ befehl, zeitMs });
      return befehle.length === 1 ? ok("README.md\nsrc\n") : ok(`${ENDE_MARKE}\nBetreff\nZeile eins\nZeile zwei\n`);
    },
  });
  assert.deepEqual(r, { ende: "fertig", schritte: 2, tokens: 20, abschluss: { betreff: "Betreff", beschreibung: "Zeile eins\nZeile zwei" } });
  const [erste, zweite] = m.gesehen;
  assert.deepEqual(erste.map((x) => x.role), ["system", "user"]);
  assert.match(erste[0].content, /exactly ONE bash code block/);
  assert.match(erste[1].content, /^Please solve this issue: Bitte a auf 2 setzen\./);
  assert.match(erste[1].content, /no network and no git/);
  assert.deepEqual(zweite.slice(2).map((x) => x.role), ["assistant", "user"]);
  assert.equal(zweite[3].content, "<returncode>0</returncode>\n<output>\nREADME.md\nsrc\n</output>");
  // jeder Befehl eine eigene bash, die Umgebung wie bei mini-swe-agent, Zeit je Befehl aus der Sandbox
  assert.deepEqual(befehle[0].befehl, ["bash", "-c", "export PAGER=cat MANPAGER=cat LESS=-R PIP_PROGRESS_BAR=off TQDM_DISABLE=1\nls -la"]);
  assert.equal(befehle[0].zeitMs, SANDBOX_GRENZEN.befehlMs);
});

test("11.5c1: Formfehler – keiner oder mehrere Blöcke werden abgewiesen, drei hintereinander beenden; ein guter Schritt setzt zurück", async () => {
  let n = 0;
  const fuehre = async () => { n++; return ok("x\n"); };
  const zwei = `${bash("ls")}\n${bash("pwd")}`;
  const m = drehbuch(["ohne Block", zwei, bash("ls"), "nichts", { text: "abgebrochen mitten im", tokens: 5, abgeschnitten: true }, "```sh\nls\n```"]);
  const r = await repoLauf({ aufgabe: "x", modell: m.modell, fuehre });
  assert.deepEqual(r, { ende: "formfehler", schritte: 6, tokens: 55 });
  assert.equal(n, 1, "nur der gültige Befehl lief");
  const antworten = m.gesehen[5].filter((x) => x.role === "user").slice(1).map((x) => x.content);
  assert.match(antworten[0], /found 0 actions/);
  assert.match(antworten[1], /found 2 actions/);
  assert.match(antworten[2], /^<returncode>0<\/returncode>/);
  assert.match(antworten[3], /found 0 actions/);
  assert.match(antworten[4], /reached the output token limit/);
});

test("11.5c1: Ende nur mit der Marke als erster Zeile und Exit 0 – sonst geht es weiter", async () => {
  const ausgaben = [ok(`${ENDE_MARKE}\n`, 1), ok(`vorher\n${ENDE_MARKE}\n`), ok(`${ENDE_MARKE}x\n`), ok(`\n  ${ENDE_MARKE}\n`)];
  const m = drehbuch(ausgaben.map(() => bash(ENDE)));
  const r = await repoLauf({ aufgabe: "x", modell: m.modell, fuehre: async () => ausgaben.shift()! });
  assert.deepEqual(r, { ende: "fertig", schritte: 4, tokens: 40, abschluss: { betreff: "", beschreibung: "" } });
  assert.match(m.gesehen[1].at(-1)!.content, /^<returncode>1<\/returncode>/);
});

test("11.5c1: Grenzen – Schritte, Tokens, Zeit (auch je Befehl), lange Ausgabe und Zeitablauf als Beobachtung", async () => {
  const immer = { modell: async () => ({ text: bash("ls"), tokens: 60 }), fuehre: async () => ok("x\n") };
  assert.deepEqual(await repoLauf({ aufgabe: "x", ...immer, grenzen: { schritte: 2 } }), { ende: "schritte", schritte: 2, tokens: 120 });
  assert.deepEqual(await repoLauf({ aufgabe: "x", ...immer, grenzen: { tokens: 100 } }), { ende: "tokens", schritte: 2, tokens: 120 });
  // die Antwort des Modells dauert 12 Minuten: dem zweiten Befehl bleiben 6, nach der dritten Antwort nichts
  let uhr = 0;
  const zeiten: number[] = [];
  const r = await repoLauf({
    aufgabe: "x", modell: async () => { uhr += 12 * 60_000; return { text: bash("ls"), tokens: 1 }; },
    fuehre: async (_b, zeitMs) => { zeiten.push(zeitMs); return ok("x\n"); }, jetzt: () => uhr, grenzen: { befehlMs: 10 * 60_000 },
  });
  assert.deepEqual(r, { ende: "zeit", schritte: 3, tokens: 3 });
  assert.deepEqual(zeiten, [10 * 60_000, 6 * 60_000], "nie länger als die Zeit, die dem Auftrag bleibt");
  // was die Sandbox meldet, sieht das Modell
  const meldungen = [{ code: 0, ausgabe: "a\n[…]\nb\n", gekuerzt: true, zeitUm: false }, { code: null, ausgabe: "halb", gekuerzt: false, zeitUm: true }];
  const m = drehbuch([bash("cat gross"), bash("sleep 999"), "Ende"]);
  await repoLauf({ aufgabe: "x", modell: m.modell, fuehre: async () => meldungen.shift()!, grenzen: { formfehler: 1 } });
  const [lang, um] = m.gesehen[2].filter((x) => x.role === "user").slice(1).map((x) => x.content);
  assert.match(lang, /^<returncode>0<\/returncode>\n<warning>\nThe output of your last command was too long\.[\s\S]*<output>\na\n\[…\]\nb\n<\/output>$/);
  assert.match(um, /^The last command <command>sleep 999<\/command> timed out and has been killed\.\n[\s\S]*<output>\nhalb\n<\/output>/);
});

test("11.5c1: scheitert das Modell oder die Sandbox, endet der Lauf mit dem Grund – ohne Text des Fehlers", async () => {
  const ausModell = await repoLauf({ aufgabe: "x", modell: async () => { throw new Error("KI-Antrieb HTTP 500 mit Geheimnis"); }, fuehre: async () => ok("") });
  assert.deepEqual(ausModell, { ende: "modell", schritte: 1, tokens: 0 });
  const ausSandbox = await repoLauf({ aufgabe: "x", modell: async () => ({ text: bash("ls"), tokens: Number.NaN }), fuehre: async () => { throw Object.assign(new Error("weg"), { name: "SandboxFehlt" }); } });
  assert.deepEqual(ausSandbox, { ende: "sandbox", schritte: 1, tokens: 0 }, "ungültige Tokens zählen nicht");
});

// Ende zu Ende mit bubblewrap und git
const sandbox = await pruefeSandbox();
const ohne = !sandbox.ok && `Sandbox geht hier nicht (${sandbox.ok ? "" : sandbox.fall})`;
const gitUmgebung = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_NAME: "Agent", GIT_COMMITTER_EMAIL: "agent@freedom.invalid" };
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd: dir, env: gitUmgebung }).toString();

async function probeBundle() {
  const repo = mkdtempSync(join(tmpdir(), "repo-lauf-"));
  git(repo, "init", "-q");
  for (const [pfad, inhalt] of Object.entries({ "README.md": "# Probe\n", "src/a.ts": "export const a = 1;\n", "test.sh": "grep -q 'a = 2' src/a.ts\n" })) {
    mkdirSync(dirname(join(repo, pfad)), { recursive: true });
    writeFileSync(join(repo, pfad), inhalt);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "erster");
  git(repo, "bundle", "create", "-q", "r.bundle", "HEAD", "main");
  return { repo, bundle: await leseBundle(new Uint8Array(readFileSync(join(repo, "r.bundle")))) };
}
const angaben = { name: "Agent", mail: "agent@freedom.invalid", zeit: 1_790_000_000, betreff: "Vorschlag des Agenten" };

/** Was während `f` auf die Konsole ginge – der Knoten schreibt dabei nichts (P4). */
async function ohneLog<T>(f: () => Promise<T>): Promise<{ wert: T; log: unknown[] }> {
  const log: unknown[] = [];
  const alt = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info = (...a: unknown[]) => { log.push(a); };
  try {
    return { wert: await f(), log };
  } finally {
    Object.assign(console, alt);
  }
}

test("11.5c1 mit bubblewrap: Bundle → Befehle in der Sandbox → Patch, den git am annimmt; Ordner weg, nichts im Log", { skip: ohne }, async () => {
  const { repo, bundle } = await probeBundle();
  const basis = mkdtempSync(join(tmpdir(), "repo-lauf-basis-"));
  process.env.FREEDOM_TEST_GEHEIM = "geheim-des-knotens-0123456789abcdef";
  const m = drehbuch([
    bash("cat src/a.ts && pwd && env | sort"),
    bash("sed -i 's/= 1/= 2/' src/a.ts && echo 'export const b = 1;' > src/b.ts && sh test.sh && echo TEST-OK"),
    bash(`printf '%s\\n' ${ENDE_MARKE} 'a ist jetzt 2' 'Mit Test.'`),
  ]);
  try {
    const { wert: r, log } = await ohneLog(() => bearbeiteRepo({ aufgabe: "Setze a auf 2.", modell: m.modell, bundle, angaben, basis }));
    assert.deepEqual(log, []);
    assert.equal(r.ende, "fertig");
    assert.ok(r.patch?.ok, JSON.stringify(r.patch));
    assert.deepEqual(r.patch.geaendert, ["src/a.ts", "src/b.ts"]);
    assert.match(r.patch.text, /^Subject: \[PATCH\] a ist jetzt 2$/m);
    // das Modell sah die Datei, /arbeit, die Umgebung von mini-swe-agent – keine Variable des Knotens
    const erste = m.gesehen[1].at(-1)!.content;
    assert.match(erste, /^<returncode>0<\/returncode>\n<output>\nexport const a = 1;\n\/arbeit\n/);
    assert.match(erste, /^PAGER=cat$/m);
    assert.doesNotMatch(erste, /FREEDOM_TEST_GEHEIM|geheim-des-knotens/);
    assert.match(m.gesehen[2].at(-1)!.content, /TEST-OK/);
    const klon = mkdtempSync(join(tmpdir(), "repo-lauf-klon-"));
    git(klon, "clone", "-q", join(repo, "r.bundle"), ".");
    writeFileSync(join(klon, "p.patch"), r.patch.text);
    git(klon, "am", "-q", "--committer-date-is-author-date", "p.patch");
    assert.equal(git(klon, "rev-parse", "HEAD").trim(), r.patch.commit);
    assert.equal(readFileSync(join(klon, "src/a.ts"), "utf8"), "export const a = 2;\n");
    assert.deepEqual(readdirSync(basis), [], "Arbeitsordner gelöscht");
  } finally {
    delete process.env.FREEDOM_TEST_GEHEIM;
  }
});

test("11.5c1 mit bubblewrap: ohne „fertig“ kein Patch, ohne Änderung keiner, leerer Betreff → Vorgabe; der Ordner ist immer weg", { skip: ohne }, async () => {
  const { bundle } = await probeBundle();
  const basis = mkdtempSync(join(tmpdir(), "repo-lauf-basis-"));
  // Grenze erreicht, obwohl geändert wurde
  const grenze = await bearbeiteRepo({ aufgabe: "x", modell: drehbuch([bash("echo neu > neu.txt")]).modell, bundle, angaben, basis, grenzen: { schritte: 1 } });
  assert.deepEqual(grenze, { ende: "schritte", schritte: 1, tokens: 10 });
  // das Modell scheitert
  assert.deepEqual(await bearbeiteRepo({ aufgabe: "x", modell: drehbuch([]).modell, bundle, angaben, basis }), { ende: "modell", schritte: 1, tokens: 0 });
  // fertig ohne Änderung
  const leer = await bearbeiteRepo({ aufgabe: "x", modell: drehbuch([bash(`echo ${ENDE_MARKE}`)]).modell, bundle, angaben, basis });
  assert.deepEqual(leer.patch, { ok: false, fall: "patch.keine-aenderung" });
  // Betreff fehlt oder bleibt für git leer – die Vorgabe
  for (const betreff of ["", "'[WIP]'"]) {
    const r = await bearbeiteRepo({ aufgabe: "x", modell: drehbuch([bash(`echo x >> README.md && printf '%s\\n' ${ENDE_MARKE} ${betreff}`)]).modell, bundle, angaben, basis });
    assert.ok(r.patch?.ok, JSON.stringify(r.patch));
    assert.match(r.patch.text, /^Subject: \[PATCH\] Vorschlag des Agenten$/m, betreff);
  }
  assert.deepEqual(readdirSync(basis), []);
});
