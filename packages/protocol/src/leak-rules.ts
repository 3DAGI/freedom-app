/**
 * Regeln fuer Leak-Tests (Schritt 1.5 im Ausbauplan).
 *
 * Ein Leak-Test schneidet mit, was veroeffentlicht wird, und prueft es gegen
 * diese Regeln. Jede Regel liefert die Verstoesse – eine leere Liste heisst:
 * eingehalten.
 */
import type { NostrEvent } from "./event.js";
import { toHex } from "./htlc.js";

export interface LeakFinding {
  regel: string;
  eventId: string;
  detail: string;
}

/** Keine Direktnachrichten im alten, offenen Format (Kind 4). */
export function regelKeinKind4(events: readonly NostrEvent[]): LeakFinding[] {
  return events
    .filter((e) => e.kind === 4)
    .map((e) => ({ regel: "kein-kind4", eventId: e.id, detail: "Kind-4-DM veröffentlicht" }));
}

/** Kein Klartext (ab 6 Zeichen) im Inhalt oder in Tags. */
export function regelKeinKlartext(events: readonly NostrEvent[], klartexte: readonly string[]): LeakFinding[] {
  const funde: LeakFinding[] = [];
  for (const e of events) {
    const sichtbar = e.content + "\n" + JSON.stringify(e.tags);
    for (const k of klartexte) {
      if (k.length >= 6 && sichtbar.includes(k)) {
        funde.push({ regel: "kein-klartext", eventId: e.id, detail: `Klartext sichtbar: ${k.slice(0, 20)}…` });
      }
    }
  }
  return funde;
}

/** Ein bestimmter Schluessel darf nicht als Autor auftauchen. */
export function regelAutorNicht(events: readonly NostrEvent[], pubkey: string): LeakFinding[] {
  return events
    .filter((e) => e.pubkey === pubkey)
    .map((e) => ({ regel: "autor-verborgen", eventId: e.id, detail: "echter Absender ist Autor" }));
}

/** p-Tags nur an erlaubte Empfaenger. */
export function regelPTagsNur(events: readonly NostrEvent[], erlaubt: readonly string[]): LeakFinding[] {
  const funde: LeakFinding[] = [];
  for (const e of events) {
    for (const t of e.tags) {
      if (t[0] === "p" && !erlaubt.includes(t[1])) {
        funde.push({ regel: "p-tags", eventId: e.id, detail: `unerwarteter Empfänger ${t[1].slice(0, 8)}…` });
      }
    }
  }
  return funde;
}

/** KI-Anfragen (Kind 5000–5999) ohne Klartext-Prompt – Schritt 3.1. */
export function regelKeinKlartextPrompt(events: readonly NostrEvent[], prompts: readonly string[]): LeakFinding[] {
  return regelKeinKlartext(events.filter((e) => e.kind >= 5000 && e.kind < 6000), prompts)
    .map((f) => ({ ...f, regel: "kein-klartext-prompt", detail: f.detail.replace("Klartext sichtbar", "Prompt sichtbar") }));
}

/** Der Hauptschluessel des Kunden weder als Autor noch als p-Tag (Job- und Sitzungs-Events) – Schritt 3.1. */
export function regelKundeVerborgen(events: readonly NostrEvent[], kundePk: string): LeakFinding[] {
  return events
    .filter((e) => e.pubkey === kundePk || e.tags.some((t) => t[0] === "p" && t[1] === kundePk))
    .map((e) => ({
      regel: "kunde-verborgen", eventId: e.id,
      detail: e.pubkey === kundePk ? `Kunde ist Autor (Kind ${e.kind})` : `Kunde im p-Tag (Kind ${e.kind})`,
    }));
}

/** bolt11 in Klein- oder Grossschreibung (QR-Codes), mit Betrag und Trenner „1“. */
const BOLT11 = [/\bln(?:bc|tb|bcrt|sb)\d*[munp]?1[02-9ac-hj-np-z]{50,}/, /\bLN(?:BC|TB|BCRT|SB)\d*[MUNP]?1[02-9AC-HJ-NP-Z]{50,}/];

/** Keine Lightning-Rechnung (bolt11) in oeffentlichen Events. */
export function regelKeinBolt11(events: readonly NostrEvent[]): LeakFinding[] {
  return events
    .filter((e) => BOLT11.some((r) => r.test(e.content + "\n" + JSON.stringify(e.tags))))
    .map((e) => ({ regel: "kein-bolt11", eventId: e.id, detail: `Rechnung sichtbar (Kind ${e.kind})` }));
}

/** Die Solana-Adressen des Nutzers in keinem oeffentlichen Event – Schritt 4.9. */
export function regelKeineSolAdresse(events: readonly NostrEvent[], adressen: readonly string[]): LeakFinding[] {
  const funde: LeakFinding[] = [];
  for (const e of events) {
    const sichtbar = e.content + "\n" + JSON.stringify(e.tags);
    for (const a of adressen) {
      if (a.length >= 32 && sichtbar.includes(a)) {
        funde.push({ regel: "keine-sol-adresse", eventId: e.id, detail: `SOL-Adresse ${a.slice(0, 6)}… sichtbar (Kind ${e.kind})` });
      }
    }
  }
  return funde;
}

/** Jede SOL-Zahlung an eine frische Adresse – Schritt 4.9. `adressen` in Reihenfolge der Zahlungen. */
export function regelSolAdresseFrisch(adressen: readonly string[]): LeakFinding[] {
  return adressen
    .filter((a, i) => adressen.indexOf(a) !== i)
    .map((a) => ({ regel: "sol-adresse-frisch", eventId: "-", detail: `Adresse ${a.slice(0, 6)}… wiederverwendet` }));
}

/**
 * Hochgeladenes nur verschluesselt – Schritt 2.4. Geprueft werden drei
 * Ausschnitte der Datei (Anfang, Mitte, Ende) als Hex und Base64; die
 * Ausschnitte beginnen bei Vielfachen von 3, damit Base64 auf der Zeichengrenze liegt.
 */
export function regelUploadVerschluesselt(events: readonly NostrEvent[], datei: Uint8Array): LeakFinding[] {
  const n = Math.min(15, datei.length);
  const auf3 = (x: number): number => Math.max(0, x - (x % 3));
  const stellen = [0, auf3(Math.floor((datei.length - n) / 2)), auf3(datei.length - n)];
  const proben = stellen.flatMap((s) => {
    const stueck = datei.subarray(s, s + n);
    return [toHex(stueck), btoa(String.fromCharCode(...stueck)).replace(/=+$/, "")];
  }).filter((p) => p.length >= 8);
  return events
    .filter((e) => proben.some((p) => (e.content + "\n" + JSON.stringify(e.tags)).includes(p)))
    .map((e) => ({ regel: "upload-verschluesselt", eventId: e.id, detail: `Dateiinhalt im Klartext (Kind ${e.kind})` }));
}

/**
 * Zahlungs-Tags, die einen Betrag, eine Rechnung oder eine Adresse einem
 * Kunden zuordnen (Ergebnis, Sitzung, Beleg). Das Leistungs-Event des Providers
 * (volume_msat, ohne Kunden) gehoert nicht dazu.
 */
const ZAHLUNGS_TAGS = new Set([
  "amount", "amount_msat", "amount_lamports", "solana_address", "bid", "usage",
  "max_total_msat", "max_rate_per_ktoken_msat", "settle_every_msat", "cumulative_msat", "units", "payment",
]);

/** Leistungs-Event des Providers (Reputation): Menge und Volumen ohne Kunden. */
const KIND_LEISTUNG = 38010;

/** Keine Rechnung, keine Adresse, kein Betrag pro Kunde in oeffentlichen Events – Schritt 3.2. */
export function regelKeineZahlungsdaten(events: readonly NostrEvent[]): LeakFinding[] {
  const funde: LeakFinding[] = [];
  for (const e of events) {
    if (e.kind === KIND_LEISTUNG) continue;
    const tags = [...new Set(e.tags.filter((t) => ZAHLUNGS_TAGS.has(t[0])).map((t) => t[0]))];
    if (tags.length > 0) funde.push({ regel: "keine-zahlungsdaten", eventId: e.id, detail: `Zahlungsdaten offen (Kind ${e.kind}): ${tags.join(", ")}` });
    else if (regelKeinBolt11([e]).length > 0) funde.push({ regel: "keine-zahlungsdaten", eventId: e.id, detail: `Rechnung offen (Kind ${e.kind})` });
  }
  return funde;
}

/** Alle Regeln mit ihrer Aussage – Datenschutz-Aussagen verweisen hierauf. */
export const LEAK_REGELN: Readonly<Record<string, string>> = {
  "kein-kind4": "Keine Direktnachrichten im alten, offenen Format (Kind 4).",
  "kein-klartext": "Kein Klartext im Inhalt oder in Tags.",
  "autor-verborgen": "Der echte Absender ist nicht Autor.",
  "p-tags": "p-Tags nur an die gemeinten Empfänger.",
  "kein-klartext-prompt": "KI-Anfragen ohne Klartext-Prompt.",
  "kunde-verborgen": "Der Schlüssel des Kunden steht in keinem Job-Event.",
  "kein-bolt11": "Keine Lightning-Rechnung in öffentlichen Events.",
  "keine-sol-adresse": "Keine SOL-Adresse des Nutzers in öffentlichen Events.",
  "sol-adresse-frisch": "Jede SOL-Zahlung an eine frische Adresse.",
  "upload-verschluesselt": "Anhänge nur verschlüsselt.",
  "keine-zahlungsdaten": "Keine Rechnung, keine Adresse, kein Betrag pro Kunde in öffentlichen Events.",
};
