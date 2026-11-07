/**
 * Schalter „Pakete für Agenten holen“ (11.5c4, `docs/REPO-AGENTEN-ENTWURF.md` P3): nur im privaten Raum, nur
 * Moderatoren, Vorgabe aus. An heißt: Der Knoten eines Agenten holt vor einem Repo-Auftrag die Pakete, die die
 * Sperrdatei mit Prüfsumme nennt – die Registry sieht Paketnamen und die IP des Knotens, nie Code; `paket_holen` gibt es
 * privat nie. Offen gilt der Schalter nicht (der Code ist öffentlich, der Knoten holt dort immer).
 */
import { leseRepoPakete } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { privateDefinition } from "../raum-ketten.js";
import { dialog } from "./dialog.js";
import { setzePrivatePakete, type PrivaterRaum } from "./raum-mls.js";
import { toast } from "./ui.js";

/** Dialog und Speichern – true, wenn sich etwas geändert hat (dann lädt der Aufrufer den Raum neu). */
export async function stellePaketeEin(raum: PrivaterRaum): Promise<boolean> {
  const jetzt = leseRepoPakete(privateDefinition(raum.ereignisse, raum.admins));
  const w = await dialog({
    titel: t("pakete.titel"), text: t("pakete.text"), ok: t("agentUi.speichern"),
    felder: [{ art: "wahl", name: "an", label: t("pakete.schalter"), wert: jetzt ? "an" : "aus", optionen: [
      { wert: "aus", text: t("ketten.aus") }, { wert: "an", text: t("ketten.an") },
    ] }],
  });
  if (!w) return false;
  const neu = w.an === "an";
  if (neu === jetzt) return false;
  const ok = await setzePrivatePakete(raum, neu).catch(() => false);
  toast(ok ? t(neu ? "pakete.istAn" : "pakete.istAus") : t("komm.nichtGeaendert"), !ok);
  return ok;
}
