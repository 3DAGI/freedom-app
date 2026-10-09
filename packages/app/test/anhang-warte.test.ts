/**
 * Schritt C-29 (Nutzertest C-7): „Senden“ während eines Uploads schickte den Text
 * ohne Anhang, der Anhang hing an der nächsten Nachricht. Jetzt wartet Senden auf
 * die laufenden Uploads – auch auf solche, die währenddessen dazukommen – und
 * sendet nichts, wenn einer scheitert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnhangWarte } from "../src/anhang-warte.js";

function offen(): { lauf: Promise<boolean>; fertig: (gut: boolean) => void } {
  let fertig!: (gut: boolean) => void;
  const lauf = new Promise<boolean>((r) => { fertig = r; });
  return { lauf, fertig };
}

test("ohne laufende Uploads ist sofort alles fertig", async () => {
  const w = new AnhangWarte();
  assert.equal(w.anzahl, 0);
  assert.equal(await w.alleFertig(), true);
});

test("wartet, bis jeder laufende Upload fertig ist", async () => {
  const w = new AnhangWarte();
  const a = offen(), b = offen();
  w.merke(a.lauf);
  w.merke(b.lauf);
  assert.equal(w.anzahl, 2);
  let fertig = false;
  const warten = w.alleFertig().then((gut) => { fertig = true; return gut; });
  a.fertig(true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fertig, false, "einer läuft noch");
  b.fertig(true);
  assert.equal(await warten, true);
  assert.equal(w.anzahl, 0);
});

test("ein Upload, der während des Wartens dazukommt, gehört dazu", async () => {
  const w = new AnhangWarte();
  const a = offen(), b = offen();
  w.merke(a.lauf);
  let fertig = false;
  const warten = w.alleFertig().then((gut) => { fertig = true; return gut; });
  w.merke(b.lauf);
  a.fertig(true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fertig, false, "der zweite läuft noch");
  b.fertig(true);
  assert.equal(await warten, true);
});

test("scheitert ein Upload, meldet das Warten es – auch wenn andere gelingen", async () => {
  const w = new AnhangWarte();
  const a = offen(), b = offen();
  w.merke(a.lauf);
  w.merke(b.lauf);
  const warten = w.alleFertig();
  a.fertig(false);
  b.fertig(true);
  assert.equal(await warten, false);
  assert.equal(w.anzahl, 0);
  // Danach zählt nur, was neu dazukommt
  assert.equal(await w.alleFertig(), true);
});

test("fertige Uploads verlassen die Zählung auch ohne Warten", async () => {
  const w = new AnhangWarte();
  const a = offen();
  w.merke(a.lauf);
  a.fertig(true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.anzahl, 0);
});

test("verdrahtet: jeder Anhang läuft über die Warte, Senden wartet vor dem Lesen des Felds", () => {
  const anhaenge = readFileSync(new URL("../src/shell/tabs/chat-anhaenge.ts", import.meta.url), "utf8");
  assert.match(anhaenge, /anhangWarte\.merke\(lauf\)/);
  const komm = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  const senden = komm.slice(komm.indexOf("export async function sendChatMessage"));
  const warten = senden.indexOf("anhangWarte.alleFertig()");
  const lesen = senden.indexOf("const text = input.value.trim()");
  assert.ok(warten > 0 && lesen > warten, "erst warten, dann Text und Anhänge lesen");
  // Scheitert ein Upload oder wechselt die Unterhaltung, geht nichts hinaus
  // – und unter dem Feld steht wieder, was vorgemerkt ist, nicht mehr „wird gesendet“
  assert.match(senden.slice(warten, lesen), /if \(!gut\) \{ zeigeAnhangListe\(\); toast\(t\("komm\.anhangFehlt"\), true\); return; \}/);
  assert.match(senden.slice(warten, lesen), /if \(activeConversation !== ziel\) \{ zeigeAnhangListe\(\); toast\(t\("komm\.anhangGewechselt"\), true\); return; \}/);
});
