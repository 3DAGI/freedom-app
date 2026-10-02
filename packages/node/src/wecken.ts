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
 * Wecken (`WeckDienst`, B-12b): Kommt ein Umschlag (1059) an einen der
 * beobachteten Schlüssel, schickt der Knoten an jede passende Push-Adresse
 * eine leere Nachricht – nur VAPID, kein Inhalt, kein Absender, ein Thema
 * (`Topic`), damit wartende sich ersetzen. Umschläge sind bis zu zwei Tage
 * zurückdatiert (NIP-59): neu ist, was der Dienst noch nicht kannte, nicht was
 * jung aussieht. Was schon da war, als ein Schlüssel dazukam, weckt nie.
 */
import { type KeyObject, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MAX_TIME_JITTER_SECS, WECK_SCHLUESSEL, type WeckAnmeldung } from "@freedomstack/protocol";
import { checkUrlSafe } from "./url-guard.js";

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

/** So oft sieht der Dienst nach. */
export const WECKEN_TAKT_MS = 30_000;
/** Höchstens einmal je Adresse in dieser Zeit – ein Gespräch weckt nicht dauernd. */
export const WECKEN_ABSTAND_SEK = 60;
/** So lange hält der Push-Dienst die Nachricht für einen schlafenden Browser. */
export const WECKEN_TTL_SEK = 3_600;
/** Kontakt im VAPID-Token (RFC 8292 `sub`) – das Projekt, nicht der Betreiber; `WECKEN_KONTAKT` ersetzt ihn. */
export const WECKEN_KONTAKT = "https://github.com/3DAGI/freedom-app";

/** Kopfzeilen für eine leere Push-Nachricht mit VAPID (ES256): Token für den Ursprung der Adresse, 12 Stunden gültig. */
export function vapidKopf(endpunkt: string, vapid: Vapid, jetzt: number, kontakt = WECKEN_KONTAKT): Record<string, string> {
  const teil = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const inhalt = `${teil({ typ: "JWT", alg: "ES256" })}.${teil({ aud: new URL(endpunkt).origin, exp: jetzt + 12 * 3600, sub: kontakt })}`;
  const sig = sign("sha256", Buffer.from(inhalt), { key: vapid.privat, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return { Authorization: `vapid t=${inhalt}.${sig}, k=${vapid.oeffentlich}`, TTL: String(WECKEN_TTL_SEK), Urgency: "high", Topic: "freedom", "Content-Length": "0" };
}

/** Leere Push-Nachricht senden – vorher die Namensauflösung prüfen (kein privates Ziel), nie einer Weiterleitung folgen. Gibt den HTTP-Status zurück. */
export async function sendePush(endpunkt: string, kopf: Record<string, string>): Promise<number> {
  const urteil = await checkUrlSafe(endpunkt);
  if (!urteil.allowed) throw Object.assign(new Error("Push-Adresse abgelehnt"), { name: "AdresseAbgelehnt" });
  const r = await fetch(endpunkt, { method: "POST", headers: kopf, body: new Uint8Array(0), redirect: "manual", signal: AbortSignal.timeout(10_000) });
  await r.arrayBuffer().catch(() => undefined);
  return r.status;
}

export interface WeckTreffer { id: string; created_at: number; an: readonly string[] }

/** Weckt den Browser des Besitzers, wenn Post an einen seiner Schlüssel liegt (B-12b). */
export class WeckDienst {
  /** Bekannte Umschläge (Kennung → Zeit), damit jeder nur einmal weckt. */
  private gesehen = new Map<string, number>();
  /** Schlüssel, für die es schon einen Grundstand gibt – was davor da war, weckt nicht. */
  private grundstand = new Set<string>();
  private zuletzt = new Map<string, number>();

  constructor(private readonly o: {
    buch: WeckBuch;
    vapid: Vapid;
    /** Umschläge an diese Schlüssel seit `seit` – eigenes Relay und, wenn gewählt, die Relays des Pools. */
    abfrage: (schluessel: string[], seit: number) => Promise<WeckTreffer[]>;
    senden?: (endpunkt: string, kopf: Record<string, string>) => Promise<number>;
    jetzt?: () => number;
    kontakt?: string;
  }) {}

  private jetzt(): number {
    return this.o.jetzt ? this.o.jetzt() : Math.floor(Date.now() / 1000);
  }

  /** Einmal nachsehen; gibt die Zahl der gesendeten Weckrufe zurück. Fehler einzelner Adressen halten die anderen nicht auf. */
  async pruefe(): Promise<number> {
    const schluessel = this.o.buch.schluessel();
    if (schluessel.length === 0) return 0;
    const jetzt = this.jetzt();
    const fenster = jetzt - MAX_TIME_JITTER_SECS - 3_600;
    for (const [id, t] of this.gesehen) if (t < fenster) this.gesehen.delete(id);
    const treffer = await this.o.abfrage(schluessel, fenster);
    const geweckt = new Set<string>();
    for (const t of treffer) {
      if (this.gesehen.has(t.id)) continue;
      this.gesehen.set(t.id, t.created_at);
      for (const k of t.an) if (this.grundstand.has(k)) geweckt.add(k);
    }
    for (const k of schluessel) this.grundstand.add(k);
    let gesendet = 0;
    for (const e of [...this.o.buch.alle()]) {
      if (!e.schluessel.some((k) => geweckt.has(k))) continue;
      if (jetzt - (this.zuletzt.get(e.endpunkt) ?? 0) < WECKEN_ABSTAND_SEK) continue;
      this.zuletzt.set(e.endpunkt, jetzt);
      try {
        const status = await (this.o.senden ?? sendePush)(e.endpunkt, vapidKopf(e.endpunkt, this.o.vapid, jetzt, this.o.kontakt));
        if (status === 404 || status === 410) {
          this.o.buch.vergiss(e.endpunkt);
          console.log("[wecken] eine Push-Adresse ist abgelaufen und vergessen");
        } else if (status >= 200 && status < 300) {
          gesendet++;
        } else {
          console.warn(`[wecken] Push-Dienst antwortet mit HTTP ${status}`);
        }
      } catch (err) {
        console.warn(`[wecken] Push gescheitert (${(err as Error).name})`);
      }
    }
    return gesendet;
  }
}
