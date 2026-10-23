/**
 * Stand einer Kasse im Raum als Text (A-12b2c, `docs/KASSE-ENTWURF.md` V3): was die Kette sagt – Guthaben des Tresors,
 * Art, Schwelle, Wartezeit, Mitglieder – und wo Raum und Kette abweichen (`kassenAbweichungen()`). Es zählt die Kette;
 * der Raum sagt nur, wer welche Adresse genannt hat. Seit A-12c1 auch die jüngsten Auszahlungen, Empfänger und Betrag
 * von der Kette (V6), seit A-12d1 auch Änderungen der Kasse (Mitglieder, Schwelle, Wartezeit). Ohne DOM, damit ein Test die
 * Sätze prüft. Seit A-12c3 auch, welche Wallet für die Kasse unterschreibt (`kassenUnterschreiber()`).
 */
import {
  KASSEN_RECHT, ausfuehrbarAb, behaeltArt, kassenArt, kassenTresor, vorschlagsSchritte, type KassenAbweichungen, type KassenAenderung,
  type KassenSchritt, type KassenStand, type KassenVorgang, type VorschlagsStatus,
} from "@freedomstack/protocol";
import { gebietsschema, t } from "./i18n.js";
import { solText } from "./preis-anzeige.js";

const ZEITSCHLOSS: Record<number, string> = { 0: "kasse.ohneZeitschloss", 3600: "kasse.zeitschlossStunde", 86_400: "kasse.zeitschlossTag" }; // kein UI-Text

/** Die Wartezeit vor dem Auszahlen – eine andere als die drei der App in Sekunden. */
export function zeitschlossText(sek: number): string {
  const k = ZEITSCHLOSS[sek];
  return k ? t(k) : t("kasse.zeitschlossSek", { n: sek });
}

/**
 * Wer für die Kasse unterschreibt (A-12c3): die eingebaute Wallet, wenn die Adresse für die Kasse eine ihrer Adressen ist, sonst
 * die verbundene, wenn sie genau diese Adresse hat und Transaktionen signieren kann – die eingebaute geht vor. Fehlt `mitglied` im
 * Ergebnis, unterschreibt niemand für die Kasse: dann geht nur Abschließen, und es zahlt, wer da ist (die eingebaute zuerst).
 */
export function kassenUnterschreiber(
  mitglied: string | undefined, eingebaut: readonly string[] | undefined, verbunden: { adresse: string; signiert: boolean } | undefined,
): { wer: "eingebaut" | "verbunden"; mitglied?: string } | undefined {
  const v = verbunden?.signiert ? verbunden.adresse : undefined;
  if (mitglied && eingebaut?.includes(mitglied)) return { wer: "eingebaut", mitglied };
  if (mitglied && v === mitglied) return { wer: "verbunden", mitglied };
  if (eingebaut?.length) return { wer: "eingebaut" };
  return v ? { wer: "verbunden" } : undefined;
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

const ALLE = KASSEN_RECHT.vorschlagen | KASSEN_RECHT.abstimmen | KASSEN_RECHT.ausfuehren;

/**
 * Eine Änderung der Kasse als Text (A-12d1) – so, wie sie auf der Kette steht (V6). `wer` macht aus einer Adresse den Namen im
 * Raum, wo jemand sie genannt hat; die Adresse steht immer dabei.
 */
export function aenderungenText(aenderungen: readonly KassenAenderung[], wer: (adresse: string) => string | undefined = () => undefined): string {
  const adresse = (a: string) => (wer(a) ? t("kasse.aeWer", { name: wer(a)!, adresse: a }) : a);
  return aenderungen.map((a) => {
    if (a.art === "mitglied-dazu") {
      const k = a.rechte === ALLE ? "kasse.aeDazu" : a.rechte === KASSEN_RECHT.vorschlagen ? "kasse.aeDazuVorschlagen" : "kasse.aeDazuRechte";
      return t(k, { wer: adresse(a.adresse), rechte: a.rechte });
    }
    if (a.art === "mitglied-weg") return t("kasse.aeWeg", { wer: adresse(a.adresse) });
    if (a.art === "schwelle") return t("kasse.aeSchwelle", { n: a.schwelle });
    return t("kasse.aeWartezeit", { wartezeit: zeitschlossText(a.sek) });
  }).join("; ");
}

/**
 * Die jüngsten Vorschläge als Text: bei Auszahlungen Betrag und Empfänger, bei Änderungen was sich ändert (A-12d1), dazu Status
 * und Stimmen – alles von der Kette, nie aus dem Raum.
 */
export function vorschlaegeText(stand: KassenStand, liste: readonly KassenVorgang[], wer?: (adresse: string) => string | undefined): string {
  if (!liste.length) return t("kasse.keineVorschlaege");
  const zeilen = liste.map(({ index, vorschlag: v, auszahlung: a, konfiguration }) => {
    const status = t(STATUS[v.status]);
    const stimmen = { nr: String(index), status, ja: v.dafuer.length, schwelle: stand.schwelle, nein: v.dagegen.length };
    const ab = ausfuehrbarAb(stand, v);
    const wann = ab !== null && stand.zeitschlossSek > 0 ? t("kasse.ausfuehrbarAb", { zeit: new Date(Number(ab) * 1000).toLocaleString(gebietsschema()) }) : "";
    if (konfiguration === null) return t("kasse.vorschlagKonfiguration", { nr: String(index), status });
    if (konfiguration) {
      // Eine Änderung, nach der die Kasse eine andere Art hätte, hat kein Programm der App vorgeschlagen – die App stimmt nicht dafür
      return t("kasse.aenderungZeile", { ...stimmen, aenderungen: aenderungenText(konfiguration, wer) }) + wann
        + (behaeltArt(stand, konfiguration) ? "" : t("kasse.aenderungAndereArt"));
    }
    if (!a) return t("kasse.vorschlagFremd", { nr: String(index), status });
    return t("kasse.vorschlagZeile", { ...stimmen, betrag: solText(Number(a.lamports)), empfaenger: a.empfaenger }) + wann;
  });
  return [t("kasse.vorschlaege"), ...zeilen].join("\n");
}

const SCHRITT: Record<KassenSchritt, string> = { // kein UI-Text
  dafuer: "kasse.schrittDafuer", dagegen: "kasse.schrittDagegen", ausfuehren: "kasse.schrittAusfuehren", abschliessen: "kasse.schrittAbschliessen",
};
const SCHRITT_AENDERUNG: Record<KassenSchritt, string> = { ...SCHRITT, ausfuehren: "kasse.schrittAendern" }; // kein UI-Text

/**
 * Was man im Menü der Kasse wählen kann (A-12c1): einzahlen; vorschlagen und (seit A-12d1) die Kasse ändern, wenn die eigene
 * Adresse (`mitglied`) es auf der Kette darf; je Vorschlag die Schritte, die `vorschlagsSchritte()` erlaubt – für eine Änderung,
 * nach der die Kasse eine andere Art hätte, nur dagegen stimmen und abschließen. Werte: „einzahlen“, „vorschlagen“, „aendern“,
 * „<schritt>:<nr>“.
 */
export function kassenAktionen(stand: KassenStand, liste: readonly KassenVorgang[], mitglied: string | undefined, jetztSek: number): Array<{ wert: string; text: string }> {
  const aktionen = [{ wert: "einzahlen", text: t("kasse.einzahlen") }];
  if ((stand.mitglieder.find((m) => m.adresse === mitglied)?.rechte ?? 0) & KASSEN_RECHT.vorschlagen) {
    aktionen.push({ wert: "vorschlagen", text: t("kasse.vorschlagen") }, { wert: "aendern", text: t("kasse.aendern") });
  }
  for (const v of liste) {
    const k = v.konfiguration;
    for (const s of vorschlagsSchritte({ stand, vorschlag: v.vorschlag, auszahlung: v.auszahlung, konfiguration: k, mitglied, jetztSek })) {
      if (k && (s === "dafuer" || s === "ausfuehren") && !behaeltArt(stand, k)) continue;
      aktionen.push({ wert: `${s}:${v.index}`, text: t((k !== undefined ? SCHRITT_AENDERUNG : SCHRITT)[s], { nr: String(v.index) }) });
    }
  }
  return aktionen;
}
