/**
 * Neue Oberfläche in der Desktop-Hülle installieren (6.1a3c, Sammlung C-23).
 *
 * Nur in der Hülle (`packages/launcher`, erkennbar an `window.__FREEDOM_NATIVE__`):
 * Die App findet ein Update über `suchUpdate()` (Settings › Echtheit), lädt die
 * Datei von einer https-Quelle des Angebots und prüft sie (`pruefeDatei()`). Erst
 * nach der Rückfrage gibt sie Datei und Belege an die Hülle – und die prüft
 * dieselben Belege selbst noch einmal (`update::pruefe()`): Die App kann ihr
 * nichts unterschieben, was nicht k vertraute Signierer bestätigt haben.
 * Zurück geht es nur über den Start der Hülle (`--oberflaeche=vorher`), nie von hier.
 */
import { type UpdateAngebot, UPDATE_GRENZEN, pruefeDatei } from "@freedomstack/protocol";
import { t } from "../i18n.js";

/** Ein Kommando der Hülle (Tauri `invoke`). */
export type HuellenAufruf = (befehl: string, argumente?: Record<string, unknown>) => Promise<unknown>;

/** Was die Hülle über die laufende Oberfläche sagt (`oberflaeche_stand`). */
export interface HuellenStand {
  quelle: "beigelegt" | "installiert";
  version: string | null;
  sha256: string;
  /** Zeitpunkt der laufenden Fassung (Unix-Sekunden), 0 = unbekannt. */
  releasedAt: number;
  /** Diesmal mit `--oberflaeche=beigelegt` gestartet. */
  nurBeigelegt: boolean;
  /** Es gibt eine vorige installierte Fassung. */
  vorher: boolean;
}

/** Kennungen, mit denen die Hülle ablehnt (`installation.rs`, `update.rs`). */
export const HUELLEN_FEHLER = ["kein-beleg", "zu-wenig", "abweichend", "nicht-neuer", "zu-gross", "keine-ablage", "ablage"] as const;
export type InstallFehler = (typeof HUELLEN_FEHLER)[number] | "keine-huelle" | "laden" | "kodierung" | "unbekannt";

/** Text je Fehler (`texte/settings.ts`). */
export const INSTALL_FEHLER_TEXT: Record<InstallFehler, string> = {
  "kein-beleg": "set.huelleFKeinBeleg", "zu-wenig": "set.huelleFZuWenig", abweichend: "set.huelleFAbweichend",
  "nicht-neuer": "set.huelleFNichtNeuer", "zu-gross": "set.huelleFZuGross", "keine-ablage": "set.huelleFKeineAblage",
  ablage: "set.huelleFAblage", "keine-huelle": "set.huelleFKeineHuelle", laden: "set.huelleFLaden",
  kodierung: "set.huelleFKodierung", unbekannt: "set.huelleFUnbekannt",
};

/** Was die Settings über die laufende Oberfläche der Hülle sagen. */
export function huellenStandZeilen(s: HuellenStand): string[] {
  const zeilen = [s.quelle === "installiert" && s.version ? t("set.huelleInstalliert", { version: s.version }) : t("set.huelleBeigelegt")];
  if (s.nurBeigelegt) zeilen.push(t("set.huelleNurBeigelegt"));
  if (s.vorher) zeilen.push(t("set.huelleVorher"));
  return zeilen;
}

/** Der Weg in die Hülle – nur dort, sonst `null` (Browser). */
export function huellenAufruf(w: unknown = globalThis): HuellenAufruf | null {
  const g = w as { __FREEDOM_NATIVE__?: { huelle?: unknown }; __TAURI_INTERNALS__?: { invoke?: unknown } };
  const innen = g.__TAURI_INTERNALS__;
  if (g.__FREEDOM_NATIVE__?.huelle !== "desktop" || typeof innen?.invoke !== "function") return null;
  const invoke = innen.invoke as HuellenAufruf;
  // nie als Methode gespeichert aufrufen (wie bei `fetch`): `this` bleibt das Objekt der Hülle
  return (befehl, argumente) => invoke.call(innen, befehl, argumente);
}

/** Die Antwort auf `oberflaeche_stand`, streng gelesen – sonst `null`. */
export function leseHuellenStand(x: unknown): HuellenStand | null {
  if (typeof x !== "object" || x === null) return null;
  const s = x as Record<string, unknown>;
  if (s.quelle !== "beigelegt" && s.quelle !== "installiert") return null;
  if (!(s.version === null || (typeof s.version === "string" && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/.test(s.version)))) return null;
  if (typeof s.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(s.sha256)) return null;
  if (typeof s.releasedAt !== "number" || !Number.isSafeInteger(s.releasedAt) || s.releasedAt < 0) return null;
  if (typeof s.nurBeigelegt !== "boolean" || typeof s.vorher !== "boolean") return null;
  return { quelle: s.quelle, version: s.version, sha256: s.sha256, releasedAt: s.releasedAt, nurBeigelegt: s.nurBeigelegt, vorher: s.vorher };
}

/** Stand der Oberfläche – nur in der Hülle, sonst `null`. */
export async function huellenStand(aufruf: HuellenAufruf | null = huellenAufruf()): Promise<HuellenStand | null> {
  if (!aufruf) return null;
  try {
    return leseHuellenStand(await aufruf("oberflaeche_stand"));
  } catch {
    return null;
  }
}

type Holen = (url: string, o: RequestInit) => Promise<Response>;

/** Höchstens `grenze` Bytes – wer mehr schickt, schickt nicht die angebotene Datei. */
async function leseBis(res: Response, grenze: number): Promise<Uint8Array | null> {
  const leser = res.body?.getReader();
  if (!leser) return null;
  const teile: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    n += value.length;
    if (n > grenze) {
      await leser.cancel().catch(() => undefined);
      return null;
    }
    teile.push(value);
  }
  const aus = new Uint8Array(n);
  let i = 0;
  for (const t of teile) {
    aus.set(t, i);
    i += t.length;
  }
  return aus;
}

/** Lädt die angebotene Datei: Quelle für Quelle, bis eine genau passt (Größe, SHA-256). */
export async function ladeOberflaeche(angebot: UpdateAngebot, holen: Holen = (u, o) => fetch(u, o)): Promise<Uint8Array | null> {
  const grenze = Math.min(angebot.sizeBytes, UPDATE_GRENZEN.bytes);
  for (const quelle of angebot.quellen.slice(0, UPDATE_GRENZEN.quellen)) {
    try {
      const res = await holen(quelle, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) continue;
      const daten = await leseBis(res, grenze);
      if (daten && pruefeDatei(angebot, daten).ok) return daten;
    } catch {
      // nächste Quelle
    }
  }
  return null;
}

/** Die Datei als Text für die Hülle – UTF-8 streng, ein BOM bleibt: Die Hülle bekommt genau dieselben Bytes. */
export function alsText(daten: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(daten);
  } catch {
    return null;
  }
}

/** Gibt die geprüfte Datei mit den Belegen an die Hülle. Gefragt wird vorher (`bestaetige()`), nicht hier. */
export async function uebergibHuelle(
  angebot: UpdateAngebot,
  daten: Uint8Array,
  aufruf: HuellenAufruf | null = huellenAufruf(),
): Promise<{ ok: true; stand: HuellenStand } | { ok: false; fehler: InstallFehler }> {
  if (!aufruf) return { ok: false, fehler: "keine-huelle" };
  if (!pruefeDatei(angebot, daten).ok) return { ok: false, fehler: "laden" };
  const html = alsText(daten);
  if (html === null) return { ok: false, fehler: "kodierung" };
  try {
    const stand = leseHuellenStand(await aufruf("oberflaeche_installieren", { html, belege: angebot.belege }));
    return stand ? { ok: true, stand } : { ok: false, fehler: "unbekannt" };
  } catch (e) {
    const fehler = (HUELLEN_FEHLER as readonly unknown[]).includes(e) ? (e as InstallFehler) : "unbekannt";
    return { ok: false, fehler };
  }
}
