/**
 * Server: initData-Verifikation (Telegram HMAC).
 *
 * Telegram hängt an jeden Mini-App-Start einen signierten Query-String
 * (`initData`) an. Der Server muss die Signatur prüfen, bevor er einer
 * User-ID vertraut — `initDataUnsafe.user.id` im Browser ist frei wählbar.
 *
 * Ablauf (Telegram-Vorgabe):
 *   1. Alle Felder außer `hash` alphabetisch nach Key sortieren.
 *   2. Zu einer Zeichenkette `key=value` joinen, getrennt durch `\n`.
 *   3. secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
 *   4. Prüfen: HMAC_SHA256(key=secret_key, msg=check_string) === hash (hex)
 *
 * Timing-sicher vergleichen, sonst Timing-Angriff.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface TmaInitData {
  /** Telegram-User-ID (nur nach erfolgreicher Prüfung vertrauenswürdig). */
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string;
  /** Startparameter (startapp / ?start=...) falls gesetzt. */
  startParam?: string;
  /** Zeitpunkt der Signierung (Unix-Sekunden). */
  authDate: number;
  /** Roher, verifizierter String (für Logs/Widerspruch). */
  raw: string;
}

export interface PruefErgebnis {
  ok: boolean;
  data?: TmaInitData;
  /** Grund bei ok=false — nie an den Client zurückgeben. */
  grund?: string;
}

/** Maximale Alter der Signatur (24 h) — danach gilt sie als veraltet. */
const MAX_ALTER_SEK = 24 * 3600;

/**
 * Prüft einen rohen `initData`-String gegen den Bot-Token.
 * `jetztSek` für Tests injizierbar.
 */
export function pruefeInitData(initData: string, botToken: string, jetztSek = Math.floor(Date.now() / 1000)): PruefErgebnis {
  if (!initData || !botToken) return { ok: false, grund: "leer" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, grund: "kein hash" };

  // 1. Check-String bauen
  const paare: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    paare.push(`${k}=${v}`);
  }
  paare.sort();
  const checkString = paare.join("\n");

  // 2. secret_key = HMAC(bot_token, "WebAppData")
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  // 3. Signatur
  const sig = createHmac("sha256", secret).update(checkString).digest("hex");

  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, grund: "signatur" };

  // 4. User + Alter
  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, grund: "kein user" };
  let user: Record<string, unknown>;
  try { user = JSON.parse(userRaw) as Record<string, unknown>; }
  catch { return { ok: false, grund: "user-json" }; }
  const id = Number(user.id);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, grund: "user-id" };

  const authDate = Number(params.get("auth_date") ?? "0");
  if (!authDate || Math.abs(jetztSek - authDate) > MAX_ALTER_SEK) return { ok: false, grund: "auth_date" };

  const sp = params.get("start_param");
  return {
    ok: true,
    data: {
      userId: id,
      username: typeof user.username === "string" ? user.username : undefined,
      firstName: typeof user.first_name === "string" ? user.first_name : undefined,
      lastName: typeof user.last_name === "string" ? user.last_name : undefined,
      languageCode: typeof user.language_code === "string" ? user.language_code : undefined,
      isPremium: user.is_premium === true,
      photoUrl: typeof user.photo_url === "string" ? user.photo_url : undefined,
      startParam: sp ?? undefined,
      authDate,
      raw: initData,
    },
  };
}

/**
 * Extrahiert `initData` aus `Authorization: tma <initData>`.
 * (Format: kleines "tma", Leerzeichen, der rohe Query-String.)
 */
export function initDataAusHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^tma\s+(.+)$/i);
  return m?.[1];
}
