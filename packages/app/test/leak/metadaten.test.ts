/**
 * Leak-Szenario „Metadaten“ (Schritt 2.5): eine DM mit Ablauf nach NIP-40, so
 * gebaut wie `sendChatMessage()` – ueber den Signer, mit `ablaufSecs` der
 * Unterhaltung. Der Umschlag traegt nur Empfaenger und (verschobenen) Ablauf.
 * Dazu die Wache: Die App veroeffentlicht keine Reaktionen, Lesebestaetigungen,
 * Tippanzeigen oder Kontaktlisten – sie gibt es nicht, und offen soll es sie
 * nie geben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  LocalSigner, buildPrivateDm, generateKeypair, openPrivateDm, regelAutorNicht, regelKeinKind4, regelKeinKlartext,
  regelPTagsNur,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

const TEXT = "Wir treffen uns heimlich um acht";

test("DM mit Ablauf: Umschlag nur mit Empfaenger und Ablauf, sonst nichts", async () => {
  const { pool, relay } = aufzeichnung();
  const ich = new LocalSigner(generateKeypair().sk);
  const du = generateKeypair().pk;
  const dm = await buildPrivateDm({ signer: ich, recipientPk: du, content: TEXT, ablaufSecs: 86_400 });
  await pool.publish(dm.toRecipient);
  await pool.publish(dm.toSelf);
  const g = relay.gesendet;
  assert.deepEqual(g.map((e) => e.kind), [1059, 1059]);
  for (const e of g) assert.deepEqual(e.tags.map((t) => t[0]).sort(), ["expiration", "p"]);
  assert.deepEqual(regelKeinKlartext(g, [TEXT]), []);
  assert.deepEqual(regelAutorNicht(g, ich.publicKey()), []);
  assert.deepEqual(regelPTagsNur(g, [du, ich.publicKey()]), []);
  assert.deepEqual(regelKeinKind4(g), []);
  // Der Empfaenger sieht den exakten Ablauf, die App blendet danach aus.
  const r = await openPrivateDm(dm.toRecipient, new LocalSigner(generateKeypair().sk));
  assert.equal(r.ok, false, "Fremde oeffnen nichts");
});

test("Verdrahtung: Ablauf je Unterhaltung beim Senden, Ausblenden beim Laden, Bericht", () => {
  const kom = readFileSync(new URL("../../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  const senden = kom.slice(kom.indexOf("export async function sendChatMessage("));
  assert.match(senden, /\.\.\.\(c\.ablaufSecs \? \{ ablaufSecs: c\.ablaufSecs \} : \{\}\)/);
  const laden = kom.slice(kom.indexOf("async function ladeDmNachrichten("), kom.indexOf("async function veroeffentlicheDm("));
  assert.match(laden, /if \(e && e\.partner === partner && !dmAbgelaufen\(e\.dm\)\)/);
  const app = readFileSync(new URL("../../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /ablaufSel\.onchange = \(\) => setzeAblauf\(ablaufSel\.value\)/);
  const bericht = readFileSync(new URL("../../src/shell/datenschutz.ts", import.meta.url), "utf8");
  assert.match(bericht, /expiringMessages: alleDmsLaufenAb\(\),/);
  assert.doesNotMatch(bericht, /freedom\.expiry/, "die alte Einstellung gab es nie");
});

test("Wache: keine offenen Reaktionen, Lesebestaetigungen, Tippanzeigen oder Kontaktlisten", () => {
  const dateien: string[] = [];
  const sammle = (dir: string): void => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) sammle(p);
      else if (p.endsWith(".ts")) dateien.push(p);
    }
  };
  sammle(new URL("../../src", import.meta.url).pathname);
  const funde: string[] = [];
  for (const f of dateien) {
    const q = readFileSync(f, "utf8");
    // Kind 3 (Kontakte), 7 (Reaktion), 10000/30000 (NIP-51-Listen) als Event bauen
    if (/buildEvent\([^,()]+,\s*(3|7|10000|30000)\s*,/.test(q)) funde.push(`${f}: Kind 3/7/10000/30000`);
    if (/kind:\s*(3|7)\s*[,}]/.test(q)) funde.push(`${f}: kind 3/7`);
    // Tipp- oder Lese-Signal als Tag eines Events (eine CSS-Klasse "typing" zaehlt nicht)
    if (/\[\s*["'](typing|read_receipt|receipt)["']/.test(q)) funde.push(`${f}: Tipp-/Lese-Tag`);
  }
  assert.deepEqual(funde, []);
});
