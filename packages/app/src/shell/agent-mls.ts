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
import {
  KIND_SPACE, LocalSigner, fromHex, gruppenRaum, raumAgentKarte, raumAgentKarten, raumAgentenListe, toHex,
  type GruppenRaum, type InneresEvent, type InneresSenden, type NostrEvent, type RelayFilter,
} from "@freedomstack/protocol";
import { ART_CHAT, Mls } from "@freedomstack/mls";
import { type BudgetEinheit, type GeraeteAgent } from "../agenten-buch.js";
import { t } from "../i18n.js";
import { mlsEngine } from "../mls-engine.js";
import { type MlsNetz, empfangeGruppe, gruppenAbos, schreiteFort, sendeEventInGruppe } from "../mls-nostr.js";
import { MlsVerlauf, MlsZustand, mlsSchluessel, type VerlaufEintrag } from "../mls-speicher.js";
import { IndexedDbSpeicher, type GeheimSpeicher, type TresorSpeicher } from "../vault.js";
import { agentenBuch } from "./agenten.js";
import { type EinladungsErgebnis, alsEintrag, mlsGesperrt, mlsLadeAgentEin, mlsSendeEvent } from "./mls-konto.js";
import { entferneAusRaum, sendePrivat, sendeRaumstand, type PrivaterRaum } from "./raum-mls.js";
import { alsGeraet, ensurePool, frageAn, posteingangVon, state, veroeffentlicheAn } from "./state.js";
import { geheim } from "./tresor.js";

export const AGENTEN_MLS_DB = "freedom-agenten-mls";

/** Speicher und Netz – in der App die echten, in Tests austauschbar. `zustand` je Eintrag (Zustand, Verlauf). */
export interface AgentMlsUmgebung {
  zustand: (eintrag: string) => TresorSpeicher;
  geheim: GeheimSpeicher;
  netz: MlsNetz;
  /** Mit `urls`: genau dort fragen (Relays der Gruppe). */
  frage: (filter: RelayFilter, urls?: readonly string[]) => Promise<NostrEvent[]>;
}
const APP: AgentMlsUmgebung = {
  zustand: (eintrag) => new IndexedDbSpeicher(AGENTEN_MLS_DB, "zustand", eintrag),
  geheim,
  netz: { sendeAn: veroeffentlicheAn, posteingang: posteingangVon },
  frage: async (f, urls) => (urls ? frageAn(f, urls) : (await ensurePool()).query(f)),
};

export interface AgentKonto {
  pk: string; mls: Mls; sichern: () => Promise<void>; netz: MlsNetz;
  /** Was der Agent in seinen Gruppen las – verschlüsselt wie der Zustand, Grundlage für Raumstand und Kontext. */
  verlauf: MlsVerlauf;
  frage: AgentMlsUmgebung["frage"];
}
const konten = new Map<string, Promise<AgentKonto>>();

async function starte(a: GeraeteAgent, u: AgentMlsUmgebung): Promise<AgentKonto> {
  await mlsEngine();
  const schluessel = await mlsSchluessel(u.geheim);
  const zustand = new MlsZustand(u.zustand(a.pk), schluessel, `agent:${a.pk}`);
  const verlauf = new MlsVerlauf(new MlsZustand(u.zustand(`verlauf:${a.pk}`), schluessel, `agent:${a.pk}:verlauf`));
  await verlauf.laden();
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
  return { pk: a.pk, mls, sichern: () => zustand.sichern(mls.zustand()), netz: u.netz, verlauf, frage: u.frage };
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
  await agentSendet(k, raum.gruppe, raumAgentKarte({
      name: agent.name, betrieb: "geraet", bezahlung: "einlader", besitzer,
      ...(agent.about !== undefined ? { about: agent.about } : {}),
      ...(agent.modell !== undefined ? { modell: agent.modell } : {}),
  }));
  await mlsSendeEvent(raum.gruppe, listeImRaum(besitzer, raum.gruppe));
  const kanal = ersterKanal(raum);
  if (kanal) await sendePrivat(raum.gruppe, kanal, t("agentRaum.hinweisGeraet", { name: agent.name }));
  void (await import("./agenten-lauschen.js")).starteGeraeteAgenten({ privat: true });
  return "eingeladen"; // kein UI-Text
}

/** Einen Agenten dieses Geräts aus einem privaten Raum nehmen: Commit (neuer Schlüssel), Budget weg, Liste neu. */
export async function entferneAgentAusPrivatemRaum(agentPk: string, raum: PrivaterRaum): Promise<boolean> {
  if (!state.keypair || alsGeraet()) throw new Error(t("agentRaum.nurHaupt"));
  if (!(await entferneAusRaum(raum, agentPk))) return false;
  await agentenBuch.entferneRaum(agentPk, raum.gruppe);
  await mlsSendeEvent(raum.gruppe, listeImRaum(state.keypair.pk, raum.gruppe));
  void (await import("./agenten-lauschen.js")).starteGeraeteAgenten({ privat: true });
  return true;
}

// ------------------------------------------------------------ Lesen und Schreiben (11.3c3b)

/**
 * Nachrichten einer Gruppe holen und in den Verlauf des Agenten legen – vor dem
 * Zustand, denn eine MLS-Nachricht lässt sich nur einmal entschlüsseln. Alle,
 * auch Commits, in ihrer Reihenfolge: Wer einen auslässt, liest danach nichts
 * mehr. Zurück: die neu aufgenommenen Einträge.
 */
export async function agentAbgleichen(k: AgentKonto, gruppe: string): Promise<VerlaufEintrag[]> {
  const abo = gruppenAbos(k.mls).find((x) => x.gruppe === gruppe);
  if (!abo) return [];
  const evs = (await k.frage({ ...abo.filter, limit: 200 }, abo.relays)).sort((a, b) => a.created_at - b.created_at);
  const neu: VerlaufEintrag[] = [];
  const merken = async (n: Parameters<typeof alsEintrag>[0][]): Promise<void> => {
    const bekannt = new Set(k.verlauf.nachrichten(gruppe).map((e) => e.id));
    const eintraege = n.map(alsEintrag);
    k.verlauf.nimmAuf(gruppe, eintraege);
    neu.push(...eintraege.filter((e) => !bekannt.has(e.id)));
    await k.verlauf.sichern();
  };
  let geaendert = false;
  let warten: number | undefined;
  for (const ev of evs) {
    const r = await empfangeGruppe({ mls: k.mls, sichern: async () => { geaendert = true; }, ev, merken }).catch(() => null);
    warten = r?.wartezeit?.[gruppe] ?? warten;
  }
  if (geaendert) await k.sichern();
  // Nach einem Commit zurückgehaltene Nachrichten: später in den Verlauf (beantwortet werden sie nicht)
  if (warten !== undefined) setTimeout(() => void schreiteFort({ mls: k.mls, netz: k.netz, sichern: k.sichern, gruppe, merken }).catch(() => undefined), warten + 50);
  return neu;
}

/** Der Raum, wie der Agent ihn kennt – aus seinem Verlauf, mit den Agenten der Gruppe (ihre Karten). */
export function agentRaum(k: AgentKonto, gruppe: string): GruppenRaum & { ereignisse: InneresEvent[]; agenten: Set<string>; definition: string[][] } {
  const admins = k.mls.admins(gruppe);
  const ereignisse = k.verlauf.nachrichten(gruppe).map((e): InneresEvent => ({
    id: e.inneres ?? e.id, von: e.von, art: e.art ?? ART_CHAT, tags: e.tags ?? [], text: e.text, zeit: e.zeit, ...(e.admin !== undefined ? { admin: e.admin } : {}),
  }));
  // Schalter der Agentenketten: in der Definition eines Admins (F5)
  const definition = ereignisse.filter((e) => e.art === KIND_SPACE && (e.admin ?? admins.includes(e.von))).sort((a, b) => b.zeit - a.zeit)[0]?.tags ?? [];
  return {
    ...gruppenRaum(gruppe, ereignisse, { admins, mitglieder: k.mls.mitglieder(gruppe) }),
    ereignisse, agenten: new Set(raumAgentKarten(ereignisse).map((x) => x.agent)), definition,
  };
}

/** Als Agent in die Gruppe schreiben – eigene Nachrichten entschlüsselt MLS nicht zurück, darum gleich in den Verlauf. */
export async function agentSendet(k: AgentKonto, gruppe: string, s: InneresSenden): Promise<boolean> {
  const inneres = await sendeEventInGruppe({ mls: k.mls, netz: k.netz, sichern: k.sichern, gruppe, ...s }).catch(() => null);
  if (!inneres) return false;
  k.verlauf.nimmAuf(gruppe, [{ id: `eigen:${inneres}`, inneres, von: k.pk, text: s.text, zeit: Math.floor(Date.now() / 1000), ...(s.art !== ART_CHAT ? { art: s.art } : {}), ...(s.tags.length > 0 ? { tags: s.tags } : {}) }]);
  await k.verlauf.sichern();
  return true;
}

