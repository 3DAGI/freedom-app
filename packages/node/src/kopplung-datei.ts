/**
 * Kopplung des Knotens mit seinem Besitzer (Sammlung B-8b, L1 A): Das
 * Geheimnis liegt in `~/.freedom/kopplung.json` (nur für den Knoten lesbar,
 * 0600), erzeugt und erneuert nur über `npm run koppeln`. Ein neues ersetzt
 * das alte – so widerruft der Besitzer alle bisher gekoppelten Geräte. Nach
 * außen geht das Geheimnis nur als Kopplungscode auf dem eigenen Bildschirm;
 * im Betrieb prüft der Knoten nur Nachweise (`istBesitzer()`).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Kopplung, kopplungscode, neueKopplung, qrCode } from "@freedomstack/protocol";

export const kopplungsDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "kopplung.json");

/** Die gemerkte Kopplung – nur zum eigenen Schlüssel und streng gelesen; sonst null (dann gibt es keinen Besitzer). */
export function leseKopplung(datei: string, knoten: string): Kopplung | null {
  if (!existsSync(datei)) return null;
  try {
    const k = JSON.parse(readFileSync(datei, "utf8")) as Partial<Kopplung>;
    return k.knoten === knoten && typeof k.geheimnis === "string" && /^[0-9a-f]{64}$/.test(k.geheimnis) ? { knoten, geheimnis: k.geheimnis } : null;
  } catch {
    return null;
  }
}

/** Neue Kopplung ablegen (0600, erst in eine Hilfsdatei, dann umbenennen) – ersetzt die alte. */
export function erneuereKopplung(datei: string, knoten: string): Kopplung {
  const k = neueKopplung(knoten);
  mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
  writeFileSync(`${datei}.tmp`, JSON.stringify(k), { mode: 0o600 });
  renameSync(`${datei}.tmp`, datei);
  return k;
}

/**
 * Den Kopplungscode als QR fürs Terminal: je Zeichen zwei Modulzeilen
 * (Halbblöcke), schwarz auf weiß über ANSI-Farben – lesbar auf hellem und
 * dunklem Hintergrund –, mit vier Modulen Ruhezone.
 */
export function kopplungImTerminal(k: Kopplung): string {
  const qr = qrCode(kopplungscode(k), { stufe: "L" });
  const rand = 4;
  const dunkel = (x: number, y: number) => x >= 0 && y >= 0 && x < qr.groesse && y < qr.groesse && qr.module[y]![x]!;
  const zeilen: string[] = [];
  for (let y = -rand; y < qr.groesse + rand; y += 2) {
    let z = "";
    for (let x = -rand; x < qr.groesse + rand; x++) {
      const oben = dunkel(x, y);
      const unten = dunkel(x, y + 1);
      z += oben && unten ? "█" : oben ? "▀" : unten ? "▄" : " ";
    }
    zeilen.push(`\x1b[30;47m${z}\x1b[0m`);
  }
  return zeilen.join("\n");
}
