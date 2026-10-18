/**
 * Gruppenanruf im privaten Raum (Sammlung B-34, Entscheidungen LK2–LK4 A, `docs/GRUPPENANRUF-ENTWURF.md`, B-34c1):
 * Wer anruft, holt bei seinem Knoten je Mitglied einen Zugang (5081, `livekit-zugang.ts`) und schickt sie als inneres
 * Event in die MLS-Gruppe – nie offen, nie an ein Relay außer als Kind 445. Bild und Ton verschlüsselt jeder mit dem
 * Schlüssel aus `anrufSchluessel()` (B-34b); der SFU sieht nur Chiffrat.
 *
 * - **Einladung**: Art `ART_GRUPPENANRUF`, Tags `["space", <raum>]`, `["anruf", <kennung>]`, Inhalt JSON wie die
 *   Antwort des Knotens (`url`, `raum`, `zugaenge`, `bis`) plus `mitglieder`: je Zugang das MLS-Mitglied, dem er gehört
 *   (gleiche Reihenfolge). Alle Mitglieder sehen alle Zugänge – sie sind ohnehin in der Gruppe; die Kennungen sind
 *   zufällig, nie Schlüssel.
 * - **Ende**: dieselbe Art mit `["ende", "1"]`, nur vom Anrufenden.
 *
 * Gelesen wird streng (Fremddaten): die Zugänge über `leseLivekitZugaenge()`, die Mitglieder als 64 Zeichen Hex,
 * verschieden und genau so viele wie Zugänge; abgelaufene und beendete Anrufe fallen weg.
 */
import { ProtokollFehler } from "./fehler.js";
import { type LivekitZugaenge, leseLivekitZugaenge, livekitZugaengeText } from "./livekit-zugang.js";
import type { InneresEvent, InneresSenden } from "./raum-gruppe.js";

/** Inneres Event im privaten Raum – nie offen veröffentlichen. */
export const ART_GRUPPENANRUF = 25041;

const HEX64 = /^[0-9a-f]{64}$/;
const RAUM = /^[0-9a-f]{32}$/;
const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1];

function ungueltig(was: string): never {
  throw new ProtokollFehler("gruppenanruf-ungueltig", `Gruppenanruf ungültig: ${was}`, { was });
}

/** Einladung: je Mitglied (MLS-Schlüssel) ein Zugang aus der Antwort des eigenen Knotens. */
export function raumGruppenanruf(raumId: string, z: LivekitZugaenge, mitglieder: readonly string[]): InneresSenden {
  if (mitglieder.length !== z.zugaenge.length || new Set(mitglieder).size !== mitglieder.length || !mitglieder.every((m) => HEX64.test(m))) {
    ungueltig("Mitglieder");
  }
  const text = JSON.stringify({ ...JSON.parse(livekitZugaengeText(z)), mitglieder: [...mitglieder] });
  if (!leseLivekitZugaenge(text, { raum: z.raum, anzahl: mitglieder.length }, z.bis - 1)) ungueltig("Zugänge");
  return { art: ART_GRUPPENANRUF, tags: [["space", raumId], ["anruf", z.raum]], text };
}

/** Ende des Anrufs – zählt nur vom Anrufenden. */
export function raumGruppenanrufEnde(raumId: string, anruf: string): InneresSenden {
  if (!RAUM.test(anruf)) ungueltig("Anruf");
  return { art: ART_GRUPPENANRUF, tags: [["space", raumId], ["anruf", anruf], ["ende", "1"]], text: "" };
}

export interface RaumGruppenanruf {
  /** Id des inneren Events der Einladung. */
  id: string;
  /** Wer anruft (MLS-Mitglied). */
  von: string;
  /** Kennung des Anrufs – auch der Kontext des Schlüssels (`anrufSchluessel()`). */
  anruf: string;
  url: string;
  bis: number;
  zeit: number;
  teilnehmer: number;
  /** Mein Zugang, wenn die Einladung einen für mich hat. */
  zugang?: { kennung: string; token: string };
}

/** Die laufenden Gruppenanrufe des Raums, neueste zuerst. `ich`: eigener MLS-Schlüssel; `jetzt` in Sekunden. */
export function raumGruppenanrufe(raumId: string, ereignisse: readonly InneresEvent[], p: { ich?: string; jetzt?: number } = {}): RaumGruppenanruf[] {
  const jetzt = p.jetzt ?? Math.floor(Date.now() / 1000);
  const imRaum = ereignisse.filter((e) => e.art === ART_GRUPPENANRUF && tag(e, "space") === raumId && RAUM.test(tag(e, "anruf") ?? ""));
  const beendet = new Set(imRaum.filter((e) => tag(e, "ende") === "1").map((e) => `${e.von}:${tag(e, "anruf")}`));
  // Eine Kennung nennen zwei Anrufende nur mit Absicht – dann gilt keiner (die Zeit setzt der Absender selbst)
  const anrufende = new Map<string, Set<string>>();
  for (const e of imRaum) {
    if (tag(e, "ende") === undefined) anrufende.set(tag(e, "anruf")!, (anrufende.get(tag(e, "anruf")!) ?? new Set()).add(e.von));
  }
  const out = new Map<string, RaumGruppenanruf>();
  for (const e of imRaum) {
    const anruf = tag(e, "anruf")!;
    if (tag(e, "ende") !== undefined || beendet.has(`${e.von}:${anruf}`) || (anrufende.get(anruf)?.size ?? 0) > 1) continue;
    let mitglieder: unknown;
    try {
      mitglieder = (JSON.parse(e.text) as { mitglieder?: unknown }).mitglieder;
    } catch {
      continue;
    }
    if (!Array.isArray(mitglieder) || !mitglieder.every((m) => typeof m === "string" && HEX64.test(m)) || new Set(mitglieder).size !== mitglieder.length) continue;
    const z = leseLivekitZugaenge(e.text, { raum: anruf, anzahl: mitglieder.length }, jetzt);
    if (!z) continue;
    // Lädt der Anrufende neu ein (neue Zugänge), gilt die neueste Einladung
    const alt = out.get(anruf);
    if (alt && (alt.zeit > e.zeit || (alt.zeit === e.zeit && alt.id > e.id))) continue;
    const meins = p.ich ? mitglieder.indexOf(p.ich) : -1;
    out.set(anruf, {
      id: e.id, von: e.von, anruf, url: z.url, bis: z.bis, zeit: e.zeit, teilnehmer: mitglieder.length,
      ...(meins >= 0 ? { zugang: z.zugaenge[meins] } : {}),
    });
  }
  return [...out.values()].sort((a, b) => b.zeit - a.zeit || (a.id < b.id ? 1 : -1));
}
