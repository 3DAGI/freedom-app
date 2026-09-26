/**
 * Schritt 8.9b: Git-Bundles verschluesselt, der Schluessel steht oeffentlich
 * in der Referenz (Entscheidung 26.09.2026).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGitRepoRef, parseGitRepoRef } from "../src/git.js";
import { entschluesseleDatei, verschluesseleDatei } from "../src/datei-krypto.js";
import { generateKeypair, signEvent } from "../src/event.js";

const ICH = generateKeypair();
const basis = { name: "demo", blobId: "ab".repeat(32), headSha: "local", branch: "main", message: "bundle", version: 1 };

test("8.9b: Referenz traegt den oeffentlichen Schluessel – wer sie liest, kann das Bundle oeffnen", () => {
  const bundle = new TextEncoder().encode("# v2 git bundle\n");
  const { chiffrat, schluessel } = verschluesseleDatei(bundle);
  const ev = signEvent(buildGitRepoRef({ ...basis, schluessel }, ICH.pk), ICH.sk);
  assert.deepEqual(ev.tags.find((t) => t[0] === "aes-gcm"), ["aes-gcm", schluessel.key, schluessel.nonce, schluessel.ox]);
  const r = parseGitRepoRef(ev);
  assert.deepEqual(r.schluessel, schluessel);
  assert.deepEqual(entschluesseleDatei(chiffrat, r.schluessel!), bundle);
});

test("8.9b: aeltere Referenzen ohne Schluessel und unsinnige Schluessel", () => {
  assert.equal(parseGitRepoRef(signEvent(buildGitRepoRef(basis, ICH.pk), ICH.sk)).schluessel, undefined);
  const kaputt = signEvent({ ...buildGitRepoRef(basis, ICH.pk), tags: [...buildGitRepoRef(basis, ICH.pk).tags, ["aes-gcm", "zz", "kurz", "x"]] }, ICH.sk);
  assert.equal(parseGitRepoRef(kaputt).schluessel, undefined);
});
