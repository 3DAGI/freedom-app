/**
 * Kasse im Raum (A-12, `docs/KASSE-ENTWURF.md`) – App, Teil b2a: die eigene Adresse für die Kasse nennen.
 *
 * Wer das Recht „kasse“ hat (W4), nennt dem Raum eine frische Adresse der eingebauten Wallet (V4, nie die
 * Hauptadresse) samt Nachweis dieser Adresse (`kassenNachweis()`): offen als Kind 34704 an die Adresse des
 * Raums, privat nur als inneres Event der Gruppe. Vorher sagt die App, was öffentlich wird (V5). Anlegen und
 * einzahlen folgen (A-12b2b/c), die Oberfläche baut Spur C (A-12e). Als Gerät nie – die Kasse gehört der Person.
 */
import {
  KIND_KASSEN_ADRESSE, RAUM_KASSEN_RECHT, baueKassenAdresse, can, kassenAdressenOffen, kassenAdressenPrivat, kassenOrt, raumKassenAdresse,
  type SpaceState,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { bestaetige, hinweis } from "./dialog.js";
import { frischeKassenAdresse, kassenAdresseFehlt } from "./eingebaute-wallet.js";
import { mlsSendeEvent } from "./mls-konto.js";
import type { AgentZiel } from "./raum-agenten-ui.js";
import { alsGeraet, ensurePool, signiere, state } from "./state.js";
import { verlangeTresor } from "./tresor.js";
import { toast } from "./ui.js";

/** Die Adressen, die Mitglieder dem Raum genannt haben (Schlüssel → Adresse), nur mit gültigem Nachweis. */
export async function genannteKassenAdressen(ziel: AgentZiel): Promise<Map<string, string>> {
  if ("privat" in ziel) return kassenAdressenPrivat(ziel.privat.gruppe, ziel.privat.ereignisse);
  const evs = await (await ensurePool()).query({ kinds: [KIND_KASSEN_ADRESSE], "#a": [ziel.adresse], limit: 500 });
  return kassenAdressenOffen(ziel.adresse, evs);
}

/** Darf ich hier eine Adresse nennen? Recht „kasse“, als Person (nicht als Gerät). */
export function darfKassenAdresse(zustand: SpaceState | undefined): boolean {
  const ich = state.keypair?.pk;
  return !!ich && !!zustand && !alsGeraet() && can(ich, RAUM_KASSEN_RECHT, zustand);
}

/** Die eigene Adresse für die Kasse nennen – true, wenn eine hinausging. */
export async function nenneKassenAdresse(ziel: AgentZiel, zustand: SpaceState | undefined): Promise<boolean> {
  const ich = state.keypair?.pk;
  if (!ich || !darfKassenAdresse(zustand)) return false;
  try {
    const schon = (await genannteKassenAdressen(ziel)).get(ich);
    if (schon) {
      await hinweis(t("kasse.adresseTitel"), t("kasse.schonGenannt", { adresse: schon }));
      return false;
    }
    if (!(await verlangeTresor(t("kasse.wofuer")))) return false;
    const fehlt = kassenAdresseFehlt();
    if (fehlt) {
      toast(t(fehlt === "ohne-wallet" ? "kasse.ohneWallet" : "kasse.ohneVorrat"), true);
      return false;
    }
    const offen = "adresse" in ziel;
    if (!(await bestaetige({ titel: t("kasse.adresseTitel"), text: t(offen ? "kasse.offenText" : "kasse.privatText"), ok: t("kasse.nennen") }))) return false;
    const neu = await frischeKassenAdresse(kassenOrt(offen ? ziel.adresse : ziel.privat.gruppe), ich);
    if (!neu) {
      toast(t("kasse.ohneVorrat"), true);
      return false;
    }
    const { adresse, nachweis } = neu;
    const ok = offen
      ? await (await ensurePool()).publish(await signiere(baueKassenAdresse({ autor: ich, raum: ziel.adresse, adresse, nachweis }))).then(() => true, () => false)
      : await mlsSendeEvent(ziel.privat.gruppe, raumKassenAdresse(ziel.privat.gruppe, adresse, nachweis)).catch(() => false);
    toast(ok ? t("kasse.genannt", { adresse }) : t("komm.nichtGeaendert"), !ok);
    return ok;
  } catch (e) {
    toast(fehlerText(e), true);
    return false;
  }
}
