/**
 * Direkt oder über Tor – der Schalter für die Desktop-Hülle (6.1b1b, Sammlung C-23).
 *
 * Mit „Tor“ startet die Hülle arti und gibt ihrem Fenster einen SOCKS5-Zugang als
 * Proxy (6.1b1a, `packages/launcher/src/netz.rs`): Dann geht der gesamte Verkehr der
 * App über Tor. Die Wahl gilt ab dem Start der Hülle – umschalten heißt neu starten.
 * Mit „Tor“ geht nie etwas still direkt hinaus: Ist Tor nicht verbunden, scheitern
 * die Verbindungen. Anrufe (WebRTC) laufen nicht über den Proxy.
 * Nur Desktop; im Browser und unter Android bleibt der Schalter verborgen.
 */
import { t } from "../i18n.js";
import { bestaetige } from "./dialog.js";
import { type HuellenAufruf, huellenArt, huellenAufruf } from "./oberflaeche-huelle.js";
import { $ } from "./ui.js";

/** Was die Hülle über ihr Netz sagt (`netz_stand`). */
export interface NetzStand {
  /** Diese Hülle kann Tor (Desktop). */
  verfuegbar: boolean;
  /** Gewählt – gilt ab dem nächsten Start. */
  tor: boolean;
  /** Diese Sitzung läuft über Tor. */
  aktiv: boolean;
  /** Tor ist verbunden. */
  bereit: boolean;
  fehler: "start" | "bootstrap" | null;
}

/** Die Antwort auf `netz_stand`, streng gelesen – sonst `null`. */
export function leseNetzStand(x: unknown): NetzStand | null {
  if (typeof x !== "object" || x === null) return null;
  const s = x as Record<string, unknown>;
  for (const k of ["verfuegbar", "tor", "aktiv", "bereit"]) if (typeof s[k] !== "boolean") return null;
  if (!(s.fehler === null || s.fehler === "start" || s.fehler === "bootstrap")) return null;
  return { verfuegbar: s.verfuegbar as boolean, tor: s.tor as boolean, aktiv: s.aktiv as boolean, bereit: s.bereit as boolean, fehler: s.fehler };
}

/** Stand des Netzes – nur in der Hülle, sonst `null`. */
export async function netzStand(aufruf: HuellenAufruf | null = huellenAufruf()): Promise<NetzStand | null> {
  if (!aufruf) return null;
  try {
    return leseNetzStand(await aufruf("netz_stand"));
  } catch {
    return null;
  }
}

/** Was die Settings sagen: wie diese Sitzung läuft und was ab dem nächsten Start gilt. */
export function netzZeilen(s: NetzStand): string[] {
  const zeilen: string[] = [];
  if (s.aktiv) {
    if (s.fehler === "start") zeilen.push(t("set.torFehlerStart"));
    else if (s.fehler === "bootstrap") zeilen.push(t("set.torFehlerNetz"));
    else zeilen.push(t(s.bereit ? "set.torBereit" : "set.torVerbindet"));
  } else {
    zeilen.push(t("set.torDirekt"));
  }
  if (s.tor !== s.aktiv) zeilen.push(t(s.tor ? "set.torAbStart" : "set.direktAbStart"));
  return zeilen;
}

/** Speichert die Wahl und startet die Hülle neu – nur nach Rückfrage (`wireHuellenTor()`). */
export async function setzeTor(an: boolean, aufruf: HuellenAufruf | null = huellenAufruf()): Promise<boolean> {
  if (!aufruf) return false;
  try {
    await aufruf("netz_setzen", { tor: an, neustart: true });
    return true;
  } catch {
    return false;
  }
}

/** Settings › Datenschutz: der Schalter – sichtbar nur in der Desktop-Hülle. */
export async function wireHuellenTor(): Promise<void> {
  const block = $("#huelle-tor-block");
  const haken = $("#huelle-tor") as HTMLInputElement | null;
  const standBox = $("#huelle-tor-stand");
  if (!block || !haken || !standBox || huellenArt() !== "desktop") return;
  const stand = await netzStand();
  if (!stand?.verfuegbar) return;
  block.classList.remove("hidden");
  haken.checked = stand.tor;
  standBox.textContent = netzZeilen(stand).join(" ");
  haken.onchange = async () => {
    const an = haken.checked;
    const ok = await bestaetige({
      titel: t(an ? "set.torAnTitel" : "set.torAusTitel"),
      text: t(an ? "set.torAnText" : "set.torAusText"),
      ok: t("set.torNeustart"),
    });
    if (!ok || !(await setzeTor(an))) {
      haken.checked = !an;
      if (ok) standBox.textContent = t("set.torNichtGespeichert");
    }
  };
}
