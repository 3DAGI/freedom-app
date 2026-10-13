/**
 * Schritt C-37 (Nutzertest P-1, P-2, P-3): Kleinigkeiten im Profil. Im Browser prüft es der
 * Smoke-Test „profil_klein“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";
import { encodeNpub } from "../src/identity.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const html = quelle("../src/shell/index.html");
const css = quelle("../src/shell/app.css");
const app = quelle("../src/shell/app.ts");

test("Schlüssel und „Importieren“ in einer Karte mit Überschrift und einem Satz dazu", () => {
  assert.match(html, /<div class="card" id="ident-karte">\n\s+<h3><span class="ic" data-icon="user"><\/span> <span data-i18n="profil\.identitaet">Identität<\/span><\/h3>\n\s+<p class="mono-sm" data-i18n="profil\.identText">[^<]+<\/p>\n\s+<div class="ident-row">/);
  setLang("de");
  assert.equal(t("profil.identitaet"), "Identität");
  // Der Satz sagt, was der Klick tut – er kopiert den privaten Schlüssel (exportIdentity)
  assert.match(t("profil.identText"), /kopiert den privaten Schlüssel – nur zum Sichern, nie weitergeben/);
  assert.match(app, /nbIdent\.onclick = exportIdentity;/);
  setLang("en");
  assert.equal(t("profil.identitaet"), "Identity");
});

test("„Teilen“ kopiert den npub – derselbe Schlüssel, unter dem das Profil hinausgeht", () => {
  const teilen = app.slice(app.indexOf('getElementById("profile-share")'), app.indexOf("const ziele: Record<string, string>"));
  assert.match(teilen, /const npub = encodeNpub\(state\.keypair\.pk\);/);
  assert.match(teilen, /navigator\.clipboard\.writeText\(npub\)/);
  assert.match(teilen, /wert: npub \}/, "auch im Dialog ohne Zwischenablage");
  assert.doesNotMatch(teilen, /writeText\(state\.keypair\.pk\)/);
  assert.match(quelle("../src/shell/tabs/profil.ts"), /buildProfile\(state\.keypair\.pk,/);
  const npub = encodeNpub("ab".repeat(32));
  assert.match(npub, /^npub1[02-9ac-hj-np-z]{58}$/);
  setLang("de");
  assert.equal(t("ein.pubkeyKopiert"), "Öffentlicher Schlüssel (npub) kopiert");
});

test("Name im Profilkopf so, wie er ist – `.card h3` setzt sonst Großbuchstaben", () => {
  assert.match(css, /\.card h3 \{\n\s+font-size: 11px; text-transform: uppercase;/);
  assert.match(css, /\.profile-text h3 \{ margin: 0 0 3px; font-size: 16px; text-transform: none; letter-spacing: normal; \}/);
  // Die spätere Regel gewinnt bei gleicher Spezifität
  assert.ok(css.indexOf(".profile-text h3 {") > css.indexOf(".card h3 {"));
});
