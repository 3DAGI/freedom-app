/**
 * Schritt C-8 (C.6a, Rest von B14, Entscheidung E2): reines Verschieben.
 * Settings › Gebühren (Aufteilung, Anteile, Standard-Schiene) steht unter
 * Währung › Zahlen, der Reiter „Liquidität“ heißt „Hinterlegen“, „Modell
 * vorhalten/ankündigen“ steht unter Verdienen › Hosten. Die Bedienelemente
 * behalten ihre Kennungen – die Verdrahtung bleibt, wo sie war.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");

/** Inhalt eines Unter-Reiters bis zum nächsten (oder bis zum Ende der Seite). */
function bereich(name: string): string {
  const a = html.indexOf(`data-subpane="${name}"`);
  assert.ok(a > 0, name);
  const naechster = html.indexOf('class="subpane', a);
  const seitenEnde = html.indexOf("</section>", a);
  return html.slice(a, naechster > 0 && naechster < seitenEnde ? naechster : seitenEnde);
}
const reiter = (gruppe: string) => {
  const a = html.indexOf(`data-subtab-group="${gruppe}"`);
  return html.slice(a, html.indexOf("</div>", a));
};

test("C-8: Währung › Zahlen hat Aufteilung, fällige Anteile und Standard-Schiene – die Settings haben keine Gebühren mehr", () => {
  assert.match(reiter("wallet"), /data-subtab="lp" data-i18n="waehr\.tabHinterlegen">Hinterlegen<\/button><button role="tab" data-subtab="pay" data-i18n="waehr\.tabZahlen">Zahlen<\/button>/);
  const zahlen = bereich("wallet:pay");
  for (const id of ["anteile-stand", "anteile-zahlen", "standard-schiene"]) assert.match(zahlen, new RegExp(`id="${id}"`), id);
  assert.match(zahlen, /data-i18n="set\.aufteilungText"/);
  assert.doesNotMatch(reiter("settings"), /data-subtab="fees"/);
  assert.doesNotMatch(html, /data-subpane="settings:fees"/);
  // Jede Kennung genau einmal – sonst fände getElementById die alte Stelle
  for (const id of ["anteile-stand", "anteile-zahlen", "standard-schiene", "models-seed", "models-publish"]) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
  }
});

test("C-8: Hinterlegen behält Deposit und Zahlkanal; Modell vorhalten und ankündigen unter Verdienen › Hosten", () => {
  const hinterlegen = bereich("wallet:lp");
  for (const id of ["dep-start", "dep-refund", "kanal-karte", "kanal-start"]) assert.match(hinterlegen, new RegExp(`id="${id}"`), id);
  const hosten = bereich("earn:host");
  assert.match(hosten, /data-i18n="earn\.modelleTitel"/);
  for (const id of ["models-seed", "models-publish"]) {
    assert.match(hosten, new RegExp(`id="${id}"`), id);
    assert.doesNotMatch(bereich("agent:models"), new RegExp(`id="${id}"`), id);
  }
  // Die Liste der Modelle bleibt beim Agenten, die Knöpfe verdrahtet app.ts wie bisher über die Kennung
  assert.match(bereich("agent:models"), /id="models-list"/);
  assert.match(app, /const modelsSeed = \$\("#models-seed"\);/);
  assert.match(app, /void wireGebuehrenKarte\(\);/);
});

test("C-8: neue Beschriftungen mit neuen Schlüsseln, die Texte nennen den neuen Ort", () => {
  setLang("de");
  assert.equal(t("waehr.tabHinterlegen"), "Hinterlegen");
  assert.equal(t("waehr.tabZahlen"), "Zahlen");
  assert.match(t("agent.anteilUnklar"), /Währung › Zahlen/);
  assert.match(t("agent.modelleText"), /Verdienen › Hosten/);
  setLang("en");
  assert.equal(t("waehr.tabHinterlegen"), "Deposit");
  assert.equal(t("waehr.tabZahlen"), "Pay");
  assert.match(t("agent.anteilUnklar"), /Wallet › Pay/);
  // Die FAQ der Website sagt dasselbe
  const faq = readFileSync(new URL("../../website/faq.html", import.meta.url), "utf8");
  assert.match(faq, /bis dahin bleibt das Geld bei dir \(Währung → Zahlen\)/);
  assert.doesNotMatch(faq, /Settings → Gebühren/);
});
