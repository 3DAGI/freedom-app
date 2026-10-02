/**
 * Reviews an Patches (Schritt C-20g1, Vorschlag nach der Entscheidung des
 * MENSCHEN vom 02.10.2026): Kommentare an einzelnen Zeilen des Diffs und eine
 * Bewertung „genehmigt“ oder „Änderungen erbeten“ – wie ein Review bei GitHub.
 *
 * Beides ist ein Kommentar nach NIP-22 (Kind 1111) am Patch (`kommentar.ts`)
 * mit einem Tag mehr; andere Clients zeigen es als gewöhnlichen Kommentar.
 * Format in `docs/PROTOCOL.md` (19). Öffentlich wie Patches; in privaten
 * Räumen nur als inneres Event (`raumRepoZeilenKommentar()`,
 * `raumRepoBewertung()` in `raum-repo.ts`).
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag } from "./event.js";
import { ProtokollFehler } from "./fehler.js";
import { KIND_KOMMENTAR, KOMMENTAR_MAX_BYTES, type GelesenerKommentar, type KommentarBezug, baueKommentar, leseKommentar } from "./kommentar.js";
import { type GelesenesRepo, KIND_PATCH, darfAnnehmen } from "./nip34.js";

/** Seite des Diffs: Zeilennummer nach der Änderung (`neu`) oder davor (`alt`, für entfernte Zeilen). */
export const REVIEW_SEITEN = ["neu", "alt"] as const;
export type ReviewSeite = (typeof REVIEW_SEITEN)[number];
export const BEWERTUNGEN = ["genehmigt", "aenderungen"] as const;
export type Bewertung = (typeof BEWERTUNGEN)[number];

/** Grenzen wie im Diff-Leser der App: Pfad in Zeichen, höchste Zeilennummer. */
export const REVIEW_GRENZEN = { pfad: 2000, zeile: 10_000_000 } as const;

/** Wo im Diff kommentiert wird. */
export interface Zeilenbezug {
  pfad: string;
  seite: ReviewSeite;
  zeile: number;
}

export interface GelesenerZeilenKommentar extends GelesenerKommentar {
  zeile: Zeilenbezug;
}

export interface GeleseneBewertung {
  id: string;
  autor: string;
  bewertung: Bewertung;
  /** Begründung, darf leer sein. */
  text: string;
  zeit: number;
}

const HEX64 = /^[0-9a-f]{64}$/;
// Steuerzeichen und Zeilenumbrüche gehören in keinen Pfad
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/;

function gueltigerPfad(p: string): boolean {
  return p.length > 0 && p.length <= REVIEW_GRENZEN.pfad && !STEUERZEICHEN.test(p);
}

function pruefeZeile(z: Zeilenbezug): void {
  if (!gueltigerPfad(z.pfad) || !REVIEW_SEITEN.includes(z.seite) || !Number.isInteger(z.zeile) || z.zeile < 1 || z.zeile > REVIEW_GRENZEN.zeile) {
    throw new ProtokollFehler("review-zeile", "Zeilenbezug ungültig (Pfad, Seite oder Zeile)");
  }
}

function pruefePatch(p: KommentarBezug): void {
  if (p.kind !== KIND_PATCH) throw new ProtokollFehler("review-patch", "Reviews nur an Patches");
}

/** Kommentar an einer Zeile des Diffs – ein NIP-22-Kommentar am Patch mit `["zeile", pfad, seite, nummer]`. */
export function baueZeilenKommentar(
  k: { patch: KommentarBezug; zeile: Zeilenbezug; text: string; eltern?: KommentarBezug },
  autor: string,
): UnsignedEvent {
  pruefePatch(k.patch);
  pruefeZeile(k.zeile);
  const ev = baueKommentar({ wurzel: k.patch, eltern: k.eltern, text: k.text }, autor);
  return { ...ev, tags: [...ev.tags, ["zeile", k.zeile.pfad, k.zeile.seite, String(k.zeile.zeile)]] };
}

/** Bewertung eines Patches – Kommentar am Patch mit `["bewertung", …]`; die Begründung darf fehlen. */
export function baueBewertung(b: { patch: KommentarBezug; bewertung: Bewertung; text?: string }, autor: string): UnsignedEvent {
  pruefePatch(b.patch);
  if (!BEWERTUNGEN.includes(b.bewertung)) throw new ProtokollFehler("review-bewertung", "Bewertung unbekannt");
  if (!HEX64.test(b.patch.id) || !HEX64.test(b.patch.autor)) throw new ProtokollFehler("kommentar-bezug", "Kommentar ohne gültigen Bezug");
  const text = (b.text ?? "").trim();
  if (new TextEncoder().encode(text).length > KOMMENTAR_MAX_BYTES) {
    throw new ProtokollFehler("kommentar-gross", `Kommentar zu groß (höchstens ${KOMMENTAR_MAX_BYTES / 1000} KB)`, { kb: KOMMENTAR_MAX_BYTES / 1000 });
  }
  const p = b.patch;
  return buildEvent(autor, KIND_KOMMENTAR, [
    ["E", p.id, "", p.autor], ["K", String(p.kind)], ["P", p.autor],
    ["e", p.id, "", p.autor], ["k", String(p.kind)], ["p", p.autor],
    ["bewertung", b.bewertung],
  ], text);
}

/** Zeilenbezug eines fremden Events streng lesen – ohne gültigen Bezug `undefined`. */
export function leseZeilenbezug(ev: Pick<NostrEvent, "tags">): Zeilenbezug | undefined {
  const t = ev.tags.find((x) => x[0] === "zeile");
  if (!t || t.length < 4) return undefined;
  const [, pfad, seite, nummer] = t;
  if (!/^[1-9][0-9]{0,7}$/.test(nummer ?? "")) return undefined;
  const z = { pfad: pfad ?? "", seite: seite as ReviewSeite, zeile: Number(nummer) };
  try { pruefeZeile(z); } catch { return undefined; }
  return z;
}

/** Ist das ein Teil eines Reviews (Zeilenkommentar oder Bewertung)? Die Diskussion zeigt sie gesondert. */
export function istReviewTeil(ev: Pick<NostrEvent, "tags">): boolean {
  return ev.tags.some((t) => t[0] === "zeile" || t[0] === "bewertung");
}

/** Die Kommentare an Zeilen eines Patches, ältester zuerst – Ungültiges fällt heraus. */
export function zeilenKommentareZu(patchId: string, events: readonly NostrEvent[]): GelesenerZeilenKommentar[] {
  const out: GelesenerZeilenKommentar[] = [];
  for (const ev of events) {
    if (ev.kind !== KIND_KOMMENTAR) continue;
    const zeile = leseZeilenbezug(ev);
    if (!zeile) continue;
    try {
      const k = leseKommentar(ev);
      if (k.wurzel.id === patchId && k.wurzel.kind === KIND_PATCH) out.push({ ...k, zeile });
    } catch { /* fremdes Unfug-Event */ }
  }
  return out.sort((a, b) => a.zeit - b.zeit || a.id.localeCompare(b.id));
}

/** Eine Bewertung streng lesen: am Patch direkt, bekannte Bewertung, Text in der Grenze. */
export function leseBewertung(ev: NostrEvent): GeleseneBewertung & { patchId: string } {
  if (ev.kind !== KIND_KOMMENTAR) throw new Error(`Keine Bewertung: Kind ${ev.kind}`);
  const bewertung = getTag(ev, "bewertung") as Bewertung | undefined;
  if (!bewertung || !BEWERTUNGEN.includes(bewertung)) throw new Error("Bewertung unbekannt");
  const wurzel = ev.tags.find((t) => t[0] === "E")?.[1] ?? "";
  const eltern = ev.tags.find((t) => t[0] === "e")?.[1] ?? "";
  if (!HEX64.test(wurzel) || eltern !== wurzel || getTag(ev, "K") !== String(KIND_PATCH) || getTag(ev, "k") !== String(KIND_PATCH)) {
    throw new Error("Bewertung nicht direkt an einem Patch");
  }
  const text = ev.content.trim();
  if (new TextEncoder().encode(text).length > KOMMENTAR_MAX_BYTES) throw new Error("Bewertung zu groß");
  return { id: ev.id, autor: ev.pubkey, bewertung, text, zeit: ev.created_at, patchId: wurzel };
}

/**
 * Stand der Bewertungen eines Patches: je Person die neueste (bei gleicher
 * Sekunde entscheidet die Id); die eigene Bewertung des Patch-Autors zählt
 * nicht – wie bei GitHub. `maintainer` sagt, ob sie von Eigentümer oder
 * Maintainer stammt.
 */
export function bewertungenZu(
  patch: { id: string; autor: string },
  repo: Pick<GelesenesRepo, "eigentuemer" | "maintainer">,
  events: readonly NostrEvent[],
): Array<GeleseneBewertung & { maintainer: boolean }> {
  const je = new Map<string, GeleseneBewertung>();
  for (const ev of events) {
    let b: ReturnType<typeof leseBewertung>;
    try { b = leseBewertung(ev); } catch { continue; }
    if (b.patchId !== patch.id || b.autor === patch.autor) continue;
    const alt = je.get(b.autor);
    if (!alt || b.zeit > alt.zeit || (b.zeit === alt.zeit && b.id > alt.id)) je.set(b.autor, b);
  }
  return [...je.values()]
    .map(({ id, autor, bewertung, text, zeit }) => ({ id, autor, bewertung, text, zeit, maintainer: darfAnnehmen(repo, autor) }))
    .sort((a, b) => a.zeit - b.zeit || a.id.localeCompare(b.id));
}
