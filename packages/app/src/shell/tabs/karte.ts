/**
 * Abdeckungskarte als SVG (Schritt C.4a, B12): selbst gezeichnet, keine
 * Kacheln, kein Skript von außen. Ebenen mit eigener Farbe **und** eigenem
 * Muster, Legende an den Schaltern, Zoom und Verschieben mit Maus, Touch und
 * Tastatur, Angaben je Zelle; daneben die Liste als gleichwertige Ansicht.
 *
 * Gezeichnet wird nur, was `buildCoverage()` ausgibt (Zellen über der
 * Schwelle) – die Rechnung steht in `karte-ansicht.ts`. Nur DOM:
 * `createElementNS` und `textContent`, nie `innerHTML`. Seit C.4b mit
 * eingebetteten Umrissen (`welt-umrisse.ts`) und der eigenen Zelle, nur
 * umrandet und nur, wenn der Nutzer seinen Ort freigegeben hat.
 */
import { type CoverageCell, type CoverageLayer, K_ANONYMITY, LAYER_CELL_DEGREES } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import {
  type Ansicht, START, WELT, ausschnitt, gradnetz, imAusschnitt, kartenZellen, standortRechteck, verschiebe, zellRechteck, zoome,
} from "../../karte-ansicht.js";
import { WELT_UMRISSE } from "../../welt-umrisse.js";
import { ebeneName, zellenStufe } from "../../protokoll-texte.js";

const SVG = "http://www.w3.org/2000/svg";
const EBENEN: CoverageLayer[] = ["online", "lora", "bluetooth"];
/** Richtung der Schraffur je Ebene – dieselbe in der Legende (`.karte-probe` in app.css). */
const WINKEL: Record<CoverageLayer, number> = { online: 45, lora: -45, bluetooth: 0 };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attr: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attr)) e.setAttribute(k, String(v));
  return e;
}

/** Zustand – nur im Speicher. */
let ansicht: Ansicht = START;
let zellen: CoverageCell[] = [];
let verborgen = 0;
const ebenen = new Set<CoverageLayer>(EBENEN);
let gewaehlt: string | null = null;
/** Eigener Ort, gerundet (`leseStandort()`) – nur lokal gezeichnet. */
let standort: [number, number] | null = null;

/**
 * Gebiet einer Zelle: der Name aus dem Eintrag (fremd, gekürzt, nur als
 * Text), sonst ihre Mitte – eigene Einträge tragen keinen Namen (B12).
 */
export function gebietText(c: Pick<CoverageCell, "cell" | "layer" | "region">): string {
  const name = c.region.trim().slice(0, 60);
  if (name) return name;
  const r = zellRechteck(c);
  if (!r) return c.cell.slice(0, 30);
  const lat = 90 - (r.y + r.h / 2), lon = r.x + r.b / 2 - 180;
  const zahl = (v: number) => Math.abs(v).toLocaleString(gebietsschema(), { maximumFractionDigits: 2 });
  return t("karte.gebiet", { lat: zahl(lat), ns: t(lat >= 0 ? "karte.nord" : "karte.sued"), lon: zahl(lon), ow: t(lon >= 0 ? "karte.ost" : "karte.west") });
}
/** Angaben einer Zelle: Ebene, Gebiet, Stufe – nie die Zahl der Einträge. */
export const zellText = (c: Pick<CoverageCell, "cell" | "layer" | "region" | "nodes">): string => t("karte.zelle", { ebene: ebeneName(c.layer), gebiet: gebietText(c), stufe: zellenStufe(c.nodes) });

/** Karte zeichnen (nach jedem Laden der Abdeckung aus `earn.ts`). */
export function zeigeKarte(cells: CoverageCell[], hiddenCells: number, eigenerOrt: [number, number] | null = null): void {
  zellen = cells;
  verborgen = hiddenCells;
  standort = eigenerOrt;
  wireKarte();
  zeichne();
}

function zeichne(fokus?: string): void {
  const box = document.getElementById("coverage-svg");
  if (!box) return;
  const s = ausschnitt(ansicht);
  const karte = svg("svg", { viewBox: `${s.x} ${s.y} ${s.b} ${s.h}`, class: "karte-svg", tabindex: 0, role: "group" });
  karte.setAttribute("aria-label", t("karte.aria"));
  // Muster je Ebene: Schraffur in eigener Richtung, Abstand nach Zellgröße
  const defs = svg("defs");
  for (const e of EBENEN) {
    const g = LAYER_CELL_DEGREES[e] / 4;
    const muster = svg("pattern", { id: `muster-${e}`, patternUnits: "userSpaceOnUse", width: g, height: g, patternTransform: `rotate(${WINKEL[e]})` });
    muster.append(svg("rect", { width: g, height: g, class: `muster-grund ebene-${e}` }), svg("line", { x1: 0, y1: g / 2, x2: g, y2: g / 2, class: `muster-linie ebene-${e}` })); // kein UI-Text
    defs.append(muster);
  }
  karte.append(defs, svg("rect", { x: 0, y: 0, width: WELT.breite, height: WELT.hoehe, class: "karte-meer" }));
  // Umrisse in Zehntelgrad (E5) – nur Hintergrund, keine Angabe
  karte.append(svg("path", { d: WELT_UMRISSE, transform: "scale(0.1)", class: "karte-land", "aria-hidden": "true" }));
  const netz = svg("g", { class: "karte-netz" });
  const { laengen, breiten } = gradnetz(ansicht.zoom);
  for (const l of laengen) netz.append(svg("line", { x1: l + 180, y1: 0, x2: l + 180, y2: WELT.hoehe }));
  for (const b of breiten) netz.append(svg("line", { x1: 0, y1: 90 - b, x2: WELT.breite, y2: 90 - b, class: b === 0 ? "karte-aequator" : "karte-breite" }));
  karte.append(netz);
  const g = svg("g", { class: "karte-zellen" });
  for (const z of kartenZellen(zellen, ebenen)) {
    const kennung = `${z.layer}:${z.cell}`;
    const r = svg("rect", { x: z.x, y: z.y, width: z.b, height: z.h, fill: `url(#muster-${z.layer})`, role: "button" });
    r.classList.add("karte-zelle", `ebene-${z.layer}`);
    if (gewaehlt === kennung) r.classList.add("gewaehlt");
    r.setAttribute("tabindex", imAusschnitt(z, ansicht) ? "0" : "-1");
    r.setAttribute("aria-label", zellText(z));
    r.dataset.zelle = kennung;
    const titel = svg("title");
    titel.textContent = zellText(z);
    r.append(titel);
    const waehle = () => {
      gewaehlt = kennung;
      zeichne(kennung);
    };
    r.addEventListener("click", () => { if (!gezogen) waehle(); });
    r.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return; // kein UI-Text
      ev.preventDefault();
      ev.stopPropagation();
      waehle();
    });
    g.append(r);
  }
  karte.append(g);
  if (standort) {
    const r = standortRechteck(standort);
    const eigen = svg("rect", { x: r.x, y: r.y, width: r.b, height: r.h, class: "karte-eigen" });
    const titel = svg("title");
    titel.textContent = t("karte.eigenesGebiet");
    eigen.append(titel);
    karte.append(eigen);
  }
  document.getElementById("coverage-meins")?.classList.toggle("hidden", !standort);
  bedienung(karte);
  box.replaceChildren(karte);
  // Angaben der gewählten Zelle und Namen der Ebenen – auch nach einem Sprachwechsel neu
  const auswahl = zellen.find((c) => `${c.layer}:${c.cell}` === gewaehlt);
  const info = document.getElementById("coverage-zelle");
  if (info) info.textContent = auswahl ? zellText(auswahl) : "";
  document.querySelectorAll<HTMLElement>("#coverage-ebenen [data-ebene-name]").forEach((n) => {
    n.textContent = ebeneName(n.dataset.ebeneName as CoverageLayer);
  });
  const hinweis = document.getElementById("coverage-karte-hinweis");
  if (hinweis) {
    const saetze = [zellen.length ? t("karte.schwelle", { k: K_ANONYMITY }) : t("karte.keineZellen")];
    if (verborgen > 0) saetze.push(t("earn.verborgen", { n: verborgen }));
    hinweis.textContent = saetze.join(" ");
  }
  if (fokus) karte.querySelector<SVGElement>(`[data-zelle="${CSS.escape(fokus)}"]`)?.focus();
}

/** Letzter Zug war ein Ziehen – dann ist das Loslassen kein Klick auf eine Zelle. */
let gezogen = false;

/** Maus, Touch (auch zwei Finger) und Tastatur am SVG. */
function bedienung(karte: SVGSVGElement): void {
  /** Bildschirmpunkt → Karten-Einheiten; das SVG hat immer das Seitenverhältnis 2:1 wie die Welt. */
  const inKarte = (cx: number, cy: number) => {
    const r = karte.getBoundingClientRect(), s = ausschnitt(ansicht);
    const massstab = s.b / Math.max(1, r.width);
    return { x: s.x + (cx - r.left) * massstab, y: s.y + (cy - r.top) * massstab, massstab };
  };
  karte.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    ansicht = zoome(ansicht, ev.deltaY < 0 ? 1.25 : 0.8, inKarte(ev.clientX, ev.clientY));
    zeichne();
  }, { passive: false });
  const zeiger = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 };
  karte.addEventListener("pointerdown", (ev) => {
    zeiger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    start = { x: ev.clientX, y: ev.clientY };
    gezogen = false;
  });
  karte.addEventListener("pointermove", (ev) => {
    const vorher = zeiger.get(ev.pointerId);
    if (!vorher) return;
    if (!gezogen && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 4) {
      gezogen = true;
      // Erst jetzt festhalten – sonst träfe der Klick nie eine Zelle
      try { karte.setPointerCapture(ev.pointerId); } catch { /* Zeiger schon weg */ }
    }
    if (zeiger.size === 2) {
      // Zwei Finger: der Punkt zwischen ihnen bleibt unter ihnen – zoomen um die alte Mitte, dann mit ihr verschieben
      const anderer = [...zeiger.entries()].find(([id]) => id !== ev.pointerId)![1];
      const alt = Math.hypot(vorher.x - anderer.x, vorher.y - anderer.y);
      const neu = Math.hypot(ev.clientX - anderer.x, ev.clientY - anderer.y);
      const mitteVorher = { x: (vorher.x + anderer.x) / 2, y: (vorher.y + anderer.y) / 2 };
      if (alt > 0) {
        ansicht = zoome(ansicht, neu / alt, inKarte(mitteVorher.x, mitteVorher.y));
        const m = inKarte(0, 0).massstab;
        ansicht = verschiebe(ansicht, -((ev.clientX + anderer.x) / 2 - mitteVorher.x) * m, -((ev.clientY + anderer.y) / 2 - mitteVorher.y) * m);
      }
    } else if (gezogen) {
      const m = inKarte(ev.clientX, ev.clientY).massstab;
      ansicht = verschiebe(ansicht, -(ev.clientX - vorher.x) * m, -(ev.clientY - vorher.y) * m);
    }
    zeiger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const s = ausschnitt(ansicht);
    karte.setAttribute("viewBox", `${s.x} ${s.y} ${s.b} ${s.h}`);
  });
  const ende = (ev: PointerEvent) => {
    if (!zeiger.delete(ev.pointerId)) return;
    if (gezogen && zeiger.size === 0) zeichne(); // Gradnetz und Tab-Reihenfolge zum neuen Ausschnitt
  };
  karte.addEventListener("pointerup", ende);
  karte.addEventListener("pointercancel", ende);
  karte.addEventListener("keydown", (ev) => {
    const s = ausschnitt(ansicht);
    const schritt: Record<string, [number, number]> = { ArrowLeft: [-s.b / 10, 0], ArrowRight: [s.b / 10, 0], ArrowUp: [0, -s.h / 10], ArrowDown: [0, s.h / 10] };
    const pfeil = schritt[ev.key];
    if (pfeil) ansicht = verschiebe(ansicht, ...pfeil);
    else if (ev.key === "+" || ev.key === "=") ansicht = zoome(ansicht, 1.5);
    else if (ev.key === "-") ansicht = zoome(ansicht, 1 / 1.5);
    else if (ev.key === "0") ansicht = START;
    else return;
    ev.preventDefault();
    zeichne();
    document.querySelector<SVGElement>("#coverage-svg svg")?.focus();
  });
}

let verdrahtet = false;

/** Schalter der Ebenen (zugleich die Legende), Zoom-Knöpfe und „Karte | Liste“ – einmal. */
function wireKarte(): void {
  if (verdrahtet) return;
  verdrahtet = true;
  const leiste = document.getElementById("coverage-ebenen");
  for (const e of EBENEN) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `ghost mini karte-ebene ebene-${e}`;
    b.setAttribute("aria-pressed", "true");
    b.dataset.ebene = e;
    const probe = document.createElement("span");
    probe.className = `karte-probe ebene-${e}`;
    const name = document.createElement("span");
    name.dataset.ebeneName = e;
    name.textContent = ebeneName(e);
    b.append(probe, name);
    b.addEventListener("click", () => {
      if (ebenen.has(e)) ebenen.delete(e);
      else ebenen.add(e);
      b.setAttribute("aria-pressed", String(ebenen.has(e)));
      zeichne();
    });
    leiste?.append(b);
  }
  const zoomKnopf = (id: string, tun: () => Ansicht) => document.getElementById(id)?.addEventListener("click", () => {
    ansicht = tun();
    zeichne();
  });
  zoomKnopf("coverage-naeher", () => zoome(ansicht, 1.5));
  zoomKnopf("coverage-weiter", () => zoome(ansicht, 1 / 1.5));
  zoomKnopf("coverage-welt", () => START);
  zoomKnopf("coverage-meins", () => {
    if (!standort) return ansicht;
    const r = standortRechteck(standort);
    return zoome({ x: r.x + r.b / 2, y: r.y + r.h / 2, zoom: 1 }, 8);
  });
  const knoepfe = document.querySelectorAll<HTMLButtonElement>("#coverage-ansicht button");
  knoepfe.forEach((b) => b.addEventListener("click", () => {
    const aufKarte = b.dataset.ansicht === "karte";
    document.getElementById("coverage-karte")?.classList.toggle("hidden", !aufKarte);
    document.getElementById("coverage-list")?.classList.toggle("hidden", aufKarte);
    knoepfe.forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
  }));
}
