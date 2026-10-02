/**
 * Antworten des Agenten zeichnen (seit C-6d2, Sammlung C-6): Markdown nur über
 * `markdownDom()` (Links nur https, Bilder nie geladen, rohes HTML bleibt
 * Text), Code-Blöcke mit Kopier-Knopf und eingefärbt über `codeTeile()` – alles
 * mit `textContent`. Ersetzt `renderMarkdown()`, das HTML-Text baute.
 */
import { codeTeile } from "../code-farbe.js";
import { t } from "../i18n.js";
import { markdownDom } from "./markdown-ui.js";
import { el } from "./ui.js";

export function antwortDom(text: string): HTMLElement {
  // Zeilenumbrüche bleiben, wie Antworten sie schreiben
  const wurzel = markdownDom(text, "antwort", { umbrueche: true });
  for (const pre of [...wurzel.querySelectorAll("pre")]) {
    const code = pre.querySelector("code");
    const roh = code?.textContent ?? "";
    code?.replaceChildren(...codeTeile(roh).map((s) => (s.art ? el("span", s.text, `tok-${s.art}`) : document.createTextNode(s.text))));
    const knopf = el("button", `⧉ ${t("ein.kopieren")}`, "cb-copy");
    knopf.type = "button";
    knopf.addEventListener("click", () => {
      void navigator.clipboard.writeText(roh).then(() => {
        knopf.textContent = `✓ ${t("ein.kopiert")}`;
        setTimeout(() => { knopf.textContent = `⧉ ${t("ein.kopieren")}`; }, 1500);
      }, () => { /* Zwischenablage verweigert */ });
    });
    const kopf = el("div", undefined, "cb-head");
    kopf.append(el("span", pre.dataset.sprache || "code"), knopf); // kein UI-Text
    const block = el("div", undefined, "codeblock");
    pre.replaceWith(block);
    block.append(kopf, pre);
  }
  return wurzel;
}
