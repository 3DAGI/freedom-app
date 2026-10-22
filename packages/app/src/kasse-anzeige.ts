/**
 * Stand einer Kasse im Raum als Text (A-12b2c, `docs/KASSE-ENTWURF.md` V3): was die Kette sagt – Guthaben des Tresors,
 * Art, Schwelle, Wartezeit, Mitglieder – und wo Raum und Kette abweichen (`kassenAbweichungen()`). Es zählt die Kette;
 * der Raum sagt nur, wer welche Adresse genannt hat. Seit A-12c1 auch die jüngsten Auszahlungen, Empfänger und Betrag
 * von der Kette (V6). Ohne DOM, damit ein Test die Sätze prüft.
 */
import {
  KASSEN_RECHT, ausfuehrbarAb, kassenArt, kassenTresor, vorschlagsSchritte, type KassenAbweichungen, type KassenSchritt, type KassenStand,
  type KassenVorgang, type VorschlagsStatus,
} from "@freedomstack/protocol";
import { gebietsschema, t } from "./i18n.js";
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

const STATUS: Record<VorschlagsStatus, string> = { // kein UI-Text
  entwurf: "kasse.stEntwurf", aktiv: "kasse.stAktiv", abgelehnt: "kasse.stAbgelehnt", angenommen: "kasse.stAngenommen",
  "wird-ausgefuehrt": "kasse.stWirdAusgefuehrt", ausgefuehrt: "kasse.stAusgefuehrt", abgebrochen: "kasse.stAbgebrochen",
};

/** Die jüngsten Auszahlungen als Text: Betrag, Empfänger, Status und Stimmen – alles von der Kette, nie aus dem Raum. */
export function vorschlaegeText(stand: KassenStand, liste: readonly KassenVorgang[]): string {
  if (!liste.length) return t("kasse.keineVorschlaege");
  const zeilen = liste.map(({ index, vorschlag: v, auszahlung: a, konfiguration }) => {
    const status = t(STATUS[v.status]);
    // Änderungen der Kasse (A-12a3) zeigt die App nur – abstimmen darüber kommt mit A-12d
    if (konfiguration !== undefined) return t("kasse.vorschlagKonfiguration", { nr: String(index), status });
    if (!a) return t("kasse.vorschlagFremd", { nr: String(index), status });
    const ab = ausfuehrbarAb(stand, v);
    return t("kasse.vorschlagZeile", {
      nr: String(index), betrag: solText(Number(a.lamports)), empfaenger: a.empfaenger, status,
      ja: v.dafuer.length, schwelle: stand.schwelle, nein: v.dagegen.length,
    }) + (ab !== null && stand.zeitschlossSek > 0 ? t("kasse.ausfuehrbarAb", { zeit: new Date(Number(ab) * 1000).toLocaleString(gebietsschema()) }) : "");
  });
  return [t("kasse.vorschlaege"), ...zeilen].join("\n");
}

const SCHRITT: Record<KassenSchritt, string> = { // kein UI-Text
  dafuer: "kasse.schrittDafuer", dagegen: "kasse.schrittDagegen", ausfuehren: "kasse.schrittAusfuehren", abschliessen: "kasse.schrittAbschliessen",
};

/**
 * Was man im Menü der Kasse wählen kann (A-12c1): einzahlen; vorschlagen, wenn die eigene Adresse (`mitglied`) es auf der
 * Kette darf; je Vorschlag die Schritte, die `vorschlagsSchritte()` erlaubt. Werte: „einzahlen“, „vorschlagen“, „<schritt>:<nr>“.
 */
export function kassenAktionen(stand: KassenStand, liste: readonly KassenVorgang[], mitglied: string | undefined, jetztSek: number): Array<{ wert: string; text: string }> {
  const aktionen = [{ wert: "einzahlen", text: t("kasse.einzahlen") }];
  if ((stand.mitglieder.find((m) => m.adresse === mitglied)?.rechte ?? 0) & KASSEN_RECHT.vorschlagen) aktionen.push({ wert: "vorschlagen", text: t("kasse.vorschlagen") });
  for (const v of liste) {
    if (v.konfiguration !== undefined) continue; // eine Änderung der Kasse: noch keine Schritte (A-12d)
    for (const s of vorschlagsSchritte({ stand, vorschlag: v.vorschlag, auszahlung: v.auszahlung, mitglied, jetztSek })) {
      aktionen.push({ wert: `${s}:${v.index}`, text: t(SCHRITT[s], { nr: String(v.index) }) });
    }
  }
  return aktionen;
}
