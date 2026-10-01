/**
 * Barrierefreiheit (Schritt C-4, Sammlung C-4): Jedes Bedienelement in
 * `index.html` hat einen Namen für Vorleser, Schrift hat genug Kontrast, und
 * was anklickbar ist, geht auch mit der Tastatur. Im Browser misst der
 * Smoke-Test („zugang“) dasselbe auf jeder Seite und in jedem Unterreiter –
 * hier fällt eine neue Stelle schon ohne Browser auf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const html = quelle("../src/shell/index.html");
const css = quelle("../src/shell/app.css");

/** Eingabefelder, Auswahlen und Knöpfe ohne Namen – ein Label, `aria-label`/`data-i18n-aria` oder Text zählt. */
function ohneName(seite: string): string[] {
  const fuer = new Set([...seite.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
  const aus: string[] = [];
  for (const m of seite.matchAll(/<(input|select|textarea|button)\b([^>]*)>/g)) {
    const [, tag, attr] = m;
    if (/type="(hidden|checkbox|radio|file)"/.test(attr!)) continue;
    if (/\s(aria-label|data-i18n-aria|aria-labelledby)=/.test(attr!)) continue;
    const id = /\sid="([^"]+)"/.exec(attr!)?.[1];
    if (id && fuer.has(id)) continue;
    const vorher = seite.slice(0, m.index);
    if ((vorher.match(/<label\b/g) ?? []).length > (vorher.match(/<\/label>/g) ?? []).length) continue; // steht in einem Label
    if (tag === "button") {
      const innen = seite.slice(m.index! + m[0].length, seite.indexOf("</button>", m.index)).replace(/<[^>]+>/g, "").trim();
      if (innen || /data-i18n="/.test(attr!)) continue;
    }
    aus.push(`${tag}#${id ?? "?"}`);
  }
  return aus;
}

test("C-4: jedes Bedienelement in index.html hat einen Namen – auch Felder nur mit Platzhalter und Knöpfe nur mit Symbol", () => {
  assert.deepEqual(ohneName(html), []);
  // Die Prüfung selbst: ein Feld nur mit Platzhalter, ein Symbol-Knopf und ein Feld nur mit Tooltip fallen auf
  const probe = `<input id="a" placeholder="x"><button id="b"><span class="ic"></span></button><select id="c" title="t"></select>`
    + `<label>Name <input id="d"></label><label for="e">E</label><input id="e"><button id="f" data-i18n="x">x</button><input id="g" data-i18n-aria="k">`;
  assert.deepEqual(ohneName(probe), ["input#a", "button#b", "select#c"]);
});

test("C-4: Kontrast – Rot als Schrift heller als die Fläche Rot, nichts Lesbares über opacity gedämpft", () => {
  // #CC3333 auf #0A0A0A hat 3,9:1 – für Schrift (Fehler, Gefahr im Menü, entfernte Zeilen im Diff) ein helleres Rot
  assert.match(css, /--red-text: #E35D5D;/);
  for (const sel of [".err", "button.menue-punkt.menue-gefahr", ".diff-minus"]) {
    assert.match(css, new RegExp(`${sel.replace(/\./g, "\\.")} \\{ color: var\\(--red-text\\)`), sel);
  }
  // opacity dämpft auch die Schrift darin: gedämpft wird über die Farbe
  assert.match(css, /\.nb-val\.nb-muted \{ color: var\(--text-muted\); font-weight: 400; \}/);
  assert.doesNotMatch(css, /\.trust-marker \{[^}]*\bopacity:/, "die Stufen-Beschriftung steht im Strich");
});

test("C-4: die Identität in der Kopfzeile geht auch mit der Tastatur; keine Tab-Reihenfolge von Hand", () => {
  assert.match(html, /<span class="nb-ident" id="nb-ident" role="button" tabindex="0"/);
  const app = quelle("../src/shell/app.ts");
  assert.match(app, /nbIdent\.addEventListener\("keydown", \(e\) => \{\s*if \(e\.key === "Enter" \|\| e\.key === " "\) \{ e\.preventDefault\(\); void exportIdentity\(\); \}/);
  assert.doesNotMatch(html, /tabindex="[1-9]/, "tabindex > 0 bringt die Reihenfolge durcheinander");
  // Als Knopf ist sie auch eine Berührfläche – mobil mindestens 40 px (Regel aus C.5a, Smoke „mobil“)
  assert.match(css, /\.ident-row \.nb-ident \{ display: inline-flex; align-items: center; min-height: 40px; \}/);
  // Der Smoke-Test misst es im Browser auf jeder Seite, Desktop und Handy
  const smoke = quelle("../../../scripts/smoke_test.py");
  assert.match(smoke, /erg\["zugang"\] = zugang_pruefen\(browser,/);
  assert.match(smoke, /and erg\.get\("zugang", \{\}\)\.get\("bestanden"\) is True/);
});
