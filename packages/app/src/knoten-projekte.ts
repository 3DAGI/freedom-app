/**
 * Projekte meines Knotens (VKl2, Entwurf `docs/VIBECODEN-ENTWURF.md`, „Als Repo in einen Raum stellen“):
 * Zeilen, Texte und der Bundle-Verweis ohne DOM. Gezeigt wird nur Text; Ablehnungen des Knotens nur über
 * ihre Kennung (`fall`), nie Text vom Knoten.
 */
import type { CodeAntwort, CodeProjekt, GitRepoRef } from "@freedomstack/protocol";
import { gebietsschema, t } from "./i18n.js";

/** Liste: kurz. Bundle: Packen, Verschlüsseln und Veröffentlichen auf dem Knoten – bei 32 MB dauert das. */
export const CODE_ZEIT_MS = 20_000;
export const BUNDLE_ZEIT_MS = 180_000;
export const CODE_TAKT_MS = 1500;

/** Kennungen des Knotens (`CodeAbgelehnt` in `node/src/projekte.ts`) – ein Test vergleicht die Listen. */
export const CODE_FALL_TEXT: Record<string, string> = {
  "code-aus": "set.codeAus",
  "code-ohne-motor": "set.codeOhneMotor",
  "code-belegt": "set.codeBelegt",
  "code-zu-viele": "set.codeZuViele",
  "code-git": "set.codeGit",
  "code-ablage": "set.codeAblage",
  "code-leer": "set.codeLeer",
  "code-zu-gross": "set.codeZuGross",
  "code-commit": "set.codeCommit",
};

/** Warum der Knoten ablehnte – bekannte Kennung als Text, sonst nur, dass er ablehnte (seine Meldung bleibt draußen). */
export function codeAblehnungText(fall: string | undefined): string {
  return fall && Object.hasOwn(CODE_FALL_TEXT, fall) ? t(CODE_FALL_TEXT[fall]!) : t("set.codeAbgelehnt");
}

/** Eine Zeile je Projekt – Name, Schritte, letzte Änderung. */
export function projektZeile(p: CodeProjekt): string {
  const datum = new Date(p.geaendert * 1000).toLocaleDateString(gebietsschema(), { day: "numeric", month: "short", year: "numeric" });
  return t("set.projektZeile", { name: p.name, n: p.schritte, datum });
}

/**
 * Der Bundle-Verweis (38042) aus der Antwort des Knotens – derselbe wie nach einem Upload (`ladeBundleHoch()`):
 * Blob und Schlüssel vom Knoten, Version aus der Uhr.
 */
export function bundleVerweis(id: string, a: Extract<CodeAntwort, { aktion: "bundle" }>, jetzt: number): GitRepoRef {
  return { name: id, blobId: a.blob, headSha: "local", branch: "main", message: `bundle ${id}`, version: jetzt, schluessel: a.schluessel }; // kein UI-Text
}
