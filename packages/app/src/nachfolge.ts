/**
 * Nachfolge in der App (Schritt 8.11b), ohne DOM – die Oberflaeche steht in
 * shell/nachfolge-ui.ts.
 *
 * Als Vertrauter haelt die App: den eigenen Anteil je Besitzer (versiegelt
 * bekommen, 8.11a), Anfragen anderer Vertrauter und – wenn sie sammelt – die
 * ihr uebergebenen Anteile. Alles liegt nur im Tresor-Speicher (`geheim`);
 * ohne Tresor nur im Speicher bis zum Neuladen, der Anteil bleibt dann auf den
 * Relays und wird beim naechsten Abgleich wieder gelesen.
 */
import {
  type AnteilAnfrage, type GehaltenerAnteil, type NostrEvent, type Signer, type SuccessionPlan, type SuccessionState,
  darfUebergeben, evaluateSuccession, oeffneAnteil, oeffneAnteilAnfrage, oeffneAnteilUebergabe,
} from "@freedomstack/protocol";

export const LS_NACHFOLGE = "freedom.nachfolge";

export type ErhaltenerAnteil = GehaltenerAnteil & { von: string };

export interface NachfolgeStand {
  /** Besitzer -> mein Anteil (der neueste). */
  anteile: Record<string, GehaltenerAnteil>;
  /** Anfragen anderer Vertrauter an mich (hoechstens 50). */
  anfragen: AnteilAnfrage[];
  /** Besitzer -> Anteile, die mir uebergeben wurden (ich sammle). */
  erhalten: Record<string, ErhaltenerAnteil[]>;
  /** Besitzer -> wann ich die anderen gefragt habe. */
  angefragt: Record<string, number>;
}

export interface NachfolgeSpeicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): Promise<void>;
}

const leer = (): NachfolgeStand => ({ anteile: {}, anfragen: [], erhalten: {}, angefragt: {} });
const HEX64 = /^[0-9a-f]{64}$/;
const objekt = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Gespeicherten Stand streng lesen – Unfug faellt heraus. */
export function leseStand(s: NachfolgeSpeicher | null, imSpeicher?: NachfolgeStand): NachfolgeStand {
  if (!s) return imSpeicher ?? leer();
  try {
    const roh = JSON.parse(s.getItem(LS_NACHFOLGE) ?? "{}") as unknown;
    if (!objekt(roh)) return leer();
    const st = leer();
    if (objekt(roh.anteile)) for (const [k, v] of Object.entries(roh.anteile)) if (HEX64.test(k) && objekt(v)) st.anteile[k] = v as unknown as GehaltenerAnteil;
    if (Array.isArray(roh.anfragen)) st.anfragen = roh.anfragen.filter(objekt) as unknown as AnteilAnfrage[];
    if (objekt(roh.erhalten)) for (const [k, v] of Object.entries(roh.erhalten)) if (HEX64.test(k) && Array.isArray(v)) st.erhalten[k] = v.filter(objekt) as unknown as ErhaltenerAnteil[];
    if (objekt(roh.angefragt)) for (const [k, v] of Object.entries(roh.angefragt)) if (HEX64.test(k) && Number.isSafeInteger(v)) st.angefragt[k] = v as number;
    return st;
  } catch {
    return leer();
  }
}

export async function schreibeStand(s: NachfolgeSpeicher | null, st: NachfolgeStand): Promise<void> {
  if (s) await s.setItem(LS_NACHFOLGE, JSON.stringify(st));
}

/**
 * Einen Umschlag aus dem Posteingang einordnen: eigener Anteil, Anfrage eines
 * anderen Vertrauten oder (nur wenn ich angefragt habe) eine Uebergabe.
 * Gibt den geaenderten Stand zurueck oder null, wenn der Umschlag nicht zur
 * Nachfolge gehoert.
 */
export async function nimmUmschlag(p: {
  wrap: NostrEvent; signer: Signer; stand: NachfolgeStand; plaene: () => Promise<SuccessionPlan[]>;
}): Promise<NachfolgeStand | null> {
  const st = p.stand;
  const a = await oeffneAnteil(p.wrap, p.signer).catch(() => null);
  if (a) {
    const alt = st.anteile[a.besitzer];
    if (!alt || a.zeit >= alt.zeit) st.anteile[a.besitzer] = a;
    return st;
  }
  const q = await oeffneAnteilAnfrage(p.wrap, p.signer).catch(() => null);
  if (q) {
    if (!st.anfragen.some((x) => x.anfrageId === q.anfrageId)) st.anfragen = [...st.anfragen, q].slice(-50);
    return st;
  }
  if (Object.keys(st.angefragt).length === 0) return null;
  const u = await oeffneAnteilUebergabe(p.wrap, p.signer, await p.plaene()).catch(() => null);
  if (!u) return null;
  const liste = st.erhalten[u.besitzer] ?? [];
  const { anfrageId: _, ...anteil } = u;
  if (!liste.some((x) => x.teilung === u.teilung && x.index === u.index)) st.erhalten[u.besitzer] = [...liste, anteil];
  return st;
}

/** Neuester Plan je Besitzer aus Relay-Events. */
export function neuestePlaene(events: readonly NostrEvent[], lese: (ev: NostrEvent) => SuccessionPlan): Map<string, SuccessionPlan> {
  const m = new Map<string, SuccessionPlan>();
  for (const ev of [...events].sort((x, y) => x.created_at - y.created_at)) {
    try {
      const p = lese(ev);
      m.set(p.ownerPubkey, p);
    } catch { /* unvollstaendiger Plan */ }
  }
  return m;
}

export interface VertrautenZeile {
  besitzer: string;
  anteil: GehaltenerAnteil;
  plan: SuccessionPlan | null;
  status: SuccessionState | null;
  /** Anteil passt zum aktuellen Plan und ich bin darin Vertrauter. */
  passt: boolean;
  /** Meine Meldung zaehlt schon (nach dem letzten Lebenszeichen). */
  gemeldet: boolean;
  /** Anfragen anderer Vertrauter – mit der Antwort, ob ich uebergeben darf. */
  anfragen: { anfrage: AnteilAnfrage; darf: { ok: true } | { ok: false; grund: string } }[];
  /** Anteile dieser Teilung, die ich habe (eigener plus uebergebene). */
  beisammen: number;
  kannAnfordern: boolean;
  kannZusammensetzen: boolean;
}

/** Was die Ansicht „Du bist Vertrauter fuer …“ zeigt und anbietet. */
export function vertrautenZeilen(
  st: NachfolgeStand, plaene: Map<string, SuccessionPlan>, events: NostrEvent[], ich: string, jetzt?: number,
): VertrautenZeile[] {
  return Object.values(st.anteile).map((anteil) => {
    const plan = plaene.get(anteil.besitzer) ?? null;
    const passt = !!plan && plan.secretHash === anteil.secretHash && plan.guardians.includes(ich);
    const status = plan ? evaluateSuccession(plan, events, jetzt) : null;
    const anfragen = st.anfragen
      .filter((q) => q.besitzer === anteil.besitzer && q.teilung === anteil.teilung)
      .map((anfrage) => ({
        anfrage,
        darf: plan ? darfUebergeben({ plan, events, anteil, ich, sammler: anfrage.von, nowSecs: jetzt }) : { ok: false as const, grund: "Plan nicht gefunden" },
      }));
    const indizes = new Set([anteil.index, ...(st.erhalten[anteil.besitzer] ?? []).filter((e) => e.teilung === anteil.teilung).map((e) => e.index)]);
    const freigegeben = passt && status?.status === "freigegeben";
    return {
      besitzer: anteil.besitzer, anteil, plan, status, passt, gemeldet: !!status?.claims.includes(ich), anfragen, beisammen: indizes.size,
      kannAnfordern: freigegeben,
      kannZusammensetzen: freigegeben && !!plan && indizes.size >= plan.threshold,
    };
  });
}
