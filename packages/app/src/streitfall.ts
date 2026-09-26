/**
 * Streitfall in der App (Schritt 5.6b): Prüfer aus dem eigenen Netz, und die
 * eigenen Reklamationen, bis ihr Urteil da ist.
 *
 * Den Prüfer wählt der Nutzer unter seinen Kontakten und seinen eigenen
 * Providern (Allowlist) – nie aus einer Rangliste des Netzes. Das Urteil geht
 * versiegelt an den Sitzungsschlüssel, von dem die Reklamation kam; damit es
 * auch nach einem Neustart lesbar ist, merkt sich die App diesen Schlüssel für
 * die Reklamation – nur im Tresor (`geheim`), höchstens 30 Tage.
 */
import { KIND_JOB_DISPUTE, type Dispute, type DisputeReason, type Resolution, type UnsignedEvent, parseDispute } from "@freedomstack/protocol";

/** Eigene Reklamationen samt Sitzungsschlüssel – liegt nur im Tresor. */
export const LS_REKLAMATIONEN = "freedom.reklamationen";
export const REKLAMATION_AUFBEWAHREN_SECS = 30 * 24 * 3600;
const MAX_REKLAMATIONEN = 50;
const HEX64 = /^[0-9a-f]{64}$/;

export interface Pruefer {
  pk: string;
  name: string;
  art: "kontakt" | "eigener Provider";
}

/**
 * Prüfer aus dem eigenen Netz: Kontakte (Direktnachrichten) und eigene
 * Provider – ohne die Beteiligten, ohne Doppelte, höchstens neun.
 */
export function prueferAusNetz(
  kontakte: ReadonlyArray<{ id: string; name: string; type: string }>,
  eigeneProvider: readonly string[],
  ausschliessen: readonly string[],
): Pruefer[] {
  const raus = new Set(ausschliessen);
  const out = new Map<string, Pruefer>();
  for (const k of kontakte) {
    if (k.type !== "dm" || !HEX64.test(k.id) || raus.has(k.id)) continue;
    out.set(k.id, { pk: k.id, name: k.name.trim().slice(0, 40) || `${k.id.slice(0, 8)}…`, art: "kontakt" });
  }
  for (const pk of eigeneProvider) {
    if (!HEX64.test(pk) || raus.has(pk) || out.has(pk)) continue;
    out.set(pk, { pk, name: `${pk.slice(0, 8)}…`, art: "eigener Provider" });
  }
  return [...out.values()].slice(0, 9);
}

export interface EigeneReklamation {
  jobId: string;
  providerPk: string;
  pruefer: string;
  prueferName: string;
  /** Sitzungsschlüssel (hex), von dem die Reklamation kam – das Urteil geht an ihn. */
  sitzungSk: string;
  grund: DisputeReason;
  betragMsat: number;
  at: number;
  urteil?: { ergebnis: Resolution; erstattungMsat: number; notiz: string; at: number };
}

const GRUENDE: readonly DisputeReason[] = ["nichts_geliefert", "unbrauchbar", "falsches_modell", "abgebrochen"];
const ERGEBNISSE: readonly Resolution[] = ["erstattet", "bestaetigt", "geteilt", "unentschieden"];
const ganz = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

/** Aus dem Tresor lesen – Unbrauchbares und Abgelaufenes fällt weg. */
export function leseReklamationen(roh: string | null, jetzt: number): EigeneReklamation[] {
  let liste: unknown;
  try {
    liste = JSON.parse(roh ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(liste)) return [];
  return liste.filter((r): r is EigeneReklamation => {
    if (typeof r !== "object" || r === null) return false;
    const x = r as Partial<EigeneReklamation>;
    const urteilOk = x.urteil === undefined || (typeof x.urteil === "object" && x.urteil !== null
      && ERGEBNISSE.includes(x.urteil.ergebnis) && ganz(x.urteil.erstattungMsat) && typeof x.urteil.notiz === "string" && ganz(x.urteil.at));
    return typeof x.jobId === "string" && HEX64.test(x.jobId) && typeof x.providerPk === "string" && HEX64.test(x.providerPk)
      && typeof x.pruefer === "string" && HEX64.test(x.pruefer) && typeof x.prueferName === "string"
      && typeof x.sitzungSk === "string" && HEX64.test(x.sitzungSk) && GRUENDE.includes(x.grund as DisputeReason)
      && ganz(x.betragMsat) && ganz(x.at) && jetzt - x.at <= REKLAMATION_AUFBEWAHREN_SECS && urteilOk;
  }).slice(-MAX_REKLAMATIONEN);
}

/** Eine neue Reklamation merken (dieselbe Aufgabe ersetzt die alte). */
export function mitReklamation(liste: readonly EigeneReklamation[], r: EigeneReklamation): EigeneReklamation[] {
  return [...liste.filter((x) => x.jobId !== r.jobId), r].slice(-MAX_REKLAMATIONEN);
}

const WAS: Record<Resolution, string> = {
  erstattet: "gibt dir recht",
  bestaetigt: "gibt dem Provider recht",
  geteilt: "schlägt vor, den Betrag zu teilen",
  unentschieden: "kann es nicht beurteilen",
};

/** Eine Zeile für die Anzeige (textContent). */
export function reklamationText(r: EigeneReklamation): string {
  if (!r.urteil) return `wartet auf das Urteil von ${r.prueferName}`;
  const betrag = r.urteil.erstattungMsat > 0 ? ` – ${Math.floor(r.urteil.erstattungMsat / 1000)} sats zurück` : "";
  return `${r.prueferName} ${WAS[r.urteil.ergebnis]}${betrag}. Das gilt nur zwischen dir und dem Provider; erstatten muss er selbst.`;
}

// ------------------------------------------------------------ als Pruefer (5.6c)

/** Beantwortete Pruefauftraege (nur IDs der Reklamationen – nichts vom Inhalt). */
export const LS_PRUEFUNGEN_ERLEDIGT = "freedom.pruefungen.erledigt";

/**
 * Ist dieser Kern ein Pruefauftrag an mich? Nur eine Reklamation, die mich als
 * Pruefer nennt – sonst urteile ich ueber etwas, das niemand von mir wollte.
 */
export function pruefauftragAus(kern: UnsignedEvent & { id: string }, ich: string): (Dispute & { id: string }) | null {
  if (kern.kind !== KIND_JOB_DISPUTE) return null;
  try {
    const d = parseDispute({ ...kern, sig: "" });
    if (!d.pruefer.includes(ich) || !HEX64.test(d.jobId) || !HEX64.test(d.providerPubkey) || !ganz(d.amountMsat)) return null;
    return { ...d, id: kern.id };
  } catch {
    return null;
  }
}

/** Was bei welchem Urteil zurueckgeht – wie `resolveDispute()` es rechnet. */
export function erstattungFuer(ergebnis: Resolution, betragMsat: number): number {
  return ergebnis === "erstattet" ? betragMsat : ergebnis === "geteilt" ? Math.floor(betragMsat / 2) : 0;
}

export function leseErledigt(roh: string | null): string[] {
  try {
    const l = JSON.parse(roh ?? "[]") as unknown;
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string" && HEX64.test(x)).slice(-200) : [];
  } catch {
    return [];
  }
}
