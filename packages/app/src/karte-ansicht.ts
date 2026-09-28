/**
 * Abdeckungskarte ohne DOM (Schritt C.4a): Plattkarte (Länge → x, Breite →
 * y, 1 Grad = 1 Einheit), Zellen als Rechtecke, Gradnetz, Ausschnitt mit Zoom
 * und Verschieben. Gezeichnet wird in `shell/tabs/karte.ts`.
 *
 * Die Karte bekommt nur, was `buildCoverage()` ausgibt – Zellen über der
 * k-Schwelle. Nie einzelne Einträge, nie rohe Events: dieses Modul kennt sie
 * gar nicht.
 */
import { type CoverageCell, type CoverageLayer, LAYER_CELL_DEGREES } from "@freedomstack/protocol";

/** Die Welt in Karten-Einheiten: 360 × 180. */
export const WELT = { breite: 360, hoehe: 180 } as const;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 32;

export interface Rechteck { x: number; y: number; b: number; h: number }

/** Länge/Breite → Punkt auf der Karte. */
export function projiziere(lat: number, lon: number): { x: number; y: number } {
  return { x: lon + 180, y: 90 - lat };
}

/**
 * Eine Zelle als Rechteck: Südwest-Ecke aus der Kennung (`toCell()`), Größe
 * nach Ebene (`LAYER_CELL_DEGREES`). `null` bei Unfug – die Kennung kommt aus
 * fremden Events.
 */
export function zellRechteck(c: Pick<CoverageCell, "cell" | "layer">): Rechteck | null {
  const grad = LAYER_CELL_DEGREES[c.layer];
  if (!grad) return null;
  // Form wie `toCell()`: zwei Dezimalzahlen mit Komma dazwischen – nichts sonst
  if (!/^-?\d{1,3}(\.\d{1,6})?,-?\d{1,3}(\.\d{1,6})?$/.test(c.cell)) return null;
  const [lat, lon] = c.cell.split(",").map(Number) as [number, number];
  if (lat < -90 || lat + grad > 90 || lon < -180 || lon + grad > 180) return null;
  const nw = projiziere(lat + grad, lon);
  return { x: nw.x, y: nw.y, b: grad, h: grad };
}

export interface KartenZelle extends Rechteck {
  cell: string;
  layer: CoverageLayer;
  region: string;
  nodes: number;
}

/** Zellen aus `buildCoverage()` der gewählten Ebenen – Unfug fällt weg, gröbere Ebenen zuerst (liegen unten). */
export function kartenZellen(cells: readonly CoverageCell[], ebenen: ReadonlySet<CoverageLayer>): KartenZelle[] {
  const aus: KartenZelle[] = [];
  for (const c of cells) {
    if (!ebenen.has(c.layer)) continue;
    const r = zellRechteck(c);
    if (r) aus.push({ ...r, cell: c.cell, layer: c.layer, region: c.region, nodes: c.nodes });
  }
  return aus.sort((a, b) => b.b - a.b || a.y - b.y || a.x - b.x);
}

/** Ausschnitt: Mitte in Karten-Einheiten und Zoom (1 = ganze Welt). */
export interface Ansicht { x: number; y: number; zoom: number }
export const START: Ansicht = { x: WELT.breite / 2, y: WELT.hoehe / 2, zoom: 1 };

const grenze = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Mitte so begrenzen, dass der Ausschnitt in der Welt bleibt. */
function begrenze(a: Ansicht): Ansicht {
  const zoom = grenze(a.zoom, ZOOM_MIN, ZOOM_MAX);
  const halbB = WELT.breite / zoom / 2, halbH = WELT.hoehe / zoom / 2;
  return { zoom, x: grenze(a.x, halbB, WELT.breite - halbB), y: grenze(a.y, halbH, WELT.hoehe - halbH) };
}

/** Der sichtbare Ausschnitt als Rechteck (für `viewBox`). */
export function ausschnitt(a: Ansicht): Rechteck {
  const v = begrenze(a);
  const b = WELT.breite / v.zoom, h = WELT.hoehe / v.zoom;
  return { x: v.x - b / 2, y: v.y - h / 2, b, h };
}

/** Zoomen um den Faktor; `um` (Karten-Einheiten) bleibt an derselben Stelle auf dem Schirm. */
export function zoome(a: Ansicht, faktor: number, um: { x: number; y: number } = a): Ansicht {
  const zoom = grenze(a.zoom * faktor, ZOOM_MIN, ZOOM_MAX);
  const f = a.zoom / zoom;
  return begrenze({ zoom, x: um.x + (a.x - um.x) * f, y: um.y + (a.y - um.y) * f });
}

/** Verschieben um einen Anteil des Ausschnitts (Tastatur: 0,1) bzw. um Karten-Einheiten. */
export function verschiebe(a: Ansicht, dx: number, dy: number): Ansicht {
  return begrenze({ ...a, x: a.x + dx, y: a.y + dy });
}

/** Gradnetz: alle 30°, ab Zoom 3 alle 10°. */
export function gradnetz(zoom: number): { laengen: number[]; breiten: number[] } {
  const schritt = zoom >= 3 ? 10 : 30;
  const laengen: number[] = [], breiten: number[] = [];
  for (let l = -180; l <= 180; l += schritt) laengen.push(l);
  for (let b = -90; b <= 90; b += schritt) breiten.push(b);
  return { laengen, breiten };
}

/** Liegt das Rechteck (auch nur teilweise) im Ausschnitt? – für die Tab-Reihenfolge. */
export function imAusschnitt(r: Rechteck, a: Ansicht): boolean {
  const s = ausschnitt(a);
  return r.x < s.x + s.b && r.x + r.b > s.x && r.y < s.y + s.h && r.y + r.h > s.y;
}

/**
 * Eigener Standort nur gerundet (C.4b, E6, B13): die Südwest-Ecke der
 * 0,5°-Zelle. Das reicht für alle Ebenen – ihre Zellen (0,5°, 1°, 2°) sind
 * Vielfache davon, `toCell()` und `coverageAt()` ergeben dasselbe wie mit dem
 * genauen Ort. Gespeichert wird nur das (`freedom.coverage.cell`).
 */
export const STANDORT_GRAD = 0.5;

export function rundeStandort(lat: number, lon: number): [number, number] | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const ab = (v: number, max: number) => Math.min(Math.floor(v / STANDORT_GRAD) * STANDORT_GRAD, max - STANDORT_GRAD);
  return [ab(lat, 90), ab(lon, 180)];
}

/** Gemerkten Standort lesen – ein alter genauer Wert (bis C.4a) kommt gerundet zurück, Unfug als `null`. */
export function leseStandort(roh: string | null): [number, number] | null {
  let v: unknown;
  try {
    v = JSON.parse(roh ?? "null");
  } catch {
    return null;
  }
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" ? rundeStandort(v[0], v[1]) : null;
}

/** Die eigene Zelle auf der Karte – nur umrandet, kein Punkt. */
export function standortRechteck([lat, lon]: [number, number]): Rechteck {
  const nw = projiziere(lat + STANDORT_GRAD, lon);
  return { x: nw.x, y: nw.y, b: STANDORT_GRAD, h: STANDORT_GRAD };
}
