/**
 * Namensschicht: Menschen wiedererkennen, ohne eine Namensbehörde.
 *
 * DAS PROBLEM
 * Alles ist heute ein 64-Zeichen-Hex. Ohne Namen ist das System bei mehr als
 * fünfzig Nutzern unbedienbar — und das ist kein Komfortthema: Wenn man
 * niemanden finden und niemanden wiedererkennen kann, gibt es kein soziales
 * Netz, sondern eine Sammlung von Schlüsseln.
 *
 * WARUM DAS SCHWER IST
 * Ein Name kann sicher, dezentral oder menschenlesbar sein — alle drei
 * zugleich geht nicht ohne eine Instanz, die vergibt. Genau diese Instanz ist
 * der wirksamste Zensurpunkt im Internet: DNS ist der Ort, an dem am
 * effektivsten abgeschaltet wird. NIP-05 hängt an Domains und erbt das
 * Problem vollständig.
 *
 * DIE ENTSCHEIDUNG HIER
 * Es gibt **keinen globalen Namensraum**. Stattdessen drei Ebenen:
 *
 * 1. **Eigene Namen (Petnames).** Du vergibst sie, sie gelten nur für dich,
 *    sie sind eindeutig und niemand kann sie dir nehmen. Das ist die
 *    Grundlage — alles andere sind Hinweise darauf.
 * 2. **Namen aus dem Bekanntenkreis.** Wie nennen die Leute, denen du
 *    vertraust, diese Person? Kein Beweis, aber der stärkste Hinweis, den es
 *    ohne Behörde gibt.
 * 3. **Selbstbezeichnung und NIP-05.** Was jemand über sich sagt. Bequem,
 *    aber wertlos als Beweis — jeder kann sich nennen, wie er will.
 *
 * Die Reihenfolge ist die Botschaft: Was DU vergeben hast, gilt. Was andere
 * sagen, ist ein Hinweis. Was jemand über sich selbst sagt, ist eine
 * Behauptung.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";

/** Öffentlich geteilte Namenszuordnung („ich nenne X so"). */
export const KIND_PETNAME = 38062;

export interface Petname {
  /** Wer den Namen vergeben hat. */
  byPubkey: string;
  /** Für wen. */
  forPubkey: string;
  name: string;
  /** Optionaler Zusatz, z. B. „von der Konferenz". */
  note?: string;
  createdAt: number;
}

export function buildPetname(p: Omit<Petname, "createdAt">, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["d", `name:${p.forPubkey}`],
    ["p", p.forPubkey],
    ["name", p.name],
  ];
  if (p.note) tags.push(["note", p.note]);
  return buildEvent(p.byPubkey, KIND_PETNAME, tags, "", createdAt);
}

export function parsePetname(ev: NostrEvent): Petname {
  if (ev.kind !== KIND_PETNAME) throw new Error(`kein Petname: kind ${ev.kind}`);
  const forPubkey = getTag(ev, "p");
  const name = getTag(ev, "name");
  if (!forPubkey || !name) throw new Error("Petname ohne Ziel oder Namen");
  if (forPubkey === ev.pubkey) throw new Error("Selbstbenennung ist kein Petname");
  return { byPubkey: ev.pubkey, forPubkey, name: name.trim(), note: getTag(ev, "note") ?? undefined, createdAt: ev.created_at };
}

/**
 * Bereinigt einen Namen für die Anzeige.
 *
 * Unsichtbare Zeichen und Zeichen aus fremden Schriftsystemen, die lateinischen
 * zum Verwechseln ähnlich sehen, sind der klassische Weg, jemanden zu imitieren.
 * Der Name wird nicht abgelehnt, sondern markiert — Ablehnen würde Menschen
 * ausschließen, die ihre Sprache benutzen.
 */
export function inspectName(name: string): { clean: string; suspicious: boolean; reason?: string } {
  const clean = name.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, "").trim();

  if (clean !== name) {
    return { clean, suspicious: true, reason: "enthält unsichtbare Zeichen" };
  }
  if (clean.length === 0) return { clean, suspicious: true, reason: "leer" };
  if (clean.length > 40) return { clean: clean.slice(0, 40), suspicious: true, reason: "ungewöhnlich lang" };

  // Mischung aus lateinischen und kyrillischen/griechischen Zeichen im selben
  // Wort ist praktisch immer ein Imitationsversuch.
  const lat = /[a-zA-Z]/.test(clean);
  const andere = /[\u0400-\u04FF\u0370-\u03FF]/.test(clean);
  if (lat && andere) {
    return { clean, suspicious: true, reason: "mischt Schriftsysteme — mögliche Verwechslung" };
  }
  return { clean, suspicious: false };
}

export type NameSource = "eigener" | "bekanntenkreis" | "selbst";

export interface ResolvedName {
  pubkey: string;
  /** Was angezeigt wird. */
  display: string;
  source: NameSource;
  /** Wie viele vertraute Kontakte diesen Namen verwenden. */
  agreement?: number;
  /** Andere Namen, die für dieselbe Person im Umlauf sind. */
  alternatives: { name: string; count: number }[];
  /** Verwechslungsgefahr mit einer bereits bekannten Person. */
  conflict?: string;
  suspicious?: string;
}

export interface ResolveOptions {
  /** Eigene Zuordnungen — haben immer Vorrang. */
  ownPetnames?: Map<string, string>;
  /** Wem man vertraut (aus wot.ts). Nur deren Namen zählen. */
  trusted?: Set<string>;
  /** Selbstbezeichnungen (kind 0 / NIP-05). */
  selfNames?: Map<string, string>;
}

/**
 * Löst einen Pubkey zu einem Namen auf.
 *
 * Meldet ausdrücklich, WOHER der Name kommt. Ein Name ohne Herkunft ist eine
 * Einladung zur Verwechslung — und Verwechslung ist bei Zahlungen teuer.
 */
export function resolveName(
  pubkey: string,
  petnameEvents: NostrEvent[],
  opts: ResolveOptions = {},
): ResolvedName {
  const kurz = pubkey.slice(0, 8) + "…" + pubkey.slice(-4);

  // 1. Eigener Name schlägt alles.
  const eigen = opts.ownPetnames?.get(pubkey);
  if (eigen) {
    return { pubkey, display: eigen, source: "eigener", alternatives: [] };
  }

  // 2. Was der Bekanntenkreis sagt.
  const stimmen = new Map<string, Set<string>>();
  for (const ev of petnameEvents) {
    let p: Petname;
    try {
      p = parsePetname(ev);
    } catch {
      continue;
    }
    if (p.forPubkey !== pubkey) continue;
    // Nur Namen von Leuten zählen, denen man vertraut. Sonst könnte jeder
    // eine Namenslawine erzeugen und damit jemanden umbenennen.
    if (opts.trusted && !opts.trusted.has(p.byPubkey)) continue;
    const s = stimmen.get(p.name) ?? new Set<string>();
    s.add(p.byPubkey);
    stimmen.set(p.name, s);
  }

  const sortiert = [...stimmen.entries()]
    .map(([name, wer]) => ({ name, count: wer.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  if (sortiert.length > 0) {
    const pruefung = inspectName(sortiert[0].name);
    return {
      pubkey,
      display: pruefung.clean,
      source: "bekanntenkreis",
      agreement: sortiert[0].count,
      alternatives: sortiert.slice(1),
      suspicious: pruefung.suspicious ? pruefung.reason : undefined,
    };
  }

  // 3. Selbstbezeichnung — eine Behauptung, mehr nicht.
  const selbst = opts.selfNames?.get(pubkey);
  if (selbst) {
    const pruefung = inspectName(selbst);
    return {
      pubkey,
      display: pruefung.clean,
      source: "selbst",
      alternatives: [],
      suspicious: pruefung.suspicious ? pruefung.reason : undefined,
    };
  }

  return { pubkey, display: kurz, source: "selbst", alternatives: [] };
}

/**
 * Warnt vor Verwechslung mit bereits bekannten Personen.
 *
 * Der teuerste Fehler in solchen Systemen ist nicht der gestohlene Schlüssel,
 * sondern die Zahlung an den falschen „Max". Deshalb wird ein Name, der einem
 * bereits vergebenen ähnelt, markiert, bevor etwas passiert.
 */
export function checkImpersonation(
  candidate: ResolvedName,
  known: Map<string, string>,
): string | undefined {
  const normal = (s: string): string =>
    s.toLowerCase().replace(/[\s._-]/g, "").replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s");

  const kandidat = normal(candidate.display);
  for (const [pk, name] of known) {
    if (pk === candidate.pubkey) continue;
    if (normal(name) === kandidat) {
      return `Heißt fast genauso wie „${name}", den du bereits kennst. Vor einer Zahlung prüfen.`;
    }
  }
  return undefined;
}

/**
 * Anzeigetext, der die Herkunft mitträgt.
 *
 * „Max" allein ist gefährlich. „Max (so nennen ihn 4 deiner Kontakte)" ist
 * eine Information, mit der man etwas anfangen kann.
 */
export function displayWithSource(r: ResolvedName): string {
  switch (r.source) {
    case "eigener":
      return r.display;
    case "bekanntenkreis":
      return `${r.display} (so nennen ihn ${r.agreement} deiner Kontakte)`;
    default:
      return r.display === r.pubkey.slice(0, 8) + "…" + r.pubkey.slice(-4)
        ? r.display
        : `${r.display} (selbst gewählt, ungeprüft)`;
  }
}

/** Sucht Personen anhand eines Namensfragments. */
export function searchByName(
  query: string,
  petnameEvents: NostrEvent[],
  opts: ResolveOptions = {},
): ResolvedName[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];

  const kandidaten = new Set<string>();
  for (const [pk, name] of opts.ownPetnames ?? []) {
    if (name.toLowerCase().includes(q)) kandidaten.add(pk);
  }
  for (const ev of petnameEvents) {
    try {
      const p = parsePetname(ev);
      if (opts.trusted && !opts.trusted.has(p.byPubkey)) continue;
      if (p.name.toLowerCase().includes(q)) kandidaten.add(p.forPubkey);
    } catch { /* ignorieren */ }
  }

  return [...kandidaten]
    .map((pk) => resolveName(pk, petnameEvents, opts))
    // Eigene Namen zuerst, dann nach Zustimmung im Bekanntenkreis.
    .sort((a, b) => {
      const rang = (r: ResolvedName): number => (r.source === "eigener" ? 0 : r.source === "bekanntenkreis" ? 1 : 2);
      return rang(a) - rang(b) || (b.agreement ?? 0) - (a.agreement ?? 0);
    });
}
