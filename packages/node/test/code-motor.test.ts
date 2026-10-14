/**
 * Vibecoden auf dem eigenen Knoten (A-31, VKc2): Der Knoten ist ACP-Client – ein Werkzeug-Aufruf des
 * Motors wird Schritt `befehl`, sein Ende `ausgabe`, eine Freigabe wartet auf den Besitzer (Modus
 * „fragen“), `stopp` bricht ab; jeder Schritt mit Änderungen ein Commit. Alles reist versiegelt,
 * ins Log kommen weder Befehle noch Ausgaben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agent, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import {
  KIND_DVM_KNOTEN_CODE, LocalSigner, MemoryRelay, OutboxPool, baueCodeAuftrag, generateKeypair, leseCodeAntwort, leseCodeSchritt,
  neueKopplung, openPrivateJobResponse, type CodeAktion, type CodeSchritt,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { CodeAbgelehnt, ProjektAblage } from "../src/projekte.js";
import { CodeLaeufe, kuerzeAusgabe, prozessMotor, type LAUF_GRENZEN } from "../src/code-motor.js";

const ablage = () => new ProjektAblage(join(mkdtempSync(join(tmpdir(), "vkc2-")), "projekte"));
/** Commit-Nachrichten eines Projekts (`--all`: ohne Commit leer, statt dass git scheitert). */
const commits = (a: ProjektAblage, p: string) =>
  execFileSync("git", ["--git-dir", join(a.ort(p), ".git"), "log", "--all", "--format=%s"], { env: { PATH: process.env.PATH } }).toString().trim().split("\n").filter(Boolean);
/** Bis die Bedingung gilt – mit Frist, nie mit fester Pause. */
async function bis(ok: () => boolean | Promise<boolean>, frist = 5000): Promise<void> {
  for (const ende = Date.now() + frist; !(await ok());) {
    if (Date.now() > ende) throw new Error("Frist abgelaufen");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** ACP-Agent im selben Prozess: ein Werkzeug-Aufruf mit Freigabe, bei „ja“ eine neue Datei. */
function attrappe(o: { wirft?: boolean; wartetAufAbbruch?: boolean } = {}) {
  const spur = { abgebrochen: false, cwd: "", optionen: [] as string[] };
  let abbruch = () => {};
  const app = agent({ name: "attrappe" })
    .onRequest("initialize", () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }))
    .onRequest("session/new", ({ params }) => { spur.cwd = params.cwd; return { sessionId: "s1" }; })
    .onNotification("session/cancel", () => { spur.abgebrochen = true; abbruch(); })
    .onRequest("session/prompt", async ({ params, client }) => {
      if (o.wirft) throw new Error("kaputt-geheim");
      const update = (u: Record<string, unknown>) => client.notify("session/update", { sessionId: params.sessionId, update: u as never });
      await update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Ich lege a.txt an." } });
      await update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Datei anlegen", kind: "execute", status: "pending", rawInput: { command: "echo hallo > a.txt" } });
      const r = await client.request("session/request_permission", {
        sessionId: params.sessionId, toolCall: { toolCallId: "t1" },
        options: [{ optionId: "ja", name: "Ja", kind: "allow_once" }, { optionId: "immer", name: "Immer", kind: "allow_always" }, { optionId: "nein", name: "Nein", kind: "reject_once" }],
      });
      spur.optionen.push(r.outcome.outcome === "selected" ? r.outcome.optionId : "cancelled");
      if (r.outcome.outcome === "cancelled" || spur.abgebrochen) return { stopReason: "cancelled" };
      const ja = r.outcome.optionId !== "nein";
      if (ja) writeFileSync(join(spur.cwd, "a.txt"), "hallo\n");
      await update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: ja ? "completed" : "failed", content: [{ type: "content", content: { type: "text", text: ja ? "hallo" : "abgelehnt" } }] });
      if (o.wartetAufAbbruch) {
        await new Promise<void>((weiter) => { abbruch = weiter; });
        return { stopReason: "cancelled" };
      }
      await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Fertig: a.txt angelegt." } });
      return { stopReason: "end_turn" };
    });
  return { spur, motor: () => ({ strom: app, beende: () => {} }) };
}

const AUFTRAG = { projekt: "app", text: "Lege a.txt an." };
const id = () => randomBytes(32).toString("hex");
function laeufe(o: Parameters<typeof attrappe>[0] = {}, grenzen: Partial<typeof LAUF_GRENZEN> = {}) {
  const a = ablage(), t = attrappe(o);
  return { a, ...t, l: new CodeLaeufe({ ablage: a, motor: t.motor, grenzen }) };
}

test("VKc2: frei – Gedanke und Befehl, Ausgabe, ein Commit je Schritt, Abschluss; nie „immer erlauben“", async () => {
  const { a, spur, l } = laeufe();
  const schritte: CodeSchritt[] = [];
  const e = await l.starte(id(), { ...AUFTRAG, modus: "frei" }, (s) => schritte.push(s));
  assert.deepEqual(e, { ende: "fertig", schritte: 1, abschluss: "Fertig: a.txt angelegt." });
  assert.deepEqual(schritte, [
    { nr: 1, art: "befehl", gedanke: "Ich lege a.txt an.", befehl: "echo hallo > a.txt", wartet: false },
    { nr: 1, art: "ausgabe", ausgabe: "hallo", code: 0, gekuerzt: false },
  ]);
  assert.deepEqual(spur.optionen, ["ja"], "einmal erlauben, nie für immer");
  assert.equal(spur.cwd, a.ort("app"), "der Motor arbeitet im Projektordner");
  assert.deepEqual(commits(a, "app"), ["Schritt 1"]);
});

test("VKc2: fragen – wartet auf den Besitzer; „nein“ lehnt ab, ohne Antwort abgelehnt nach der Frist", async () => {
  for (const [antwort, erwartet] of [[true, "ja"], [false, "nein"], [null, "nein"]] as const) {
    const { a, spur, l } = laeufe({}, { freigabeMs: antwort === null ? 30 : 60_000 });
    const lauf = id(), schritte: CodeSchritt[] = [];
    const e = await l.starte(lauf, { ...AUFTRAG, modus: "fragen" }, (s) => {
      schritte.push(s);
      if (s.art === "befehl" && s.wartet && antwort !== null) {
        assert.equal(l.freigabe(lauf, 2, true), false, "nur der wartende Schritt");
        assert.equal(l.freigabe(id(), 1, true), false, "nur der eigene Lauf");
        setImmediate(() => assert.equal(l.freigabe(lauf, 1, antwort), true));
      }
    });
    assert.deepEqual(spur.optionen, [erwartet], String(antwort));
    assert.deepEqual(schritte[0], { nr: 1, art: "befehl", gedanke: "Ich lege a.txt an.", befehl: "echo hallo > a.txt", wartet: true });
    assert.equal(e.ende, "fertig");
    if (erwartet === "nein") {
      assert.deepEqual(schritte[1], { nr: 1, art: "ausgabe", ausgabe: "abgelehnt", code: 1, gekuerzt: false });
      assert.deepEqual(commits(a, "app"), [], "ohne Änderung kein Commit");
    }
  }
});

test("VKc2: stopp – session/cancel, offene Freigabe „cancelled“; je Projekt ein Lauf; Grenze und Fehler", async () => {
  const { spur, l } = laeufe();
  const lauf = id();
  let andererFehler: unknown;
  const e = await l.starte(lauf, { ...AUFTRAG, modus: "fragen" }, (s) => {
    if (s.art !== "befehl" || !s.wartet) return;
    try { void l.starte(id(), { ...AUFTRAG, modus: "frei" }, () => {}); } catch (x) { andererFehler = x; }
    assert.equal(l.stopp(lauf), true);
  });
  assert.ok(andererFehler instanceof CodeAbgelehnt && andererFehler.fall === "code-belegt", "ein Lauf je Projekt");
  assert.deepEqual([e.ende, spur.abgebrochen, spur.optionen], ["gestoppt", true, ["cancelled"]]);
  assert.equal(l.stopp(lauf), false, "vorbei");
  // Grenze: der Lauf dauert zu lange – der Knoten bricht ab
  const g = laeufe({ wartetAufAbbruch: true }, { laufMs: 50 });
  assert.equal((await g.l.starte(id(), { ...AUFTRAG, modus: "frei" }, () => {})).ende, "grenze");
  // Fehler des Motors: „fehler“, ins Log nur der Fehlername
  const log: string[] = [];
  const alt = console.warn;
  console.warn = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  try {
    assert.equal((await laeufe({ wirft: true }).l.starte(id(), { ...AUFTRAG, modus: "frei" }, () => {})).ende, "fehler");
  } finally {
    console.warn = alt;
  }
  assert.ok(log.length > 0 && !log.join("\n").includes("kaputt-geheim"), "nie Text des Motors im Log");
});

test("VKc2: Ausgabe gekürzt – Anfang und Ende bleiben, höchstens 10 000 Zeichen", () => {
  assert.deepEqual(kuerzeAusgabe("kurz"), { ausgabe: "kurz", gekuerzt: false });
  const k = kuerzeAusgabe("A".repeat(6000) + "B".repeat(6000));
  assert.ok(k.gekuerzt && k.ausgabe.length <= 10_000 && k.ausgabe.startsWith("AAA") && k.ausgabe.endsWith("BBB"));
});

test("VKc2: Motor als Prozess – ACP über stdio, ohne Shell, Umgebung leer bis auf PATH, HOME, LANG", async () => {
  assert.throws(() => prozessMotor([]), /leer/);
  const a = ablage();
  const skript = fileURLToPath(new URL("./fixtures/acp-attrappe.mjs", import.meta.url));
  process.env.GEHEIM = "nicht-weitergeben";
  try {
    const l = new CodeLaeufe({ ablage: a, motor: prozessMotor([process.execPath, skript]) });
    const lauf = id();
    const e = await l.starte(lauf, { ...AUFTRAG, modus: "fragen" }, (s) => {
      if (s.art === "befehl" && s.wartet) setImmediate(() => l.freigabe(lauf, 1, true));
    });
    assert.deepEqual(e, { ende: "fertig", schritte: 1, abschluss: "Prozess fertig." });
    assert.equal(readFileSync(join(a.ort("app"), "p.txt"), "utf8"), "prozess true -\n", "HOME ist das Projekt, keine Variable des Knotens");
    const fehlt = new CodeLaeufe({ ablage: a, motor: prozessMotor(["/gibt/es/nicht"]) });
    assert.equal((await fehlt.starte(id(), { projekt: "zwei", text: "x", modus: "frei" }, () => {})).ende, "fehler");
  } finally {
    delete process.env.GEHEIM;
  }
});

test("VKc2: im Knoten – Lauf im Hintergrund, Schritte und Ergebnis versiegelt, Freigabe über einen eigenen Auftrag", async () => {
  const relay = new MemoryRelay(`mem://vkc2-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair(), k = neueKopplung(kp.pk), t = attrappe();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], projekte: ablage(), code: new CodeLaeufe({ ablage: ablage(), motor: t.motor }),
  }, pool);
  const antworten = async (s: LocalSigner) =>
    (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s)))).flatMap((x) => (x.ok ? [x.response] : []));
  const schicke = async (aktion: CodeAktion) => {
    const s = new LocalSigner(generateKeypair().sk);
    const { wrap, requestId } = await baueCodeAuftrag({ sitzung: s, kopplung: k, aktion });
    await pool.publish(wrap);
    return { s, requestId };
  };
  const log: string[] = [];
  const alt = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  try {
    const auftrag = await schicke({ aktion: "auftrag", ...AUFTRAG, modus: "fragen" });
    assert.equal((await provider.pollOnce()).length, 1, "antwortet sofort – der Lauf läuft im Hintergrund");
    const schritte = async () => (await antworten(auftrag.s)).filter((r) => r.kind === 7000).map((r) => leseCodeSchritt(r.content));
    await bis(async () => (await schritte()).some((s) => s?.art === "befehl" && s.wartet));
    const ja = await schicke({ aktion: "freigabe", lauf: auftrag.requestId, schritt: 1, ja: true });
    await provider.pollOnce();
    const ok = (await antworten(ja.s)).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!;
    assert.deepEqual(leseCodeAntwort(ok.content, "freigabe"), { aktion: "freigabe", ok: true });
    await bis(async () => (await antworten(auftrag.s)).some((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000));
    const ende = (await antworten(auftrag.s)).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!;
    assert.deepEqual(leseCodeAntwort(ende.content, "auftrag"), { aktion: "auftrag", ende: "fertig", schritte: 1, abschluss: "Fertig: a.txt angelegt." });
    // Umschläge tragen zufällige Zeitstempel (NIP-59) – die Reihenfolge im Relay sagt nichts, es zählt `nr` und `art`
    assert.deepEqual((await schritte()).map((s) => s && `${s.nr}:${s.art}`).sort(), ["1:ausgabe", "1:befehl"]);
    const stopp = await schicke({ aktion: "stopp", lauf: auftrag.requestId });
    await provider.pollOnce();
    assert.deepEqual(leseCodeAntwort((await antworten(stopp.s)).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "stopp"), { aktion: "stopp", ok: false });
  } finally {
    Object.assign(console, alt);
  }
  assert.equal((await relay.query({ kinds: [7000, KIND_DVM_KNOTEN_CODE + 1000] })).length, 0, "nie offen");
  const alles = log.join("\n");
  assert.ok(!/echo hallo|a\.txt|Lege a|Ich lege/.test(alles), "weder Befehl noch Ausgabe noch Auftrag im Log");
  assert.match(alles, /\[code\] Lauf [0-9a-f]{8}: fertig, 1 Schritt\(e\)/);
});
