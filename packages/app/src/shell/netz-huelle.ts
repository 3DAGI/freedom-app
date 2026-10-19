/**
 * Direkt oder über Tor – der Schalter für die Hülle (6.1b1b Desktop, 6.1b2b Android;
 * Sammlung C-23).
 *
 * Mit „Tor“ startet die Hülle arti und gibt ihrem Fenster einen Zugang als Proxy
 * (6.1b1a/6.1b2a, `packages/launcher/src/netz.rs`): Dann geht der gesamte Verkehr der
 * App über Tor. Die Wahl gilt ab dem Start der Hülle – umschalten heißt neu starten;
 * unter Android schließt sich die App dafür (sie kann sich nicht selbst neu starten).
 * Mit „Tor“ geht nie etwas still direkt hinaus: Ist Tor nicht verbunden, scheitern
 * die Verbindungen. Anrufe (WebRTC) laufen nicht über den Proxy.
 * Im Browser bleibt der Schalter verborgen, ebenso, wo die Hülle keinen Proxy setzen kann.
 *
 * Brücken (B-33c, PT2 A, PT3 A, `docs/TOR-BRUECKEN-ENTWURF.md` V3–V5): ein zweiter Schalter, nur wenn die
 * Programme beiliegen (`brueckenMoeglich`, Desktop seit B-33b2). Eigene Zeilen gehen nur an die Hülle
 * (`netz_setzen`, geprüft dort) – die App merkt sie nie, sie erfährt nur ihre Zahl.
 */
import { t } from "../i18n.js";
import { bestaetige, dialog, hinweis } from "./dialog.js";
import { type HuellenAufruf, type HuellenArt, huellenArt, huellenAufruf } from "./oberflaeche-huelle.js";
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
  /** `proxy`: das WebView nahm den Zugang nicht an (Android); `bruecke`: Programm fehlt oder Zeile gilt nicht (B-33b1). */
  fehler: "start" | "bootstrap" | "proxy" | "bruecke" | null;
  /** Brücken gewählt – gilt ab dem nächsten Start (Hüllen vor B-33b1 nennen das nicht: aus). */
  bruecken: boolean;
  /** Diese Sitzung läuft über Brücken. */
  brueckenAktiv: boolean;
  /** Die Programme der Brücken liegen bei. */
  brueckenMoeglich: boolean;
  /** So viele eigene Zeilen hat die Hülle gemerkt. */
  eigeneZeilen: number;
}

const FEHLER = [null, "start", "bootstrap", "proxy", "bruecke"] as const;

/** Die Antwort auf `netz_stand`, streng gelesen – sonst `null`. Die Felder der Brücken fehlen bei älteren Hüllen. */
export function leseNetzStand(x: unknown): NetzStand | null {
  if (typeof x !== "object" || x === null) return null;
  const s = x as Record<string, unknown>;
  for (const k of ["verfuegbar", "tor", "aktiv", "bereit"]) if (typeof s[k] !== "boolean") return null;
  for (const k of ["bruecken", "brueckenAktiv", "brueckenMoeglich"]) if (k in s && typeof s[k] !== "boolean") return null;
  if ("eigeneZeilen" in s && !(Number.isSafeInteger(s.eigeneZeilen) && (s.eigeneZeilen as number) >= 0)) return null;
  const fehler = FEHLER.find((f) => f === s.fehler);
  if (fehler === undefined) return null;
  return {
    verfuegbar: s.verfuegbar as boolean, tor: s.tor as boolean, aktiv: s.aktiv as boolean, bereit: s.bereit as boolean, fehler,
    bruecken: s.bruecken === true, brueckenAktiv: s.brueckenAktiv === true, brueckenMoeglich: s.brueckenMoeglich === true,
    eigeneZeilen: (s.eigeneZeilen as number | undefined) ?? 0,
  };
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
    else if (s.fehler === "bootstrap") zeilen.push(t(s.brueckenAktiv ? "set.brueckeFehlerNetz" : "set.torFehlerNetz"));
    else if (s.fehler === "proxy") zeilen.push(t("set.torFehlerProxy"));
    else if (s.fehler === "bruecke") zeilen.push(t("set.brueckeFehlerStart"));
    else if (s.brueckenAktiv) zeilen.push(t(s.bereit ? "set.brueckeBereit" : "set.brueckeVerbindet"));
    else zeilen.push(t(s.bereit ? "set.torBereit" : "set.torVerbindet"));
  } else {
    zeilen.push(t("set.torDirekt"));
  }
  if (s.tor !== s.aktiv) zeilen.push(t(s.tor ? "set.torAbStart" : "set.direktAbStart"));
  else if (s.tor && s.bruecken !== s.brueckenAktiv) zeilen.push(t(s.bruecken ? "set.brueckeAbStart" : "set.ohneBrueckeAbStart"));
  if (s.bruecken && s.eigeneZeilen > 0) zeilen.push(t("set.brueckenEigene", { n: s.eigeneZeilen }));
  return zeilen;
}

/** Die Rückfrage je Hülle: Der Desktop startet neu, Android schließt die App. */
export function torRueckfrage(an: boolean, art: HuellenArt): { titel: string; text: string; ok: string } {
  const android = art === "android";
  return {
    titel: t(an ? "set.torAnTitel" : "set.torAusTitel"),
    text: t(an ? (android ? "set.torAnTextAndroid" : "set.torAnText") : android ? "set.torAusTextAndroid" : "set.torAusText"),
    ok: t(android ? "set.torSchliessen" : "set.torNeustart"),
  };
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

/** Die Rückfrage zu Brücken: mit Brücke geht die App über Tor (wenn nötig, schaltet sie es mit ein). */
export function brueckeRueckfrage(an: boolean, art: HuellenArt): { titel: string; text: string; ok: string } {
  return {
    titel: t(an ? "set.brueckeAnTitel" : "set.brueckeAusTitel"),
    text: t(an ? "set.brueckeAnText" : "set.brueckeAusText"),
    ok: t(art === "android" ? "set.torSchliessen" : "set.torNeustart"),
  };
}

/**
 * Eingefügte Brücken-Zeilen: eine je Zeile, auch in der Form von bridges.torproject.org und ihrem QR-Code
 * (`['webtunnel …', 'webtunnel …']`). Leere Zeilen fallen weg; geprüft wird in der Hülle.
 */
export function zeilenAusText(text: string): string[] {
  const roh = text.trim();
  const teile = roh.startsWith("[") && roh.endsWith("]") ? [...roh.slice(1, -1).matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? "") : roh.split(/\r?\n/);
  return teile.map((z) => z.trim()).filter((z) => z.length > 0);
}

/** Warum eine Zeile nicht gilt – je Kennung aus `bruecken.rs` (`ZeilenFehler::kennung()`) ein Text. */
const ZEILEN_GRUND: Record<string, string> = {
  leer: "set.brueckeGrundLeer",
  "zu-lang": "set.brueckeGrundZuLang",
  "zu-viele": "set.brueckeGrundZuViele",
  zeichen: "set.brueckeGrundZeichen",
  transport: "set.brueckeGrundTransport",
  adresse: "set.brueckeGrundAdresse",
  fingerabdruck: "set.brueckeGrundFingerabdruck",
  parameter: "set.brueckeGrundParameter",
  arti: "set.brueckeGrundArti",
};

/** Fehler der Hülle beim Setzen (`zeile:<stelle>:<kennung>`, `bruecken-fehlen`) als Text – nie ihr Wortlaut. */
export function brueckenFehlerText(e: unknown): string {
  const m = typeof e === "string" ? /^zeile:(\d{1,3}):([a-z-]{1,20})$/.exec(e) : null;
  const grund = m && Object.hasOwn(ZEILEN_GRUND, m[2]!) ? ZEILEN_GRUND[m[2]!] : undefined;
  if (m && grund) return t("set.brueckeZeileFalsch", { nr: Number(m[1]) + 1, grund: t(grund) });
  if (e === "bruecken-fehlen") return t("set.brueckenFehlen");
  return t("set.torNichtGespeichert");
}

/** Speichert Brücken (an/aus, eigene Zeilen) – nur über die Hülle; Fehler als Text (`brueckenFehlerText()`). */
export async function setzeBruecken(
  wahl: { tor: boolean; neustart: boolean; bruecken?: boolean; zeilen?: string[] },
  aufruf: HuellenAufruf | null = huellenAufruf(),
): Promise<string | null> {
  if (!aufruf) return t("set.torNichtGespeichert");
  try {
    await aufruf("netz_setzen", wahl);
    return null;
  } catch (e) {
    return brueckenFehlerText(e);
  }
}

/** Settings › Datenschutz: der Schalter – sichtbar nur in der Hülle, wenn sie Tor kann. */
export async function wireHuellenTor(): Promise<void> {
  const block = $("#huelle-tor-block");
  const haken = $("#huelle-tor") as HTMLInputElement | null;
  const standBox = $("#huelle-tor-stand");
  const art = huellenArt();
  if (!block || !haken || !standBox || !art) return;
  const stand = await netzStand();
  if (!stand?.verfuegbar) return;
  block.classList.remove("hidden");
  haken.checked = stand.tor;
  standBox.textContent = netzZeilen(stand).join(" ");
  haken.onchange = async () => {
    const an = haken.checked;
    const ok = await bestaetige(torRueckfrage(an, art));
    if (!ok || !(await setzeTor(an))) {
      haken.checked = !an;
      if (ok) standBox.textContent = t("set.torNichtGespeichert");
    }
  };
  wireBruecken(stand, art, standBox);
}

/** Der Schalter für Brücken und „Eigene Brücken“ – nur, wenn die Programme beiliegen. */
function wireBruecken(stand: NetzStand, art: HuellenArt, standBox: HTMLElement): void {
  const block = $("#huelle-bruecke-block");
  const haken = $("#huelle-bruecke") as HTMLInputElement | null;
  const knopf = $("#huelle-bruecken-zeilen") as HTMLButtonElement | null;
  if (!block || !haken || !knopf || !stand.brueckenMoeglich) return;
  block.classList.remove("hidden");
  haken.checked = stand.bruecken;
  haken.onchange = async () => {
    const an = haken.checked;
    const ok = await bestaetige(brueckeRueckfrage(an, art));
    const fehler = ok ? await setzeBruecken({ tor: an || stand.tor, neustart: true, bruecken: an }) : null;
    if (!ok || fehler) {
      haken.checked = !an;
      if (fehler) standBox.textContent = fehler;
    }
  };
  knopf.onclick = async () => {
    let text = "";
    let fehler: string | undefined;
    for (;;) {
      const w = await dialog({
        titel: t("set.brueckenTitel"),
        text: fehler ?? t("set.brueckenDialogText"),
        felder: [{ art: "textarea", name: "zeilen", label: t("set.brueckenFeld"), wert: text, mono: true, scannen: true }],
        ok: t("set.brueckenMerken"),
      });
      if (!w) return;
      text = String(w.zeilen ?? "");
      const zeilen = zeilenAusText(text);
      const f = await setzeBruecken({ tor: stand.tor, neustart: false, zeilen });
      if (!f) {
        await hinweis(t("set.brueckenTitel"), t(zeilen.length ? "set.brueckenGemerkt" : "set.brueckenEingebaut", { n: zeilen.length }));
        return;
      }
      fehler = f;
    }
  };
}
