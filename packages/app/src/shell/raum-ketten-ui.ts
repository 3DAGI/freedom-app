/**
 * Schalter „Agenten sprechen Agenten an“ (11.3e3, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md`
 * „Agentenketten“, F5): je Raum, Standard aus. Offen setzt ihn der Gründer in seiner
 * Definition (34700), privat ein Moderator im Raumstand. Ausschalten wirkt sofort.
 *
 * Die Grenze zählt die Agenten-Antworten in Folge seit der letzten Nachricht eines
 * Menschen (Standard 10, höchstens 50). Jede Antwort kostet wie sonst; ein Agent, bei
 * dem der Fragende zahlt, antwortet nie einem Agenten (Knoten zahlen nichts aus).
 */
import { AGENTENKETTE, KIND_SPACE, buildEvent, definitionDesGruenders, leseRaumAdresse } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { kettenGrenze, leseGrenze, mitKetten, privateDefinition } from "../raum-ketten.js";
import { dialog } from "./dialog.js";
import type { AgentZiel } from "./raum-agenten-ui.js";
import { setzePrivateKetten } from "./raum-mls.js";
import { ensurePool, signiere, state } from "./state.js";
import { toast } from "./ui.js";

/** Die neueste Definition des Gründers – nur er schreibt sie (B-7); auch für die Kasse (A-12b2b). */
export async function gruenderDefinition(adresse: string): Promise<{ tags: string[][]; zeit: number } | null> {
  const ort = leseRaumAdresse(adresse);
  if (!ort) return null;
  const evs = await (await ensurePool()).query({ kinds: [KIND_SPACE], authors: [ort.besitzer], "#d": [`space:${ort.spaceId}`], limit: 10 });
  const tags = definitionDesGruenders(adresse, evs);
  if (!tags.length) return null;
  const zeit = Math.max(...evs.filter((e) => e.pubkey === ort.besitzer).map((e) => e.created_at));
  return { tags: tags.map((x) => [...x]), zeit };
}

/** Dialog und Speichern – true, wenn sich etwas geändert hat (dann lädt der Aufrufer den Raum neu). */
export async function stelleKettenEin(ziel: AgentZiel): Promise<boolean> {
  const offen = "adresse" in ziel ? await gruenderDefinition(ziel.adresse) : null;
  if ("adresse" in ziel && !offen) {
    toast(t("ketten.ohneDefinition"), true);
    return false;
  }
  const jetzt = "privat" in ziel ? kettenGrenze(privateDefinition(ziel.privat.ereignisse, ziel.privat.admins)) : kettenGrenze(offen?.tags ?? []);
  const w = await dialog({
    titel: t("ketten.titel"), text: t("ketten.text"), ok: t("agentUi.speichern"),
    felder: [
      { art: "wahl", name: "an", label: t("ketten.schalter"), wert: jetzt === null ? "aus" : "an", optionen: [
        { wert: "aus", text: t("ketten.aus") }, { wert: "an", text: t("ketten.an") },
      ] },
      { art: "text", name: "grenze", label: t("ketten.grenze", { max: AGENTENKETTE.hoechstens }), wert: String(jetzt ?? AGENTENKETTE.vorgabe), mono: true },
    ],
    pruefe: (w) => (w.an !== "an" || leseGrenze(String(w.grenze ?? "")) !== undefined ? null : t("ketten.grenzeFalsch", { max: AGENTENKETTE.hoechstens })),
  });
  if (!w) return false;
  const neu = w.an === "an" ? leseGrenze(String(w.grenze ?? "")) ?? null : null;
  if (neu === jetzt) return false;
  let ok: boolean;
  if (offen && "adresse" in ziel && state.keypair) {
    // Nach der alten Definition, nie in derselben Sekunde – sonst entschiede die Id (Fallstrick B-20c)
    const zeit = Math.max(Math.floor(Date.now() / 1000), offen.zeit + 1);
    ok = await (await ensurePool()).publish(await signiere(buildEvent(state.keypair.pk, KIND_SPACE, mitKetten(offen.tags, neu), "", zeit))).then(() => true, () => false);
  } else {
    ok = "privat" in ziel ? await setzePrivateKetten(ziel.privat, neu).catch(() => false) : false;
  }
  toast(ok ? (neu === null ? t("ketten.istAus") : t("ketten.istAn", { n: neu })) : t("komm.nichtGeaendert"), !ok);
  return ok;
}
