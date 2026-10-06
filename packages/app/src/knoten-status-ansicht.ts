/**
 * Status meines Knotens in der App (Sammlung B-11b, Entscheidung L6 A – nur
 * lesen): was die Antwort des Knotens (`leseKnotenStatus()`) in der Karte
 * „Mein Knoten“ heißt – je Zeile ein fertiger Text, ohne DOM. Rollen kommen
 * als feste Kennungen und werden hier übersetzt; Modellnamen bleiben, wie sie
 * sind, und landen nur als Text im DOM.
 */
import type { KnotenStatus, MarktKurs, StatusBefund, StatusRolle } from "@freedomstack/protocol";
import { gebietsschema, t } from "./i18n.js";
import { ausMsat, solText } from "./preis-anzeige.js";

/** So lange wartet die App auf die Antwort – der Knoten antwortet im nächsten Abruf. */
export const STATUS_ZEIT_MS = 45_000;
/** So oft sieht sie nach, nur während des Wartens. */
export const STATUS_TAKT_MS = 2_000;

/** Textschlüssel je Rolle – feste Kennungen, nie Text vom Knoten. */
export const ROLLEN_TEXT: Record<StatusRolle, string> = {
  ki: "set.rolleKi", relay: "set.rolleRelay", speicher: "set.rolleSpeicher", gateway: "set.rolleGateway", zahlkanal: "set.rolleZahlkanal",
  lnurl: "set.rolleLnurl", lp: "set.rolleLp", relayer: "set.rolleRelayer", tor: "set.rolleTor", app: "set.rolleApp", turn: "set.rolleTurn",
};

/**
 * Textschlüssel je Befund der Selbstprüfung (B-11c) – Kennungen aus
 * `node/src/einrichtung.ts`; ein Test hält beide Listen gleich. Unbekannte
 * (neuerer Knoten) zeigen nur Kennung und Stufe.
 */
export const EINRICHTUNG_TEXT: Record<string, string> = {
  "ln.fehlt": "set.einLnFehlt",
  "ln.keineAdresse": "set.einLnKeineAdresse",
  "ln.http": "set.einLnHttp",
  "ln.cors": "set.einLnCors",
  "ln.unerreichbar": "set.einLnUnerreichbar",
  "ln.keinPay": "set.einLnKeinPay",
  "ln.betraege": "set.einLnBetraege",
  "ln.mindestens": "set.einLnMindestens",
  "ln.nimmtNicht": "set.einLnNimmtNicht",
  "ln.keineRechnung": "set.einLnKeineRechnung",
  "ln.andererBetrag": "set.einLnAndererBetrag",
  "ln.ungueltig": "set.einLnUngueltig",
  "ln.ok": "set.einLnOk",
  "sol.kanalAus": "set.einSolKanalAus",
  "sol.kanalAdresseFehlt": "set.einSolKanalAdresseFehlt",
  "sol.kanalSchluesselUnlesbar": "set.einSolKanalSchluesselUnlesbar",
  "sol.kanalSchluesselPasstNicht": "set.einSolKanalSchluesselPasstNicht",
  "sol.kanalAn": "set.einSolKanalAn",
  "sol.programmFehlt": "set.einSolProgrammFehlt",
  "sol.wenigGuthaben": "set.einSolWenigGuthaben",
  "sol.guthaben": "set.einSolGuthaben",
  "sol.ketteUnerreichbar": "set.einSolKetteUnerreichbar",
  "sol.auszahlungProgramm": "set.einSolAuszahlungProgramm",
  "sol.auszahlung": "set.einSolAuszahlung",
  "sol.auszahlungAus": "set.einSolAuszahlungAus",
  "sol.auszahlungTeilt": "set.einSolAuszahlungTeilt",
  "sol.auszahlungUngueltig": "set.einSolAuszahlungUngueltig",
};

const ZEICHEN: Record<StatusBefund["stufe"], string> = { ok: "✓", hinweis: "!", fehler: "✗" }; // kein UI-Text

/** Werte eines Befunds für den Text: Lamports als SOL, Zahlen im Gebietsschema, Fehlernamen wie sie sind. */
function befundWerte(b: StatusBefund): Record<string, string> {
  const aus: Record<string, string> = { fall: b.fall };
  for (const [k, w] of Object.entries(b.werte)) aus[k] = typeof w === "number" ? (/lamports$/i.test(k) ? solText(w) : zahl(w)) : w;
  return aus;
}

/** Eine Zeile je Befund: Zeichen der Stufe, Schiene, Text aus der Kennung. */
export function befundZeile(b: StatusBefund): string {
  const text = EINRICHTUNG_TEXT[b.fall] ? t(EINRICHTUNG_TEXT[b.fall]!, befundWerte(b)) : t("set.einUnbekannt", { fall: b.fall });
  return `${ZEICHEN[b.stufe]} ${t(b.schiene === "lightning" ? "set.schieneLightning" : "set.schieneSol")}: ${text}`;
}

const zahl = (n: number): string => n.toLocaleString(gebietsschema());
/** Bytes als MB-Zahl – die Einheit steht im Text. */
const mb = (n: number): string => (n / 1024 ** 2).toLocaleString(gebietsschema(), { maximumFractionDigits: 1 });

/** Die Zeilen der Anzeige – in der Sprache der App, Beträge in sats und SOL (`ausMsat()`). */
export function statusZeilen(s: KnotenStatus, kurs?: Pick<MarktKurs, "satsProSol">): string[] {
  const seit = new Date(s.seit * 1000).toLocaleString(gebietsschema(), { dateStyle: "medium", timeStyle: "short" });
  const zeilen = [
    t("set.statusFassung", { fassung: s.fassung, seit }),
    t("set.statusRollen", { rollen: s.rollen.length > 0 ? s.rollen.map((r) => t(ROLLEN_TEXT[r])).join(", ") : t("set.statusKeine") }),
    t("set.statusModelle", { modelle: s.modelle.length > 0 ? s.modelle.join(", ") : t("set.statusKeine") }),
    t("set.statusAuftraege", { erledigt: zahl(s.auftraege.erledigt), gratis: zahl(s.auftraege.gratis), abgelehnt: zahl(s.auftraege.abgelehnt) }),
    t("set.statusAbgerechnet", { betrag: ausMsat(s.abgerechnetMsat, kurs) }),
  ];
  if (s.speicher) {
    zeilen.push(s.speicher.quotaBytes > 0
      ? t("set.statusSpeicher", { belegt: mb(s.speicher.belegtBytes), quota: mb(s.speicher.quotaBytes), gehalten: zahl(s.speicher.gehalten) })
      : t("set.statusSpeicherOhne", { belegt: mb(s.speicher.belegtBytes), gehalten: zahl(s.speicher.gehalten) }));
  }
  if (s.relay) zeilen.push(t("set.statusRelay", { events: zahl(s.relay.events), verbindungen: zahl(s.relay.verbindungen) }));
  // Selbstprüfung (B-11c): fehlt sie, sagt die Anzeige das – nie „alles gut“ erfinden
  if (s.einrichtung) zeilen.push(t("set.statusEinrichtung"), ...s.einrichtung.map(befundZeile));
  else zeilen.push(t("set.statusEinrichtungFehlt"));
  return zeilen;
}
