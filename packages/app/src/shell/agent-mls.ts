/**
 * Agenten auf dem Gerät in privaten Räumen (11.3c3a, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P1, P2, P4): ein eigenes MLS-Konto je Agent –
 * nie das der Identität, sonst spräche er mit ihrer Stimme.
 *
 * - Zustand verschlüsselt in der IndexedDB `freedom-agenten-mls` (je Agent ein
 *   Eintrag, an den Agenten gebunden), Schlüssel wie beim eigenen Konto im Tresor;
 *   die Notfall-Löschung kennt die Datenbank.
 * - Einladen nur als Admin der Gruppe: Das KeyPackage erzeugt das Gerät selbst,
 *   die Einladung reicht `mlsLadeAgentEin()` direkt an das Konto des Agenten –
 *   beides geht nie über ein Relay.
 * - Danach nur innere Events der Gruppe: Raumstand, Karte (vom Agenten), Liste des
 *   Besitzers (alle seine Agenten in diesem Raum), Pflicht-Hinweis. Nie offen
 *   veröffentlicht (Leak-Regel `agent-raum-privat`).
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, fromHex, raumAgentKarte, raumAgentenListe, toHex } from "@freedomstack/protocol";
import { Mls } from "@freedomstack/mls";
import { type BudgetEinheit, type GeraeteAgent } from "../agenten-buch.js";
import { t } from "../i18n.js";
import { mlsEngine } from "../mls-engine.js";
import { type MlsNetz, sendeEventInGruppe } from "../mls-nostr.js";
import { MlsZustand, mlsSchluessel } from "../mls-speicher.js";
import { IndexedDbSpeicher, type GeheimSpeicher, type TresorSpeicher } from "../vault.js";
import { agentenBuch } from "./agenten.js";
import { type EinladungsErgebnis, mlsGesperrt, mlsLadeAgentEin, mlsSendeEvent } from "./mls-konto.js";
import { entferneAusRaum, sendePrivat, sendeRaumstand, type PrivaterRaum } from "./raum-mls.js";
import { alsGeraet, posteingangVon, state, veroeffentlicheAn } from "./state.js";
import { geheim } from "./tresor.js";

export const AGENTEN_MLS_DB = "freedom-agenten-mls";

/** Speicher und Netz – in der App die echten, in Tests austauschbar. */
export interface AgentMlsUmgebung {
  zustand: (agent: string) => TresorSpeicher;
  geheim: GeheimSpeicher;
  netz: MlsNetz;
}
const APP: AgentMlsUmgebung = {
  zustand: (agent) => new IndexedDbSpeicher(AGENTEN_MLS_DB, "zustand", agent),
  geheim,
  netz: { sendeAn: veroeffentlicheAn, posteingang: posteingangVon },
};

export interface AgentKonto { pk: string; mls: Mls; sichern: () => Promise<void>; netz: MlsNetz }
const konten = new Map<string, Promise<AgentKonto>>();

async function starte(a: GeraeteAgent, u: AgentMlsUmgebung): Promise<AgentKonto> {
  await mlsEngine();
  const zustand = new MlsZustand(u.zustand(a.pk), await mlsSchluessel(u.geheim), `agent:${a.pk}`);
  // Kontobeweis mit dem Schlüssel des Agenten – die Kopie wird danach genullt
  const beweis = (id: string): string => {
    const sk = fromHex(a.sk);
    try {
      return toHex(schnorr.sign(fromHex(id), sk));
    } finally {
      sk.fill(0);
    }
  };
  const mls = new Mls(agentenSigner(a), beweis, await zustand.laden());
  return { pk: a.pk, mls, sichern: () => zustand.sichern(mls.zustand()), netz: u.netz };
}

/** Mit diesem Schlüssel signiert der Agent – aus seinem Eintrag im Buch, nie die Identität. */
const agentenSigner = (a: GeraeteAgent): LocalSigner => new LocalSigner(fromHex(a.sk));

/** Das MLS-Konto eines Agenten dieses Geräts – beim ersten Aufruf geladen; null, wo MLS nicht geht. */
export function agentKonto(a: GeraeteAgent, u: AgentMlsUmgebung = APP): Promise<AgentKonto> | null {
  if (mlsGesperrt()) return null;
  let k = konten.get(a.pk);
  if (!k) {
    k = starte(a, u);
    konten.set(a.pk, k);
    k.catch(() => { if (konten.get(a.pk) === k) konten.delete(a.pk); });
  }
  return k;
}

const zufall = (): string => toHex(crypto.getRandomValues(new Uint8Array(32)));

/** Ersten Kanal des Raums – dort steht der Pflicht-Hinweis. */
const ersterKanal = (raum: PrivaterRaum): string | undefined =>
  [...(raum.zustand.space?.channels ?? [])].sort((a, b) => a.position - b.position)[0]?.id;

/** Meine Liste der Agenten in diesem Raum (F1 A) – nur als inneres Event. */
function listeImRaum(besitzer: string, gruppe: string) {
  return raumAgentenListe(besitzer, agentenBuch.alle().filter((x) => x.raeume.some((r) => r.raum === gruppe)).map((x) => x.pk));
}

/**
 * Einen Agenten dieses Geräts in einen privaten Raum holen (nur als Admin), mit
 * Budget je Monat und Tag (F3 B: ich zahle, auch wenn andere fragen).
 */
export async function ladeAgentInPrivatenRaum(
  agentPk: string, raum: PrivaterRaum, budget: { einheit: BudgetEinheit; monat: number; tag: number },
): Promise<EinladungsErgebnis | "ohne Raumstand"> { // kein UI-Text
  if (!state.keypair || alsGeraet()) throw new Error(t("agentRaum.nurHaupt"));
  const besitzer = state.keypair.pk;
  const agent = agentenBuch.agent(agentPk);
  if (!agent) throw new Error(t("agentRaum.unbekannt"));
  const kl = agentKonto(agent);
  if (!kl) throw new Error(mlsGesperrt() ?? t("agentRaum.unbekannt"));
  const k = await kl;
  // KeyPackage nur auf dem Gerät: erst den Zustand sichern (privater Teil), dann einladen
  const kp = await agentenSigner(agent).signEvent(await k.mls.keyPackage(zufall()));
  await k.sichern();
  const r = await mlsLadeAgentEin(raum.gruppe, kp, async (wrap) => {
    await k.mls.beitreten(wrap);
    await k.sichern();
    return true;
  });
  if (r !== "eingeladen") return r;
  if (!(await sendeRaumstand(raum))) return "ohne Raumstand"; // kein UI-Text
  await agentenBuch.setzeBudget(agentPk, raum.gruppe, budget);
  await sendeEventInGruppe({
    mls: k.mls, netz: k.netz, sichern: k.sichern, gruppe: raum.gruppe,
    ...raumAgentKarte({
      name: agent.name, betrieb: "geraet", bezahlung: "einlader", besitzer,
      ...(agent.about !== undefined ? { about: agent.about } : {}),
      ...(agent.modell !== undefined ? { modell: agent.modell } : {}),
    }),
  });
  await mlsSendeEvent(raum.gruppe, listeImRaum(besitzer, raum.gruppe));
  const kanal = ersterKanal(raum);
  if (kanal) await sendePrivat(raum.gruppe, kanal, t("agentRaum.hinweisGeraet", { name: agent.name }));
  void (await import("./agenten-lauschen.js")).starteGeraeteAgenten();
  return "eingeladen"; // kein UI-Text
}

/** Einen Agenten dieses Geräts aus einem privaten Raum nehmen: Commit (neuer Schlüssel), Budget weg, Liste neu. */
export async function entferneAgentAusPrivatemRaum(agentPk: string, raum: PrivaterRaum): Promise<boolean> {
  if (!state.keypair || alsGeraet()) throw new Error(t("agentRaum.nurHaupt"));
  if (!(await entferneAusRaum(raum, agentPk))) return false;
  await agentenBuch.entferneRaum(agentPk, raum.gruppe);
  await mlsSendeEvent(raum.gruppe, listeImRaum(state.keypair.pk, raum.gruppe));
  void (await import("./agenten-lauschen.js")).starteGeraeteAgenten();
  return true;
}
