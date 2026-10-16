/**
 * Schritt C-44 (Oberflächen-Review 15.10.2026): Personen ohne Bild als Buchstabe in einem Kreis,
 * die Farbe aus dem Schlüssel. Im Browser prüft es der Smoke-Test „kontaktname“ (Liste und Kopf).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AVATAR_FARBEN, avatarFarbe, personInitiale } from "../src/avatar.js";
import { pkShort } from "../src/shell-logic.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const PK = "a3".padEnd(64, "0");

test("die Farbe kommt aus dem Schlüssel – gleich für denselben, verteilt über alle Farben", () => {
  assert.equal(avatarFarbe(PK), 0xa3 % AVATAR_FARBEN);
  assert.equal(avatarFarbe(PK), avatarFarbe(PK.toUpperCase()));
  const farben = new Set(Array.from({ length: 256 }, (_, i) => avatarFarbe(i.toString(16).padStart(2, "0") + "0".repeat(62))));
  assert.equal(farben.size, AVATAR_FARBEN);
  // Kein Schlüssel oder keiner in Hex: die erste Farbe, nie NaN
  for (const kaputt of ["", "z9", "-1", "1"]) assert.equal(avatarFarbe(kaputt), 0, kaputt);
});

test("der Buchstabe kommt nur aus dem Namen – nie aus dem Schlüssel, nie das „~“", () => {
  assert.equal(personInitiale("bea", PK), "B");
  assert.equal(personInitiale("~ada", PK), "A");
  assert.equal(personInitiale("  émile ", PK), "É");
  assert.equal(personInitiale("🦊 Fuchs", PK), "🦊");
  for (const ohne of ["", "  ", "~", pkShort(PK), PK]) assert.equal(personInitiale(ohne, PK), "?", JSON.stringify(ohne));
});

/** Kontrast nach WCAG 2.x zwischen einer Farbe in Hex und Weiß. */
function kontrastZuWeiss(hex: string): number {
  const kanal = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * kanal(0) + 0.7152 * kanal(1) + 0.0722 * kanal(2);
  return 1.05 / (l + 0.05);
}

test("acht Farben in app.css, jede mit weißer Schrift ab 4,5:1 – in Liste, Kopfzeile und Profil", () => {
  const css = quelle("../src/shell/app.css");
  for (let i = 0; i < AVATAR_FARBEN; i++) {
    const m = new RegExp(`\\.avatar\\[data-farbe="${i}"\\], header \\.ident\\[data-farbe="${i}"\\]::before, \\.profile-avatar-fallback\\[data-farbe="${i}"\\] \\{ background: (#[0-9A-F]{6}); \\}`).exec(css);
    assert.ok(m, `Farbe ${i}`);
    assert.ok(kontrastZuWeiss(m[1]!) >= 4.5, `Farbe ${i} ${m[1]} ${kontrastZuWeiss(m[1]!).toFixed(2)}:1`);
  }
  assert.doesNotMatch(css, /data-farbe="8"/);
  assert.match(css, /\.avatar \{[^}]*color: #fff;/);
  assert.match(css, /header \.ident\[data-farbe\]::before \{ color: #fff;/);
});

test("verdrahtet: Chat-Liste, Kopf der Unterhaltung, Raum-Verlauf, Mitglieder, Kopfzeile, Profil – nie ein Bild aus dem Netz", () => {
  const ui = quelle("../src/shell/ui.ts");
  const fn = ui.slice(ui.indexOf("export function avatar("), ui.indexOf("\n}\n", ui.indexOf("export function avatar(")));
  assert.match(fn, /el\("span", zeichen, `avatar \$\{klasse\}`\)/);
  assert.match(fn, /a\.dataset\.farbe = String\(avatarFarbe\(pk\)\);/);
  assert.doesNotMatch(fn, /img|src|picture/);
  assert.match(ui, /e\.dataset\.farbe = String\(avatarFarbe\(state\.keypair\?\.pk \?\? ""\)\);/);
  const komm = quelle("../src/shell/tabs/kommunikation.ts");
  assert.match(komm, /kopf\.replaceChildren\(\.\.\.\(c\?\.type === "dm" \? \[avatar\(c\.id, kontaktInitiale\(c\)\), el\("span", kontaktAnzeige\(c\), "chat-partner-name"\)\] : \[\]\)\);/);
  assert.match(komm, /zeigePartner\(conversations\.find\(\(c\) => c\.id === activeConversation\)\);/, "auch nach Umbenennen und Profilnamen");
  const raeume = quelle("../src/shell/tabs/raeume.ts");
  assert.match(raeume, /avatar\(g\.autor, g\.autor === ich \? eigeneInitiale\(\) : personInitiale\(nameVon\(g\.autor\), g\.autor\), "msg-av"\)/);
  assert.match(raeume, /avatar\(m\.pk, m\.pk === state\.keypair\?\.pk \? eigeneInitiale\(\) : personInitiale\(anzeige, m\.pk\)\)/);
  const profil = quelle("../src/shell/tabs/profil.ts");
  assert.match(profil, /avatar\.dataset\.farbe = String\(avatarFarbe\(state\.keypair\.pk\)\);/);
  assert.match(quelle("../src/shell/index.html"), /<span id="chat-partner" class="chat-partner"><\/span>/);
});
