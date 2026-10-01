/**
 * Ohne sicheren Kontext (B-10b): Kommt die App über http im Heimnetz vom
 * eigenen Knoten (B-10a), gibt der Browser kein `crypto.subtle` frei. Tresor
 * und Bundles sagen das, statt mit einer fremden Meldung zu scheitern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verschluesselungMoeglich } from "../src/sicherer-kontext.js";
import { BundleFehler, leseBundle } from "../src/git-bundle.js";
import { repos } from "../src/texte/repos.js";
import { einstieg } from "../src/texte/einstieg.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const subtle = { importKey() {}, digest() {} };

test("B-10b: verschluesselungMoeglich – nur im sicheren Kontext mit crypto.subtle", () => {
  assert.equal(verschluesselungMoeglich(), true, "Node: wie https");
  assert.equal(verschluesselungMoeglich({ isSecureContext: true, crypto: { subtle } }), true);
  assert.equal(verschluesselungMoeglich({ crypto: { subtle } }), true, "ohne Angabe (Node) zählt, was da ist");
  assert.equal(verschluesselungMoeglich({ isSecureContext: false, crypto: { subtle } }), false, "http im Heimnetz");
  assert.equal(verschluesselungMoeglich({ isSecureContext: true, crypto: {} }), false, "so im Browser gesehen: subtle fehlt");
  assert.equal(verschluesselungMoeglich({ isSecureContext: true, crypto: { subtle: { digest() {} } } }), false);
  assert.equal(verschluesselungMoeglich({}), false);
});

test("B-10b: Tresor – ohne sicheren Kontext ein Hinweis statt des Dialogs, nichts wird angelegt", () => {
  const tresor = lies("shell/tresor.ts");
  const fn = tresor.slice(tresor.indexOf("export function richteTresorEin("), tresor.indexOf("export async function verlangeTresor("));
  const pruefung = fn.indexOf("if (!verschluesselungMoeglich()) {");
  assert.ok(pruefung > fn.indexOf("if (tresorEingerichtet())"), "ein eingerichteter Tresor bleibt die erste Antwort");
  assert.ok(pruefung < fn.indexOf("const box = dialog("), "vor dem Dialog für die Passphrase");
  assert.ok(pruefung < fn.indexOf("createVault("), "vor dem Anlegen");
  assert.match(fn.slice(pruefung, pruefung + 300), /return hinweis\(t\("ein\.tresorAktion"\), text\)\.then\(\(\) => false\);/, "danach: nicht eingerichtet");
  assert.match(fn, /const text = grund \? `\$\{grund\}\\n\\n\$\{t\("ein\.tresorUnsicher"\)\}` : t\("ein\.tresorUnsicher"\);/, "wer den Tresor verlangt (Wallet), nennt den Grund dazu");
  const satz = einstieg["ein.tresorUnsicher"]!;
  for (const s of [satz.de, satz.en]) assert.match(s, /\.onion/, "nennt die sicheren Wege");
  assert.match(satz.de, /https.*\.onion.*localhost/);
});

test("B-10b: Bundles – ohne crypto.subtle eine eigene Kennung mit Text, nie eine fremde Meldung", async () => {
  const bundle = new Uint8Array(readFileSync(new URL("fixtures/probe-v2.bundle", import.meta.url)));
  const echt = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try {
    await assert.rejects(leseBundle(bundle), (e) => e instanceof BundleFehler && e.art === "unsicher");
  } finally {
    Object.defineProperty(globalThis, "crypto", echt);
  }
  assert.ok((await leseBundle(bundle)).objekte.size > 0, "mit crypto.subtle wie bisher");
  assert.match(lies("shell/tabs/code-reiter.ts"), /unsicher: "repo\.bundleUnsicher",/);
  const satz = repos["repo.bundleUnsicher"]!;
  assert.ok(satz.de && satz.en);
});
