/**
 * Arbeitsordner eines Repo-Auftrags (11.5a1, W3a A): neuer Ordner 0700, die
 * Arbeitskopie nur in einen leeren, echten Ordner, Dateien mit ihrem Modus,
 * Verweise zuletzt und als Verweis – nie ein Pfad durch einen Verweis hinaus.
 * Mit bubblewrap: der Agent liest die Arbeitskopie in der Sandbox (VKb).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArbeitsDatei, Arbeitskopie } from "@freedomstack/protocol";
import { arbeitsOrt, neuerArbeitsordner, schreibeArbeitskopie } from "../src/arbeitskopie.js";
import { fuehreAus, pruefeSandbox } from "../src/sandbox.js";

const d = (pfad: string, art: ArbeitsDatei["art"], inhalt: string): ArbeitsDatei => ({ pfad, art, daten: new TextEncoder().encode(inhalt) });
const kopie = (...dateien: ArbeitsDatei[]): Arbeitskopie => ({ commit: "0".repeat(40), dateien, module: [] });
const basis = () => mkdtempSync(join(tmpdir(), "arbeitsort-"));

test("11.5a1: Arbeitsordner – im Arbeitsspeicher, wo es ihn gibt, 0700, weg() löscht alles", () => {
  assert.equal(arbeitsOrt("/gibt/es/nicht"), tmpdir());
  if (existsSync("/dev/shm") && lstatSync("/dev/shm").isDirectory()) assert.equal(arbeitsOrt(), "/dev/shm");
  const { ordner, weg } = neuerArbeitsordner(basis());
  assert.equal(statSync(ordner).mode & 0o777, 0o700);
  schreibeArbeitskopie(ordner, kopie(d("a/b.txt", "datei", "x")));
  weg();
  assert.ok(!existsSync(ordner));
});

test("11.5a1: Arbeitskopie schreiben – Inhalte, Modi, Verweise als Verweis", () => {
  const { ordner } = neuerArbeitsordner(basis());
  schreibeArbeitskopie(ordner, kopie(
    d("liesmich", "verweis", "README.md"), d("README.md", "datei", "# Probe\n"), d("bin/start.sh", "ausfuehrbar", "#!/bin/sh\n"), d("src/tief/a.ts", "datei", "a"),
  ));
  assert.equal(readFileSync(join(ordner, "README.md"), "utf8"), "# Probe\n");
  assert.equal(statSync(join(ordner, "README.md")).mode & 0o111, 0);
  assert.equal(statSync(join(ordner, "bin/start.sh")).mode & 0o100, 0o100);
  assert.equal(readFileSync(join(ordner, "src/tief/a.ts"), "utf8"), "a");
  assert.ok(lstatSync(join(ordner, "liesmich")).isSymbolicLink());
  assert.equal(readlinkSync(join(ordner, "liesmich")), "README.md");
});

test("11.5a1: nur in einen leeren, echten Ordner; ungültige Pfade schreiben nichts; nie durch einen Verweis hinaus", () => {
  const voll = neuerArbeitsordner(basis()).ordner;
  writeFileSync(join(voll, "da"), "");
  assert.throws(() => schreibeArbeitskopie(voll, kopie(d("a", "datei", "x"))), /kein leerer Ordner/);
  // der Ordner selbst als Verweis
  const echt = neuerArbeitsordner(basis()).ordner, verweis = join(basis(), "verweis");
  symlinkSync(echt, verweis);
  assert.throws(() => schreibeArbeitskopie(verweis, kopie(d("a", "datei", "x"))), /kein leerer Ordner/);
  assert.ok(!existsSync(join(echt, "a")));
  for (const boese of ["../aussen", ".git/hooks/pre-commit", "/abs"]) {
    const o = neuerArbeitsordner(basis()).ordner;
    assert.throws(() => schreibeArbeitskopie(o, kopie(d("ok", "datei", "x"), d(boese, "datei", "x"))), /Pfad ungültig/, boese);
    assert.ok(!existsSync(join(o, "ok")), "nichts geschrieben");
  }
  // Verweis „a“ nach draußen und eine Datei „a/x“: die Datei zuerst, der Verweis scheitert – draußen landet nichts
  const aussen = mkdtempSync(join(tmpdir(), "aussen-"));
  const o = neuerArbeitsordner(basis()).ordner;
  assert.throws(() => schreibeArbeitskopie(o, kopie(d("a", "verweis", aussen), d("a/x", "datei", "geheim"))));
  assert.ok(!existsSync(join(aussen, "x")));
});

const sandbox = await pruefeSandbox();
test("11.5a1 mit VKb (bubblewrap): der Agent liest die Arbeitskopie in der Sandbox, der Verweis zeigt nur hinein", { skip: !sandbox.ok && `Sandbox geht hier nicht (${sandbox.ok ? "" : sandbox.fall})` }, async () => {
  const { ordner, weg } = neuerArbeitsordner(basis());
  try {
    schreibeArbeitskopie(ordner, kopie(d("README.md", "datei", "# Probe\n"), d("bin/start.sh", "ausfuehrbar", "#!/bin/sh\necho gestartet\n"), d("knoten", "verweis", "/home/user/.freedom/node-key")));
    const r = await fuehreAus(["/bin/sh", "-c", "cat README.md; ./bin/start.sh; cat knoten 2>/dev/null || echo verweis-leer"], { arbeit: ordner });
    assert.equal(r.code, 0);
    assert.equal(r.ausgabe, "# Probe\ngestartet\nverweis-leer\n");
  } finally {
    weg();
  }
});
