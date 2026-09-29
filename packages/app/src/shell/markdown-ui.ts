/**
 * Markdown zeichnen (Schritt C-20a, Sammlung C-20): den Baum aus
 * `leseMarkdown()` nur mit `createElement` und `textContent` – nie
 * `innerHTML`, auch kein rohes HTML aus dem Text. Links nur https, in neuem
 * Tab ohne Referrer; Bilder werden nie geladen, nur als Verweis gezeigt.
 * Seit C-20b Tabellen und Verweise ins Repo: Die öffnet `oeffne` (Reiter
 * „Code“) – ohne `oeffne` bleiben sie Text, eine Adresse werden sie nie.
 */
import { type MdAusrichtung, type MdBlock, type MdInline, type MdOptionen, leseMarkdown } from "../markdown.js";
import { t } from "../i18n.js";

export interface MdAnzeige extends MdOptionen {
  /** Relatives Ziel im Repo öffnen (C-20b) – fehlt es, bleibt der Verweis Text. */
  oeffne?: (ziel: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

/** Markdown als Element mit der Klasse `md` (dazu `klasse`). */
export function markdownDom(text: string, klasse: string, o: MdAnzeige = {}): HTMLElement {
  const wurzel = el("div", undefined, `md ${klasse}`); // kein UI-Text
  wurzel.append(...leseMarkdown(text, o).map((b) => block(b, o)));
  return wurzel;
}

function mit<E extends HTMLElement>(e: E, teile: readonly MdInline[], o: MdAnzeige): E {
  e.append(...teile.map((x) => inline(x, o)));
  return e;
}

function link(ziel: string, e: HTMLAnchorElement): HTMLAnchorElement {
  e.href = ziel;
  e.target = "_blank";
  e.relList.add("noopener", "noreferrer", "nofollow");
  e.title = ziel;
  return e;
}

function zelle(tag: "th" | "td", teile: readonly MdInline[], ausrichtung: MdAusrichtung | undefined, o: MdAnzeige): HTMLElement {
  return mit(el(tag, undefined, ausrichtung ? `md-${ausrichtung}` : undefined), teile, o); // kein UI-Text
}

function block(b: MdBlock, o: MdAnzeige): HTMLElement {
  switch (b.art) {
    case "ueberschrift": return mit(el(`h${Math.min(6, Math.max(1, b.stufe))}` as "h1"), b.inhalt, o);
    case "absatz": return mit(el("p"), b.inhalt, o);
    case "linie": return el("hr");
    case "zitat": {
      const q = el("blockquote");
      q.append(...b.kinder.map((k) => block(k, o)));
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
        li.append(...p.kinder.map((k) => block(k, o)));
        l.append(li);
      }
      return l;
    }
    case "tabelle": {
      // Breite Tabellen laufen in ihrer Hülle, nie die Seite
      const huelle = el("div", undefined, "md-tabelle");
      const tab = el("table");
      const kopf = el("tr");
      kopf.append(...b.kopf.map((z, n) => zelle("th", z, b.ausrichtung[n], o)));
      const thead = el("thead");
      thead.append(kopf);
      const tbody = el("tbody");
      for (const r of b.zeilen) {
        const tr = el("tr");
        tr.append(...r.map((z, n) => zelle("td", z, b.ausrichtung[n], o)));
        tbody.append(tr);
      }
      tab.append(thead, tbody);
      huelle.append(tab);
      return huelle;
    }
  }
}

function inline(x: MdInline, o: MdAnzeige): Node {
  switch (x.art) {
    case "text": return document.createTextNode(x.text);
    case "code": return el("code", x.text);
    case "fett": return mit(el("strong"), x.kinder, o);
    case "kursiv": return mit(el("em"), x.kinder, o);
    case "durch": return mit(el("del"), x.kinder, o);
    case "umbruch": return el("br");
    case "link": return link(x.ziel, mit(el("a"), x.kinder, o));
    case "verweis": {
      const oeffne = o.oeffne;
      if (!oeffne) return mit(el("span"), x.kinder, o);
      // Ohne href: ein Verweis ins Repo ist keine Adresse (nichts in den Verlauf, nichts nach außen)
      const a = mit(el("a", undefined, "md-verweis"), x.kinder, o);
      a.setAttribute("role", "link");
      a.tabIndex = 0;
      a.title = x.ziel;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        oeffne(x.ziel);
      });
      a.addEventListener("keydown", (e) => {
        if (e.key === "Enter") oeffne(x.ziel);
      });
      return a;
    }
    case "bild": {
      // Nie laden: ein Bild vom fremden Server verriete, wer wann liest
      const text = t("repo.mdBild", { alt: x.alt || "…" });
      return x.ziel ? link(x.ziel, el("a", text, "md-bild")) : el("span", text, "md-bild");
    }
  }
}
