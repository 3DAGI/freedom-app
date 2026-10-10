/**
 * Agent auf dem Knoten (11.3d1a, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P4, P5):
 * offene Räume, „wer fragt, zahlt“. Der Agent hat einen eigenen Schlüssel
 * (`~/.freedom/agent-key`, 0600) – nie den des Knotens, nie den des Besitzers.
 *
 * - **Auftrag:** Die App des Fragenden schickt einen gewöhnlichen, versiegelten und
 *   bezahlten Auftrag an den Knoten; im Kern steht der Verweis auf die Erwähnung
 *   (`leseAuftragsVerweis()`). Gerechnet wird nicht die Eingabe des Auftrags,
 *   sondern Persona, Verlauf und Erwähnung aus dem Raum – sonst ließe sich der
 *   Agent unter einer fremden Erwähnung alles sagen.
 * - **Prüfung** mit denselben Regeln wie in der App (`entscheide()`): die Erwähnung
 *   gibt es im Raum, der Fragende darf dort schreiben, der Agent auch (Rolle
 *   `agent`), nie auf einen Agenten (F5: Knoten zahlen nichts aus), Bremse je
 *   Absender. Jede Erwähnung beantwortet er höchstens einmal.
 * - **Antwort:** Kind 42 vom Agenten im Raum, dieselbe Antwort versiegelt an den
 *   Fragenden (dort zahlt er).
 * - **Kein Klartext im Knoten:** Raum und Antwort nur für den Auftrag im Speicher;
 *   gemerkt werden nur die Ids beantworteter Erwähnungen.
 *
 * Private Räume: Beitreten seit 11.3d2a (`knoten-mls.ts`), Antworten mit 11.3d2b;
 * das Budget des Einladers (Pfand im Zahlkanal) mit 11.3d3.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AuftragsBremse, KIND_CHANNEL_MESSAGE, KIND_RAUM_KANAL, KIND_ROLE_GRANT, KIND_SPACE, KIND_SPACE_ROLES,
  agentAntwortEvent, agentPromptMit, ausRaumEvent, baueAgentKarte, definitionDesGruenders, entscheide, istAgentIm, leseRaumAdresse,
  raumZustandFuer, signEvent, verifyEvent,
  type AgentKarteDaten, type AgentVerlaufGrenzen, type NostrEvent, type RaumNachricht, type RelayFilter,
} from "@freedomstack/protocol";

export const agentSchluesselDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "agent-key");
export const agentBeantwortetDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "agent-beantwortet.json");

/** Verlauf im Auftrag – wie „kurz“ in der App (`VERLAUF_UMFANG`); den Umfang wählt der Gastgeber. */
export const AGENT_VERLAUF_KNOTEN: AgentVerlaufGrenzen = Object.freeze({ nachrichten: 6, zeichen: 3000, jeNachricht: 1000 });
export const AGENT_KNOTEN_GRENZEN = Object.freeze({ persona: 4000, gemerkt: 2000, verlauf: 300 });
const PERSONA_VORGABE = "Du bist ein hilfsbereiter Assistent in einem Gesprächsraum. Antworte knapp und sachlich."; // kein UI-Text

export interface KnotenAgentEinstellung {
  name: string;
  about?: string;
  persona: string;
  modell?: string;
  besitzer?: string;
  /** Private Räume (11.3d2a): Einladungen nur vom Besitzer oder von allen – ohne Angabe keine. */
  privat?: "besitzer" | "alle";
}

const HEX64 = /^[0-9a-f]{64}$/;
const STEUER = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const textOk = (s: string, max: number) => s.trim() !== "" && [...s].length <= max && !STEUER.test(s);

/**
 * Aus der Umgebung: `KNOTEN_AGENT=1` schaltet ihn ein; `AGENT_NAME` (Pflicht),
 * `AGENT_ABOUT`, `AGENT_PERSONA`, `AGENT_MODELL`, `AGENT_BESITZER` (Hex),
 * `AGENT_PRIVAT` (`besitzer` oder `alle`, 11.3d2a).
 * `null`: aus. Ungültig: ein Grund – dann startet der Knoten nicht.
 */
export function agentAusUmgebung(env: Record<string, string | undefined>):
  { einstellung: KnotenAgentEinstellung; grund?: undefined } | { einstellung?: undefined; grund: string } | null {
  const an = (env.KNOTEN_AGENT ?? "").trim();
  if (an === "" || an === "0") return null;
  if (an !== "1") return { grund: "KNOTEN_AGENT ist weder 0 noch 1" };
  const name = (env.AGENT_NAME ?? "").trim();
  if (!textOk(name, 64)) return { grund: "AGENT_NAME fehlt oder ist ungültig (höchstens 64 Zeichen)" };
  const about = env.AGENT_ABOUT?.trim() || undefined;
  if (about !== undefined && !textOk(about, 500)) return { grund: "AGENT_ABOUT ist ungültig (höchstens 500 Zeichen)" };
  const persona = env.AGENT_PERSONA?.trim() || PERSONA_VORGABE;
  // Zeilenumbrüche erlaubt – die Persona ist ein Text für das Modell
  if ([...persona].length > AGENT_KNOTEN_GRENZEN.persona || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(persona)) {
    return { grund: `AGENT_PERSONA ist ungültig (höchstens ${AGENT_KNOTEN_GRENZEN.persona} Zeichen)` };
  }
  const modell = env.AGENT_MODELL?.trim() || undefined;
  if (modell !== undefined && !textOk(modell, 128)) return { grund: "AGENT_MODELL ist ungültig" };
  const besitzer = env.AGENT_BESITZER?.trim().toLowerCase() || undefined;
  if (besitzer !== undefined && !HEX64.test(besitzer)) return { grund: "AGENT_BESITZER ist kein Schlüssel (64 Zeichen Hex)" };
  const privat = (env.AGENT_PRIVAT ?? "").trim();
  if (privat !== "" && privat !== "besitzer" && privat !== "alle") return { grund: "AGENT_PRIVAT ist weder besitzer noch alle" };
  if (privat === "besitzer" && !besitzer) return { grund: "AGENT_PRIVAT=besitzer braucht AGENT_BESITZER" };
  return {
    einstellung: {
      name, persona, ...(about ? { about } : {}), ...(modell ? { modell } : {}), ...(besitzer ? { besitzer } : {}),
      ...(privat === "besitzer" || privat === "alle" ? { privat } : {}),
    },
  };
}

/** Ablehnung mit Kennung – die App erkennt den Fall am Tag `fall`, nie am Text. */
export class AgentAbgelehnt extends Error {
  constructor(readonly fall: string) {
    super(`Agent: ${fall}`);
    this.name = "AgentAbgelehnt";
  }
}

/** Ein geprüfter Auftrag: die Erwähnung, der Raum, der Text für das Modell. */
export interface AgentAuftrag {
  nachricht: RaumNachricht;
  kennung: string;
  prompt: string;
}

interface Pool {
  query(f: RelayFilter): Promise<NostrEvent[]>;
  publish(ev: NostrEvent): Promise<unknown>;
}

export class KnotenAgent {
  readonly pk: string;
  private readonly sk: Uint8Array;
  private readonly bremse = new AuftragsBremse();
  private readonly beantwortet: string[];
  private readonly inArbeit = new Set<string>();

  constructor(private readonly p: {
    schluessel: { sk: Uint8Array; pk: string };
    einstellung: KnotenAgentEinstellung;
    /** Schlüssel des Knotens – er rechnet (Karte `provider`). */
    knoten: string;
    pool: Pool;
    /** Ids beantworteter Erwähnungen – überlebt einen Neustart. Ohne: nur im Speicher. */
    datei?: string;
    jetzt?: () => number;
  }) {
    this.pk = p.schluessel.pk;
    this.sk = p.schluessel.sk;
    this.beantwortet = p.datei ? leseGemerkt(p.datei) : [];
  }

  private jetzt(): number {
    return this.p.jetzt?.() ?? Math.floor(Date.now() / 1000);
  }

  /** Das Modell des Agenten, wenn der Knoten es anbietet. */
  get modell(): string | undefined {
    return this.p.einstellung.modell;
  }

  /** Angaben der Karte: Betrieb Knoten, „wer fragt, zahlt“, der Knoten rechnet – offen wie im privaten Raum (11.3d2a). */
  kartenDaten(): AgentKarteDaten {
    const e = this.p.einstellung;
    return {
      name: e.name, betrieb: "knoten", bezahlung: "fragender", provider: this.p.knoten,
      ...(e.about ? { about: e.about } : {}), ...(e.modell ? { modell: e.modell } : {}), ...(e.besitzer ? { besitzer: e.besitzer } : {}),
    };
  }

  /** Karte (38090) für offene Räume – signiert vom Agenten. */
  karte(): NostrEvent {
    return signEvent(baueAgentKarte(this.pk, this.kartenDaten(), this.jetzt()), this.sk);
  }

  /**
   * Den Verweis prüfen und den Auftrag bauen. Wirft `AgentAbgelehnt` – vor dem
   * Rechnen, also ohne Kosten für den Fragenden. Eine angenommene Erwähnung ist
   * reserviert, bis `antworte()` oder `gib()` sie abschließt.
   */
  async pruefe(verweis: { raum: string; erwaehnung: string }): Promise<AgentAuftrag> {
    const ort = leseRaumAdresse(verweis.raum);
    // Private Räume (Gruppen-Id statt Adresse) erst mit 11.3d2
    if (!ort) throw new AgentAbgelehnt("agent-privat");
    if (this.beantwortet.includes(verweis.erwaehnung) || this.inArbeit.has(verweis.erwaehnung)) {
      throw new AgentAbgelehnt("agent-schon-beantwortet");
    }
    // Fehler der Relays nie weiterreichen – nach außen nur Kennungen
    const frage = (f: RelayFilter) => this.p.pool.query(f).catch(() => { throw new AgentAbgelehnt("agent-raum-nicht-erreichbar"); });
    const ev = (await frage({ ids: [verweis.erwaehnung], limit: 1 })).find((e) => e.id === verweis.erwaehnung);
    const kennung = ort.spaceId;
    if (!ev || !verifyEvent(ev) || ev.kind !== KIND_CHANNEL_MESSAGE || !ev.tags.some((t) => t[0] === "space" && t[1] === kennung)) {
      throw new AgentAbgelehnt("agent-keine-erwaehnung");
    }
    const [struktur, verlauf] = await Promise.all([
      frage({ kinds: [KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT, KIND_RAUM_KANAL], "#space": [kennung], limit: 500 }),
      frage({ kinds: [KIND_CHANNEL_MESSAGE], "#space": [kennung], until: ev.created_at, limit: AGENT_KNOTEN_GRENZEN.verlauf }),
    ]);
    const echt = (l: NostrEvent[]) => l.filter((e) => verifyEvent(e));
    const struk = echt(struktur);
    const stand = raumZustandFuer(verweis.raum, struk);
    if (!stand?.space) throw new AgentAbgelehnt("agent-kein-raum");
    // Schalter der Agentenketten: nur in der Definition des Gründers (F5)
    const definition = definitionDesGruenders(verweis.raum, struk);
    const alle = echt(verlauf).filter((e) => e.tags.some((t) => t[0] === "space" && t[1] === kennung));
    if (!alle.some((e) => e.id === ev.id)) alle.push(ev);
    // „Wer fragt, zahlt“: nie auf Agenten – Knoten zahlen nichts aus (F5)
    const e = entscheide({ agent: this.pk, ev, alle, stand, definition, bremse: this.bremse, jetzt: this.jetzt(), ausBudget: false });
    if (e.art !== "antworten") throw new AgentAbgelehnt(`agent-${e.grund}`);
    this.inArbeit.add(ev.id);
    const nachrichten = alle.map(ausRaumEvent).filter((n): n is RaumNachricht => n !== null);
    const prompt = agentPromptMit({
      agent: this.pk, persona: this.p.einstellung.persona, nachricht: e.nachricht, alle: nachrichten,
      istAgent: istAgentIm(stand), grenzen: AGENT_VERLAUF_KNOTEN,
    });
    return { nachricht: e.nachricht, kennung, prompt };
  }

  /** Die Antwort im Raum veröffentlichen (Kind 42 vom Agenten) und die Erwähnung als beantwortet merken. */
  async antworte(a: AgentAuftrag, text: string): Promise<NostrEvent> {
    const ev = signEvent(agentAntwortEvent({ agent: this.pk, kennung: a.kennung, auf: a.nachricht, text, jetzt: this.jetzt() }), this.sk);
    try {
      await this.p.pool.publish(ev).catch(() => { throw new AgentAbgelehnt("agent-nicht-veroeffentlicht"); });
      this.beantwortet.push(a.nachricht.id);
      if (this.beantwortet.length > AGENT_KNOTEN_GRENZEN.gemerkt) this.beantwortet.splice(0, this.beantwortet.length - AGENT_KNOTEN_GRENZEN.gemerkt);
      if (this.p.datei) schreibeGemerkt(this.p.datei, this.beantwortet);
      return ev;
    } finally {
      this.inArbeit.delete(a.nachricht.id);
    }
  }

  /** Abgebrochen (Rechnen gescheitert): die Erwähnung wieder freigeben – ein neuer Auftrag darf sie beantworten. */
  gib(a: AgentAuftrag): void {
    this.inArbeit.delete(a.nachricht.id);
  }
}

/** Gemerkte Ids lesen – Kaputtes heißt leer (nur Ids, nie Inhalt). */
function leseGemerkt(datei: string): string[] {
  if (!existsSync(datei)) return [];
  try {
    const l = JSON.parse(readFileSync(datei, "utf8")) as unknown;
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string" && HEX64.test(x)).slice(-AGENT_KNOTEN_GRENZEN.gemerkt) : [];
  } catch {
    return [];
  }
}

function schreibeGemerkt(datei: string, ids: readonly string[]): void {
  mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
  writeFileSync(datei, JSON.stringify(ids), { mode: 0o600 });
}
