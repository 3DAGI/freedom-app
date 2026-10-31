/**
 * „Agent beauftragen“ auf der Repo-Seite (11.5d1, Entwurf `docs/REPO-AGENTEN-ENTWURF.md` V1, W2 A, W5 A).
 *
 * - Nur für Repos, die zu einem Raum gehören: offen bestätigt (`raumBestaetigt`), privat die Gruppe
 *   (`privatRaum`). Beauftragt wird ein Agent auf einem Knoten aus diesem Raum, der „wer fragt, zahlt“
 *   nennt (`repoAgenten()`) – jedes Mitglied mit Schreibrecht darf, es zahlt selbst (W2 A).
 * - Der Dialog fragt Agent, Aufgabe und Obergrenze; dann zeigt `beauftrageAmRepo()` den Preis, und erst
 *   nach der Bestätigung geht die Nachricht mit Erwähnung und Repo-Tag in den Raum – offen signiert an
 *   den Raum, privat nur als inneres Event der Gruppe (`mlsSendeEventId()`), nie offen.
 * - Gelesen wird nur, was der Raum selbst sagt: offen seine Struktur und die Karten seiner Agenten,
 *   privat der Verlauf der Gruppe.
 * - Seit 11.5d3 auch aus dem Raum selbst (Menü „Agent beauftragen“): ein Repo gleich, mehrere zur Wahl.
 */
import {
  KIND_RAUM_KANAL, KIND_ROLE_GRANT, KIND_SPACE, KIND_SPACE_ROLES, buildChannelMessage, gruppenRaum, leseRaumAdresse, raumAgentKarten,
  raumNachricht, raumZustandFuer, type SpaceState,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import type { RaumAgentKarte } from "../knoten-agent-wahl.js";
import { REPO_AUFGABE_MAX, REPO_GEBOT_SATS, auftragsKanal, leseAufgabe, leseObergrenze, repoAgenten, repoAuftragNachricht } from "../repo-agent.js";
import type { RepoKarte } from "../repo-ansicht.js";
import { dialog } from "./dialog.js";
import { beauftrageAmRepo } from "./knoten-agent-fragen.js";
import { mlsGruppenStand, mlsSendeEventId } from "./mls-konto.js";
import { ensurePool, signiere, state } from "./state.js";
import { agentKartenIm } from "./tabs/raeume.js";
import { toast } from "./ui.js";

/** Der Raum des Repos, wie der Auftrag ihn braucht. */
interface Ort {
  /** Adresse des offenen Raums oder die Gruppe – so steht er im Verweis des Auftrags. */
  raum: string;
  zustand: SpaceState;
  karten: RaumAgentKarte[];
  /** Wer im Raum schreibt – offen die Identität, privat das Konto der Gruppe. */
  ich: string;
  sende: (kanal: string, agent: string, n: { text: string; tags: string[][] }) => Promise<string | null>;
}

async function offenerRaum(adresse: string, ich: string): Promise<Ort | null> {
  const ort = leseRaumAdresse(adresse);
  if (!ort) return null;
  const pool = await ensurePool();
  const struktur = await pool.query({ kinds: [KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT, KIND_RAUM_KANAL], "#space": [ort.spaceId], limit: 500 }).catch(() => []);
  const zustand = raumZustandFuer(adresse, struktur);
  if (!zustand?.space) return null;
  return {
    raum: adresse, zustand, ich, karten: await agentKartenIm(zustand, pool),
    sende: async (kanal, agent, n) => {
      const ev = buildChannelMessage({ authorPubkey: ich, spaceId: ort.spaceId, channelId: kanal, content: n.text, mentions: [agent] });
      ev.tags.push(...n.tags);
      const signiert = await signiere(ev);
      await pool.publish(signiert);
      return signiert.id;
    },
  };
}

async function privaterRaum(gruppe: string): Promise<Ort | null> {
  const stand = await mlsGruppenStand(gruppe).catch(() => null);
  if (!stand) return null;
  const { zustand } = gruppenRaum(gruppe, stand.ereignisse, stand);
  if (!zustand.space) return null;
  return {
    raum: gruppe, zustand, ich: stand.ich, karten: raumAgentKarten(stand.ereignisse),
    sende: (kanal, agent, n) => {
      const s = raumNachricht({ kanal, text: n.text, erwaehnt: [agent] });
      return mlsSendeEventId(gruppe, { ...s, tags: [...s.tags, ...n.tags] });
    },
  };
}

export async function beauftrageAgentAmRepo(k: RepoKarte): Promise<void> {
  const repo = k.repo, ich = state.keypair?.pk;
  if (!repo || !ich) return;
  const ort = k.privatRaum ? await privaterRaum(k.privatRaum) : k.raumBestaetigt && repo.raum ? await offenerRaum(repo.raum, ich) : null;
  if (!ort) return toast(t("agentRepo.keinRaum"), true);
  const agenten = repoAgenten(ort.karten, ort.ich);
  if (!agenten.length) return toast(t("agentRepo.keinAgent"), true);
  const w = await dialog({
    titel: t("agentRepo.titel", { repo: k.name }),
    text: t("agentRepo.text"),
    felder: [
      { art: "wahl", name: "agent", label: t("agentRepo.agent"), optionen: agenten.map((a) => ({ wert: a.agent, text: a.name })), wert: agenten[0]!.agent, pflicht: true },
      { art: "textarea", name: "aufgabe", label: t("agentRepo.aufgabe"), pflicht: true },
      { art: "text", name: "obergrenze", label: t("agentRepo.obergrenze"), wert: String(REPO_GEBOT_SATS.vorgabe), pflicht: true, mono: true },
    ],
    ok: t("agentRepo.weiter"),
    pruefe: (v) => (leseAufgabe(v.aufgabe) === null ? t("agentRepo.aufgabeFalsch", { max: REPO_AUFGABE_MAX })
      : leseObergrenze(v.obergrenze) === null ? t("agentRepo.obergrenzeFalsch", { max: REPO_GEBOT_SATS.hoechstens }) : null),
  });
  if (!w) return;
  const agent = agenten.find((a) => a.agent === w.agent), aufgabe = leseAufgabe(w.aufgabe), gebotSats = leseObergrenze(w.obergrenze);
  if (!agent || !aufgabe || !gebotSats) return;
  const kanal = auftragsKanal(ort.zustand, ort.ich, agent.agent);
  if (!kanal) return toast(t("agentRepo.keinKanal", { name: agent.name }), true);
  const n = repoAuftragNachricht({ name: agent.name, aufgabe, repo: repo.adresse });
  await beauftrageAmRepo(ort.raum, agent, { gebotSats, repo: k.name, sende: () => ort.sende(kanal, agent.agent, n).catch(() => null) });
}

/** „Agent beauftragen“ im Raum (11.5d3): bei einem Repo gleich, bei mehreren erst die Wahl – dann wie auf der Repo-Seite. */
export async function beauftrageAgentImRaum(repos: readonly RepoKarte[]): Promise<void> {
  const mit = repos.filter((k) => k.repo);
  if (mit.length <= 1) return mit[0] ? beauftrageAgentAmRepo(mit[0]) : undefined;
  const w = await dialog({
    titel: t("agentRepo.welchesRepo"),
    felder: [{ art: "wahl", name: "repo", label: t("agentRepo.repo"), optionen: mit.map((k) => ({ wert: k.schluessel, text: k.name })), wert: mit[0]!.schluessel, pflicht: true }],
    ok: t("raum.weiter"),
  });
  const k = w ? mit.find((x) => x.schluessel === w.repo) : undefined;
  if (k) await beauftrageAgentAmRepo(k);
}
