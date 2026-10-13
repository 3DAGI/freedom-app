/**
 * Lizenz (Entscheidung LIZ, MENSCH 09.10.2026: EUPL-1.2). Der Wortlaut in
 * `LICENSE` ist der amtliche englische Text – gegen SPDX und choosealicense
 * verglichen – und wird nie bearbeitet. Jedes Paket nennt dieselbe Lizenz.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const wurzel = new URL("../../../", import.meta.url);
const lies = (pfad: string) => readFileSync(new URL(pfad, wurzel), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** SHA-256 von `LICENSE`, wie mit LIZ angelegt (Text von choosealicense, Wortlaut gleich SPDX). */
const LICENSE_SHA256 = "2684098cbd7501a84c93cd947f3b32ad01eb955b20a43ad62ab4455eed4d1410";

test("LIZ: LICENSE ist der unveränderte Text der EUPL-1.2 – eine geänderte Stelle fällt auf", () => {
  const text = lies("LICENSE");
  assert.match(text, /^\s*EUROPEAN UNION PUBLIC LICENCE v\. 1\.2\n/);
  for (const teil of ["14. Jurisdiction", "15. Applicable Law", "Appendix", "Legal Protection:"]) {
    assert.ok(text.includes(teil), teil);
  }
  assert.equal(sha256(text), LICENSE_SHA256);
  // Gegenprobe: schon ein anderes Wort ergibt eine andere Summe
  assert.notEqual(sha256(text.replace("Belgian law", "Austrian law")), LICENSE_SHA256);
});

test("LIZ: jedes Paket und die Sperrdatei nennen EUPL-1.2, die README den Hinweis nach der EUPL", () => {
  const pakete = ["package.json", ...readdirSync(new URL("packages/", wurzel))
    .map((n) => `packages/${n}/package.json`)
    .filter((p) => existsSync(new URL(p, wurzel)))];
  assert.ok(pakete.length >= 5, pakete.join(", "));
  for (const p of pakete) assert.equal(JSON.parse(lies(p)).license, "EUPL-1.2", p);
  const sperre = JSON.parse(lies("package-lock.json")).packages as Record<string, { license?: string }>;
  for (const p of pakete) {
    const schluessel = p === "package.json" ? "" : p.replace(/\/package\.json$/, "");
    assert.equal(sperre[schluessel]?.license, "EUPL-1.2", `package-lock.json: ${schluessel || "(Wurzel)"}`);
  }
  const readme = lies("README.md");
  assert.ok(readme.includes("Licensed under the EUPL"), "Hinweis nach der EUPL (vor ihrem Artikel 1)");
  assert.ok(readme.includes("[`LICENSE`](LICENSE)"));
});
