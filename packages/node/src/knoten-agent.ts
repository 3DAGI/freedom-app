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
 * Private Räume (`AGENT_PRIVAT`): beitreten seit 11.3d2a (`knoten-mls.ts`), antworten seit 11.3d2b –
 * derselbe Auftrag mit der Gruppe im Verweis, die Antwort als inneres Event;
 * das Budget des Einladers (Pfand im Zahlkanal) mit 11.3d3.
 *
 * Repo-Aufträge (11.5c2a, `docs/REPO-AGENTEN-ENTWURF.md`, nur mit `AGENT_REPO=1` und Sandbox): Zeigt die
 * Erwähnung auf ein Repo des Raums (`leseRepoAuftrag()`), holt der Agent das Bundle des neuesten Verweises
 * eines Pflegers (`holeRepoBundle()`), arbeitet im Ablauf nach mini-swe-agent (`bearbeiteRepo()`), reicht den
 * Patch ein (Kind 1617 vom Agenten) und nennt ihn in der Antwort. In privaten Räumen (11.5c2b, P1–P4) nur als
 * Mitglied, nur mit dem Modell auf diesem Rechner (`modellLokal`), Repo, Verweis, Patch und Antwort nur als innere
 * Events der Gruppe.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AuftragsBremse, KIND_CHANNEL_MESSAGE, KIND_GIT_REPO_REF, KIND_RAUM_KANAL, KIND_REPO_ANKUENDIGUNG, KIND_ROLE_GRANT, KIND_SPACE, KIND_SPACE_ROLES,
  agentAntwortEvent, agentPromptMit, ausRaumEvent, baueAgentKarte, bauePatch, definitionDesGruenders, entscheide, gruppenRaum, istAgentIm,
  leseIssue, lesePatchText, leseRaumAdresse, leseRepoAuftrag, neuesterBundleVerweis, raumAgentAntwort, raumAgentKarten, raumZustandFuer,
  raumRepoPatch, raumReposPrivat, repoImOffenenRaum, repoImPrivatenRaum, signEvent, verifyEvent,
  type AgentKarteDaten, type AgentVerlaufGrenzen, type GelesenesRepo, type InneresEvent, type InneresSenden, type NostrEvent, type RaumNachricht,
  type RelayFilter, type SpaceState,
} from "@freedomstack/protocol";
import type { ChatAntwort, InferenceBackend } from "./inference.js";
import type { PaketFall, PaketOptionen } from "./pakete.js";
import { holeRepoBundle } from "./repo-bundle.js";
import { type RepoLaufGrenzen, bearbeiteRepo } from "./repo-lauf.js";

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
  /** Repo-Aufträge (11.5c2a): Code des Raums in der Sandbox bearbeiten – nur mit `AGENT_REPO=1`. */
  repo?: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/;
const STEUER = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const textOk = (s: string, max: number) => s.trim() !== "" && [...s].length <= max && !STEUER.test(s);

/**
 * Aus der Umgebung: `KNOTEN_AGENT=1` schaltet ihn ein; `AGENT_NAME` (Pflicht),
 * `AGENT_ABOUT`, `AGENT_PERSONA`, `AGENT_MODELL`, `AGENT_BESITZER` (Hex),
 * `AGENT_PRIVAT` (`besitzer` oder `alle`, 11.3d2a), `AGENT_REPO` (0 oder 1, 11.5c2a).
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
  const repo = (env.AGENT_REPO ?? "").trim();
  if (repo !== "" && repo !== "0" && repo !== "1") return { grund: "AGENT_REPO ist weder 0 noch 1" };
  return {
    einstellung: {
      name, persona, ...(about ? { about } : {}), ...(modell ? { modell } : {}), ...(besitzer ? { besitzer } : {}),
      ...(privat === "besitzer" || privat === "alle" ? { privat } : {}), ...(repo === "1" ? { repo: true } : {}),
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

/** Was der Agent von seinem MLS-Konto braucht (`KnotenMls`, 11.3d2a) – private Räume. */
export interface PrivateRaeume {
  gruppen(): string[];
  ereignisse(gruppe: string): InneresEvent[];
  admins(gruppe: string): string[];
  mitglieder(gruppe: string): string[];
  abgleich(): Promise<unknown>;
  sende(gruppe: string, s: InneresSenden): Promise<string | null>;
}

/** Ein Repo-Auftrag (11.5c2a): das Repo mit den Rechten des Raums, der Bundle-Verweis, die Aufgabe für den Ablauf. */
export interface RepoArbeit {
  repo: GelesenesRepo;
  verweis: NostrEvent;
  aufgabe: string;
}

/** Ein geprüfter Auftrag: die Erwähnung, der Raum, der Text für das Modell – im privaten Raum mit der Gruppe. */
export interface AgentAuftrag {
  nachricht: RaumNachricht;
  kennung: string;
  gruppe?: string;
  prompt: string;
  repo?: RepoArbeit;
}

/** Wie ein Repo-Auftrag endete – Kennung im Tag `fall` der Antwort, der Satz für den Raum (die App bildet ihren eigenen). */
export const REPO_TEXT = {
  "repo.patch": "Patch eingereicht:",
  "repo.keine-aenderung": "Fertig, aber nichts geändert – kein Patch.",
  "repo.gross": "Die Änderung ist zu groß für einen Patch.",
  "repo.binaer": "Die Änderung enthält Binärdateien oder Text, der kein UTF-8 ist – dafür gibt es keinen Patch.",
  "repo.ordner": "Den Arbeitsordner konnte der Knoten nicht lesen – kein Patch.",
  "repo.angaben": "Der Patch ließ sich nicht bauen.",
  "repo.schritte": "Abgebrochen nach der Höchstzahl an Schritten – kein Patch.",
  "repo.zeit": "Abgebrochen: Die Zeit für den Auftrag ist um – kein Patch.",
  "repo.tokens": "Abgebrochen: Die Obergrenze des Preises ist erreicht – kein Patch.",
  "repo.formfehler": "Abgebrochen: Das Modell hielt das Format nicht ein – kein Patch.",
} as const;
export type RepoFall = keyof typeof REPO_TEXT;
/** Hinter dem Satz, wenn die Pakete der Sperrdatei nicht zu holen waren (11.5c3) – der Auftrag lief ohne sie. */
export const PAKETE_FEHLEN_TEXT = "Die Pakete aus der Sperrdatei ließen sich nicht holen.";

/** Ergebnis eines Repo-Auftrags – wie ein gewöhnliches Ergebnis, dazu die Kennung und, wenn eingereicht, der Patch. */
export interface RepoErgebnis {
  output: string;
  fall: RepoFall;
  patch?: string;
  /** Warum die Pakete der Sperrdatei fehlten (11.5c3, `PaketAbgelehnt.fall`). */
  pakete?: PaketFall;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

/** Höchstens so viele Repo-Aufträge zugleich – jeder hält eine Sandbox und das Modell lange beschäftigt. */
export const REPO_GLEICHZEITIG = 1;

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
  private privat?: PrivateRaeume;
  private repoLaeufe = 0;

  constructor(private readonly p: {
    schluessel: { sk: Uint8Array; pk: string };
    einstellung: KnotenAgentEinstellung;
    /** Schlüssel des Knotens – er rechnet (Karte `provider`). */
    knoten: string;
    pool: Pool;
    /** Ids beantworteter Erwähnungen – überlebt einen Neustart. Ohne: nur im Speicher. */
    datei?: string;
    jetzt?: () => number;
    /**
     * Repo-Aufträge (11.5c2a): nur, wenn die Sandbox geht (`main.ts` prüft `pruefeSandbox()`) – ohne diese
     * Angabe lehnt der Agent sie ab, auch mit `AGENT_REPO=1`. `bwrap`, `basis`, `grenzen` für Tests.
     */
    repo?: {
      bwrap?: string; basis?: string; grenzen?: Partial<RepoLaufGrenzen>;
      /** Pakete holen (11.5c3, W6a) – nur für offene Räume; `tor` aus `main.ts`. Ohne diese Angabe holt der Agent keine. */
      pakete?: PaketOptionen;
    };
    /**
     * Läuft das Modell auf diesem Rechner (`lokaleKiAdresse()` der Adresse des Antriebs, P2)? Nur dann nimmt der
     * Agent Repo-Aufträge privater Räume an – ihr Code geht nie an einen anderen Rechner.
     */
    modellLokal?: boolean;
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
    if (this.beantwortet.includes(verweis.erwaehnung) || this.inArbeit.has(verweis.erwaehnung)) {
      throw new AgentAbgelehnt("agent-schon-beantwortet");
    }
    const ort = leseRaumAdresse(verweis.raum);
    // Gruppen-Id statt Adresse: privater Raum (11.3d2b) – nur mit eigenem MLS-Konto
    if (!ort) return this.pruefePrivat(verweis);
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
    const repo = await this.offenesRepo(ev, verweis.raum, stand, frage);
    this.inArbeit.add(ev.id);
    const nachrichten = alle.map(ausRaumEvent).filter((n): n is RaumNachricht => n !== null);
    const prompt = agentPromptMit({
      agent: this.pk, persona: this.p.einstellung.persona, nachricht: e.nachricht, alle: nachrichten,
      istAgent: istAgentIm(stand), grenzen: AGENT_VERLAUF_KNOTEN,
    });
    return { nachricht: e.nachricht, kennung, prompt, ...(repo ? { repo: { ...repo, aufgabe: prompt + repo.issueText } } : {}) };
  }

  /**
   * Repo-Auftrag im offenen Raum (11.5c2a): das Repo gehört zum Raum (`repoImOffenenRaum()`, Agenten pflegen nie),
   * der Bundle-Verweis ist der neueste eines Pflegers, ein Issue gehört zum Repo. Ohne Repo-Tag: kein Repo-Auftrag.
   */
  private async offenesRepo(ev: NostrEvent, raum: string, stand: SpaceState, frage: (f: RelayFilter) => Promise<NostrEvent[]>):
    Promise<{ repo: GelesenesRepo; verweis: NostrEvent; issueText: string } | undefined> {
    const auftrag = leseRepoAuftrag(ev.tags);
    if (!auftrag) return undefined;
    if (!this.p.einstellung.repo || !this.p.repo) throw new AgentAbgelehnt("agent-repo-aus");
    const [, eigentuemer, id] = auftrag.repo.split(":");
    const echt = (l: NostrEvent[]) => l.filter((x) => verifyEvent(x));
    const ankuendigungen = echt(await frage({ kinds: [KIND_REPO_ANKUENDIGUNG], authors: [eigentuemer!], "#d": [id!], limit: 20 }));
    const im = repoImOffenenRaum({ auftrag, raum, ankuendigungen, zustand: stand, istAgent: istAgentIm(stand) });
    if (!im.ok) throw new AgentAbgelehnt(im.fall);
    const verweise = echt(await frage({ kinds: [KIND_GIT_REPO_REF], authors: [im.repo.eigentuemer, ...im.repo.maintainer], "#d": [im.repo.id], limit: 50 }));
    const verweis = neuesterBundleVerweis(im.repo, verweise);
    if (!verweis) throw new AgentAbgelehnt("agent-repo-bundle");
    const roh = auftrag.issue ? echt(await frage({ ids: [auftrag.issue], limit: 1 })).find((x) => x.id === auftrag.issue) : undefined;
    return { repo: im.repo, verweis, issueText: this.issueText(auftrag.issue, roh, im.repo) };
  }

  /**
   * Einen Repo-Auftrag ausführen (11.5c2a): Bundle holen, Ablauf in der Sandbox, Patch vom Agenten einreichen.
   * Wirft `AgentAbgelehnt`, wenn nichts gerechnet werden konnte (Bundle, Modell, Sandbox) – dann zahlt der
   * Fragende nichts, und `gib()` gibt die Erwähnung frei. Sonst die Antwort samt Kennung; die steht danach
   * über `antworte()` im Raum. Gezählt werden Tokens der Antworten (wie jede Abrechnung), höchstens `tokens`.
   */
  async bearbeiteRepoAuftrag(a: AgentAuftrag, p: {
    gespraech: NonNullable<InferenceBackend["gespraech"]>; model?: string; tokens?: number;
  }): Promise<RepoErgebnis> {
    const arbeit = a.repo;
    if (!arbeit || !this.p.repo) throw new AgentAbgelehnt("agent-repo-aus");
    if (this.repoLaeufe >= REPO_GLEICHZEITIG) throw new AgentAbgelehnt("agent-repo-belegt");
    this.repoLaeufe++;
    const start = Date.now();
    let promptTokens = 0, model = p.model ?? "";
    try {
      const geholt = await holeRepoBundle(this.p.pool, arbeit.verweis);
      if (!geholt.ok) throw new AgentAbgelehnt(geholt.fall);
      const r = await bearbeiteRepo({
        aufgabe: arbeit.aufgabe, bundle: geholt.bundle, bwrap: this.p.repo.bwrap, basis: this.p.repo.basis,
        // Pakete nur in offenen Räumen – privat verriete schon die Wahl der Namen etwas über den Code (P3, W7)
        ...(this.p.repo.pakete && !a.gruppe ? { paketHolen: this.p.repo.pakete } : {}),
        grenzen: { ...this.p.repo.grenzen, ...(p.tokens !== undefined ? { tokens: p.tokens } : {}) },
        angaben: { name: this.p.einstellung.name, mail: `${this.pk.slice(0, 16)}@agent.freedom.invalid`, zeit: this.jetzt(), betreff: "Vorschlag des Agenten" }, // kein UI-Text
        modell: async (nachrichten) => {
          const c: ChatAntwort = await p.gespraech({ model: p.model, nachrichten });
          promptTokens += c.promptTokens;
          model = c.model;
          return { text: c.text, tokens: c.completionTokens, abgeschnitten: c.abgeschnitten };
        },
      });
      if (r.ende === "modell" || r.ende === "sandbox") throw new AgentAbgelehnt("agent-repo-fehler");
      const basis = { model, promptTokens, completionTokens: r.tokens, durationMs: Date.now() - start, ...(r.pakete ? { pakete: r.pakete } : {}) };
      const text = (t: string) => (r.pakete ? `${t} ${PAKETE_FEHLEN_TEXT}` : t);
      if (r.ende !== "fertig") return { ...basis, fall: `repo.${r.ende}`, output: text(REPO_TEXT[`repo.${r.ende}`]) };
      if (!r.patch?.ok) {
        const fall = `repo.${(r.patch?.fall ?? "patch.ordner").slice("patch.".length)}` as RepoFall;
        return { ...basis, fall, output: text(REPO_TEXT[fall]) };
      }
      const patch = await this.reicheEin(a, arbeit.repo, r.patch.text);
      return { ...basis, fall: "repo.patch", patch, output: text(`${REPO_TEXT["repo.patch"]} ${lesePatchText(r.patch.text).betreff}`) };
    } finally {
      this.repoLaeufe--;
    }
  }

  /** Den Patch einreichen: offen signiert vom Agenten (1617), privat nur als inneres Event der Gruppe (P4) – die Id davon. */
  private async reicheEin(a: AgentAuftrag, repo: GelesenesRepo, text: string): Promise<string> {
    if (a.gruppe) {
      const inneres = await this.privat?.sende(a.gruppe, raumRepoPatch(a.gruppe, { repo, text })).catch(() => null);
      if (!inneres) throw new AgentAbgelehnt("agent-nicht-veroeffentlicht");
      return inneres;
    }
    const patch = signEvent(bauePatch({ repo, text }, this.pk), this.sk);
    await this.p.pool.publish(patch).catch(() => { throw new AgentAbgelehnt("agent-nicht-veroeffentlicht"); });
    return patch.id;
  }

  /** Das MLS-Konto des Agenten (11.3d2a) – ohne gibt es keine privaten Räume. */
  nutzePrivat(z: PrivateRaeume): void {
    this.privat = z;
  }

  /**
   * Privater Raum (11.3d2b): dieselben Regeln, der Raum aus dem, was der Agent als Mitglied liest
   * (`gruppenRaum()` mit Admins und Mitgliedern aus MLS). Fehlt die Erwähnung noch, einmal abgleichen.
   */
  private async pruefePrivat(v: { raum: string; erwaehnung: string }): Promise<AgentAuftrag> {
    const z = this.privat;
    if (!z || !z.gruppen().includes(v.raum)) throw new AgentAbgelehnt("agent-privat");
    const lies = () => {
      const ereignisse = z.ereignisse(v.raum);
      const admins = z.admins(v.raum);
      return { ereignisse, admins, raum: gruppenRaum(v.raum, ereignisse, { admins, mitglieder: z.mitglieder(v.raum) }) };
    };
    let r = lies();
    if (!r.raum.nachrichten.some((n) => n.id === v.erwaehnung)) {
      await z.abgleich().catch(() => undefined);
      r = lies();
    }
    const ev = r.raum.nachrichten.find((n) => n.id === v.erwaehnung);
    if (!ev) throw new AgentAbgelehnt("agent-keine-erwaehnung");
    if (!r.raum.zustand.space) throw new AgentAbgelehnt("agent-kein-raum");
    // Schalter der Agentenketten: in der Definition eines Admins (F5); Agenten an ihrer Karte
    const definition = r.ereignisse.filter((e) => e.art === KIND_SPACE && (e.admin ?? r.admins.includes(e.von))).sort((a, b) => b.zeit - a.zeit)[0]?.tags ?? [];
    const agenten = new Set(raumAgentKarten(r.ereignisse).map((k) => k.agent));
    const istAgent = (pk: string): boolean => agenten.has(pk);
    const e = entscheide({
      agent: this.pk, ev, alle: r.raum.nachrichten, stand: r.raum.zustand, definition, bremse: this.bremse, jetzt: this.jetzt(), istAgent, ausBudget: false,
    });
    if (e.art !== "antworten") throw new AgentAbgelehnt(`agent-${e.grund}`);
    const repo = this.privatesRepo(ev, v.raum, r.ereignisse, r.raum.zustand, istAgent);
    this.inArbeit.add(ev.id);
    const nachrichten = r.raum.nachrichten.map(ausRaumEvent).filter((n): n is RaumNachricht => n !== null);
    const prompt = agentPromptMit({
      agent: this.pk, persona: this.p.einstellung.persona, nachricht: e.nachricht, alle: nachrichten, istAgent, grenzen: AGENT_VERLAUF_KNOTEN,
    });
    return { nachricht: e.nachricht, kennung: v.raum, gruppe: v.raum, prompt, ...(repo ? { repo: { ...repo, aufgabe: prompt + repo.issueText } } : {}) };
  }

  /**
   * Repo-Auftrag im privaten Raum (11.5c2b, P1–P4): nur, was ein Pfleger der Gruppe angekündigt hat
   * (`repoImPrivatenRaum()`, Agenten pflegen nie), der Bundle-Verweis samt Schlüssel aus den inneren Events, und nur
   * mit dem Modell auf diesem Rechner – der Code der Gruppe geht nie an einen anderen.
   */
  private privatesRepo(ev: NostrEvent, gruppe: string, ereignisse: InneresEvent[], zustand: SpaceState, istAgent: (pk: string) => boolean):
    { repo: GelesenesRepo; verweis: NostrEvent; issueText: string } | undefined {
    const auftrag = leseRepoAuftrag(ev.tags);
    if (!auftrag) return undefined;
    if (!this.p.einstellung.repo || !this.p.repo) throw new AgentAbgelehnt("agent-repo-aus");
    if (!this.p.modellLokal) throw new AgentAbgelehnt("agent-repo-modell");
    const im = repoImPrivatenRaum({ auftrag, raumId: gruppe, ereignisse, zustand, istAgent });
    if (!im.ok) throw new AgentAbgelehnt(im.fall);
    const { bundles, issues } = raumReposPrivat(gruppe, ereignisse, zustand, istAgent);
    const verweis = neuesterBundleVerweis(im.repo, bundles);
    if (!verweis) throw new AgentAbgelehnt("agent-repo-bundle");
    return { repo: im.repo, verweis, issueText: this.issueText(auftrag.issue, issues.find((x) => x.id === auftrag.issue), im.repo) };
  }

  /** Text eines Issues für die Aufgabe – nur ein Issue genau dieses Repos, sonst `agent-repo-issue`. */
  private issueText(id: string | undefined, roh: NostrEvent | undefined, repo: GelesenesRepo): string {
    if (!id) return "";
    let issue: ReturnType<typeof leseIssue> | undefined;
    try { issue = roh ? leseIssue(roh) : undefined; } catch { issue = undefined; }
    if (!issue || issue.repoAdresse !== repo.adresse) throw new AgentAbgelehnt("agent-repo-issue");
    return `\n\n[Issue: ${issue.betreff}]:\n${issue.text}`; // kein UI-Text
  }

  /**
   * Die Antwort im Raum veröffentlichen – offen Kind 42 vom Agenten, privat ein inneres Event der
   * Gruppe (11.3d2b) – und die Erwähnung als beantwortet merken.
   */
  async antworte(a: AgentAuftrag, text: string, repo?: { fall: RepoFall; patch?: string; pakete?: PaketFall }): Promise<void> {
    try {
      if (a.gruppe) {
        const inneres = await this.privat?.sende(a.gruppe, raumAgentAntwort(a.nachricht, text, repo)).catch(() => null);
        if (!inneres) throw new AgentAbgelehnt("agent-nicht-veroeffentlicht");
      } else {
        const ev = signEvent(agentAntwortEvent({ agent: this.pk, kennung: a.kennung, auf: a.nachricht, text, jetzt: this.jetzt(), ...repo }), this.sk);
        await this.p.pool.publish(ev).catch(() => { throw new AgentAbgelehnt("agent-nicht-veroeffentlicht"); });
      }
      this.beantwortet.push(a.nachricht.id);
      if (this.beantwortet.length > AGENT_KNOTEN_GRENZEN.gemerkt) this.beantwortet.splice(0, this.beantwortet.length - AGENT_KNOTEN_GRENZEN.gemerkt);
      if (this.p.datei) schreibeGemerkt(this.p.datei, this.beantwortet);
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
