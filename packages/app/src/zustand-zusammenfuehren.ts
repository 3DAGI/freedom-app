/**
 * Zusammenführen statt Überschreiben (Sammlung Neuordnung, B-5), ohne DOM.
 *
 * Bis B-5 überschrieb das Wiederherstellen einer Sicherung (oder eines
 * Exports) alles auf dem Gerät: Was hier seit der Sicherung dazukam – eine
 * neue Unterhaltung, ein vergebener Name, ein abonnierter Katalog –, war weg.
 * Jetzt geht nichts verloren, was nur auf einer Seite steht:
 *
 * - Sammlungen werden vereinigt: Unterhaltungen (je Kennung, die zuletzt
 *   aktive Fassung, Zeit das Späteste), Räume, Kataloge (höchstens 20).
 * - Zeitstände nehmen das Späteste je Eintrag: Lesestände, geprüfte Kontakte.
 * - Mandate behalten je Kontakt das zuerst gesehene (Regel seit 8.6a).
 * - Eigene Namen: beide Seiten; steht derselbe Kontakt verschieden, gilt die
 *   Sicherung – das zählt als Konflikt und wird genannt.
 * - Einzelwerte (Sprache, Profil, Einstellungen): wie bisher aus der Sicherung.
 *
 * Die gespeicherten Daten tragen keine Zeit je Feld – deshalb keine Mengen
 * mit Zeitstempeln (das frühere `merge.ts`, entfernt mit B-21), sondern Vereinigung: Bei echtem
 * Konflikt verliert eine Seite, und die App sagt, wie oft.
 */

export interface ZusammenfuehrBericht {
  /** Einträge, bei denen etwas nur auf dem Gerät stand und erhalten blieb. */
  erhalten: number;
  /** Stellen, an denen beide Seiten Verschiedenes hatten und die Sicherung galt. */
  konflikte: number;
}

type Leser = (k: string) => string | null;

const json = (roh: string | null): unknown => {
  try { return roh === null ? undefined : JSON.parse(roh); } catch { return undefined; }
};
const istObjekt = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Unterhaltungen je Kennung: die zuletzt aktive Fassung, `lastTs` das Späteste. */
function unterhaltungen(lokal: unknown, sicherung: unknown, b: ZusammenfuehrBericht): unknown {
  if (!Array.isArray(lokal) || !Array.isArray(sicherung)) return sicherung;
  const nachId = new Map<string, Record<string, unknown>>();
  for (const c of sicherung) if (istObjekt(c) && typeof c.id === "string") nachId.set(c.id, c);
  for (const c of lokal) {
    if (!istObjekt(c) || typeof c.id !== "string") continue;
    const s = nachId.get(c.id);
    if (!s) { nachId.set(c.id, c); b.erhalten++; continue; }
    const lt = Number(c.lastTs) || 0;
    const st = Number(s.lastTs) || 0;
    if (lt > st) { nachId.set(c.id, { ...c, lastTs: lt }); b.erhalten++; }
    if (typeof c.name === "string" && typeof s.name === "string" && c.name !== s.name && lt <= st) b.konflikte++;
  }
  return [...nachId.values()].sort((x, y) => (Number(y.lastTs) || 0) - (Number(x.lastTs) || 0));
}

/** Listen von Texten vereinigen (Räume, Kataloge) – Sicherung zuerst, dann was nur hier stand. */
function liste(lokal: unknown, sicherung: unknown, b: ZusammenfuehrBericht, max = Infinity): unknown {
  if (!Array.isArray(lokal) || !Array.isArray(sicherung)) return sicherung;
  const out = sicherung.filter((x): x is string => typeof x === "string").slice(0, max);
  for (const x of lokal) {
    if (typeof x === "string" && !out.includes(x) && out.length < max) { out.push(x); b.erhalten++; }
  }
  return out;
}

/** Je Schlüssel die späteste Zahl (Lesestände, geprüfte Kontakte). */
function spaetestes(lokal: unknown, sicherung: unknown, b: ZusammenfuehrBericht): unknown {
  if (!istObjekt(lokal) || !istObjekt(sicherung)) return sicherung;
  const out: Record<string, unknown> = { ...sicherung };
  for (const [k, v] of Object.entries(lokal)) {
    if (typeof v !== "number") continue;
    const s = out[k];
    if (typeof s !== "number" || v > s) { out[k] = v; b.erhalten++; }
  }
  return out;
}

/** Mandate: je Kontakt das zuerst gesehene (8.6a). */
function mandate(lokal: unknown, sicherung: unknown, b: ZusammenfuehrBericht): unknown {
  if (!istObjekt(lokal) || !istObjekt(sicherung)) return sicherung;
  const out: Record<string, unknown> = { ...sicherung };
  for (const [alt, l] of Object.entries(lokal)) {
    const s = out[alt] as { gesehen?: unknown } | undefined;
    const lg = (l as { gesehen?: unknown } | null)?.gesehen;
    if (typeof lg !== "number") continue;
    if (!s || typeof s.gesehen !== "number" || lg < s.gesehen) { out[alt] = l; b.erhalten++; }
  }
  return out;
}

/** Eigene Namen: beide Seiten; verschieden → die Sicherung, gezählt. */
function namen(lokal: unknown, sicherung: unknown, b: ZusammenfuehrBericht): unknown {
  if (!istObjekt(lokal) || !istObjekt(sicherung)) return sicherung;
  const out: Record<string, unknown> = { ...sicherung };
  for (const [pk, name] of Object.entries(lokal)) {
    if (!(pk in out)) { out[pk] = name; b.erhalten++; } else if (out[pk] !== name) b.konflikte++;
  }
  return out;
}

const REGELN: Record<string, (l: unknown, s: unknown, b: ZusammenfuehrBericht) => unknown> = {
  "freedom.chats": unterhaltungen,
  "freedom.spaces": (l, s, b) => liste(l, s, b),
  "freedom.kataloge": (l, s, b) => liste(l, s, b, 20),
  "freedom.lastRead": spaetestes,
  "freedom.kontakte.geprueft": spaetestes,
  "freedom.mandate": mandate,
  "freedom.petnames": namen,
};

/**
 * Die Werte, die geschrieben werden: je Eintrag der Sicherung zusammengeführt
 * mit dem, was hier steht (`lese`), oder – für Einzelwerte – wie bisher aus
 * der Sicherung. Einträge, die nur hier stehen, bleiben ohnehin unberührt.
 */
export function fuehreZusammen(sicherung: Record<string, string>, lese: Leser): { werte: Record<string, string>; bericht: ZusammenfuehrBericht } {
  const bericht: ZusammenfuehrBericht = { erhalten: 0, konflikte: 0 };
  const werte: Record<string, string> = {};
  for (const [k, v] of Object.entries(sicherung)) {
    const regel = REGELN[k];
    const lokal = lese(k);
    if (!regel || lokal === null || lokal === v) { werte[k] = v; continue; }
    const s = json(v);
    const l = json(lokal);
    const ergebnis = s === undefined || l === undefined ? undefined : regel(l, s, bericht);
    werte[k] = ergebnis === undefined ? v : JSON.stringify(ergebnis);
  }
  return { werte, bericht };
}
