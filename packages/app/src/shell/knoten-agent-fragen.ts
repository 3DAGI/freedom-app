/**
 * Fragen an Agenten auf dem Knoten (11.3d1b2, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P4, „wer fragt, zahlt“; Knoten seit 11.3d1a).
 *
 * - Nach dem Senden in einem offenen Raum: je erwähntem Agenten, dessen Karte
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
 */
import { auftragsVerweisTags } from "@freedomstack/protocol";
import { hoechstMsat } from "../anteile-kasse.js";
import { t } from "../i18n.js";
import { KiSitzungen } from "../ki-sitzung.js";
import { kiZahlweg } from "../ki-zahlweg.js";
import { type RaumAgentKarte, type ZuBezahlen, ablehnungsText, zuBezahlen } from "../knoten-agent-wahl.js";
import { ausMsat } from "../preis-anzeige.js";
import { fehlerText } from "../protokoll-texte.js";
import { standardSchiene } from "../standard-schiene.js";
import { AGENT_GEBOT_SATS } from "./agenten-lauschen.js";
import { bezahlterAuftrag } from "./bezahlter-auftrag.js";
import { bestaetige } from "./dialog.js";
import { kanalDa, providerZahlung } from "./ki-zahlung.js";
import { providerMitStand, state } from "./state.js";
import { privatFaehig } from "./tabs/agent.js";
import { toast } from "./ui.js";

/** Eingabe des Auftrags – der Knoten liest sie nicht (11.3d1a), sie muss nur da sein. */
const EINGABE = "agent-raum";

/** Nach dem Senden einer Nachricht im offenen Raum `raum` (Adresse) mit der Id `erwaehnung`. */
export async function frageKnotenAgenten(p: { raum: string; erwaehnung: string; erwaehnt: string[]; karten: RaumAgentKarte[] }): Promise<void> {
  const ich = state.keypair?.pk;
  if (!ich) return;
  // Einer nach dem anderen – jeder mit eigenem Preis und eigener Bestätigung
  for (const k of zuBezahlen(p.erwaehnt, p.karten, ich)) {
    await frageEinen(p.raum, p.erwaehnung, k).catch((e) => toast(fehlerText(e), true));
  }
}

async function frageEinen(raum: string, erwaehnung: string, k: ZuBezahlen): Promise<void> {
  // Nur ein Knoten mit Angebot, der versiegelte Anfragen nimmt
  const angebot = privatFaehig((await providerMitStand()).filter((c) => c.caps.pubkey === k.provider))[0]?.caps;
  if (!angebot) return toast(t("agentKnoten.ohneAngebot", { name: k.name }), true);
  const weg = kiZahlweg(standardSchiene(), kanalDa(k.provider));
  if (weg === "kanal-noetig") return toast(t("zahl.kanalNoetig"), true);
  if (weg === "lightning") {
    const { grund } = await providerZahlung(k.provider);
    if (grund) return toast(grund, true);
  }
  const hoechst = hoechstMsat(AGENT_GEBOT_SATS, []);
  const ok = await bestaetige({
    titel: t("agentKnoten.titel", { name: k.name }),
    text: t(weg === "kanal" ? "agentKnoten.preisKanal" : "agentKnoten.preis", {
      name: k.name, hoechst: ausMsat(hoechst, angebot.kurs), rate: ausMsat(angebot.textRatePerKTokenMsat, angebot.kurs),
    }),
    ok: t("agentKnoten.fragen"),
  });
  if (!ok) return;

  // Frischer Sitzungsschlüssel je Frage – der Knoten kann zwei Fragen nicht über ihn verbinden
  const r = await bezahlterAuftrag({
    provider: k.provider, sitzungen: new KiSitzungen(), input: EINGABE, hoechstMsat: hoechst, kanal: weg === "kanal",
    extraTags: auftragsVerweisTags({ raum, erwaehnung }),
  });
  if (r?.art === "antwort") toast(t("agentKnoten.beantwortet", { name: k.name }));
  else if (r?.art === "abgelehnt") toast(t(ablehnungsText(r.fall), { name: k.name, fall: r.fall ?? "–" }), true);
  else toast(t("agentKnoten.keineAntwort", { name: k.name }), true);
}
