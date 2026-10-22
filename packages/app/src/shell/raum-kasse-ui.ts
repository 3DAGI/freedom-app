/**
 * Kasse im Raum (A-12, `docs/KASSE-ENTWURF.md`) – App, Teil b2a: die eigene Adresse für die Kasse nennen.
 *
 * Wer das Recht „kasse“ hat (W4), nennt dem Raum eine frische Adresse der eingebauten Wallet (V4, nie die
 * Hauptadresse) samt Nachweis dieser Adresse (`kassenNachweis()`): offen als Kind 34704 an die Adresse des
 * Raums, privat nur als inneres Event der Gruppe. Vorher sagt die App, was öffentlich wird (V5). Teil b2b: Gründer
 * (offen) bzw. Admin (privat) legt die Kasse an – Mitglieder sind die genannten Adressen derer mit dem Recht – und
 * schreibt sie in die Definition. Einzahlen folgt (A-12b2c), die Oberfläche baut Spur C (A-12e). Als Gerät nie –
 * die Kasse gehört der Person.
 */
import {
  KASSEN_ZEITSCHLOSS_SEK, KIND_KASSEN_ADRESSE, KIND_SPACE, RAUM_KASSEN_RECHT, baueKassenAdresse, buildEvent, can, kassenAdressenOffen,
  kassenAdressenPrivat, kassenOrt, mitKassenRecht, mitKassenTag, raumKassenAdresse, type SpaceState,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { solText } from "../preis-anzeige.js";
import { fehlerText } from "../protokoll-texte.js";
import { bestaetige, dialog, hinweis } from "./dialog.js";
import { frischeKassenAdresse, kassenAdresseFehlt } from "./eingebaute-wallet.js";
import { mlsSendeEvent } from "./mls-konto.js";
import type { AgentZiel } from "./raum-agenten-ui.js";
import { gruenderDefinition } from "./raum-ketten-ui.js";
import { setzePrivateKasse } from "./raum-mls.js";
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

/** Darf ich hier die Kasse anlegen? Gründer des offenen, Admin des privaten Raums, als Person, noch ohne Kasse. */
function darfKasseAnlegen(ziel: AgentZiel, zustand: SpaceState | undefined): boolean {
  const ich = state.keypair?.pk;
  if (!ich || !zustand?.space || zustand.space.kasse || alsGeraet()) return false;
  return "privat" in ziel ? ziel.privat.admins.includes(ich) : zustand.ownerPubkey === ich;
}

const ZEITSCHLOSS: Record<number, string> = { 0: "kasse.ohneZeitschloss", 3600: "kasse.zeitschlossStunde", 86_400: "kasse.zeitschlossTag" }; // kein UI-Text

/** Die Kasse anlegen (Devnet, eingebaute Wallet) und in die Definition schreiben – true, wenn sie dort steht. */
export async function legeKasseImRaumAn(ziel: AgentZiel, zustand: SpaceState | undefined): Promise<boolean> {
  const ich = state.keypair?.pk;
  if (!ich || !zustand || !darfKasseAnlegen(ziel, zustand)) return false;
  try {
    if (!(await verlangeTresor(t("kasse.wofuer")))) return false;
    const adressen = await genannteKassenAdressen(ziel);
    const gruender = adressen.get(ich);
    if (!gruender) {
      await hinweis(t("kasse.anlegenTitel"), t("kasse.erstAdresse"));
      return false;
    }
    const andere = mitKassenRecht(zustand).filter((pk) => pk !== ich);
    const weitere = andere.flatMap((pk) => adressen.get(pk) ?? []);
    const w = await dialog({
      titel: t("kasse.anlegenTitel"), text: t("kasse.anlegenText", { mit: weitere.length, ohne: andere.length - weitere.length }), ok: t("kasse.weiter"),
      felder: [
        { art: "wahl", name: "art", label: t("kasse.art"), wert: "gruender", optionen: [
          { wert: "gruender", text: t("kasse.artGruender") }, { wert: "mehrheit", text: t("kasse.artMehrheit") },
        ] },
        { art: "wahl", name: "zeitschloss", label: t("kasse.zeitschloss"), wert: "0", optionen: KASSEN_ZEITSCHLOSS_SEK.map((s) => ({ wert: String(s), text: t(ZEITSCHLOSS[s]!) })) },
      ],
      pruefe: (w) => (w.art === "mehrheit" && !weitere.length ? t("kasse.mehrheitAllein") : null),
    });
    if (!w) return false;
    const art = w.art === "mehrheit" ? "mehrheit" : "gruender";
    const { legeKasseAn } = await import("./zahlschienen.js");
    const kasse = await legeKasseAn({ art, gruender, weitere, zeitschlossSek: Number(w.zeitschloss) }, (k) => bestaetige({
      titel: t("kasse.anlegenTitel"), ok: t("kasse.anlegen"),
      text: [
        t("kasse.kosten", { miete: solText(k.miete), gebuehr: solText(k.gebuehr), gesamt: solText(k.gesamt), zahler: k.zahler }),
        t(art === "mehrheit" ? "kasse.ehrlichMehrheit" : "kasse.ehrlichGruender"),
        ...(k.zahler === gruender ? [] : [t("kasse.zahlerVerbunden", { gruender })]),
      ].join("\n\n"),
    }));
    // Auf der Kette steht sie jetzt – scheitert das Schreiben, nicht still aufgeben, sonst kennt der Raum sie nie
    while (!(await schreibeKasse(ziel, ich, kasse))) {
      if (!(await bestaetige({ titel: t("kasse.anlegenTitel"), text: t("kasse.nichtVermerkt", { kasse }), ok: t("kasse.nochmal") }))) return false;
    }
    toast(t("kasse.angelegt", { kasse }));
    return true;
  } catch (e) {
    toast(fehlerText(e), true);
    return false;
  }
}

/** Offen eine neue Definition des Gründers mit der Kasse, privat über `setzePrivateKasse()`. */
async function schreibeKasse(ziel: AgentZiel, ich: string, kasse: string): Promise<boolean> {
  if ("privat" in ziel) return setzePrivateKasse(ziel.privat, kasse).catch(() => false);
  const alt = await gruenderDefinition(ziel.adresse).catch(() => null);
  if (!alt) return false;
  // Nach der alten Definition, nie in derselben Sekunde – sonst entschiede die Id (Fallstrick B-20c)
  const zeit = Math.max(Math.floor(Date.now() / 1000), alt.zeit + 1);
  return (await ensurePool()).publish(await signiere(buildEvent(ich, KIND_SPACE, mitKassenTag(alt.tags, kasse), "", zeit))).then(() => true, () => false);
}
