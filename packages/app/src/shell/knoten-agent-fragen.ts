/**
 * Fragen an Agenten auf dem Knoten (11.3d1b2, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P4, „wer fragt, zahlt“; Knoten seit 11.3d1a).
 *
 * - Nach dem Senden in einem Raum (offen seit 11.3d1b2, privat seit 11.3d2c mit der
 *   Gruppe und der Id des inneren Events im Verweis): je erwähntem Agenten, dessen Karte
 *   „wer fragt, zahlt“ und seinen Knoten nennt (`zuBezahlen()`), erst den Preis
 *   zeigen – ohne Bestätigung geht nichts hinaus. Die Nachricht selbst steht
 *   schon im Raum; sie ist öffentlich, gleich wie man sich entscheidet.
 * - Der Auftrag geht versiegelt an den Knoten (`bezahlterAuftrag()`), von einem
 *   frischen Sitzungsschlüssel je Frage. Im Kern nur der Verweis
 *   (`auftragsVerweisTags()`: Adresse des Raums, Id der Erwähnung) und eine
 *   feste Eingabe – der Knoten rechnet mit dem Raum, nie mit der Eingabe.
 * - Bezahlt wie jede KI-Anfrage: höchstens das Gebot, Lightning nach A+ oder
 *   eine Gutschrift im Zahlkanal; geht weder das eine noch das andere, wird
 *   nicht gefragt.
 * - Die Antwort steht im Raum (vom Agenten). Hier nur Rückmeldungen über ihre
 *   Kennung (`ablehnungsText()`). Kein zweiter Versuch von selbst: Im Zahlkanal
 *   hielte die offene erste Gutschrift die zweite um ein Gebot höher.
 * - Repo-Aufträge (11.5d1, `beauftrageAmRepo()`): dieselbe Frage mit der Obergrenze des
 *   Fragenden (W5 A); die Nachricht mit dem Repo-Tag geht erst nach der Bestätigung
 *   hinaus (`RepoWunsch.sende()`), gewartet wird so lange, wie der Lauf beim Knoten darf.
 */
import { KIND_AGENT_KARTE, aktuelleAgentKarten, auftragsVerweisTags, type AgentKarte } from "@freedomstack/protocol";
import { hoechstMsat } from "../anteile-kasse.js";
import { t } from "../i18n.js";
import { KiSitzungen } from "../ki-sitzung.js";
import { kiSchiene } from "../ki-schiene.js";
import { kiZahlweg } from "../ki-zahlweg.js";
import { type RaumAgentKarte, type ZuBezahlen, ablehnungsText, zuBezahlen } from "../knoten-agent-wahl.js";
import { ausMsat } from "../preis-anzeige.js";
import { fehlerText } from "../protokoll-texte.js";
import { REPO_WARTEN_MS } from "../repo-agent.js";
import { AGENT_GEBOT_SATS } from "./agenten-lauschen.js";
import { bezahlterAuftrag } from "./bezahlter-auftrag.js";
import { bestaetige } from "./dialog.js";
import { kanalDa, providerZahlung } from "./ki-zahlung.js";
import { type PrivaterRaum, sendePrivat } from "./raum-mls.js";
import { ensurePool, providerMitStand, state } from "./state.js";
import { privatFaehig } from "./tabs/agent.js";
import { toast } from "./ui.js";

/** Eingabe des Auftrags – der Knoten liest sie nicht (11.3d1a), sie muss nur da sein. */
const EINGABE = "agent-raum";

/** Nach dem Senden einer Nachricht: `raum` ist die Adresse des offenen Raums oder die Gruppe, `erwaehnung` die Id der Nachricht. */
export async function frageKnotenAgenten(p: { raum: string; erwaehnung: string; erwaehnt: string[]; karten: RaumAgentKarte[] }): Promise<void> {
  const ich = state.keypair?.pk;
  if (!ich) return;
  // Einer nach dem anderen – jeder mit eigenem Preis und eigener Bestätigung
  for (const k of zuBezahlen(p.erwaehnt, p.karten, ich)) {
    await frageEinen(p.raum, p.erwaehnung, k).catch((e) => toast(fehlerText(e), true));
  }
}

/** Ein Repo-Auftrag (11.5d1): Obergrenze, Name des Repos und das Senden der Nachricht – erst nach der Bestätigung. */
export interface RepoWunsch {
  gebotSats: number;
  repo: string;
  /** Die Raum-Nachricht mit Erwähnung und Repo-Tag senden – ihre Id (privat die des inneren Events) oder `null`. */
  sende: () => Promise<string | null>;
}

/** Einen Agenten am Repo beauftragen (11.5d1) – `raum` wie bei Fragen: Adresse des offenen Raums oder die Gruppe. */
export async function beauftrageAmRepo(raum: string, k: ZuBezahlen, repo: RepoWunsch): Promise<void> {
  await frageEinen(raum, undefined, k, repo).catch((e) => toast(fehlerText(e), true));
}

async function frageEinen(raum: string, gesendet: string | undefined, k: ZuBezahlen, repo?: RepoWunsch): Promise<void> {
  // Nur ein Knoten mit Angebot, der versiegelte Anfragen nimmt
  const angebot = privatFaehig((await providerMitStand()).filter((c) => c.caps.pubkey === k.provider))[0]?.caps;
  if (!angebot) return toast(t("agentKnoten.ohneAngebot", { name: k.name }), true);
  // Schiene für KI (12.4b): der Schalter beim Gebot, sonst die Standard-Schiene
  const weg = kiZahlweg(kiSchiene(), kanalDa(k.provider));
  if (weg === "kanal-noetig") return toast(t("zahl.kanalNoetig"), true);
  if (weg === "lightning") {
    const { grund } = await providerZahlung(k.provider);
    if (grund) return toast(grund, true);
  }
  const hoechst = hoechstMsat(repo?.gebotSats ?? AGENT_GEBOT_SATS, []);
  const preis = repo ? (weg === "kanal" ? "agentRepo.preisKanal" : "agentRepo.preis") : (weg === "kanal" ? "agentKnoten.preisKanal" : "agentKnoten.preis");
  const ok = await bestaetige({
    titel: t(repo ? "agentRepo.preisTitel" : "agentKnoten.titel", { name: k.name, repo: repo?.repo ?? "" }),
    text: t(preis, {
      name: k.name, hoechst: ausMsat(hoechst, angebot.kurs), rate: ausMsat(angebot.textRatePerKTokenMsat, angebot.kurs), repo: repo?.repo ?? "",
    }),
    ok: t(repo ? "agentRepo.beauftragen" : "agentKnoten.fragen"),
  });
  if (!ok) return;
  // Repo-Auftrag: die Nachricht erst jetzt – ohne sie gibt es nichts zu bezahlen
  const erwaehnung = gesendet ?? (await repo?.sende());
  if (!erwaehnung) return toast(t("agentRepo.nichtGesendet"), true);
  if (repo) toast(t("agentRepo.laeuft", { name: k.name }));

  // Frischer Sitzungsschlüssel je Frage – der Knoten kann zwei Fragen nicht über ihn verbinden
  const r = await bezahlterAuftrag({
    provider: k.provider, sitzungen: new KiSitzungen(), input: EINGABE, hoechstMsat: hoechst, kanal: weg === "kanal",
    extraTags: auftragsVerweisTags({ raum, erwaehnung }), ...(repo ? { wartenMs: REPO_WARTEN_MS } : {}),
  });
  if (r?.art === "antwort") toast(t(repo ? "agentRepo.fertig" : "agentKnoten.beantwortet", { name: k.name }));
  else if (r?.art === "abgelehnt") toast(t(ablehnungsText(r.fall), { name: k.name, fall: r.fall ?? "–" }), true);
  else toast(t("agentKnoten.keineAntwort", { name: k.name }), true);
}

// ------------------------------------------------------------ Einladen in private Räume (11.3d2c)

/** Die Karte, wenn dieser Schlüssel ein Agent auf einem Knoten ist (38090, vom Agenten signiert) – sonst null. */
export async function knotenAgentKarte(pk: string): Promise<AgentKarte | null> {
  const evs = await (await ensurePool()).query({ kinds: [KIND_AGENT_KARTE], authors: [pk], limit: 5 }).catch(() => []);
  return aktuelleAgentKarten(evs).find((k) => k.agent === pk && k.betrieb === "knoten") ?? null;
}

/** Pflicht-Hinweis (Entwurf P2) nach dem Einladen: im ersten Kanal, dass der Knoten alles im Raum mitliest. */
export async function meldeKnotenAgentImRaum(raum: PrivaterRaum, name: string): Promise<boolean> {
  const kanal = [...(raum.zustand.space?.channels ?? [])].sort((a, b) => a.position - b.position)[0]?.id;
  return !!kanal && !!(await sendePrivat(raum.gruppe, kanal, t("agentKnoten.hinweisRaum", { name })).catch(() => null));
}
