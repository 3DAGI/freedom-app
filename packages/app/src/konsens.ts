/**
 * Redundanz-Konsens in der App (Sammlung A-7), ohne DOM.
 *
 * Nur auf Wunsch und nur für eine Frage: Sie geht an mehrere Provider
 * (`KONSENS_PROVIDER` nach `recommendedRedundancy("important")`), je einzeln
 * versiegelt mit dem eigenen Sitzungsschlüssel für diesen Provider – kein Tag
 * verrät, dass andere dieselbe Frage bekommen. Jede Antwort wird wie sonst
 * angenommen und bezahlt (höchstens das Gebot je Provider), danach vergleicht
 * `evaluateConsensus()` lokal, ohne weiteren Dienst.
 *
 * Einig heißt stimmig, nicht richtig: Fahren alle dasselbe Modell, teilen sie
 * dessen Irrtümer. Was der Vergleich zeigt, ist Abweichung.
 */
import {
  type ConsensusAnswer,
  type ConsensusResult,
  type NostrEvent,
  evaluateConsensus,
  parseJobResult,
  recommendedRedundancy,
} from "@freedomstack/protocol";
import { t } from "./i18n.js";

/** So viele Provider bekommen die Frage – ungerade, damit es bei Uneinigkeit eine Mehrheit geben kann. */
export const KONSENS_PROVIDER = recommendedRedundancy("important");
/** Weniger als zwei ergeben keinen Vergleich – dann geht nichts hinaus. */
export const KONSENS_MIN = 2;
/** So lange wartet die App auf die übrigen Antworten. */
export const KONSENS_WARTEN_MS = 180_000;

type Ergebnis = ReturnType<typeof parseJobResult>;

/** Die ersten Provider der Rangfolge, jeder nur einmal. */
export function konsensZiele(kandidaten: readonly string[], n = KONSENS_PROVIDER): string[] {
  return [...new Set(kandidaten)].slice(0, n);
}

/** Sammelt die Antworten eines Vergleichs: je Anfrage genau eine, nur vom gefragten Provider. */
export class KonsensSammlung {
  private readonly ziele = new Map<string, string>();
  private readonly erledigt = new Set<string>();
  private readonly antworten: ConsensusAnswer[] = [];

  /** Anfrage merken – vor dem Senden. */
  erwarte(requestId: string, provider: string): void {
    this.ziele.set(requestId, provider);
  }

  /** Wie viele Provider gefragt wurden. */
  get gefragt(): number {
    return this.ziele.size;
  }

  /** Anfragen, auf die noch nichts kam. */
  offen(): Set<string> {
    return new Set([...this.ziele.keys()].filter((id) => !this.erledigt.has(id)));
  }

  fertig(): boolean {
    return this.offen().size === 0;
  }

  private passt(ev: NostrEvent): string | null {
    const id = ev.tags.find((x) => x[0] === "e")?.[1] ?? "";
    return this.ziele.get(id) === ev.pubkey && !this.erledigt.has(id) ? id : null;
  }

  /** Ergebnis annehmen – null, wenn es zu keiner offenen Anfrage gehört oder nicht vom Gefragten kommt. */
  nimm(ev: NostrEvent): Ergebnis | null {
    const id = this.passt(ev);
    if (!id) return null;
    this.erledigt.add(id);
    let r: Ergebnis;
    try {
      r = parseJobResult(ev);
    } catch {
      r = { requestId: id, customerPubkey: "", providerPubkey: ev.pubkey, output: ev.content, amountMsat: 0 } as Ergebnis;
    }
    this.antworten.push({ providerPubkey: ev.pubkey, output: r.output, amountMsat: r.amountMsat });
    return r;
  }

  /** Ablehnung (Rückmeldung mit Status „error“): Dieser Provider antwortet nicht mehr. */
  lehntAb(ev: NostrEvent): boolean {
    const id = this.passt(ev);
    if (!id || ev.tags.find((x) => x[0] === "status")?.[1] !== "error") return false;
    this.erledigt.add(id);
    return true;
  }

  auswerten(): ConsensusResult {
    return evaluateConsensus(this.antworten);
  }
}

/** Das Ergebnis als Satz – aus den Feldern, nicht aus der (deutschen) Erklärung des Protokolls. */
export function konsensText(e: ConsensusResult, gefragt: number): string {
  const n = e.agreeing.length + e.outliers.length;
  const satz =
    e.verdict === "unanimous" ? t("agent.konsensEinig", { n })
    : e.verdict === "majority" ? t("agent.konsensMehrheit", { einig: e.agreeing.length, n, wer: e.outliers.map((pk) => `${pk.slice(0, 12)}…`).join(", ") })
    : e.verdict === "split" ? t("agent.konsensUneinig", { n })
    : t("agent.konsensZuWenigeAntworten", { n, gefragt });
  return `${satz} ${t("agent.konsensHinweis")}`;
}
