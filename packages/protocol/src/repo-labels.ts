/**
 * Labels ändern und Zuständige an Issues und Patches (Schritt C-20i1,
 * Vorschlag nach der Entscheidung des MENSCHEN vom 02.10.2026) – wie bei
 * GitHub: Eigentümer und Maintainer setzen nachträglich Labels und weisen
 * Personen zu.
 *
 * Format: Label-Event nach NIP-32 (Kind 1985) mit genau einem Ziel (`e` =
 * Issue oder Patch, `k` = seine Art). Namensraum `#t` für Labels (wie die
 * `t`-Tags eines Issues nach NIP-34), `freedomstack.zustaendig` für
 * Zuständige (Werte: Schlüssel als Hex – bewusst keine `p`-Tags, die wären
 * in 1985 weitere Ziele). Abweichend vom additiven NIP-32 nennt ein Event
 * den **ganzen Stand** eines Namensraums: Es zählt je Ziel und Namensraum die
 * neueste Aussage von Eigentümer oder Maintainern; ein leerer Stand entfernt
 * alles. Ohne Aussage gelten die `t`-Tags des Issues. Format in
 * `docs/PROTOCOL.md` (19). In privaten Räumen nur als inneres Event
 * (`raumRepoLabels()` in `raum-repo.ts`).
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag, getTags } from "./event.js";
import { ProtokollFehler } from "./fehler.js";
import { type GelesenesRepo, KIND_ISSUE, KIND_PATCH, darfAnnehmen } from "./nip34.js";

export const KIND_LABEL = 1985;

/** Namensräume nach NIP-32: Labels wie `t`-Tags, Zuständige mit eigenem, eindeutigem Namen. */
export const LABEL_RAEUME = { labels: "#t", zustaendig: "freedomstack.zustaendig" } as const;
export type LabelArt = keyof typeof LABEL_RAEUME;

/** Höchstens so viele Werte je Stand – wie beim Lesen eines Issues (20 Labels). */
export const LABEL_GRENZEN = { labels: 20, zustaendig: 10 } as const;

const LABEL = /^[^\s,]{1,40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ZIEL_ARTEN: readonly number[] = [KIND_ISSUE, KIND_PATCH];

export interface LabelStandAngaben {
  /** Issue (1621) oder Patch (1617). */
  ziel: { id: string; kind: number };
  art: LabelArt;
  werte: readonly string[];
}

export interface GelesenerLabelStand {
  id: string;
  autor: string;
  zielId: string;
  zielKind: number;
  art: LabelArt;
  werte: string[];
  zeit: number;
}

const gueltig = (art: LabelArt, w: string): boolean => (art === "labels" ? LABEL.test(w) : HEX64.test(w));

/** Den ganzen Stand eines Namensraums setzen – Labels oder Zuständige. */
export function baueLabelStand(a: LabelStandAngaben, autor: string): UnsignedEvent {
  if (!HEX64.test(a.ziel.id) || !ZIEL_ARTEN.includes(a.ziel.kind)) throw new ProtokollFehler("label-ziel", "Labels nur an Issues und Patches");
  if (!(a.art in LABEL_RAEUME)) throw new ProtokollFehler("label-art", "Unbekannte Art (Labels oder Zuständige)");
  const werte = [...new Set(a.werte)];
  for (const w of werte) {
    if (!gueltig(a.art, w)) {
      throw a.art === "labels"
        ? new ProtokollFehler("issue-label", "Label: ohne Leerzeichen und Komma, höchstens 40 Zeichen")
        : new ProtokollFehler("label-zustaendig", "Zuständige als 64-stellige Hex-Schlüssel");
    }
  }
  if (werte.length > LABEL_GRENZEN[a.art]) {
    throw new ProtokollFehler("label-viele", `Höchstens ${LABEL_GRENZEN[a.art]} Einträge`, { n: LABEL_GRENZEN[a.art] });
  }
  const raum = LABEL_RAEUME[a.art];
  return buildEvent(autor, KIND_LABEL, [
    ["L", raum], ...werte.map((w) => ["l", w, raum]), ["e", a.ziel.id], ["k", String(a.ziel.kind)],
  ], "");
}

/** Ein Label-Event streng lesen: genau ein Ziel (Issue oder Patch), ein bekannter Namensraum, nur gültige Werte. */
export function leseLabelStand(ev: NostrEvent): GelesenerLabelStand {
  if (ev.kind !== KIND_LABEL) throw new Error(`Kein Label-Event: Kind ${ev.kind}`);
  const raeume = getTags(ev, "L").map((t) => t[1] ?? "");
  const art = (Object.keys(LABEL_RAEUME) as LabelArt[]).find((x) => raeume.length === 1 && raeume[0] === LABEL_RAEUME[x]);
  if (!art) throw new Error("Label-Event ohne bekannten Namensraum");
  const ziele = getTags(ev, "e");
  const zielKind = Number(getTag(ev, "k"));
  if (ziele.length !== 1 || !HEX64.test(ziele[0]![1] ?? "") || !ZIEL_ARTEN.includes(zielKind)) throw new Error("Label-Event ohne genau ein Ziel");
  const l = getTags(ev, "l").filter((t) => t[2] === LABEL_RAEUME[art]).map((t) => t[1] ?? "");
  if (l.some((w) => !gueltig(art, w))) throw new Error("Label-Event mit ungültigem Wert");
  const werte = [...new Set(l)];
  if (werte.length > LABEL_GRENZEN[art]) throw new Error("Label-Event mit zu vielen Werten");
  return { id: ev.id, autor: ev.pubkey, zielId: ziele[0]![1]!, zielKind, art, werte, zeit: ev.created_at };
}

/**
 * Stand eines Namensraums an einem Ziel: die neueste Aussage von Eigentümer
 * oder Maintainern (bei gleicher Sekunde die größere Id) – `undefined`, wenn
 * es keine gibt (dann gelten die eigenen `t`-Tags des Issues).
 */
export function labelStandZu(
  zielId: string, art: LabelArt, repo: Pick<GelesenesRepo, "eigentuemer" | "maintainer">, events: readonly NostrEvent[],
): GelesenerLabelStand | undefined {
  let bester: GelesenerLabelStand | undefined;
  for (const ev of events) {
    let s: GelesenerLabelStand;
    try { s = leseLabelStand(ev); } catch { continue; }
    if (s.zielId !== zielId || s.art !== art || !darfAnnehmen(repo, s.autor)) continue;
    if (!bester || s.zeit > bester.zeit || (s.zeit === bester.zeit && s.id > bester.id)) bester = s;
  }
  return bester;
}
