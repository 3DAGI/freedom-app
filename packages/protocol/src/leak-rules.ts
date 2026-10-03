/**
 * Regeln fuer Leak-Tests (Schritt 1.5 im Ausbauplan).
 *
 * Ein Leak-Test schneidet mit, was veroeffentlicht wird, und prueft es gegen
 * diese Regeln. Jede Regel liefert die Verstoesse – eine leere Liste heisst:
 * eingehalten.
 */
import type { NostrEvent } from "./event.js";
import { fromHex, toHex } from "./htlc.js";
import { bech32 } from "@scure/base";
import { KIND_ANRUF, istRelayKandidat, pruefeSdpNurRelay } from "./anruf.js";

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

/**
 * Anmeldungen (NIP-42, Kind 22242) gehen nur als `["AUTH", …]` an den Relay,
 * der sie verlangt – nie als veroeffentlichtes Event (8.4c). Ein Relay, das sie
 * speicherte, verriete jedem, wer sich wann wo angemeldet hat.
 */
export function regelAnmeldungNichtOffen(events: readonly NostrEvent[]): LeakFinding[] {
  return events
    .filter((e) => e.kind === 22242)
    .map((e) => ({ regel: "anmeldung-nicht-offen", eventId: e.id, detail: "Anmeldung (NIP-42) als Event veröffentlicht" }));
}

/**
 * Die Kopien einer Nachricht (Umschläge, Kind 1059) gehen nicht im selben
 * Augenblick hinaus (6.4): je zwei, die innerhalb von `fensterMs`
 * veröffentlicht wurden, sind ein Verstoß – sonst verbindet der Zeitpunkt,
 * was die Wegwerf-Schlüssel trennen.
 */
export function regelKopienEntkoppelt(sendungen: readonly { ev: NostrEvent; zeitMs: number }[], fensterMs = 1000): LeakFinding[] {
  const u = sendungen.filter((s) => s.ev.kind === 1059).sort((a, b) => a.zeitMs - b.zeitMs);
  const funde: LeakFinding[] = [];
  for (let i = 1; i < u.length; i++) {
    if (u[i]!.zeitMs - u[i - 1]!.zeitMs < fensterMs) {
      funde.push({ regel: "kopien-entkoppelt", eventId: u[i]!.ev.id, detail: `${u[i]!.zeitMs - u[i - 1]!.zeitMs} ms nach dem vorigen Umschlag` });
    }
  }
  return funde;
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

/**
 * Keine Lightning-Adresse des Nutzers (lud16, auch als LNURL) in öffentlichen
 * Events – Schritt 6.3. Umschläge (1059) sind verschlüsselt und zählen nicht.
 */
export function regelKeineLnAdresse(events: readonly NostrEvent[], adressen: readonly string[]): LeakFinding[] {
  const gesucht = adressen.map((a) => a.trim().toLowerCase()).filter((a) => a.includes("@") && a.length >= 6);
  return events
    .filter((e) => e.kind !== 1059 && gesucht.some((a) => (e.content + "\n" + JSON.stringify(e.tags)).toLowerCase().includes(a)))
    .map((e) => ({ regel: "keine-ln-adresse", eventId: e.id, detail: `Lightning-Adresse sichtbar (Kind ${e.kind})` }));
}

/**
 * Zap-Anfragen (9734) nie mit der Identität und nur als „anon“ – der
 * LNURL-Server veröffentlicht sie samt Rechnung in der Quittung (Schritt 6.3).
 */
export function regelZapAnonym(zapAnfragen: readonly NostrEvent[], identitaet: string): LeakFinding[] {
  return zapAnfragen
    .filter((e) => e.kind === 9734 && (e.pubkey === identitaet || !e.tags.some((t) => t[0] === "anon")))
    .map((e) => ({ regel: "zap-anonym", eventId: e.id, detail: e.pubkey === identitaet ? "Zap-Anfrage von der Identität" : "Zap-Anfrage ohne anon" }));
}

/**
 * Repos privater Räume nie offen (Schritt 11.4b): kein offenes Event der
 * Arten 30617, 38042, 1617, 1630–1633 und (seit C-17a) 1621 zu ihren
 * Kennungen, (seit C-20h1) kein offenes Release (30063), kein offener
 * Kommentar (1111) und (seit C-20i1) kein offenes Label-Event (1985) zu ihren
 * inneren Issues und Patches (`innere`), und ihr Bundle-Schlüssel nirgends im
 * Klartext.
 * Umschläge (1059) und Gruppen-Nachrichten (445) sind verschlüsselt und
 * zählen nicht.
 */
export function regelRaumRepoPrivat(
  events: readonly NostrEvent[],
  p: { repoIds: readonly string[]; schluessel: readonly string[]; innere?: readonly string[] },
): LeakFinding[] {
  const arten = new Set([30617, 38042, 1617, 1621, 1630, 1631, 1632, 1633, 30063]);
  const innere = new Set(p.innere ?? []);
  const schluessel = p.schluessel.filter((k) => k.length >= 16).map((k) => k.toLowerCase());
  return events.filter((e) => e.kind !== 1059 && e.kind !== 445).flatMap((e) => {
    const d = e.tags.find((t) => t[0] === "d")?.[1];
    const a = e.tags.filter((t) => t[0] === "a").map((t) => t[1] ?? "");
    const zumRepo = (arten.has(e.kind) && p.repoIds.some((id) => d === id || a.some((x) => x.endsWith(`:${id}`))))
      || ((e.kind === 1111 || e.kind === 1985) && e.tags.some((t) => (t[0] === "E" || t[0] === "e") && innere.has(t[1] ?? "")));
    const klartext = (e.content + "\n" + JSON.stringify(e.tags)).toLowerCase();
    if (zumRepo) return [{ regel: "raum-repo-privat", eventId: e.id, detail: `Repo eines privaten Raums offen (Kind ${e.kind})` }];
    if (schluessel.some((k) => klartext.includes(k))) return [{ regel: "raum-repo-privat", eventId: e.id, detail: `Bundle-Schlüssel sichtbar (Kind ${e.kind})` }];
    return [];
  });
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
  "gutschrift", // Zahlkanal (4.3d): Betrag, Ablauf und Signatur – nur im versiegelten Kern
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

/** Steht `nadel` irgendwo in `heu`? */
function enthaeltBytes(heu: Uint8Array, nadel: Uint8Array): boolean {
  outer: for (let i = 0; i + nadel.length <= heu.length; i++) {
    for (let j = 0; j < nadel.length; j++) if (heu[i + j] !== nadel[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Mitgeschnittene Mesh-Pakete (Funk, Bluetooth, Datei) – Schritt 7.1: kein
 * Schlüssel des Nutzers (Hex, npub oder die 32 Byte roh) und kein Klartext
 * (ab 6 Zeichen). `pakete` sind Rahmen UND zusammengesetzte Nutzlasten – ein
 * Schlüssel kann über zwei Rahmen verteilt sein.
 */
export function regelMeshVerschluesselt(
  pakete: readonly Uint8Array[],
  p: { schluessel: readonly string[]; klartexte: readonly string[] },
): LeakFinding[] {
  const enc = new TextEncoder();
  const nadeln: { bytes: Uint8Array; was: string }[] = [];
  for (const pk of p.schluessel) {
    nadeln.push({ bytes: enc.encode(pk), was: `Schlüssel ${pk.slice(0, 8)}… (Hex)` });
    nadeln.push({ bytes: enc.encode(bech32.encode("npub", bech32.toWords(fromHex(pk)))), was: `Schlüssel ${pk.slice(0, 8)}… (npub)` });
    nadeln.push({ bytes: fromHex(pk), was: `Schlüssel ${pk.slice(0, 8)}… (roh)` });
  }
  for (const k of p.klartexte) if (k.length >= 6) nadeln.push({ bytes: enc.encode(k), was: `Klartext ${k.slice(0, 20)}…` });
  const funde: LeakFinding[] = [];
  pakete.forEach((b, i) => {
    for (const n of nadeln) {
      if (enthaeltBytes(b, n.bytes)) funde.push({ regel: "mesh-verschluesselt", eventId: `paket-${i}`, detail: `${n.was} im Mesh-Paket` });
    }
  });
  return funde;
}

/**
 * Gruppennachrichten nach Marmot (Kind 445, Schritt 2.2b-c2): nur der h-Tag
 * (dazu höchstens `expiration`), der nicht die MLS-Gruppen-Id ist, und jede
 * von einem eigenen Wegwerf-Schlüssel – nie von einer Identität.
 */
export function regelMlsGruppe(
  events: readonly NostrEvent[],
  p: { gruppenIds: readonly string[]; identitaeten: readonly string[] },
): LeakFinding[] {
  const funde: LeakFinding[] = [];
  const gesehen = new Set<string>();
  const fund = (e: NostrEvent, detail: string) => funde.push({ regel: "mls-gruppe", eventId: e.id, detail });
  for (const e of events.filter((x) => x.kind === 445)) {
    const h = e.tags.filter((t) => t[0] === "h");
    const andere = e.tags.filter((t) => t[0] !== "h" && t[0] !== "expiration");
    if (h.length !== 1 || !/^[0-9a-f]{64}$/.test(h[0]![1] ?? "")) fund(e, "kein einzelner h-Tag mit 64 Hex");
    else if (p.gruppenIds.includes(h[0]![1]!)) fund(e, "h-Tag ist die MLS-Gruppen-Id");
    for (const t of andere) fund(e, `weiterer Tag ${t[0]}`);
    if (p.identitaeten.includes(e.pubkey)) fund(e, "Identität ist Autor");
    if (gesehen.has(e.pubkey)) fund(e, "Schlüssel wiederverwendet");
    gesehen.add(e.pubkey);
    for (const id of p.identitaeten) if (e.content.includes(id)) fund(e, "Identität im Inhalt");
  }
  return funde;
}

/** Der Nachweis des Besitzers (Kopplung, B-8) steht nur im versiegelten Kern an den eigenen Knoten – nie in einem offenen Event. */
export function regelBesitzerVersiegelt(events: readonly NostrEvent[]): LeakFinding[] {
  return events.filter((e) => e.tags.some((t) => t[0] === "besitzer"))
    .map((e) => ({ regel: "besitzer-versiegelt", eventId: e.id, detail: `Besitzer-Nachweis offen (Kind ${e.kind})` }));
}

/**
 * Anrufe nur über den Vermittler (B-13d1): Der Anruf-Aufbau (Kind 25040) steht
 * nie offen in einem gesendeten Event, und in den inneren Events – die der Test
 * vor dem Versiegeln mitschneidet – stehen nur Kandidaten vom Typ `relay`, mit
 * DTLS-Fingerabdruck. Eine Host-, srflx- oder prflx-Adresse verriete dem
 * Gegenüber die eigene IP.
 */
export function regelAnrufNurRelay(events: readonly NostrEvent[], innere: readonly NostrEvent[] = []): LeakFinding[] {
  const funde: LeakFinding[] = events.filter((e) => e.kind === KIND_ANRUF)
    .map((e) => ({ regel: "anruf-nur-relay", eventId: e.id, detail: "Anruf-Aufbau offen" }));
  for (const e of innere.filter((x) => x.kind === KIND_ANRUF)) {
    let n: { typ?: unknown; sdp?: unknown; kandidat?: { candidate?: unknown } };
    try {
      n = JSON.parse(e.content) as typeof n;
    } catch {
      funde.push({ regel: "anruf-nur-relay", eventId: e.id, detail: "Inhalt unlesbar" });
      continue;
    }
    const ok = n.typ === "angebot" || n.typ === "antwort" ? pruefeSdpNurRelay(n.sdp as string)
      : n.typ === "kandidat" ? istRelayKandidat(n.kandidat?.candidate as string)
      : n.typ === "ende";
    if (!ok) funde.push({ regel: "anruf-nur-relay", eventId: e.id, detail: `${String(n.typ)}: nicht nur über den Vermittler` });
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
  "mesh-verschluesselt": "Über Funk, Bluetooth und Datei nur Verschlüsseltes – ohne Schlüssel des Nutzers, ohne Klartext.",
  "mls-gruppe": "Gruppennachrichten nur mit gehashter Gruppen-Id, jede von einem eigenen Wegwerf-Schlüssel, nie von der Identität.",
  "anmeldung-nicht-offen": "Anmeldungen bei Relays (NIP-42) nie als veröffentlichtes Event.",
  "kopien-entkoppelt": "Die Kopien einer Nachricht gehen nicht im selben Augenblick hinaus.",
  "keine-ln-adresse": "Keine Lightning-Adresse des Nutzers in öffentlichen Events – im Profil nur auf ausdrücklichen Wunsch.",
  "zap-anonym": "Zap-Anfragen tragen nie die Identität des Zahlers.",
  "raum-repo-privat": "Repos privater Räume – Ankündigung, Bundle-Schlüssel, Patches, Status – nur in der MLS-Gruppe, nie offen.",
  "besitzer-versiegelt": "Der Nachweis des Besitzers an den eigenen Knoten nur versiegelt, nie offen.",
  "anruf-nur-relay": "Anrufe nur über den Vermittler: Anruf-Aufbau nie offen, innen nur Relay-Kandidaten mit Fingerabdruck.",
};
