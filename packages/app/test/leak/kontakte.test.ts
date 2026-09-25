/**
 * Leak-Szenario „Kontaktliste“ (Schritt 2.5b): Die App veroeffentlicht die
 * Kontakte nur, wenn der Nutzer es einschaltet (Standard aus) – und dann als
 * NIP-51-Liste mit allen Eintraegen verschluesselt an sich selbst, so gebaut
 * wie `sichereKontakte()` in `tabs/kommunikation.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  D_KONTAKTE, LocalSigner, buildPrivateKontaktliste, generateKeypair, oeffnePrivateKontaktliste, regelKeinKlartext,
  regelPTagsNur,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

test("Kontaktliste: nur verschluesselt, kein Kontakt und kein Name offen", async () => {
  const { pool, relay } = aufzeichnung();
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = [{ pk: generateKeypair().pk, name: "Dr. Weber (Therapie)" }, { pk: generateKeypair().pk, name: "Anwältin Kaya" }];
  const ev = await ich.signEvent(await buildPrivateKontaktliste(kontakte, ich));
  await pool.publish(ev);
  const g = relay.gesendet;
  assert.deepEqual(g.map((e) => e.kind), [30000]);
  assert.deepEqual(g[0].tags, [["d", D_KONTAKTE]]);
  assert.deepEqual(regelPTagsNur(g, []), []);
  assert.deepEqual(regelKeinKlartext(g, kontakte.flatMap((k) => [k.pk, k.name])), []);
  assert.deepEqual(await oeffnePrivateKontaktliste(g[0], ich), kontakte, "auf dem anderen Geraet wieder lesbar");
});

test("Verdrahtung: Standard aus, nur bei Aenderung gesichert, beim Ausschalten geleert, beim Abgleich geladen", () => {
  const kom = readFileSync(new URL("../../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  const set = readFileSync(new URL("../../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  const f = kom.slice(kom.indexOf("export async function sichereKontakte("), kom.indexOf("export async function ladeKontakte("));
  assert.match(f, /if \(!state\.signer \|\| \(!leeren && \(!kontakteSichernAn\(\) \|\| gesicherterStand === null\)\)\) return;/);
  assert.match(f, /if \(stand === gesicherterStand\) return;/);
  assert.match(f, /await signiere\(await buildPrivateKontaktliste\(kontakte, state\.signer\)\)/);
  assert.match(kom, /return localStorage\.getItem\(LS_KONTAKTE_SICHERN\) === "1";/);
  assert.match(kom, /void sichereKontakte\(\)\.catch/);
  assert.match(kom, /let neu = await ladeKontakte\(\)\.catch\(\(\) => 0\);/);
  assert.match(set, /await sichereKontakte\(true\);/);
  // Nur der Schalter schaltet ein – genau eine Stelle, und zuerst wird geladen, dann gesichert
  const ein = (kom + set).match(/setItem\(LS_KONTAKTE_SICHERN, "1"\)/g) ?? [];
  assert.equal(ein.length, 1);
  assert.match(set, /if \(kontakte\.checked\) \{\s*const neu = await kontakteEinschalten\(\);/);
  const e = kom.slice(kom.indexOf("export async function kontakteEinschalten("), kom.indexOf("export async function ladeKontakte("));
  assert.ok(e.indexOf("await ladeKontakte()") < e.indexOf("await sichereKontakte()"), "erst holen, dann sichern");
  assert.match(e, /localStorage\.removeItem\(LS_KONTAKTE_SICHERN\);\s*throw e;/, "scheitert das Laden, bleibt es aus");
  const html = readFileSync(new URL("../../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<input type="checkbox" id="kontakte-sichern" \/>/, "nicht vorab angehakt");
});
