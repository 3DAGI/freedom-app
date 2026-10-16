/**
 * `.gitignore` lesen und anwenden (Schritt 11.5a2b, `docs/REPO-AGENTEN-ENTWURF.md` V5):
 * Was der Agent in der Sandbox baut (`node_modules`, `dist`, Caches), gehört nicht in
 * den Patch – so wie git es nicht aufnimmt. Ohne git und ohne Abhängigkeit; die Regeln
 * wie `gitignore(5)`: `#` Kommentar, `!` holt zurück, `/` am Ende nur Ordner, `/` am
 * Anfang oder in der Mitte bindet an den Ordner der Datei, `*`, `?`, `[…]`, `**`.
 * Der Letzte Treffer gilt, tiefere Dateien nach höheren. Ein ignorierter Ordner wird
 * nicht betreten – was darin liegt, holt kein `!` zurück. Dateien, die git schon kennt
 * (in der Arbeitskopie), bleiben drin, gleich was hier steht – das prüft der Aufrufer.
 */

export interface IgnoreRegel {
  /** Ordner der `.gitignore`, relativ zum Repo (`""` für oben). */
  basis: string;
  muster: RegExp;
  /** `!…` – holt zurück. */
  zurueck: boolean;
  /** `…/` – nur Ordner. */
  nurOrdner: boolean;
}

/** Höchstens so viele Regeln je Datei und Zeichen je Regel – die Datei kommt aus dem Repo. */
export const IGNORE_GRENZEN = { regeln: 1000, zeichen: 1000 } as const;

/** Ein Muster aus `.gitignore` als regulärer Ausdruck über den Pfad relativ zur Basis. */
function alsRegExp(m: string, verankert: boolean): RegExp | null {
  let re = "";
  for (let i = 0; i < m.length; i++) {
    const z = m[i]!;
    if (z === "*") {
      if (m[i + 1] === "*" && (i === 0 || m[i - 1] === "/") && (i + 2 === m.length || m[i + 2] === "/")) {
        // „**“ als ganzer Teil: beliebig viele Ordner (auch keiner)
        if (i + 2 === m.length) re += ".*";
        else { re += "(?:.*/)?"; i++; }
        i++;
        continue;
      }
      while (m[i + 1] === "*") i++;
      re += "[^/]*";
    } else if (z === "?") re += "[^/]";
    else if (z === "[") {
      const ende = m.indexOf("]", i + 2);
      if (ende < 0) return null;
      let klasse = m.slice(i + 1, ende);
      const nicht = klasse[0] === "!" || klasse[0] === "^";
      if (nicht) klasse = klasse.slice(1);
      re += `[${nicht ? "^" : ""}${klasse.replace(/[\\\]^]/g, (x) => `\\${x}`)}]`;
      i = ende;
    } else if (z === "\\" && i + 1 < m.length) re += m[++i]!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    else re += z.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  try {
    return new RegExp(`^${verankert ? "" : "(?:.*/)?"}${re}$`, "s");
  } catch {
    return null;
  }
}

/** Die Regeln einer `.gitignore` im Ordner `basis`. Unlesbares fällt weg. */
export function leseIgnore(text: string, basis: string): IgnoreRegel[] {
  const regeln: IgnoreRegel[] = [];
  for (const roh of text.split("\n").slice(0, IGNORE_GRENZEN.regeln * 4)) {
    let z = roh.replace(/\r$/, "");
    if (z.length > IGNORE_GRENZEN.zeichen || z === "" || z.startsWith("#")) continue;
    z = z.replace(/(?<!\\)\s+$/, "");
    const zurueck = z.startsWith("!");
    if (zurueck) z = z.slice(1);
    else if (z.startsWith("\\!") || z.startsWith("\\#")) z = z.slice(1);
    const nurOrdner = z.endsWith("/");
    if (nurOrdner) z = z.replace(/\/+$/, "");
    if (!z) continue;
    const verankert = z.includes("/");
    const muster = alsRegExp(z.replace(/^\//, ""), verankert);
    if (muster) regeln.push({ basis, muster, zurueck, nurOrdner });
    if (regeln.length >= IGNORE_GRENZEN.regeln) break;
  }
  return regeln;
}

/** Ist `pfad` (relativ zum Repo) nach den Regeln ignoriert? `regeln` von oben nach unten, wie gelesen. */
export function istIgnoriert(pfad: string, istOrdner: boolean, regeln: readonly IgnoreRegel[]): boolean {
  let ignoriert = false;
  for (const r of regeln) {
    if (r.nurOrdner && !istOrdner) continue;
    if (r.basis && !pfad.startsWith(`${r.basis}/`)) continue;
    const relativ = r.basis ? pfad.slice(r.basis.length + 1) : pfad;
    if (r.muster.test(relativ)) ignoriert = !r.zurueck;
  }
  return ignoriert;
}
