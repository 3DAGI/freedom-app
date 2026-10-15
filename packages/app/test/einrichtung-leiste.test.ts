/**
 * Schritt C-39a (Nutzertest E-1, E-7): Die Onboarding-Leiste und die Einrichtung. Im Browser prüft es
 * der Smoke-Test „einrichtung_wahl“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang } from "../src/i18n.js";
import { hinweisSeite, nextStep, type Readiness } from "../src/onboarding.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const neu: Readiness = { hasIdentity: true, backedUp: false, hasVault: false, hasWallet: false, hasUsedOnce: false, gratisErschoepft: false };

test("die Wahl aus der Einrichtung zählt ab dem ersten Schritt", () => {
  setLang("de");
  const schreiben = nextStep(neu, "kommunizieren");
  assert.equal(schreiben.id, "los-chat");
  assert.equal(schreiben.title, "Schreib jemandem");
  assert.equal(schreiben.action, undefined, "seit C-43 steht die Karte schon in den Chats – kein Knopf, der nur hinführt");
  assert.match(schreiben.body, /Profil › Teilen/);
  assert.equal(nextStep(neu, "verdienen").id, "provider-anleitung");
  // Ohne Wahl und mit „KI fragen“ wie bisher
  assert.equal(nextStep(neu).id, "los");
  assert.equal(nextStep(neu, "nutzen").id, "los");
  // Nach der ersten Nutzung geht die Sicherung vor – gleich, was gewählt war
  for (const intent of ["kommunizieren", "verdienen", "nutzen"] as const) assert.equal(nextStep({ ...neu, hasUsedOnce: true }, intent).id, "sichern");
});

test("die Karte steht in den Nachrichten (seit C-43 statt eines Knopfs dorthin); die erste Nachricht ist die erste Nutzung", () => {
  assert.equal(hinweisSeite("los-chat", "kommunizieren"), "comm");
  const app = quelle("../src/shell/app.ts");
  assert.doesNotMatch(app, /schritt\.id === "los-chat"/);
  const komm = quelle("../src/shell/tabs/kommunikation.ts");
  assert.match(komm, /if \(localStorage\.getItem\("freedom\.usedOnce"\) !== "1"\) \{\n\s+localStorage\.setItem\("freedom\.usedOnce", "1"\);\n\s+void zeigeOnboarding\(\);/);
});

test("während der Einrichtung keine Leiste – auch nicht von einem Aufruf, der vorher begann", () => {
  const ui = quelle("../src/shell/einrichtung-ui.ts");
  assert.match(ui, /laeuft = true;\n\s+document\.getElementById\("onboarding-bar"\)\?\.classList\.add\("hidden"\);/);
  const app = quelle("../src/shell/app.ts");
  const leiste = app.slice(app.indexOf("export async function zeigeOnboarding"), app.indexOf("const bu = backupStatus();"));
  // Erst nach dem Laden prüfen – sonst zeichnet ein Aufruf vom Start die Leiste neben die Merkphrase
  assert.ok(leiste.indexOf("if (einrichtungLaeuft())") > leiste.indexOf('await import("../identity.js")'));
});
