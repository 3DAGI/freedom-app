/**
 * Stand einer Kasse im Raum als Text (A-12b2c, `docs/KASSE-ENTWURF.md` V3): was die Kette sagt – Guthaben des Tresors,
 * Art, Schwelle, Wartezeit, Mitglieder – und wo Raum und Kette abweichen (`kassenAbweichungen()`). Es zählt die Kette;
 * der Raum sagt nur, wer welche Adresse genannt hat. Ohne DOM, damit ein Test die Sätze prüft.
 */
import { kassenArt, kassenTresor, type KassenAbweichungen, type KassenStand } from "@freedomstack/protocol";
import { t } from "./i18n.js";
import { solText } from "./preis-anzeige.js";

const ZEITSCHLOSS: Record<number, string> = { 0: "kasse.ohneZeitschloss", 3600: "kasse.zeitschlossStunde", 86_400: "kasse.zeitschlossTag" }; // kein UI-Text

/** Die Wartezeit vor dem Auszahlen – eine andere als die drei der App in Sekunden. */
export function zeitschlossText(sek: number): string {
  const k = ZEITSCHLOSS[sek];
  return k ? t(k) : t("kasse.zeitschlossSek", { n: sek });
}

/** Der Stand als Text, Zeile für Zeile; `name` macht aus einem Schlüssel den Namen im Raum. */
export function kassenStandText(p: {
  kasse: string; stand: KassenStand; guthaben: number; abweichungen: KassenAbweichungen; name: (pk: string) => string;
}): string {
  const { stand, abweichungen: a } = p;
  const art = kassenArt(stand);
  const zeilen = [
    t("kasse.standTresor", { tresor: kassenTresor(p.kasse), guthaben: solText(p.guthaben) }),
    art === "gruender" ? t("kasse.standGruender") : art === "mehrheit" ? t("kasse.standMehrheit", { schwelle: stand.schwelle, von: stand.mitglieder.length }) : t("kasse.standFremd"),
    t("kasse.standWartezeit", { wartezeit: zeitschlossText(stand.zeitschlossSek) }),
    t("kasse.standMitglieder", { n: stand.mitglieder.length }),
  ];
  const abw = [
    ...a.rechtOhneMitgliedschaft.map((x) => t(x.adresse ? "kasse.abwRechtMitAdresse" : "kasse.abwRechtOhneAdresse", { wer: p.name(x.pubkey) })),
    ...a.mitgliedschaftOhneRecht.map((x) => (x.pubkey
      ? t("kasse.abwMitgliedBekannt", { wer: p.name(x.pubkey), adresse: x.adresse })
      : t("kasse.abwMitgliedUnbekannt", { adresse: x.adresse }))),
  ];
  return [...zeilen, "", ...(abw.length ? [t("kasse.abweichungen"), ...abw] : [t("kasse.stimmtUeberein")])].join("\n");
}
