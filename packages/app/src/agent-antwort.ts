/**
 * Erwähnungen beantworten – ohne Netz und ohne DOM (11.3c2a, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P3, P4, F3 B, F5).
 *
 * Die Regeln selbst (`entscheide()`, Prompt, Antwort-Event) stehen seit 11.3d1a
 * im Protokoll (`agent-raum.ts`) – der Agent auf dem Knoten entscheidet mit
 * denselben. Hier bleibt, was nur die App hat: der Umfang des Verlaufs aus
 * `VERLAUF_UMFANG` und die Sitzungsschlüssel je Agent und Raum (D1b2) – sonst
 * verbände der Provider die Räume. Antworten eines Agenten auf dem Gerät kommen
 * immer aus dem Budget seines Erstellers (F3 B).
 */
import { agentPromptMit, type RaumNachricht } from "@freedomstack/protocol";
import { KiSitzungen } from "./ki-sitzung.js";
import { VERLAUF_UMFANG, type VerlaufUmfang } from "./ki-kontext.js";

export { agentAntwortEvent, agentHinweisEvent, darfSchreibenIm, entscheide, istAgentIm, type Entscheid } from "@freedomstack/protocol";

/** Der Text für den Provider – Grenzen des Verlaufs aus der Wahl des Nutzers (`VERLAUF_UMFANG`). */
export function agentPrompt(p: {
  agent: string;
  persona: string;
  nachricht: RaumNachricht;
  alle: readonly RaumNachricht[];
  istAgent: (pk: string) => boolean;
  umfang: VerlaufUmfang;
}): string {
  const { umfang, ...rest } = p;
  return agentPromptMit({ ...rest, grenzen: VERLAUF_UMFANG[umfang] });
}

/** Sitzungsschlüssel je Agent und Raum (D1b2) – nur im Speicher der Seite. */
export class AgentSitzungen {
  readonly #je = new Map<string, KiSitzungen>();

  fuer(agent: string, raum: string): KiSitzungen {
    const k = `${agent}|${raum}`;
    let s = this.#je.get(k);
    if (!s) {
      s = new KiSitzungen();
      this.#je.set(k, s);
    }
    return s;
  }
}
