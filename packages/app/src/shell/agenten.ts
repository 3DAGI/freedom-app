/**
 * Agenten auf dem Gerät in offenen Räumen (11.3c1, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P1, P2, P4, P5): anlegen, einladen, entfernen.
 *
 * - Anlegen nur mit Tresor: Schlüssel und Persona liegen nur dort.
 * - Einladen nur, wer im Raum Rollen vergeben darf. Fehlt die Rolle `agent`,
 *   legt sie nur der Gründer an (`mitAgentRolle()` – nie mit mehr Rechten).
 * - Die Karte (38090) signiert der Agent selbst und nennt den Ersteller als
 *   Besitzer; das gilt nur mit dessen Liste (30000, F1 A). In der Liste stehen
 *   nur Agenten offener Räume – Agenten privater Räume nie (Leak-Regel
 *   `agent-raum-privat`). Agenten anderer Geräte bleiben darin.
 * - Pflicht-Hinweis im Raum: Der Agent läuft auf meinem Gerät, und ich bezahle
 *   seine Antworten – ohne Erwähnung, sonst löste der Hinweis ihn aus.
 *
 * Die Oberfläche dafür baut Spur C (11.3e); Erwähnungen beantwortet 11.3c2.
 */
import {
  AGENT_RECHTE, AGENT_ROLLE, AGENTEN_LISTE_D, KIND_AGENTEN_LISTE, KIND_RAUM_KANAL, KIND_ROLE_GRANT, KIND_SPACE, KIND_SPACE_ROLES,
  baueAgentKarte, baueAgentenListe, buildChannelMessage, buildRoleGrant, buildRoles, can, canWriteTo, leseRaumAdresse,
  mitAgentRolle, raumZustandFuer, type NostrEvent, type SpaceState,
} from "@freedomstack/protocol";
import { AgentenBuch, type AgentDaten, type BudgetEinheit, type GeraeteAgent } from "../agenten-buch.js";
import { t } from "../i18n.js";
import { alsGeraet, ensurePool, frageBeiAutoren, signiere, state } from "./state.js";
import { geheim, verlangeTresor } from "./tresor.js";

/** Die Agenten dieses Geräts – nur im Tresor. */
export const agentenBuch = new AgentenBuch(geheim);

/** Agenten gehören der Person, nie einem Gerät (8.6c): Karte und Liste nennten sonst das Gerät als Besitzer. */
function ich(): string {
  if (!state.keypair || alsGeraet()) throw new Error(t("agentRaum.nurHaupt"));
  return state.keypair.pk;
}

/** Einen Agenten anlegen – erst der Tresor, dann der Schlüssel. null: kein Tresor. */
export async function legeGeraeteAgentAn(d: AgentDaten): Promise<GeraeteAgent | null> {
  ich();
  if (!(await verlangeTresor(t("agentRaum.wofuer")))) return null;
  return agentenBuch.legeAn(d);
}

/** Stand eines offenen Raums – nur die Definition des Gründers aus der Adresse zählt (B-7). */
async function raumStand(adresse: string): Promise<{ kennung: string; stand: SpaceState }> {
  const ort = leseRaumAdresse(adresse);
  if (!ort) throw new Error(t("agentRaum.raumFehlt"));
  const struktur = await (await ensurePool()).query({ kinds: [KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT, KIND_RAUM_KANAL], "#space": [ort.spaceId], limit: 500 });
  const stand = raumZustandFuer(adresse, struktur);
  if (!stand?.space) throw new Error(t("agentRaum.raumFehlt"));
  return { kennung: ort.spaceId, stand };
}

/**
 * Meine Liste (30000, F1 A) neu: Agenten anderer Geräte bleiben, von diesem
 * Gerät nur die in offenen Räumen.
 */
async function aktualisiereListe(besitzer: string): Promise<void> {
  const bisher = await frageBeiAutoren({ kinds: [KIND_AGENTEN_LISTE], authors: [besitzer], "#d": [AGENTEN_LISTE_D], limit: 5 });
  const neueste = bisher.filter((e) => e.pubkey === besitzer).sort((a, b) => b.created_at - a.created_at)[0];
  const fremde = (neueste?.tags ?? []).filter((x) => x[0] === "p" && /^[0-9a-f]{64}$/.test(x[1] ?? "") && !agentenBuch.agent(x[1]!)).map((x) => x[1]!);
  await (await ensurePool()).publish(await signiere(baueAgentenListe(besitzer, [...fremde, ...agentenBuch.inOffenenRaeumen()])));
}

/** Kanal für den Hinweis: der erste, in den ich schreiben darf. */
function hinweisKanal(stand: SpaceState, pk: string): string | undefined {
  return [...(stand.space?.channels ?? [])].sort((a, b) => a.position - b.position).find((k) => canWriteTo(pk, k, stand))?.id;
}

/**
 * Einen Agenten dieses Geräts in einen offenen Raum holen, mit Budget je Monat
 * und Tag (F3 B: ich zahle, auch wenn andere fragen – B-22: dort schreibt jeder).
 */
export async function ladeAgentInOffenenRaum(
  agentPk: string, adresse: string, budget: { einheit: BudgetEinheit; monat: number; tag: number },
): Promise<void> {
  const besitzer = ich();
  const agent = agentenBuch.agent(agentPk);
  const signer = agentenBuch.signer(agentPk);
  if (!agent || !signer) throw new Error(t("agentRaum.unbekannt"));
  const { kennung, stand } = await raumStand(adresse);
  if (!can(besitzer, "rollen_vergeben", stand)) throw new Error(t("agentRaum.keinRecht"));
  const pool = await ensurePool();
  const veroeffentliche = async (ev: Promise<NostrEvent>): Promise<void> => void (await pool.publish(await ev));
  // Erst die Rolle (nur der Gründer; fehlt sie oder trägt sie mehr als die Grundrechte), dann Budget, Zuweisung, Karte und Liste
  const rolle = stand.roles.get(AGENT_ROLLE);
  if (!rolle || rolle.permissions.some((p) => !AGENT_RECHTE.includes(p))) {
    if (stand.ownerPubkey !== besitzer) throw new Error(t("agentRaum.rolleFehlt"));
    await veroeffentliche(signiere(buildRoles(kennung, besitzer, mitAgentRolle([...stand.roles.values()]))));
  }
  await agentenBuch.setzeBudget(agentPk, adresse, budget);
  await veroeffentliche(signiere(buildRoleGrant(kennung, besitzer, agentPk, [AGENT_ROLLE])));
  await veroeffentliche(signer.signEvent(baueAgentKarte(agentPk, {
    name: agent.name, betrieb: "geraet", bezahlung: "einlader", besitzer,
    ...(agent.about !== undefined ? { about: agent.about } : {}),
    ...(agent.modell !== undefined ? { modell: agent.modell } : {}),
  })));
  await aktualisiereListe(besitzer);
  const kanal = hinweisKanal(stand, besitzer);
  if (kanal) {
    await veroeffentliche(signiere(buildChannelMessage({
      authorPubkey: besitzer, spaceId: kennung, channelId: kanal, mentions: [],
      content: t("agentRaum.hinweisGeraet", { name: agent.name }),
    })));
  }
  // Ab jetzt beantwortet er Erwähnungen (11.3c2) – dynamisch, sonst hingen die Module im Kreis
  void (await import("./agenten-lauschen.js")).starteGeraeteAgenten();
}

/** Einen Agenten dieses Geräts aus einem offenen Raum nehmen: Rolle entziehen, Budget weg, Liste neu. */
export async function entferneAgentAusOffenemRaum(agentPk: string, adresse: string): Promise<void> {
  const besitzer = ich();
  const { kennung, stand } = await raumStand(adresse);
  if (can(besitzer, "rollen_vergeben", stand)) {
    await (await ensurePool()).publish(await signiere(buildRoleGrant(kennung, besitzer, agentPk, [])));
  }
  await agentenBuch.entferneRaum(agentPk, adresse);
  await aktualisiereListe(besitzer);
  void (await import("./agenten-lauschen.js")).starteGeraeteAgenten();
}
