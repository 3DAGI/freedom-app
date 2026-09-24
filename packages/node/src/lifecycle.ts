/**
 * Dauerbetrieb: sauber entleeren, aktualisieren, weiterlaufen.
 *
 * WAS BEIM NEUSTART WIRKLICH WEHTUT
 * Nicht die Ausfallzeit. Ein Knoten, der zwei Sekunden weg ist, fällt
 * niemandem auf — die Clients fragen mehrere Provider. Wehtut ein Neustart
 * **mitten in einem Job**: Der Kunde hat bezahlt oder wartet, und bekommt
 * nichts. Einmal reicht, damit er einen anderen Provider nimmt.
 *
 * Deshalb wird nicht abgeschaltet, sondern **entleert**:
 *   1. Keine neuen Jobs mehr annehmen und das dem Netz mitteilen.
 *   2. Laufende Jobs zu Ende bringen.
 *   3. Erst dann beenden.
 *
 * WARUM DAS AUF DIESER HARDWARE ÜBERHAUPT GEHT
 * Der teure Teil ist nicht der Knotenprozess, sondern das Modell im
 * Grafikspeicher — Minuten beim Laden. Läuft Ollama als eigener Dienst, bleibt
 * es beim Knoten-Neustart geladen, und der Neustart kostet Sekunden statt
 * Minuten. Genau deshalb trennt das Container-Paket die beiden.
 *
 * WAS BEWUSST NICHT GEBAUT IST
 * Kein Blue-Green, kein Socket-Handoff, kein Prozess der sich selbst ersetzt.
 * Das wäre für zwei Sekunden Ausfall viel Maschinerie — und jede davon kann
 * auf eine Art kaputtgehen, die man erst im Betrieb bemerkt.
 */
import { NostrEvent } from "@freedomstack/protocol";

export type DrainPhase = "laeuft" | "entleert" | "bereit" | "beendet";

export interface DrainState {
  phase: DrainPhase;
  /** Jobs, die noch laufen. */
  inFlight: number;
  /** Sekunden seit Beginn des Entleerens. */
  drainingFor: number;
  message: string;
}

export interface DrainOptions {
  /**
   * Nach wie vielen Sekunden auch mit laufenden Jobs beendet wird.
   *
   * Ohne Obergrenze hängt ein Knoten an einem Job, der nie fertig wird — und
   * ein Update, das nie durchkommt, ist schlimmer als eines mit Ausfall.
   */
  maxDrainSeconds?: number;
  onPhase?: (s: DrainState) => void;
}

/**
 * Verwaltet das Entleeren.
 *
 * Bewusst ohne Timer im Inneren: Der Aufrufer bestimmt, wann geprüft wird.
 * Ein Modul, das selbst tickt, lässt sich nicht ohne Wartezeit testen — und
 * was sich nicht testen lässt, ist im Betrieb blind.
 */
export class DrainController {
  private phase: DrainPhase = "laeuft";
  private jobs = new Set<string>();
  private drainStart = 0;
  private readonly maxDrain: number;

  constructor(private opts: DrainOptions = {}) {
    this.maxDrain = opts.maxDrainSeconds ?? 300;
  }

  /** Darf ein neuer Job angenommen werden? */
  get accepting(): boolean {
    return this.phase === "laeuft";
  }

  jobStarted(id: string): void {
    // Auch beim Entleeren mitzählen: Ein Job, der die Annahme knapp vor der
    // Umschaltung passiert hat, muss trotzdem zu Ende gebracht werden.
    this.jobs.add(id);
  }

  jobFinished(id: string, nowSecs = Math.floor(Date.now() / 1000)): void {
    this.jobs.delete(id);
    if (this.phase === "entleert" && this.jobs.size === 0) this.setPhase("bereit", nowSecs);
  }

  /** Entleeren beginnen. Gibt zurück, ob sofort beendet werden kann. */
  beginDrain(nowSecs = Math.floor(Date.now() / 1000)): boolean {
    // Mehrfaches Auslösen ist normal: Ein ungeduldiger Betreiber drückt
    // zweimal Strg-C. Das darf die Frist nicht zurücksetzen.
    const jetzt: DrainPhase = this.phase;
    if (jetzt !== "laeuft") return jetzt === "bereit";
    this.drainStart = nowSecs;
    this.setPhase(this.jobs.size === 0 ? "bereit" : "entleert", nowSecs);
    return (this.phase as DrainPhase) === "bereit";
  }

  /** Regelmäßig aufrufen. Gibt zurück, ob beendet werden darf. */
  check(nowSecs = Math.floor(Date.now() / 1000)): DrainState {
    if (this.phase === "entleert") {
      if (this.jobs.size === 0) this.setPhase("bereit", nowSecs);
      else if (nowSecs - this.drainStart >= this.maxDrain) {
        // Aufgeben, aber sagen warum: Ein stilles Abschneiden sähe aus wie
        // ein Absturz.
        this.setPhase("bereit", nowSecs);
      }
    }
    return this.state(nowSecs);
  }

  state(nowSecs = Math.floor(Date.now() / 1000)): DrainState {
    const drainingFor = this.phase === "laeuft" ? 0 : nowSecs - this.drainStart;
    let message: string;
    switch (this.phase) {
      case "laeuft":
        message = `Nimmt Jobs an. ${this.jobs.size} laufen.`;
        break;
      case "entleert":
        message =
          `Keine neuen Jobs mehr. ${this.jobs.size} laufen noch, seit ${drainingFor}s. ` +
          `Abbruch spätestens nach ${this.maxDrain}s.`;
        break;
      case "bereit":
        message = this.jobs.size === 0
          ? "Alle Jobs fertig. Neustart kann erfolgen."
          : `${this.jobs.size} Job(s) nach ${this.maxDrain}s abgebrochen — Neustart erfolgt trotzdem.`;
        break;
      default:
        message = "Beendet.";
    }
    return { phase: this.phase, inFlight: this.jobs.size, drainingFor, message };
  }

  markStopped(): void {
    this.phase = "beendet";
  }

  private setPhase(p: DrainPhase, nowSecs: number): void {
    if (this.phase === p) return;
    this.phase = p;
    this.opts.onPhase?.(this.state(nowSecs));
  }
}

// ------------------------------------------------------------- Updates

export interface VersionInfo {
  version: string;
  /** Prüfsumme des Artefakts. */
  sha256: string;
  /** Bezugsquellen. */
  sources: string[];
  releasedAt: number;
}

export interface UpdateDecision {
  shouldUpdate: boolean;
  reason: string;
  target?: VersionInfo;
}

/** Vergleicht Versionen nach semantischer Ordnung, nicht als Text. */
export function compareVersions(a: string, b: string): number {
  const teil = (v: string): number[] =>
    v.replace(/^v/, "").split(/[.-]/).map((x) => (Number.isFinite(Number(x)) ? Number(x) : -1));
  const pa = teil(a);
  const pb = teil(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export interface UpdatePolicy {
  /** Aktuell laufende Version. */
  current: string;
  /** Signierschlüssel, denen vertraut wird. */
  trustedSigners: string[];
  /**
   * Mindestalter eines Releases in Stunden, bevor es übernommen wird.
   *
   * Der wichtigste Wert hier. Wer sofort aktualisiert, ist der Erste, den ein
   * fehlerhaftes Release trifft — und bei einem kompromittierten
   * Signierschlüssel der Erste, den es erwischt. Ein Tag Abstand kostet
   * nichts und fängt beides ab.
   */
  minAgeHours?: number;
  /** Nur Patch-Versionen automatisch? */
  patchOnly?: boolean;
}

/**
 * Entscheidet, ob aktualisiert wird.
 *
 * Bewusst konservativ: Ein Provider-Knoten, der sich selbst kaputt
 * aktualisiert, verdient nichts mehr und merkt es womöglich tagelang nicht.
 */
export function decideUpdate(
  manifests: { version: string; sha256: string; sources: string[]; releasedAt: number; signerPubkey: string }[],
  policy: UpdatePolicy,
  nowSecs = Math.floor(Date.now() / 1000),
): UpdateDecision {
  const minAge = (policy.minAgeHours ?? 24) * 3600;

  const gueltig = manifests
    .filter((m) => policy.trustedSigners.includes(m.signerPubkey))
    .filter((m) => compareVersions(m.version, policy.current) > 0);

  if (gueltig.length === 0) {
    return { shouldUpdate: false, reason: `${policy.current} ist aktuell.` };
  }

  const reif = gueltig.filter((m) => nowSecs - m.releasedAt >= minAge);
  if (reif.length === 0) {
    const neuestes = gueltig.sort((a, b) => b.releasedAt - a.releasedAt)[0];
    const stunden = Math.ceil((minAge - (nowSecs - neuestes.releasedAt)) / 3600);
    return {
      shouldUpdate: false,
      reason:
        `${neuestes.version} ist da, aber erst ${Math.floor((nowSecs - neuestes.releasedAt) / 3600)}h alt. ` +
        `Übernahme in ${stunden}h — wer sofort aktualisiert, ist der Erste, den ein Fehler trifft.`,
    };
  }

  // Höchste reife Version nehmen, nicht die neueste: Eine später
  // veröffentlichte niedrigere Version wäre ein Rückschritt.
  const ziel = reif.sort((a, b) => compareVersions(b.version, a.version))[0];

  if (policy.patchOnly) {
    const [maj, min] = policy.current.replace(/^v/, "").split(".");
    const [zmaj, zmin] = ziel.version.replace(/^v/, "").split(".");
    if (maj !== zmaj || min !== zmin) {
      return {
        shouldUpdate: false,
        reason:
          `${ziel.version} ist kein Patch von ${policy.current}. ` +
          `Grössere Sprünge brauchen eine Entscheidung — sie können Konfiguration ändern.`,
      };
    }
  }

  return {
    shouldUpdate: true,
    reason: `${policy.current} → ${ziel.version}`,
    target: { version: ziel.version, sha256: ziel.sha256, sources: ziel.sources, releasedAt: ziel.releasedAt },
  };
}

export interface UpdateResult {
  ok: boolean;
  version?: string;
  message: string;
}

export interface UpdateHooks {
  /** Lädt das Artefakt und gibt dessen Prüfsumme zurück. */
  download: (source: string) => Promise<{ sha256: string; path: string }>;
  /** Tauscht die Dateien aus. */
  install: (path: string) => Promise<void>;
  /** Sichert den aktuellen Stand für den Rückweg. */
  backup: () => Promise<string>;
  restore: (backupPath: string) => Promise<void>;
}

/**
 * Führt ein Update aus — mit Rückweg.
 *
 * Die Prüfsumme wird gegen das signierte Manifest gehalten, BEVOR etwas
 * installiert wird. Eine Bezugsquelle kann kompromittiert sein; das Manifest
 * liegt auf den Relays und nicht beim Anbieter der Datei.
 */
export async function performUpdate(
  target: VersionInfo,
  hooks: UpdateHooks,
  log: (s: string) => void = () => {},
): Promise<UpdateResult> {
  const fehler: string[] = [];
  let heruntergeladen: string | null = null;

  for (const quelle of target.sources) {
    try {
      log(`lade ${target.version} von ${quelle}`);
      const d = await hooks.download(quelle);
      if (d.sha256.toLowerCase() !== target.sha256.toLowerCase()) {
        // Nicht installieren und die Quelle benennen: Eine falsche Prüfsumme
        // ist entweder ein Übertragungsfehler oder ein Angriff, und beides
        // gehört ins Log.
        fehler.push(`${quelle}: Prüfsumme weicht ab`);
        continue;
      }
      heruntergeladen = d.path;
      break;
    } catch (e) {
      fehler.push(`${quelle}: ${(e as Error).message}`);
    }
  }

  if (!heruntergeladen) {
    return {
      ok: false,
      message: `Kein brauchbares Artefakt für ${target.version}. ${fehler.join(" | ")}`,
    };
  }

  const sicherung = await hooks.backup();
  try {
    await hooks.install(heruntergeladen);
    return { ok: true, version: target.version, message: `Aktualisiert auf ${target.version}.` };
  } catch (e) {
    log(`Installation fehlgeschlagen, stelle zurück: ${(e as Error).message}`);
    try {
      await hooks.restore(sicherung);
      return { ok: false, message: `Update fehlgeschlagen, alter Stand wiederhergestellt: ${(e as Error).message}` };
    } catch (e2) {
      // Der schlimmste Fall, und er gehört klar benannt statt beschönigt.
      return {
        ok: false,
        message:
          `Update UND Rückweg fehlgeschlagen. Sicherung liegt unter ${sicherung}. ` +
          `Von Hand wiederherstellen: ${(e2 as Error).message}`,
      };
    }
  }
}

/**
 * Verfügbarkeits-Meldung fürs Netz.
 *
 * Ein Knoten, der neu startet, ohne es zu sagen, sieht für Clients aus wie
 * einer, der Jobs verschluckt. Eine Zeile vorher spart Reputation.
 */
export function buildAvailabilityTags(state: DrainState): string[][] {
  return [
    ["availability", state.phase === "laeuft" ? "online" : "draining"],
    ["in_flight", String(state.inFlight)],
  ];
}

export function readAvailability(ev: NostrEvent): "online" | "draining" | "unbekannt" {
  const v = ev.tags.find((t) => t[0] === "availability")?.[1];
  return v === "online" || v === "draining" ? v : "unbekannt";
}
