/**
 * Der Knoten liefert die App aus (B-10, Sammlung Neuordnung, Entscheidung L2 A).
 *
 * Warum: Die App von GitHub Pages läuft über https – von dort lassen Browser
 * keine unverschlüsselte Verbindung zu `ws://…` im Heimnetz zu, also auch nicht
 * zum Relay des eigenen Knotens. Kommt die App vom Knoten selbst, ist sie dort
 * zu Hause: http im Heimnetz auf dem Port des Relays, und über einen
 * Onion-Dienst auf diesen Port auch als .onion.
 *
 * Nur ein reproduzierbarer Build mit Prüfsumme: Ausgeliefert wird nur eine
 * Datei, deren SHA-256 der Betreiber vorher angibt (`APP_SHA256` – von der
 * Website, aus dem Release oder aus `scripts/repro-build.sh`). Geprüft wird
 * beim Start; danach kommt die App aus dem Speicher – eine spätere Änderung der
 * Datei geht nie hinaus. Die Summe steht daneben (`/freedom.html.sha256`), damit
 * jeder sie mit der Website vergleichen kann.
 *
 * Nach außen und ins Log nur feste Texte – nie Pfade oder Meldungen des Systems.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface App {
  html: Buffer;
  /** SHA-256 in Hex (klein). */
  sha256: string;
}

/** Die App ist eine Datei von einigen MB (MLS-Engine eingebettet); größer ist sie nie. */
export const APP_MAX_BYTES = 32 * 1024 * 1024;

export type AppGrund = "keine-summe" | "nicht-lesbar" | "zu-gross" | "summe-anders";
export type AppPruefung = { ok: true; app: App } | { ok: false; grund: AppGrund };

const HEX64 = /^[0-9a-f]{64}$/;

/** Feste Texte für das Log des Betreibers. */
export const APP_GRUND_TEXT: Record<AppGrund, string> = {
  "keine-summe": "APP_SHA256 ist keine SHA-256 (64 Hex-Zeichen)",
  "nicht-lesbar": "APP_DATEI nicht lesbar – vorher bauen (cd packages/app && node build.mjs) oder den Pfad setzen",
  "zu-gross": "APP_DATEI ist zu groß für die App",
  "summe-anders": "die Datei hat eine andere SHA-256 als APP_SHA256 – nur ein reproduzierbarer Build mit passender Summe geht hinaus",
};

/** Liest die Datei und gibt sie nur zurück, wenn ihre SHA-256 die erwartete ist. */
export async function ladeApp(datei: string, soll: string): Promise<AppPruefung> {
  const summe = soll.trim().toLowerCase();
  if (!HEX64.test(summe)) return { ok: false, grund: "keine-summe" };
  let html: Buffer;
  try {
    html = await readFile(datei);
  } catch {
    return { ok: false, grund: "nicht-lesbar" };
  }
  if (html.length > APP_MAX_BYTES) return { ok: false, grund: "zu-gross" };
  const ist = createHash("sha256").update(html).digest("hex");
  return ist === summe ? { ok: true, app: { html, sha256: ist } } : { ok: false, grund: "summe-anders" };
}

/**
 * Aus der Umgebung: `APP_SHA256` schaltet die Auslieferung ein, `APP_DATEI`
 * nennt die Datei (Standard: der Build im eigenen Checkout neben dem Knoten).
 * Leere Werte aus der Umgebungsdatei gelten als nicht gesetzt.
 */
export function appAusUmgebung(env: Record<string, string | undefined>, basis: string): { datei: string; soll: string } | undefined {
  const soll = env.APP_SHA256?.trim();
  if (!soll) return undefined;
  return { datei: resolve(basis, env.APP_DATEI?.trim() || "../app/dist/freedom.html"), soll };
}

/** Pfade der Auslieferung auf dem Port des Relays. */
export function istAppPfad(pfad: string): "app" | "summe" | undefined {
  if (pfad === "/" || pfad === "/freedom.html") return "app";
  if (pfad === "/freedom.html.sha256") return "summe";
  return undefined;
}

/**
 * Kopfzeilen der App: nie zwischengespeichert ohne Nachfrage (die Summe ist das
 * ETag), nie in einem fremden Rahmen, keine Herkunft an Links. Die eigentliche
 * CSP steht in der Datei selbst (`build.mjs`) – hier nur, was ein `<meta>` nicht
 * kann (`frame-ancestors`).
 */
export function appKopfzeilen(app: App): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    ETag: `"${app.sha256}"`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
  };
}
