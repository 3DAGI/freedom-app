/**
 * Der Schlüssel des Knotens (Sammlung B-40, Lauf 2 des lokalen Agenten): An ihm
 * hängen Ruf, Zahlkanäle, Kopplung und das eigene Relay – er darf sich bei einem
 * Neustart nie ändern. Bis B-40 erzeugte der Knoten ohne `NODE_SECRET_KEY` bei
 * jedem Start einen neuen und schrieb den geheimen ins Log; unter Docker immer.
 *
 * Jetzt: `NODE_SECRET_KEY`, wenn gesetzt – nur streng (64 Zeichen Hex). Sonst
 * die Datei `~/.freedom/node-key`, dieselbe, die der Installer anlegt
 * (0600). Fehlt sie, legt der erste Start sie an. Was nicht passt, startet nicht
 * – nie still einen neuen Schlüssel. Der geheime Schlüssel geht nie ins Log.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateKeypair, toHex } from "@freedomstack/protocol";
import { schnorr } from "@noble/curves/secp256k1.js";

export const knotenSchluesselDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "node-key");

const HEX64 = /^[0-9a-f]{64}$/;

export interface KnotenSchluessel {
  sk: Uint8Array;
  pk: string;
  /** Woher er kam – fürs Log, ohne den Schlüssel selbst. */
  quelle: "umgebung" | "datei" | "neu";
}

/** Fehler mit festem Text – nie mit dem Inhalt der Datei oder der Variablen. */
export class SchluesselFehler extends Error {}

function ausHex(hex: string): { sk: Uint8Array; pk: string } {
  const sk = Uint8Array.from(Buffer.from(hex, "hex"));
  return { sk, pk: toHex(schnorr.getPublicKey(sk)) };
}

/**
 * Den Schlüssel laden: aus der Umgebung (leer gilt als nicht gesetzt), sonst aus
 * `datei`; fehlt sie, mit `anlegen` neu (0600, nur wenn es sie noch nicht gibt).
 * Wirft `SchluesselFehler`, wenn etwas nicht passt – dann startet der Knoten nicht.
 */
export function ladeKnotenSchluessel(umgebung: string | undefined, datei: string, opts: { anlegen: boolean }): KnotenSchluessel {
  const roh = (umgebung ?? "").trim();
  if (roh) {
    if (!HEX64.test(roh.toLowerCase())) throw new SchluesselFehler("NODE_SECRET_KEY ist ungültig – erwartet 64 Zeichen Hex.");
    return { ...ausHex(roh.toLowerCase()), quelle: "umgebung" };
  }
  if (existsSync(datei)) {
    const inhalt = readFileSync(datei, "utf8").trim().toLowerCase();
    if (!HEX64.test(inhalt)) throw new SchluesselFehler(`${datei} ist defekt – erwartet 64 Zeichen Hex. Nicht überschreiben: ohne den alten Schlüssel ist die Identität des Knotens weg.`);
    return { ...ausHex(inhalt), quelle: "datei" };
  }
  if (!opts.anlegen) throw new SchluesselFehler(`Kein Schlüssel – weder NODE_SECRET_KEY noch ${datei}. Erst den Knoten starten.`);
  const kp = generateKeypair();
  mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
  // „wx“: nur anlegen, nie eine Datei ersetzen, die inzwischen ein anderer Prozess geschrieben hat
  writeFileSync(datei, `${toHex(kp.sk)}\n`, { mode: 0o600, flag: "wx" });
  return { sk: kp.sk, pk: kp.pk, quelle: "neu" };
}
