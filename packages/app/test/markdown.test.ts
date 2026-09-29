/**
 * Schritt C-20a: Markdown für README, Issues und Kommentare. Der Leser ist
 * rein und hier getestet (Blöcke, Inline, sichere Ziele, Grenzen); gezeichnet
 * wird nur mit DOM – das prüft der Smoke-Test („raum“) im Browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MD_GRENZEN, type MdBlock, type MdInline, leseMarkdown, sicheresZiel } from "../src/markdown.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
/** Code ohne Kommentare – ein Wort im Kommentar ist kein Aufruf. */
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const text = (x: MdInline): string => x.art === "text" || x.art === "code" ? x.text : x.art === "bild" ? x.alt : x.art === "umbruch" ? "⏎" : x.kinder.map(text).join("");
/** Kurzform eines Blocks: Art und Text – so bleiben die Erwartungen lesbar. */
const kurz = (b: MdBlock): unknown => {
  switch (b.art) {
    case "ueberschrift": return [`h${b.stufe}`, b.inhalt.map(text).join("")];
    case "absatz": return ["p", b.inhalt.map(text).join("")];
    case "code": return ["code", b.sprache, b.text];
    case "zitat": return ["zitat", b.kinder.map(kurz)];
    case "linie": return ["hr"];
    case "liste": return [b.geordnet ? `ol${b.start}` : "ul", b.punkte.map((p) => [...(p.erledigt === undefined ? [] : [p.erledigt ? "[x]" : "[ ]"]), ...p.kinder.map(kurz)])];
  }
};
const md = (s: string, umbrueche = false) => leseMarkdown(s, { umbrueche }).map(kurz);
const inline = (s: string) => {
  const [b] = leseMarkdown(s);
  assert.equal(b?.art, "absatz");
  return (b as { inhalt: MdInline[] }).inhalt;
};

test("C-20a: Blöcke – Überschriften, Absätze, Listen, Aufgaben, Zitate, Code, Linien", () => {
  assert.deepEqual(md("# Werkzeug\n\nEin Probe-Repo für den Bundle-Leser.\n"), [["h1", "Werkzeug"], ["p", "Ein Probe-Repo für den Bundle-Leser."]]);
  assert.deepEqual(md("### Drei ###\nTitel\n===\nZwei\n---"), [["h3", "Drei"], ["h1", "Titel"], ["h2", "Zwei"]]);
  assert.deepEqual(md("#kein Titel\n####### auch nicht"), [["p", "#kein Titel ####### auch nicht"]]);
  assert.deepEqual(md("- eins\n- zwei\n  - drunter\n- [x] fertig\n- [ ] offen"), [["ul", [
    [["p", "eins"]], [["p", "zwei"], ["ul", [[["p", "drunter"]]]]], ["[x]", ["p", "fertig"]], ["[ ]", ["p", "offen"]],
  ]]]);
  assert.deepEqual(md("3. drei\n4. vier\n\n5) andere Art"), [["ol3", [[["p", "drei"]], [["p", "vier"]]]], ["ol5", [[["p", "andere Art"]]]]]);
  assert.deepEqual(md("- a\n\n- b\n\n  weiter in b\nfaul weiter"), [["ul", [[["p", "a"]], [["p", "b"], ["p", "weiter in b faul weiter"]]]]]);
  assert.deepEqual(md("Text\n2. kein Punkt\n- aber das"), [["p", "Text 2. kein Punkt"], ["ul", [[["p", "aber das"]]]]]);
  assert.deepEqual(md("> Zitat\nfaul\n> > tiefer"), [["zitat", [["p", "Zitat faul"], ["zitat", [["p", "tiefer"]]]]]]);
  assert.deepEqual(md("```ts\nconst x = 1;\n<b>roh</b>\n```\n\n~~~\n```\n~~~"), [["code", "ts", "const x = 1;\n<b>roh</b>"], ["code", "", "```"]]);
  assert.deepEqual(md("    eingerückt\n\n    weiter\n\nText"), [["code", "", "eingerückt\n\nweiter"], ["p", "Text"]]);
  assert.deepEqual(md("```\nohne Ende"), [["code", "", "ohne Ende"]]);
  assert.deepEqual(md("---\n* * *\n- - -"), [["hr"], ["hr"], ["hr"]]);
  assert.deepEqual(md("<div align=\"center\"><img src=\"https://x.org/a.png\"></div>"), [["p", "<div align=\"center\"><img src=\"https://x.org/a.png\"></div>"]], "rohes HTML bleibt Text");
});

test("C-20a: Inline – Betonung, Code, Umbrüche; snake_case und Escapes bleiben Text", () => {
  assert.deepEqual(inline("**fett** *kursiv* ***beides*** ~~weg~~ `x < y`").map((x) => x.art), ["fett", "text", "kursiv", "text", "fett", "text", "durch", "text", "code"]);
  const beides = inline("***beides***")[0]!;
  assert.equal(beides.art === "fett" && beides.kinder[0]!.art, "kursiv");
  const verschachtelt = inline("*a **b** c*")[0]!;
  assert.deepEqual(verschachtelt.art === "kursiv" && verschachtelt.kinder.map((x) => x.art), ["text", "fett", "text"]);
  assert.deepEqual(inline("snake_case_name und 2 * 3 * 4 und ** leer **"), [{ art: "text", text: "snake_case_name und 2 * 3 * 4 und ** leer **" }]);
  assert.deepEqual(inline("\\*kein\\* \\[Link\\](ziel) `` a`b ``"), [{ art: "text", text: "*kein* [Link](ziel) " }, { art: "code", text: "a`b" }]);
  assert.deepEqual(md("Eins\nZwei  \nDrei\\\nVier"), [["p", "Eins Zwei⏎Drei⏎Vier"]], "README: Umbruch nur hart");
  assert.deepEqual(md("Eins\nZwei", true), [["p", "Eins⏎Zwei"]], "Issue und Kommentar: jede Zeile");
});

test("C-20a: Links nur https ohne Zugangsdaten, Bilder nie mit fremdem Ziel geladen", () => {
  assert.equal(sicheresZiel("https://example.org/a"), "https://example.org/a");
  for (const boese of ["javascript:alert(1)", "http://example.org", "data:text/html,x", "https://u:p@example.org", "//example.org", "README.md", "vbscript:x"]) {
    assert.equal(sicheresZiel(boese), null, boese);
  }
  const teile = inline("[gut](https://example.org/a \"Titel\") [böse](javascript:alert(1)) [nah](docs/x.md) <https://a.org> siehe https://b.org/x. und (https://c.org/y)");
  const links = teile.filter((x) => x.art === "link").map((x) => x.art === "link" && [x.ziel, text(x)]);
  assert.deepEqual(links, [["https://example.org/a", "gut"], ["https://a.org/", "https://a.org"], ["https://b.org/x", "https://b.org/x"], ["https://c.org/y", "https://c.org/y"]]);
  assert.match(teile.map(text).join(""), /^gut böse nah https:\/\/a\.org siehe https:\/\/b\.org\/x\. und \(https:\/\/c\.org\/y\)$/, "unerlaubte Ziele bleiben als Text stehen");
  assert.deepEqual(inline("![Logo *x*](https://example.org/l.png) ![b](http://x.org/b.png)"), [
    { art: "bild", ziel: "https://example.org/l.png", alt: "Logo x" }, { art: "text", text: " " }, { art: "bild", ziel: null, alt: "b" },
  ]);
});

test("C-20a: Grenzen – Länge, Tiefe, Suchweite; fremde Texte bleiben schnell", () => {
  const lang = "a".repeat(MD_GRENZEN.zeichen + 500);
  assert.equal(text((leseMarkdown(lang)[0] as { inhalt: MdInline[] }).inhalt[0]!).length, MD_GRENZEN.zeichen);
  // Tiefer als erlaubt: der Rest bleibt Text, nichts läuft über
  let b = leseMarkdown(`${"> ".repeat(50)}tief`)[0]!;
  let stufen = 0;
  while (b.art === "zitat") {
    stufen++;
    b = b.kinder[0]!;
  }
  assert.equal(stufen, MD_GRENZEN.tiefe);
  assert.equal(b.art === "absatz" && text(b.inhalt[0]!).endsWith("tief"), true);
  const tiefeListe = Array.from({ length: 40 }, (_, n) => `${"  ".repeat(n)}- ${n}`).join("\n");
  assert.ok(JSON.stringify(leseMarkdown(tiefeListe)).length > 0);
  // Böse Muster: jedes bleibt unter einer Sekunde (die Schrittgrenze hält es linear)
  for (const boese of ["[".repeat(100_000), "*a ".repeat(33_000), "_a ".repeat(33_000), "![](".repeat(25_000), "**x".repeat(33_000), "`a ".repeat(33_000), "~~a ".repeat(25_000)]) {
    const start = performance.now();
    leseMarkdown(boese, { umbrueche: true });
    assert.ok(performance.now() - start < 1000, `${boese.slice(0, 4)}: ${Math.round(performance.now() - start)} ms`);
  }
});

test("Verdrahtung (C-20a): README, Issue und Kommentar als Markdown – nur DOM, kein Bild, Links ohne Referrer", () => {
  const ui = ohneKommentare(lies("shell/markdown-ui.ts"));
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|outerHTML|"img"|createElement\("img/, "nur DOM, nie ein Bild");
  assert.match(ui, /e\.relList\.add\("noopener", "noreferrer", "nofollow"\)/);
  assert.match(lies("shell/tabs/code-reiter.ts"), /MARKDOWN\.test\(readme\.name\) \? markdownDom\(inhalt\.slice\(0, TEXT_MAX\), "code-readme"\)/);
  assert.match(lies("shell/tabs/issues-reiter.ts"), /markdownDom\(z\.issue\.text, "issue-text", \{ umbrueche: true \}\)/);
  assert.match(lies("shell/tabs/diskussion.ts"), /markdownDom\(k\.text, "issue-text", \{ umbrueche: true \}\)/);
  assert.doesNotMatch(ohneKommentare(lies("markdown.ts")), /document|innerHTML/, "der Leser kennt kein DOM");
});
