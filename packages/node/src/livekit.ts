/**
 * Zugänge zum Gruppenanruf (LiveKit) des eigenen Knotens (Sammlung B-34a, Entscheidungen LK2–LK4 A): Den SFU stellt
 * `livekit-server` als eigener Dienst (Profil „livekit“, `scripts/livekit-einrichten.sh`); der Knoten vergibt nur
 * Zugänge – JWT nach LiveKit (HS256 mit dem API-Geheimnis, `iss` = API-Schlüssel, `sub` = Kennung, Recht nur für
 * diesen Raum), je Teilnehmer einer mit zufälliger Kennung. Nur an den Besitzer (5081, versiegelt, Nachweis).
 * Geheimnis und Zugänge nie ins Log; keine npm-Abhängigkeit – `node:crypto` reicht.
 */
import { createHmac, randomBytes } from "node:crypto";
import { LIVEKIT_GRENZEN, istLivekitUrl, type LivekitZugaenge } from "@freedomstack/protocol";

export interface LivekitDienst {
  url: string;
  schluessel: string;
  geheimnis: string;
  gueltigSek: number;
}

/** So lange gilt ein Zugang, wenn `LIVEKIT_GUELTIG_SEK` nichts anderes sagt. */
export const LIVEKIT_GUELTIG_SEK = 3_600;
/** Das API-Geheimnis muss mindestens so lang sein (LiveKit verlangt 32 Zeichen). */
export const LIVEKIT_GEHEIMNIS_MIN = 32;
const SCHLUESSEL = /^[A-Za-z0-9_-]{3,64}$/;

/**
 * Aus der Umgebung des Knotens: `LIVEKIT_URL` (`wss://…`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, optional
 * `LIVEKIT_GUELTIG_SEK`. Ohne alle aus – nie halb.
 */
export function livekitAusUmgebung(env: {
  LIVEKIT_URL?: string; LIVEKIT_API_KEY?: string; LIVEKIT_API_SECRET?: string; LIVEKIT_GUELTIG_SEK?: string;
}): { dienst?: LivekitDienst; grund?: string } {
  const url = (env.LIVEKIT_URL ?? "").trim();
  const schluessel = (env.LIVEKIT_API_KEY ?? "").trim();
  const geheimnis = env.LIVEKIT_API_SECRET ?? "";
  if (!url && !schluessel && !geheimnis) return { grund: "aus (LIVEKIT_URL, LIVEKIT_API_KEY und LIVEKIT_API_SECRET setzen)" };
  if (!istLivekitUrl(url)) return { grund: "LIVEKIT_URL ungültig (wss://host[:port])" };
  if (!SCHLUESSEL.test(schluessel)) return { grund: "LIVEKIT_API_KEY fehlt oder ist ungültig" };
  if (geheimnis.length < LIVEKIT_GEHEIMNIS_MIN) return { grund: `LIVEKIT_API_SECRET fehlt oder ist kürzer als ${LIVEKIT_GEHEIMNIS_MIN} Zeichen` };
  const gueltig = env.LIVEKIT_GUELTIG_SEK ? Number(env.LIVEKIT_GUELTIG_SEK) : LIVEKIT_GUELTIG_SEK;
  if (!Number.isSafeInteger(gueltig) || gueltig < 60 || gueltig > LIVEKIT_GRENZEN.hoechstensSek) return { grund: "LIVEKIT_GUELTIG_SEK ungültig (60 bis 86400)" };
  return { dienst: { url: url.replace(/\/$/, ""), schluessel, geheimnis, gueltigSek: gueltig } };
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

/** Ein JWT nach LiveKit: HS256, Felder wie `livekit-server-sdk`; der Kopf nennt zusätzlich `typ: "JWT"` (der SFU nimmt beides). */
export function livekitToken(d: LivekitDienst, raum: string, kennung: string, jetzt: number): string {
  const kopf = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const inhalt = b64url(JSON.stringify({
    iss: d.schluessel, sub: kennung, jti: kennung,
    // eine Minute Spielraum für eine falsch gehende Uhr beim SFU
    nbf: jetzt - 60, exp: jetzt + d.gueltigSek,
    video: { room: raum, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  }));
  const signatur = createHmac("sha256", d.geheimnis).update(`${kopf}.${inhalt}`).digest("base64url");
  return `${kopf}.${inhalt}.${signatur}`;
}

/** Je Teilnehmer ein frischer Zugang – zufällige Kennung, nur für diesen Raum. */
export function livekitZugaenge(d: LivekitDienst, raum: string, anzahl: number, jetzt = Math.floor(Date.now() / 1000)): LivekitZugaenge {
  const zugaenge: LivekitZugaenge["zugaenge"] = [];
  while (zugaenge.length < anzahl) {
    const kennung = randomBytes(8).toString("hex");
    if (!zugaenge.some((z) => z.kennung === kennung)) zugaenge.push({ kennung, token: livekitToken(d, raum, kennung, jetzt) });
  }
  return { url: d.url, raum, zugaenge, bis: jetzt + d.gueltigSek };
}
