/**
 * Vibecoden auf dem eigenen Knoten (Sammlung A-31, Entwurf
 * docs/VIBECODEN-ENTWURF.md, VKa): Der gekoppelte Besitzer gibt seinem Knoten
 * vom Handy aus Aufträge an Projekte – versiegelt vom Sitzungsschlüssel und mit
 * Besitzer-Nachweis (B-8), wie Status (5077) und TURN (5079). Fremde bekommen
 * nie Zugang: Der Knoten antwortet nur mit `istBesitzer()` aus einem Umschlag.
 *
 * Ein Auftrag ist ein Lauf: Der Knoten meldet jeden Schritt versiegelt als
 * Rückmeldung (7000, `partial`, Inhalt aus `codeSchrittText()`) an den
 * Sitzungsschlüssel des Auftrags und schließt mit dem Ergebnis (6080). Wartet
 * ein Schritt auf Freigabe, antwortet die App mit einem eigenen Code-Auftrag
 * (`freigabe`), der den Lauf über die Id seines Auftrags nennt
 * (docs/PROTOCOL.md 34).
 */
import { KIND_DVM_KNOTEN_CODE } from "./kinds.js";
import { type Kopplung, mitBesitzerNachweis } from "./kopplung.js";
import { buildJobRequest } from "./dvm.js";
import { buildPrivateJobRequest } from "./private-job.js";
import type { NostrEvent } from "./event.js";
import type { Signer } from "./signer.js";
import { type DateiSchluessel, istDateiSchluessel } from "./datei-krypto.js";

/** Grenzen – was darüber liegt, baut und liest dieses Modul nicht. */
export const CODE_GRENZEN = {
  /** Wunsch an den Agenten, in Zeichen. */
  text: 8000,
  /** Gedanke des Modells vor einem Befehl. */
  gedanke: 2000,
  /** Ein Befehl. */
  befehl: 2000,
  /** Ausgabe eines Befehls – darüber kürzt der Knoten (Anfang und Ende, wie mini-swe-agent). */
  ausgabe: 10_000,
  /** Abschluss des Agenten im Ergebnis. */
  abschluss: 4000,
  /** Schritte je Lauf. */
  schritte: 200,
  /** Projekte in der Liste. */
  projekte: 100,
  /** git-Bundle eines Projekts, in Byte (wie ein hochgeladenes Bundle in der App). */
  bundle: 32 * 1024 * 1024,
} as const;

/** Name eines Projekts: zugleich Name seines Ordners auf dem Knoten – klein, ohne Punkt und Schrägstrich. */
const PROJEKT = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function istProjektName(n: unknown): n is string {
  return typeof n === "string" && PROJEKT.test(n);
}

/** Wie der Agent Befehle ausführt: jeden erst nach Freigabe oder frei im Projekt (VK3). */
export type CodeModus = "fragen" | "frei";

export type CodeAktion =
  | { aktion: "liste" }
  | { aktion: "neu"; projekt: string }
  | { aktion: "auftrag"; projekt: string; text: string; modus: CodeModus }
  | { aktion: "freigabe"; lauf: string; schritt: number; ja: boolean }
  | { aktion: "stopp"; lauf: string }
  | { aktion: "bundle"; projekt: string };

export const CODE_AKTIONEN = ["liste", "neu", "auftrag", "freigabe", "stopp", "bundle"] as const;

/** Je Aktion die erlaubten Parameter, jeder genau einmal. */
const PARAMETER: Record<CodeAktion["aktion"], readonly string[]> = {
  liste: [],
  neu: ["projekt"],
  auftrag: ["projekt", "text", "modus"],
  freigabe: ["lauf", "schritt", "antwort"],
  stopp: ["lauf"],
  bundle: ["projekt"],
};

const istSchrittNr = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1 && (n as number) <= CODE_GRENZEN.schritte;

/** Aktion prüfen – dieselben Regeln beim Bauen (App) und Lesen (Knoten); sonst null. */
function gepruefteAktion(a: CodeAktion): CodeAktion | null {
  switch (a.aktion) {
    case "liste":
      return { aktion: "liste" };
    case "neu":
      return istProjektName(a.projekt) ? { aktion: "neu", projekt: a.projekt } : null;
    case "auftrag": {
      if (!istProjektName(a.projekt) || (a.modus !== "fragen" && a.modus !== "frei")) return null;
      if (typeof a.text !== "string" || a.text.trim() === "" || a.text.length > CODE_GRENZEN.text) return null;
      return { aktion: "auftrag", projekt: a.projekt, text: a.text, modus: a.modus };
    }
    case "freigabe":
      if (!HEX64.test(a.lauf) || !istSchrittNr(a.schritt) || typeof a.ja !== "boolean") return null;
      return { aktion: "freigabe", lauf: a.lauf, schritt: a.schritt, ja: a.ja };
    case "stopp":
      return HEX64.test(a.lauf) ? { aktion: "stopp", lauf: a.lauf } : null;
    case "bundle":
      return istProjektName(a.projekt) ? { aktion: "bundle", projekt: a.projekt } : null;
    default:
      return null;
  }
}

function parameterVon(a: CodeAktion): string[][] {
  switch (a.aktion) {
    case "liste": return [];
    case "neu": return [["projekt", a.projekt]];
    case "auftrag": return [["projekt", a.projekt], ["text", a.text], ["modus", a.modus]];
    case "freigabe": return [["lauf", a.lauf], ["schritt", String(a.schritt)], ["antwort", a.ja ? "ja" : "nein"]];
    case "stopp": return [["lauf", a.lauf]];
    case "bundle": return [["projekt", a.projekt]];
  }
}

/** Code-Auftrag an den eigenen Knoten – versiegelt, mit Nachweis, ohne Gebot. */
export async function baueCodeAuftrag(p: {
  sitzung: Signer; kopplung: Kopplung; aktion: CodeAktion; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; requestId: string }> {
  const a = gepruefteAktion(p.aktion);
  if (!a) throw new Error("Code-Auftrag ungültig");
  const kern = buildJobRequest({
    kind: KIND_DVM_KNOTEN_CODE, customerPubkey: p.sitzung.publicKey(), input: "code", bidMsat: 0, providerPubkey: p.kopplung.knoten,
    params: [["aktion", a.aktion], ...parameterVon(a)],
  }, p.nowSecs);
  const request = mitBesitzerNachweis(kern, p.kopplung);
  return buildPrivateJobRequest({ request, sessionSigner: p.sitzung, providerPk: p.kopplung.knoten, powBits: p.powBits, nowSecs: p.nowSecs });
}

/** Aktion aus dem Kern lesen (Knoten) – nur bekannte Aktionen, je Parameter genau ein Wert, keine anderen; sonst null. */
export function leseCodeAuftrag(request: Pick<NostrEvent, "kind" | "tags">): CodeAktion | null {
  if (request.kind !== KIND_DVM_KNOTEN_CODE) return null;
  const params = request.tags.filter((t) => t[0] === "param");
  if (params.some((t) => t.length !== 3 || typeof t[2] !== "string")) return null;
  const einzeln = (name: string): string | null => {
    const w = params.filter((t) => t[1] === name);
    return w.length === 1 ? w[0]![2]! : null;
  };
  const aktion = einzeln("aktion");
  if (aktion === null || !(CODE_AKTIONEN as readonly string[]).includes(aktion)) return null;
  const erlaubt = PARAMETER[aktion as CodeAktion["aktion"]];
  if (params.some((t) => t[1] !== "aktion" && !erlaubt.includes(t[1]!))) return null;
  const w: Record<string, string> = {};
  for (const name of erlaubt) {
    const v = einzeln(name);
    if (v === null) return null;
    w[name] = v;
  }
  switch (aktion) {
    case "liste": return gepruefteAktion({ aktion: "liste" });
    case "neu": return gepruefteAktion({ aktion: "neu", projekt: w.projekt! });
    case "auftrag": return gepruefteAktion({ aktion: "auftrag", projekt: w.projekt!, text: w.text!, modus: w.modus as CodeModus });
    case "freigabe": {
      if (!/^[1-9][0-9]{0,2}$/.test(w.schritt!) || (w.antwort !== "ja" && w.antwort !== "nein")) return null;
      return gepruefteAktion({ aktion: "freigabe", lauf: w.lauf!, schritt: Number(w.schritt), ja: w.antwort === "ja" });
    }
    case "bundle": return gepruefteAktion({ aktion: "bundle", projekt: w.projekt! });
    default: return gepruefteAktion({ aktion: "stopp", lauf: w.lauf! });
  }
}

/**
 * Ein Schritt eines Laufs (Rückmeldung 7000 mit `partial`): erst der Befehl
 * samt Gedanke des Modells – `wartet`, wenn er im Modus „fragen“ auf Freigabe
 * steht –, dann seine Ausgabe mit Rückgabewert.
 */
export type CodeSchritt =
  | { nr: number; art: "befehl"; gedanke: string; befehl: string; wartet: boolean }
  | { nr: number; art: "ausgabe"; ausgabe: string; code: number; gekuerzt: boolean };

const istText = (s: unknown, max: number): s is string => typeof s === "string" && s.length <= max;

function gepruefterSchritt(roh: unknown): CodeSchritt | null {
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const s = roh as Record<string, unknown>;
  if (!istSchrittNr(s.nr)) return null;
  if (s.art === "befehl") {
    if (Object.keys(s).length !== 5) return null;
    if (!istText(s.gedanke, CODE_GRENZEN.gedanke) || !istText(s.befehl, CODE_GRENZEN.befehl) || s.befehl.trim() === "") return null;
    if (typeof s.wartet !== "boolean") return null;
    return { nr: s.nr, art: "befehl", gedanke: s.gedanke, befehl: s.befehl, wartet: s.wartet };
  }
  if (s.art === "ausgabe") {
    if (Object.keys(s).length !== 5) return null;
    if (!istText(s.ausgabe, CODE_GRENZEN.ausgabe) || typeof s.gekuerzt !== "boolean") return null;
    if (!Number.isSafeInteger(s.code) || (s.code as number) < -1 || (s.code as number) > 255) return null;
    return { nr: s.nr, art: "ausgabe", ausgabe: s.ausgabe, code: s.code as number, gekuerzt: s.gekuerzt };
  }
  return null;
}

/** Schritt als Inhalt der Rückmeldung – dasselbe Format, das `leseCodeSchritt()` liest. */
export function codeSchrittText(s: CodeSchritt): string {
  const g = gepruefterSchritt(s);
  if (!g) throw new Error("Code-Schritt ungültig");
  return JSON.stringify(g);
}

/** Schritt streng lesen (App) – sonst null. */
export function leseCodeSchritt(text: string): CodeSchritt | null {
  try {
    return gepruefterSchritt(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Wie ein Lauf endete – feste Kennungen, die App bildet den Text. */
export const CODE_ENDEN = ["fertig", "grenze", "gestoppt", "abgelehnt", "fehler"] as const;
export type CodeEnde = (typeof CODE_ENDEN)[number];

export interface CodeProjekt {
  name: string;
  /** Schritte (Commits) im Projekt. */
  schritte: number;
  /** Letzte Änderung, Unix-Sekunden. */
  geaendert: number;
}

/** Antwort des Knotens (6080) je Aktion. */
export type CodeAntwort =
  | { aktion: "liste"; projekte: CodeProjekt[] }
  | { aktion: "neu"; projekt: string }
  | { aktion: "auftrag"; ende: CodeEnde; schritte: number; abschluss: string }
  | { aktion: "freigabe"; ok: boolean }
  | { aktion: "stopp"; ok: boolean }
  /**
   * Das Projekt als git-Bundle (VKl): verschlüsselt ins Blob-Netz gelegt (`blob`, Manifest-Event `manifest`),
   * hier nur der Schlüssel dazu – versiegelt an den Besitzer. Klartext-Größe in `bytes`.
   */
  | { aktion: "bundle"; blob: string; manifest: string; schluessel: DateiSchluessel; bytes: number };

const istSchrittZahl = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

function gepruefteAntwort(roh: unknown): CodeAntwort | null {
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const a = roh as Record<string, unknown>;
  const felder = Object.keys(a).length;
  switch (a.aktion) {
    case "liste": {
      if (felder !== 2 || !Array.isArray(a.projekte) || a.projekte.length > CODE_GRENZEN.projekte) return null;
      const projekte: CodeProjekt[] = [];
      for (const p of a.projekte as unknown[]) {
        if (typeof p !== "object" || p === null || Array.isArray(p) || Object.keys(p).length !== 3) return null;
        const { name, schritte, geaendert } = p as Record<string, unknown>;
        if (!istProjektName(name) || !istSchrittZahl(schritte) || !istSchrittZahl(geaendert)) return null;
        projekte.push({ name, schritte, geaendert });
      }
      if (new Set(projekte.map((p) => p.name)).size !== projekte.length) return null;
      return { aktion: "liste", projekte };
    }
    case "neu":
      return felder === 2 && istProjektName(a.projekt) ? { aktion: "neu", projekt: a.projekt } : null;
    case "auftrag":
      if (felder !== 4 || !(CODE_ENDEN as readonly unknown[]).includes(a.ende)) return null;
      if (!istSchrittZahl(a.schritte) || (a.schritte as number) > CODE_GRENZEN.schritte) return null;
      if (!istText(a.abschluss, CODE_GRENZEN.abschluss)) return null;
      return { aktion: "auftrag", ende: a.ende as CodeEnde, schritte: a.schritte as number, abschluss: a.abschluss };
    case "freigabe":
    case "stopp":
      return felder === 2 && typeof a.ok === "boolean" ? { aktion: a.aktion, ok: a.ok } : null;
    case "bundle": {
      if (felder !== 5 || typeof a.blob !== "string" || !HEX64.test(a.blob) || typeof a.manifest !== "string" || !HEX64.test(a.manifest)) return null;
      if (!istDateiSchluessel(a.schluessel) || Object.keys(a.schluessel as object).length !== 4) return null;
      if (!Number.isSafeInteger(a.bytes) || (a.bytes as number) < 1 || (a.bytes as number) > CODE_GRENZEN.bundle) return null;
      const k = a.schluessel as DateiSchluessel;
      return { aktion: "bundle", blob: a.blob, manifest: a.manifest, schluessel: { alg: k.alg, key: k.key, nonce: k.nonce, ox: k.ox }, bytes: a.bytes as number };
    }
    default:
      return null;
  }
}

/** Antwort des Knotens (6080) – dasselbe Format, das `leseCodeAntwort()` liest. */
export function codeAntwortText(a: CodeAntwort): string {
  const g = gepruefteAntwort(a);
  if (!g) throw new Error("Code-Antwort ungültig");
  return JSON.stringify(g);
}

/** Antwort streng lesen (App) – nur zur erwarteten Aktion, sonst null. */
export function leseCodeAntwort(text: string, erwartet: CodeAktion["aktion"]): CodeAntwort | null {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  const a = gepruefteAntwort(roh);
  return a && a.aktion === erwartet ? a : null;
}
