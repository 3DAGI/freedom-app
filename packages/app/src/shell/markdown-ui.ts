/**
 * Markdown zeichnen (Schritt C-20a, Sammlung C-20): den Baum aus
 * `leseMarkdown()` nur mit `createElement` und `textContent` – nie
 * `innerHTML`, auch kein rohes HTML aus dem Text. Links nur https, in neuem
 * Tab ohne Referrer; Bilder werden nie geladen, nur als Verweis gezeigt.
 */
import { type MdBlock, type MdInline, type MdOptionen, leseMarkdown } from "../markdown.js";
import { t } from "../i18n.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

/** Markdown als Element mit der Klasse `md` (dazu `klasse`). */
export function markdownDom(text: string, klasse: string, o: MdOptionen = {}): HTMLElement {
  const wurzel = el("div", undefined, `md ${klasse}`); // kein UI-Text
  wurzel.append(...leseMarkdown(text, o).map(block));
  return wurzel;
}

function mit<E extends HTMLElement>(e: E, teile: readonly MdInline[]): E {
  e.append(...teile.map(inline));
  return e;
}

function link(ziel: string, e: HTMLAnchorElement): HTMLAnchorElement {
  e.href = ziel;
  e.target = "_blank";
  e.relList.add("noopener", "noreferrer", "nofollow");
  e.title = ziel;
  return e;
}

function block(b: MdBlock): HTMLElement {
  switch (b.art) {
    case "ueberschrift": return mit(el(`h${Math.min(6, Math.max(1, b.stufe))}` as "h1"), b.inhalt);
    case "absatz": return mit(el("p"), b.inhalt);
    case "linie": return el("hr");
    case "zitat": {
      const q = el("blockquote");
      q.append(...b.kinder.map(block));
      return q;
    }
    case "code": {
      const pre = el("pre");
      pre.append(el("code", b.text));
      if (b.sprache) pre.dataset.sprache = b.sprache;
      return pre;
    }
    case "liste": {
      const l = el(b.geordnet ? "ol" : "ul");
      if (l instanceof HTMLOListElement && b.start !== 1) l.start = b.start;
      for (const p of b.punkte) {
        const li = el("li");
        if (p.erledigt !== undefined) {
          // Aufgabe: nur anzeigen – abhaken hieße, den Text eines anderen zu ändern
          const box = el("input");
          box.type = "checkbox";
          box.checked = p.erledigt;
          box.disabled = true;
          box.setAttribute("aria-label", t(p.erledigt ? "repo.mdErledigt" : "repo.mdOffen"));
          li.classList.add("md-aufgabe");
          li.append(box);
        }
        li.append(...p.kinder.map(block));
        l.append(li);
      }
      return l;
    }
  }
}

function inline(x: MdInline): Node {
  switch (x.art) {
    case "text": return document.createTextNode(x.text);
    case "code": return el("code", x.text);
    case "fett": return mit(el("strong"), x.kinder);
    case "kursiv": return mit(el("em"), x.kinder);
    case "durch": return mit(el("del"), x.kinder);
    case "umbruch": return el("br");
    case "link": return link(x.ziel, mit(el("a"), x.kinder));
    case "bild": {
      // Nie laden: ein Bild vom fremden Server verriete, wer wann liest
      const text = t("repo.mdBild", { alt: x.alt || "…" });
      return x.ziel ? link(x.ziel, el("a", text, "md-bild")) : el("span", text, "md-bild");
    }
  }
}
