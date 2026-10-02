/**
 * Zugänge zum TURN des eigenen Knotens (Sammlung B-13a, Entscheidungen T1 A,
 * T2 A): Den Vermittler stellt coturn als eigener Dienst (Installer, Docker);
 * der Knoten vergibt nur zeitlich begrenzte Zugänge nach TURN-REST – Nutzer
 * `<Ablauf>:<Zufall>`, Passwort base64(HMAC-SHA1(TURN_SECRET, Nutzer)), so wie
 * coturn sie mit `use-auth-secret` und `static-auth-secret` prüft. Nur an den
 * Besitzer (5079, versiegelt, Nachweis). Geheimnis und Zugänge nie ins Log.
 */
import { createHmac, randomBytes } from "node:crypto";
import { TURN_GRENZEN, istTurnUrl, type TurnZugang } from "@freedomstack/protocol";

export interface TurnDienst {
  urls: string[];
  geheimnis: string;
  gueltigSek: number;
}

/** So lange gilt ein Zugang, wenn `TURN_GUELTIG_SEK` nichts anderes sagt. */
export const TURN_GUELTIG_SEK = 3_600;
/** Das gemeinsame Geheimnis mit coturn muss mindestens so lang sein. */
export const TURN_GEHEIMNIS_MIN = 32;

/** Aus der Umgebung des Knotens: `TURN_URLS` (Komma), `TURN_SECRET`, optional `TURN_GUELTIG_SEK`. Ohne beides aus – nie halb. */
export function turnAusUmgebung(env: { TURN_URLS?: string; TURN_SECRET?: string; TURN_GUELTIG_SEK?: string }): { dienst?: TurnDienst; grund?: string } {
  const urls = (env.TURN_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0 && !env.TURN_SECRET) return { grund: "aus (TURN_URLS und TURN_SECRET setzen)" };
  if (urls.length === 0 || urls.length > TURN_GRENZEN.urls || !urls.every(istTurnUrl) || new Set(urls).size !== urls.length) {
    return { grund: "TURN_URLS ungültig (1–4 Adressen turn:/turns:host:port)" };
  }
  if (!env.TURN_SECRET || env.TURN_SECRET.length < TURN_GEHEIMNIS_MIN) return { grund: `TURN_SECRET fehlt oder ist kürzer als ${TURN_GEHEIMNIS_MIN} Zeichen` };
  const gueltig = env.TURN_GUELTIG_SEK ? Number(env.TURN_GUELTIG_SEK) : TURN_GUELTIG_SEK;
  if (!Number.isSafeInteger(gueltig) || gueltig < 60 || gueltig > TURN_GRENZEN.hoechstensSek) return { grund: "TURN_GUELTIG_SEK ungültig (60 bis 86400)" };
  return { dienst: { urls, geheimnis: env.TURN_SECRET, gueltigSek: gueltig } };
}

/** Ein frischer Zugang nach TURN-REST – je Anfrage ein neuer Zufall. */
export function turnZugang(d: TurnDienst, jetzt = Math.floor(Date.now() / 1000)): TurnZugang {
  const bis = jetzt + d.gueltigSek;
  const nutzer = `${bis}:${randomBytes(12).toString("base64url")}`;
  return { urls: [...d.urls], nutzer, passwort: createHmac("sha1", d.geheimnis).update(nutzer).digest("base64"), bis };
}
