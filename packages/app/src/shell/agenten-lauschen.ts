/**
 * Agenten auf dem Gerät antworten in offenen Räumen (11.3c2b, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P3–P5, F3 B).
 *
 * - Solange die App offen und der Tresor entsperrt ist: ein Abo auf Nachrichten
 *   (42), die Agenten dieses Geräts erwähnen – ab jetzt, nie rückwirkend.
 * - Je Agent eine Erwähnung nach der anderen; ob er antwortet, entscheidet
 *   `entscheide()` mit dem Stand des Raums (nur die Definition des Gründers).
 * - Bezahlt aus dem Budget des Erstellers für diesen Raum (F3 B), nie darüber:
 *   `reicht()` mit dem Gebot vorher, `buche()` mit dem Preis nachher – in der
 *   Einheit des Budgets: msat nur über Lightning, Lamports nur über einen
 *   Zahlkanal zum Provider. Erreicht: einmal je Zeitraum ein Hinweis im Raum.
 * - Der Auftrag geht wie jeder andere versiegelt vom Sitzungsschlüssel – je Agent
 *   und Raum eigene (D1b2) – mit A+ über `ki-zahlung.ts`; ohne Verweis auf den
 *   Raum, ohne Identität. Persönliche Angaben nur als Platzhalter (D1a).
 * - Die Antwort signiert der Agent; der Fragende ist erwähnt.
 * - Private Räume (seit 11.3c3b): je Agent und Gruppe ein Abo an die Relays der
 *   Gruppe über sein eigenes MLS-Konto. Erst holt er alles nach (auch Commits –
 *   sonst liest er danach nichts mehr), beantwortet aber nur, was nach dem Abo
 *   kam; Antwort und Hinweis als innere Events. Die Engine lädt dafür erst im
 *   Abruftakt, nie beim Start.
 */
import {
  ART_RAUM_CHAT, AuftragsBremse, KIND_CHANNEL_MESSAGE, KIND_GIFT_WRAP, KIND_RAUM_KANAL, KIND_ROLE_GRANT, KIND_SPACE, KIND_SPACE_ROLES,
  ausRaumEvent, buildJobRequest, buildPrivateJobRequest, definitionDesGruenders, leseRaumAdresse, parseJobResult, raumAgentAntwort, raumNachricht, raumZustandFuer,
  type NostrEvent, type RaumNachricht,
} from "@freedomstack/protocol";
import { AgentSitzungen, agentAntwortEvent, agentHinweisEvent, agentPrompt, entscheide, istAgentIm } from "../agent-antwort.js";
import { type GeraeteAgent, type RaumBudget } from "../agenten-buch.js";
import { gruppenAbos } from "../mls-nostr.js";
import { Nachziehen } from "../post-live.js";
import { agentAbgleichen, agentKonto, agentRaum, agentSendet } from "./agent-mls.js";
import { mlsGesperrt } from "./mls-konto.js";
import { hoechstMsat } from "../anteile-kasse.js";
import { t } from "../i18n.js";
import { type AntwortCache, oeffneAntworten } from "../ki-antworten.js";
import { LS_VERLAUF, leseUmfang } from "../ki-kontext.js";
import { kiZahlweg } from "../ki-zahlweg.js";
import { standardSchiene } from "../standard-schiene.js";
import { bedarfLamports } from "../zahlkanal.js";
import { agentenBuch } from "./agenten.js";
import { maskiereEinzeln } from "./ki-platzhalter.js";
import {
  deklaration, empfaengerFuer, kanalAntwort, kanalDa, kanalGutschrift, merkeAnfrage, providerZahlung, rechneAntwortAb, zahleAnteile,
} from "./ki-zahlung.js";
import { abonniereAn, alsGeraet, angebotVon, ensurePool, ensureSessionClient, findProviders, powJeProvider, state } from "./state.js";
import { privatFaehig } from "./tabs/agent.js";

/** Gebot je Antwort (sats) – wie die Vorgabe beim eigenen Fragen; höchstens das zahlt das Budget. */
export const AGENT_GEBOT_SATS = 100;
/** So lange wartet ein Agent auf den Provider. */
const WARTEN_MS = 180_000;

const sitzungen = new AgentSitzungen();
const bremsen = new Map<string, AuftragsBremse>();
/** Je Agent eine Erwähnung nach der anderen. */
const reihe = new Map<string, Promise<void>>();
/** Das laufende Abo und für welche Agenten es gilt. */
let aktiv: { agenten: string; stopp: () => void } | null = null;
let aufsetzen: Promise<void> = Promise.resolve();

const jetztSek = (): number => Math.floor(Date.now() / 1000);

/**
 * Abo prüfen und nur bei Änderung neu aufsetzen – beim Start, im Abruftakt
 * (Entsperren, neue Identität) und wenn sich Agenten oder Räume ändern.
 * `privat`: auch private Räume – lädt die MLS-Engine, also nie beim Start.
 */
export function starteGeraeteAgenten(o: { privat?: boolean } = {}): Promise<void> {
  const lauf = async () => {
    await setzeAboAuf();
    if (o.privat) await setzePrivatAuf();
  };
  aufsetzen = aufsetzen.then(lauf, lauf);
  return aufsetzen;
}

/** Der Abruftakt prüft offene und private Räume. */
export const agentenImTakt = (): Promise<void> => starteGeraeteAgenten({ privat: true });

const bremseFuer = (agentPk: string): AuftragsBremse => {
  const b = bremsen.get(agentPk) ?? new AuftragsBremse();
  bremsen.set(agentPk, b);
  return b;
};

/** Je Agent eine Erwähnung nach der anderen. */
function einreihen(agentPk: string, f: () => Promise<void>): void {
  reihe.set(agentPk, (reihe.get(agentPk) ?? Promise.resolve()).then(f).catch(() => { /* nächste Erwähnung */ }));
}

async function setzeAboAuf(): Promise<void> {
  const agenten = state.keypair && !alsGeraet()
    ? agentenBuch.alle().filter((a) => a.raeume.some((r) => leseRaumAdresse(r.raum))).map((a) => a.pk)
    : [];
  if (aktiv?.agenten === agenten.join(",")) return;
  aktiv?.stopp();
  aktiv = null;
  if (agenten.length === 0) return;
  const pool = await ensurePool();
  const stopp = await pool.subscribe({ kinds: [KIND_CHANNEL_MESSAGE], "#p": agenten, since: jetztSek() }, (ev) => nimm(ev));
  aktiv = { agenten: agenten.join(","), stopp };
}

/** Eine Nachricht an Agenten dieses Geräts: je erwähntem Agent mit diesem Raum in die Reihe. */
function nimm(ev: NostrEvent): void {
  const kennung = ev.tags.find((x) => x[0] === "space")?.[1];
  const erwaehnt = ausRaumEvent(ev)?.erwaehnt ?? [];
  for (const a of agentenBuch.alle()) {
    if (!erwaehnt.includes(a.pk)) continue;
    const raum = a.raeume.map((r) => r.raum).find((r) => leseRaumAdresse(r)?.spaceId === kennung);
    if (!raum) continue;
    einreihen(a.pk, () => beantworteOffen(a.pk, raum, ev));
  }
}

/** Abos der privaten Räume: je Agent und Gruppe eines (Schlüssel `agent|gruppe`). */
const privatAbos = new Map<string, () => void>();

async function setzePrivatAuf(): Promise<void> {
  const soll = new Map<string, { a: GeraeteAgent; gruppe: string }>();
  if (state.keypair && !alsGeraet() && !mlsGesperrt()) {
    for (const a of agentenBuch.alle()) for (const r of a.raeume) if (!leseRaumAdresse(r.raum)) soll.set(`${a.pk}|${r.raum}`, { a, gruppe: r.raum });
  }
  for (const [schluessel, stopp] of privatAbos) {
    if (soll.has(schluessel)) continue;
    stopp();
    privatAbos.delete(schluessel);
  }
  for (const [schluessel, { a, gruppe }] of soll) {
    if (privatAbos.has(schluessel)) continue;
    const k = await agentKonto(a)?.catch(() => null);
    const abo = k ? gruppenAbos(k.mls).find((x) => x.gruppe === gruppe) : undefined;
    if (!k || !abo) continue;
    // Erst nachholen – beantwortet wird nur, was ab jetzt kommt
    const seit = jetztSek();
    await agentAbgleichen(k, gruppe).catch(() => []);
    const nach = new Nachziehen(async () => {
      for (const e of await agentAbgleichen(k, gruppe)) {
        const erwaehnt = (e.tags ?? []).some((x) => x[0] === "p" && x[1] === a.pk);
        if (e.zeit >= seit && (e.art ?? ART_RAUM_CHAT) === ART_RAUM_CHAT && erwaehnt && e.inneres) {
          const inneres = e.inneres;
          einreihen(a.pk, () => beantwortePrivat(a.pk, gruppe, inneres));
        }
      }
    });
    privatAbos.set(schluessel, await abonniereAn({ ...abo.filter, limit: 1 }, abo.relays, () => nach.anstossen()));
  }
}

/** Provider, über die das Budget zahlen kann: msat nur Lightning, Lamports nur mit Zahlkanal. */
async function ziele(einheit: "msat" | "lamports"): Promise<string[]> {
  const liste = privatFaehig(await findProviders("classic")).map((c) => c.caps.pubkey);
  return liste.filter((pk) => (einheit === "lamports" ? kanalDa(pk) : kiZahlweg(standardSchiene(), kanalDa(pk)) === "lightning"));
}

async function beantworteOffen(agentPk: string, raum: string, ev: NostrEvent): Promise<void> {
  const ort = leseRaumAdresse(raum)!;
  const agent = agentenBuch.agent(agentPk);
  const signer = agentenBuch.signer(agentPk);
  const budget = agentenBuch.budget(agentPk, raum);
  if (!agent || !signer || !budget) return;
  const pool = await ensurePool();
  const [struktur, verlauf] = await Promise.all([
    pool.query({ kinds: [KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT, KIND_RAUM_KANAL], "#space": [ort.spaceId], limit: 500 }),
    pool.query({ kinds: [KIND_CHANNEL_MESSAGE], "#space": [ort.spaceId], limit: 300 }),
  ]);
  const stand = raumZustandFuer(raum, struktur);
  if (!stand?.space) return;
  // Schalter der Agentenketten: nur in der Definition des Gründers (F5) – `d` ist `space:<kennung>` (bis 11.3d1a nie gefunden)
  const definition = definitionDesGruenders(raum, struktur);
  const alle = verlauf.some((e) => e.id === ev.id) ? verlauf : [...verlauf, ev];
  const e = entscheide({ agent: agentPk, ev, alle, stand, definition, bremse: bremseFuer(agentPk), jetzt: jetztSek() });
  if (e.art !== "antworten") return;
  const sende = async (u: Parameters<typeof signer.signEvent>[0]): Promise<void> => void (await pool.publish(await signer.signEvent(u)));
  const nachrichten = alle.map(ausRaumEvent).filter((n): n is RaumNachricht => n !== null);
  const r = await frageUndZahle({ agent, raum, budget, nachricht: e.nachricht, alle: nachrichten, istAgent: istAgentIm(stand) });
  if (r?.art === "hinweis") await sende(agentHinweisEvent({ agent: agentPk, kennung: ort.spaceId, kanal: e.nachricht.kanal, text: r.text }));
  if (r?.art === "antwort") await sende(agentAntwortEvent({ agent: agentPk, kennung: ort.spaceId, auf: e.nachricht, text: r.text }));
}

/** Privat: Raum und Kontext aus dem Verlauf des Agenten, Antwort als inneres Event von ihm. */
async function beantwortePrivat(agentPk: string, gruppe: string, inneres: string): Promise<void> {
  const agent = agentenBuch.agent(agentPk);
  const budget = agentenBuch.budget(agentPk, gruppe);
  const k = agent && budget ? await agentKonto(agent) : null;
  if (!agent || !budget || !k) return;
  const raum = agentRaum(k, gruppe);
  const ev = raum.nachrichten.find((n) => n.id === inneres);
  if (!ev) return;
  // Agenten im privaten Raum: Mitglieder mit Karte (es gibt dort keine Rolle `agent`)
  const istAgent = (pk: string): boolean => raum.agenten.has(pk);
  const e = entscheide({ agent: agentPk, ev, alle: raum.nachrichten, stand: raum.zustand, definition: raum.definition, bremse: bremseFuer(agentPk), jetzt: jetztSek(), istAgent });
  if (e.art !== "antworten") return;
  const nachrichten = raum.nachrichten.map(ausRaumEvent).filter((n): n is RaumNachricht => n !== null);
  const r = await frageUndZahle({ agent, raum: gruppe, budget, nachricht: e.nachricht, alle: nachrichten, istAgent });
  if (r?.art === "hinweis") await agentSendet(k, gruppe, raumNachricht({ kanal: e.nachricht.kanal, text: r.text }));
  if (r?.art === "antwort") await agentSendet(k, gruppe, raumAgentAntwort(e.nachricht, r.text));
}

/**
 * Auftrag und Bezahlung – gleich für offene und private Räume. Null: kein
 * Provider, Ablehnung, keine Antwort. „hinweis“: Budget erreicht (je Zeitraum
 * einmal). „antwort“: bezahlt und verbucht.
 */
async function frageUndZahle(p: {
  agent: GeraeteAgent; raum: string; budget: RaumBudget; nachricht: RaumNachricht; alle: RaumNachricht[]; istAgent: (pk: string) => boolean;
}): Promise<{ art: "hinweis" | "antwort"; text: string } | null> {
  const { agent, raum, budget } = p;
  const agentPk = agent.pk;
  const pool = await ensurePool();
  // Provider und Gebot in der Einheit des Budgets – passt es nicht, schweigt der Agent (einmal gesagt)
  const provider = (await ziele(budget.einheit))[0];
  if (!provider) return null;
  const hoechst = hoechstMsat(AGENT_GEBOT_SATS, []);
  const kurs = budget.einheit === "lamports" ? (await angebotVon(provider))?.kurs : undefined;
  if (budget.einheit === "lamports" && !kurs) return null;
  const imBudget = kurs ? Number(bedarfLamports(hoechst, kurs.satsProSol)) : hoechst;
  const passt = agentenBuch.reicht(agentPk, raum, imBudget);
  if (!passt.ja) {
    if (passt.grund !== "kein-raum" && (await agentenBuch.meldeEinmal(agentPk, raum, passt.grund))) {
      return { art: "hinweis", text: t(passt.grund === "tag" ? "agentRaum.budgetTag" : "agentRaum.budgetMonat") };
    }
    return null;
  }

  // Auftrag: versiegelt vom Sitzungsschlüssel dieses Agenten in diesem Raum, A+ über ki-zahlung.ts
  const maske = maskiereEinzeln(agentPrompt({
    agent: agentPk, persona: agent.persona, nachricht: p.nachricht, alle: p.alle, istAgent: p.istAgent,
    umfang: leseUmfang(localStorage.getItem(LS_VERLAUF)),
  }));
  const ks = sitzungen.fuer(agentPk, raum);
  const sitzung = ks.fuer(provider);
  const empfaenger = await empfaengerFuer(provider);
  const kanal = budget.einheit === "lamports" ? await kanalGutschrift(provider, hoechst) : undefined;
  if (budget.einheit === "lamports" && !kanal) return null;
  const request = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: maske.text, bidMsat: AGENT_GEBOT_SATS * 1000, providerPubkey: provider,
    params: [["tier", "classic"]],
    extraTags: [...(kanal ? kanal.tags : deklaration(empfaenger)), ...(agent.modell ? [["param", "model", agent.modell]] : [])],
  });
  const auftrag = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: provider, powBits: powJeProvider.get(provider) ?? 0 });
  if (kanal) await kanal.merke(auftrag.requestId);
  ks.merkeAuftrag(auftrag.requestId, sitzung);
  merkeAnfrage(auftrag.requestId, empfaenger, hoechst, !!kanal);
  const seit = jetztSek() - 120;
  await pool.publish(auftrag.wrap);

  // Antwort abwarten – nur an diesen Sitzungsschlüssel, nur zu diesem Auftrag
  const cache: AntwortCache = new Map();
  const ende = Date.now() + WARTEN_MS;
  let antwort: NostrEvent | undefined;
  while (!antwort && Date.now() < ende) {
    await new Promise((r) => setTimeout(r, 3000));
    const umschlaege = await pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [sitzung.publicKey()], since: seit }).catch(() => []);
    const r = await oeffneAntworten(umschlaege, ks, new Set([auftrag.requestId]), cache);
    antwort = r.ergebnisse.find((x) => x.pubkey === provider);
    const abgelehnt = r.rueckmeldungen.find((x) => x.pubkey === provider && !["progress", "processing"].includes(x.tags.find((y) => y[0] === "status")?.[1] ?? ""));
    if (!antwort && abgelehnt) return null;
  }
  if (!antwort) return null;
  const ergebnis = parseJobResult(antwort);

  // Bezahlen und verbuchen – nie mehr als das Gebot
  if (kanal) {
    await kanalAntwort(auftrag.requestId, ergebnis.amountLamports);
    await agentenBuch.buche(agentPk, raum, Math.min(ergebnis.amountLamports ?? imBudget, imBudget));
  } else {
    const abrechnung = await rechneAntwortAb(auftrag.requestId, ergebnis.amountMsat);
    const { zahlung } = await providerZahlung(provider);
    await ensureSessionClient().chargeForResult(provider, abrechnung.providerMsat, antwort.id, zahlung, sitzung);
    await agentenBuch.buche(agentPk, raum, Math.min(ergebnis.amountMsat, hoechst));
    void zahleAnteile().catch(() => { /* beim nächsten Mal */ });
  }
  return { art: "antwort", text: maske.zurueck(ergebnis.output) };
}
