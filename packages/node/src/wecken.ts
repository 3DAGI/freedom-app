/**
 * Weckdienst des Knotens (Sammlung B-12, Entscheidungen W1 A, W2 A), erster
 * Teil (B-12a): Schlüssel und Anmeldungen.
 *
 * - VAPID (RFC 8292): Der Knoten hat ein eigenes P-256-Schlüsselpaar in
 *   `~/.freedom/vapid.json` (0600), erzeugt beim ersten Start mit
 *   `node:crypto` – keine Abhängigkeit. Den öffentlichen Teil nennt er nur im
 *   versiegelten Status an den Besitzer (`weckSchluessel`, B-11a).
 * - Anmeldungen (`WeckBuch`): Push-Adresse und beobachtete Schlüssel, nur vom
 *   Besitzer (5078, `leseWeckAnmeldung()`), in `~/.freedom/wecken.json`
 *   (0600). Die Adresse ist ein Zugang zu einem Browser – nie ins Log.
 *
 * Geweckt wird ab B-12b (ohne Inhalt, ohne Absender).
 */
import { type KeyObject, createPrivateKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WECK_SCHLUESSEL, type WeckAnmeldung } from "@freedomstack/protocol";

export const vapidDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "vapid.json");
export const weckDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "wecken.json");

/** Höchstens so viele Push-Adressen je Knoten – eine je Browser des Besitzers. */
export const WECKEN_HOECHSTENS = 10;

/** Datei ablegen wie die Kopplung: 0600, erst in eine Hilfsdatei, dann umbenennen. */
function legeAb(datei: string, inhalt: unknown): void {
  mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
  writeFileSync(`${datei}.tmp`, JSON.stringify(inhalt), { mode: 0o600 });
  renameSync(`${datei}.tmp`, datei);
}

export interface Vapid {
  privat: KeyObject;
  /** Öffentlicher Schlüssel als `applicationServerKey`: 65 Byte (0x04 …), base64url. */
  oeffentlich: string;
}

function ausJwk(jwk: { x?: unknown; y?: unknown; d?: unknown }): Vapid | null {
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string" || typeof jwk.d !== "string") return null;
  try {
    const privat = createPrivateKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, format: "jwk" });
    const x = Buffer.from(jwk.x, "base64url"), y = Buffer.from(jwk.y, "base64url");
    if (x.length !== 32 || y.length !== 32) return null;
    const oeffentlich = Buffer.concat([Buffer.from([4]), x, y]).toString("base64url");
    return WECK_SCHLUESSEL.test(oeffentlich) ? { privat, oeffentlich } : null;
  } catch {
    return null;
  }
}

/** VAPID-Schlüssel laden – fehlt die Datei, neu erzeugen und ablegen. Eine kaputte Datei bleibt liegen: dann kein Weckdienst. */
export function ladeVapid(datei: string): Vapid | null {
  if (existsSync(datei)) {
    try {
      return ausJwk(JSON.parse(readFileSync(datei, "utf8")) as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  legeAb(datei, { x: jwk.x, y: jwk.y, d: jwk.d });
  return ausJwk(jwk);
}

export interface WeckEintrag {
  endpunkt: string;
  schluessel: string[];
  /** Angemeldet seit, Unix-Sekunden. */
  seit: number;
}

/** Anmeldungen des Besitzers – je Push-Adresse ein Eintrag, gemerkt in einer Datei (nicht nur im Speicher). */
export class WeckBuch {
  private eintraege: WeckEintrag[] = [];

  constructor(private readonly datei: string) {
    if (!existsSync(datei)) return;
    try {
      const roh = JSON.parse(readFileSync(datei, "utf8")) as unknown;
      if (!Array.isArray(roh)) return;
      for (const e of roh.slice(0, WECKEN_HOECHSTENS)) {
        const x = e as Partial<WeckEintrag>;
        if (typeof x.endpunkt === "string" && Array.isArray(x.schluessel) && x.schluessel.every((k) => typeof k === "string" && /^[0-9a-f]{64}$/.test(k))
          && Number.isSafeInteger(x.seit)) this.eintraege.push({ endpunkt: x.endpunkt, schluessel: [...x.schluessel], seit: x.seit! });
      }
    } catch { /* kaputt: leer beginnen, beim nächsten Anmelden neu geschrieben */ }
  }

  /**
   * Eine geprüfte Anmeldung (`leseWeckAnmeldung()`) übernehmen: „an“ ersetzt
   * einen Eintrag derselben Adresse, „ab“ entfernt ihn. Gibt die Zahl der
   * beobachteten Schlüssel für diese Adresse zurück.
   */
  nimm(a: WeckAnmeldung, jetzt = Math.floor(Date.now() / 1000)): number {
    const ohne = this.eintraege.filter((e) => e.endpunkt !== a.endpunkt);
    if (a.aktion === "ab") {
      this.eintraege = ohne;
      legeAb(this.datei, this.eintraege);
      return 0;
    }
    if (ohne.length >= WECKEN_HOECHSTENS) throw new Error("zu viele Weck-Anmeldungen");
    this.eintraege = [...ohne, { endpunkt: a.endpunkt, schluessel: [...a.schluessel], seit: jetzt }];
    legeAb(this.datei, this.eintraege);
    return a.schluessel.length;
  }

  /** Eine Adresse vergessen, die der Push-Dienst nicht mehr kennt (404/410, B-12b). */
  vergiss(endpunkt: string): void {
    const vorher = this.eintraege.length;
    this.eintraege = this.eintraege.filter((e) => e.endpunkt !== endpunkt);
    if (this.eintraege.length !== vorher) legeAb(this.datei, this.eintraege);
  }

  alle(): readonly WeckEintrag[] {
    return this.eintraege;
  }

  /** Alle beobachteten Schlüssel, je einmal. */
  schluessel(): string[] {
    return [...new Set(this.eintraege.flatMap((e) => e.schluessel))];
  }
}
