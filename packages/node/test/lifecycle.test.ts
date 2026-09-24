/**
 * Tests fuer Dauerbetrieb und Update.
 *
 * Der Schwerpunkt liegt auf dem, was einen Provider Kunden kostet: ein
 * Neustart mitten im Job, ein Update, das nie durchkommt, und eines, das den
 * Knoten kaputt zurueck laesst.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DrainController, compareVersions, decideUpdate, performUpdate,
  buildAvailabilityTags, UpdateHooks,
} from "../src/lifecycle.js";

const NOW = 1_800_000_000;
const STUNDE = 3600;

// ------------------------------------------------------------- Entleeren

test("Ohne laufende Jobs ist sofort Schluss", () => {
  const d = new DrainController();
  assert.equal(d.beginDrain(NOW), true);
  assert.equal(d.state(NOW).phase, "bereit");
});

test("Laufender Job verhindert den Neustart", () => {
  // Der Kunde hat bezahlt oder wartet. Einmal abgeschnitten reicht, damit er
  // beim naechsten Mal einen anderen Provider nimmt.
  const d = new DrainController();
  d.jobStarted("job1");
  assert.equal(d.beginDrain(NOW), false);
  assert.equal(d.state(NOW).phase, "entleert");
  assert.equal(d.state(NOW).inFlight, 1);
});

test("Nach dem letzten Job wird freigegeben", () => {
  const d = new DrainController();
  d.jobStarted("a");
  d.jobStarted("b");
  d.beginDrain(NOW);
  d.jobFinished("a", NOW);
  assert.equal(d.state(NOW).phase, "entleert");
  d.jobFinished("b", NOW);
  assert.equal(d.state(NOW).phase, "bereit");
});

test("Waehrend des Entleerens werden keine neuen Jobs angenommen", () => {
  const d = new DrainController();
  assert.equal(d.accepting, true);
  d.jobStarted("a");
  d.beginDrain(NOW);
  assert.equal(d.accepting, false);
});

test("Ein knapp vorher angenommener Job wird trotzdem zu Ende gebracht", () => {
  // Zwischen Annahme und Umschaltung liegen Millisekunden — dieser Job darf
  // nicht unter den Tisch fallen.
  const d = new DrainController();
  d.beginDrain(NOW);
  d.jobStarted("spaet");
  assert.equal(d.state(NOW).inFlight, 1);
  assert.equal(d.check(NOW).phase, "bereit", "beginDrain war schon durch");
});

test("Haengender Job blockiert das Update nicht ewig", () => {
  // Ein Update, das nie durchkommt, ist schlimmer als eines mit Ausfall.
  const d = new DrainController({ maxDrainSeconds: 60 });
  d.jobStarted("haengt");
  d.beginDrain(NOW);
  assert.equal(d.check(NOW + 30).phase, "entleert");
  const spaet = d.check(NOW + 90);
  assert.equal(spaet.phase, "bereit");
  // Nicht still abschneiden — das saehe aus wie ein Absturz.
  assert.match(spaet.message, /abgebrochen/);
});

test("Phasenwechsel wird gemeldet", () => {
  const gemeldet: string[] = [];
  const d = new DrainController({ onPhase: (s) => gemeldet.push(s.phase) });
  d.jobStarted("a");
  d.beginDrain(NOW);
  d.jobFinished("a", NOW);
  assert.deepEqual(gemeldet, ["entleert", "bereit"]);
});

test("Verfuegbarkeit wird fuers Netz gemeldet", () => {
  // Ein Knoten, der neu startet ohne es zu sagen, sieht fuer Clients aus wie
  // einer, der Jobs verschluckt.
  const d = new DrainController();
  assert.deepEqual(buildAvailabilityTags(d.state(NOW))[0], ["availability", "online"]);
  d.jobStarted("a");
  d.beginDrain(NOW);
  assert.deepEqual(buildAvailabilityTags(d.state(NOW))[0], ["availability", "draining"]);
});

// ------------------------------------------------------------- Versionen

test("Versionen werden numerisch verglichen, nicht als Text", () => {
  // "0.10.0" < "0.9.0" waere textuell richtig und sachlich falsch.
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("v2.0.0", "1.99.99"), 1);
});

const manifest = (version: string, at: number, signer = "gut") =>
  ({ version, sha256: "a".repeat(64), sources: ["https://x/app"], releasedAt: at, signerPubkey: signer });

test("Kein Update ohne neuere Version", () => {
  const d = decideUpdate([manifest("1.0.0", NOW - 99 * STUNDE)], { current: "1.0.0", trustedSigners: ["gut"] }, NOW);
  assert.equal(d.shouldUpdate, false);
});

test("Ganz frische Releases werden noch nicht uebernommen", () => {
  // Wer sofort aktualisiert, ist der Erste, den ein fehlerhaftes Release
  // trifft — und bei einem kompromittierten Schluessel der Erste, den es
  // erwischt.
  const d = decideUpdate([manifest("1.1.0", NOW - STUNDE)], { current: "1.0.0", trustedSigners: ["gut"] }, NOW);
  assert.equal(d.shouldUpdate, false);
  assert.match(d.reason, /Erste, den ein Fehler trifft/);
});

test("Nach der Wartezeit wird uebernommen", () => {
  const d = decideUpdate([manifest("1.1.0", NOW - 48 * STUNDE)], { current: "1.0.0", trustedSigners: ["gut"] }, NOW);
  assert.equal(d.shouldUpdate, true);
  assert.equal(d.target!.version, "1.1.0");
});

test("Releases fremder Signierer werden ignoriert", () => {
  const d = decideUpdate(
    [manifest("9.9.9", NOW - 99 * STUNDE, "angreifer")],
    { current: "1.0.0", trustedSigners: ["gut"] }, NOW,
  );
  assert.equal(d.shouldUpdate, false);
});

test("Hoechste reife Version gewinnt, nicht die zuletzt veroeffentlichte", () => {
  // Eine spaeter veroeffentlichte niedrigere Version waere ein Rueckschritt.
  const d = decideUpdate([
    manifest("1.2.0", NOW - 100 * STUNDE),
    manifest("1.1.0", NOW - 30 * STUNDE),
  ], { current: "1.0.0", trustedSigners: ["gut"] }, NOW);
  assert.equal(d.target!.version, "1.2.0");
});

test("patchOnly haelt groessere Spruenge zurueck", () => {
  const d = decideUpdate(
    [manifest("2.0.0", NOW - 99 * STUNDE)],
    { current: "1.0.0", trustedSigners: ["gut"], patchOnly: true }, NOW,
  );
  assert.equal(d.shouldUpdate, false);
  assert.match(d.reason, /Konfiguration ändern/);

  const patch = decideUpdate(
    [manifest("1.0.5", NOW - 99 * STUNDE)],
    { current: "1.0.0", trustedSigners: ["gut"], patchOnly: true }, NOW,
  );
  assert.equal(patch.shouldUpdate, true);
});

// ------------------------------------------------------------- Ausfuehrung

const ziel = { version: "1.1.0", sha256: "b".repeat(64), sources: ["https://a/x", "https://b/x"], releasedAt: NOW };

function hooks(over: Partial<UpdateHooks> = {}): UpdateHooks & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async download() { return { sha256: "b".repeat(64), path: "/tmp/neu" }; },
    async install() { log.push("installiert"); },
    async backup() { log.push("gesichert"); return "/tmp/sicherung"; },
    async restore() { log.push("zurueckgestellt"); },
    ...over,
  };
}

test("Erfolgreiches Update sichert vorher", async () => {
  const h = hooks();
  const r = await performUpdate(ziel, h);
  assert.equal(r.ok, true);
  assert.deepEqual(h.log, ["gesichert", "installiert"], "Sicherung VOR der Installation");
});

test("Falsche Pruefsumme wird NICHT installiert", async () => {
  // Eine Bezugsquelle kann kompromittiert sein; das Manifest liegt auf den
  // Relays und nicht beim Anbieter der Datei.
  const h = hooks({ async download() { return { sha256: "f".repeat(64), path: "/tmp/boese" }; } });
  const r = await performUpdate(ziel, h);
  assert.equal(r.ok, false);
  assert.match(r.message, /Prüfsumme weicht ab/);
  assert.ok(!h.log.includes("installiert"));
});

test("Bei einer kaputten Quelle wird die naechste probiert", async () => {
  let erster = true;
  const h = hooks({
    async download(q) {
      if (erster) { erster = false; throw new Error(`${q} nicht erreichbar`); }
      return { sha256: "b".repeat(64), path: "/tmp/neu" };
    },
  });
  assert.equal((await performUpdate(ziel, h)).ok, true);
});

test("Fehlgeschlagene Installation wird zurueckgerollt", async () => {
  const h = hooks({ async install() { throw new Error("Platte voll"); } });
  const r = await performUpdate(ziel, h);
  assert.equal(r.ok, false);
  assert.ok(h.log.includes("zurueckgestellt"));
  assert.match(r.message, /alter Stand wiederhergestellt/);
});

test("Wenn auch der Rueckweg scheitert, steht es klar da", async () => {
  // Der schlimmste Fall gehoert benannt statt beschoenigt — mit dem Pfad der
  // Sicherung, damit jemand von Hand retten kann.
  const h = hooks({
    async install() { throw new Error("Platte voll"); },
    async restore() { throw new Error("Sicherung unlesbar"); },
  });
  const r = await performUpdate(ziel, h);
  assert.match(r.message, /UND Rückweg fehlgeschlagen/);
  assert.match(r.message, /\/tmp\/sicherung/);
});

test("Alle Quellen tot: Fehler nennt jede einzeln", async () => {
  const h = hooks({ async download(q) { throw new Error(`${q} tot`); } });
  const r = await performUpdate(ziel, h);
  assert.equal(r.ok, false);
  assert.match(r.message, /https:\/\/a\/x/);
  assert.match(r.message, /https:\/\/b\/x/);
});
