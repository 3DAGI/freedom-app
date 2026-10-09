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
 */
import {
  AuftragsBremse, KIND_CHANNEL_MESSAGE, KIND_GIFT_WRAP, KIND_RAUM_KANAL, KIND_ROLE_GRANT, KIND_SPACE, KIND_SPACE_ROLES,
  ausRaumEvent, buildJobRequest, buildPrivateJobRequest, leseRaumAdresse, parseJobResult, raumZustandFuer,
  type NostrEvent, type RaumNachricht,
} from "@freedomstack/protocol";
import { AgentSitzungen, agentAntwortEvent, agentHinweisEvent, agentPrompt, entscheide, istAgentIm } from "../agent-antwort.js";
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
import { alsGeraet, angebotVon, ensurePool, ensureSessionClient, findProviders, powJeProvider, state } from "./state.js";
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
 */
export function starteGeraeteAgenten(): Promise<void> {
  aufsetzen = aufsetzen.then(setzeAboAuf, setzeAboAuf);
  return aufsetzen;
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
    const weiter = (reihe.get(a.pk) ?? Promise.resolve()).then(() => beantworte(a.pk, raum, ev)).catch(() => { /* nächste Erwähnung */ });
    reihe.set(a.pk, weiter);
  }
}

/** Provider, über die das Budget zahlen kann: msat nur Lightning, Lamports nur mit Zahlkanal. */
async function ziele(einheit: "msat" | "lamports"): Promise<string[]> {
  const liste = privatFaehig(await findProviders("classic")).map((c) => c.caps.pubkey);
  return liste.filter((pk) => (einheit === "lamports" ? kanalDa(pk) : kiZahlweg(standardSchiene(), kanalDa(pk)) === "lightning"));
}

async function beantworte(agentPk: string, raum: string, ev: NostrEvent): Promise<void> {
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
  // Schalter der Agentenketten: nur in der Definition des Gründers (F5)
  const definition = struktur.filter((e) => e.kind === KIND_SPACE && e.pubkey === ort.besitzer && e.tags.some((x) => x[0] === "d" && x[1] === ort.spaceId))
    .sort((a, b) => b.created_at - a.created_at)[0]?.tags ?? [];
  const alle = verlauf.some((e) => e.id === ev.id) ? verlauf : [...verlauf, ev];
  const bremse = bremsen.get(agentPk) ?? new AuftragsBremse();
  bremsen.set(agentPk, bremse);
  const e = entscheide({ agent: agentPk, ev, alle, stand, definition, bremse, jetzt: jetztSek() });
  if (e.art !== "antworten") return;
  const sende = async (u: Parameters<typeof signer.signEvent>[0]): Promise<void> => void (await pool.publish(await signer.signEvent(u)));

  // Provider und Gebot in der Einheit des Budgets – passt es nicht, schweigt der Agent (einmal gesagt)
  const provider = (await ziele(budget.einheit))[0];
  if (!provider) return;
  const hoechst = hoechstMsat(AGENT_GEBOT_SATS, []);
  const kurs = budget.einheit === "lamports" ? (await angebotVon(provider))?.kurs : undefined;
  if (budget.einheit === "lamports" && !kurs) return;
  const imBudget = kurs ? Number(bedarfLamports(hoechst, kurs.satsProSol)) : hoechst;
  const passt = agentenBuch.reicht(agentPk, raum, imBudget);
  if (!passt.ja) {
    if (passt.grund !== "kein-raum" && (await agentenBuch.meldeEinmal(agentPk, raum, passt.grund))) {
      await sende(agentHinweisEvent({ agent: agentPk, kennung: ort.spaceId, kanal: e.nachricht.kanal, text: t(passt.grund === "tag" ? "agentRaum.budgetTag" : "agentRaum.budgetMonat") }));
    }
    return;
  }

  // Auftrag: versiegelt vom Sitzungsschlüssel dieses Agenten in diesem Raum, A+ über ki-zahlung.ts
  const nachrichten = alle.map(ausRaumEvent).filter((n): n is RaumNachricht => n !== null);
  const maske = maskiereEinzeln(agentPrompt({
    agent: agentPk, persona: agent.persona, nachricht: e.nachricht, alle: nachrichten, istAgent: istAgentIm(stand),
    umfang: leseUmfang(localStorage.getItem(LS_VERLAUF)),
  }));
  const ks = sitzungen.fuer(agentPk, raum);
  const sitzung = ks.fuer(provider);
  const empfaenger = await empfaengerFuer(provider);
  const kanal = budget.einheit === "lamports" ? await kanalGutschrift(provider, hoechst) : undefined;
  if (budget.einheit === "lamports" && !kanal) return;
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
    if (!antwort && abgelehnt) return;
  }
  if (!antwort) return;
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
  await sende(agentAntwortEvent({ agent: agentPk, kennung: ort.spaceId, auf: e.nachricht, text: maske.zurueck(ergebnis.output) }));
}
