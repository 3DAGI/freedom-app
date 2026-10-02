/**
 * Haken „Wecken“ in „Mein Knoten“ (Sammlung B-12d2, Entscheidungen W1 A,
 * W2 A, W3 A). Nur auf Klick, nie beim Start:
 *
 * an:  Status des Knotens (sein VAPID-Schlüssel) → Erlaubnis für Meldungen →
 *      Weck-Worker anmelden (`freedom-sw.js?sprache=…`) → Push abonnieren →
 *      die Push-Adresse versiegelt mit Nachweis beim Knoten anmelden (5078),
 *      über den Weg aus B-9c2. Bestätigt der Knoten nicht, wird alles lokal
 *      wieder abgemeldet – nichts bleibt halb an.
 * aus: beim Knoten abmelden (soweit er antwortet), dann Abo und Worker weg
 *      (`weckerAbmelden()`, dieselbe Funktion wie die Notfall-Löschung).
 *
 * Der Haken zeigt, ob es ein Abo gibt – gemerkt wird nichts. Die Push-Adresse
 * ist ein Zugang zu diesem Browser: Sie geht nur im versiegelten Kern hinaus.
 */
import {
  KIND_DVM_WECKEN, LocalSigner, baueWeckAnmeldung, generateKeypair, leseWeckAntwort, pruefeWeckEndpunkt,
  type Kopplung, type WeckAnmeldung,
} from "@freedomstack/protocol";
import { getLang, t } from "../i18n.js";
import { ablehnungsGrund } from "../knoten-halten.js";
import { STATUS_TAKT_MS, STATUS_ZEIT_MS } from "../knoten-status-ansicht.js";
import { fehlerText } from "../protokoll-texte.js";
import { weckSchluesselBytes, weckSchluesselFuer, weckWorkerAdresse, weckenMoeglich } from "../wecken-app.js";
import { weckerAbmelden } from "../wecker-abmelden.js";
import { frageKnotenStatus, powFuerKnoten } from "./knoten-status-ui.js";
import { warteAufKnoten, wegZumKnoten } from "./knoten-weg-ui.js";
import { meineKopplung } from "./mein-knoten.js";
import { sprichtFuer, state } from "./state.js";
import { el } from "./ui.js";

/** Das Abo dieses Browsers, wenn es eines gibt – nur gelesen, nichts angemeldet. */
async function aktivesAbo(): Promise<PushSubscription | null> {
  if (!weckenMoeglich(globalThis)) return null;
  const r = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  return (await r?.pushManager.getSubscription().catch(() => null)) ?? null;
}

/** An- oder Abmeldung an meinen Knoten schicken und auf seine Antwort warten. */
async function anKnoten(k: Kopplung, anmeldung: WeckAnmeldung): Promise<{ schluessel: number } | { grund: string }> {
  const powBits = await powFuerKnoten(k.knoten);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const weg = await wegZumKnoten(k.knoten, sitzung);
  if (!weg) return { grund: t("set.knotenOhneRelay") };
  try {
    const { wrap, requestId } = await baueWeckAnmeldung({ sitzung, kopplung: k, anmeldung, powBits });
    await weg.publish(wrap);
    const antwort = await warteAufKnoten(weg, sitzung, requestId, KIND_DVM_WECKEN + 1000, STATUS_ZEIT_MS, STATUS_TAKT_MS);
    if (!antwort) return { grund: t("set.statusSchweigt") };
    if ("abgelehnt" in antwort) return { grund: t("set.statusAbgelehnt", { grund: ablehnungsGrund(antwort.abgelehnt) }) };
    const a = leseWeckAntwort(antwort.ergebnis);
    return a && a.aktion === anmeldung.aktion ? { schluessel: a.schluessel } : { grund: t("set.statusUnlesbar") };
  } finally {
    weg.schliesse();
  }
}

/** Wecken einschalten – zurück ein Satz für die Anzeige; bei Misserfolg ist danach nichts angemeldet. */
async function schalteAn(k: Kopplung): Promise<{ an: boolean; text: string }> {
  const ich = sprichtFuer() ?? state.keypair?.pk;
  if (!ich) return { an: false, text: t("set.keineIdentitaet") };
  const status = await frageKnotenStatus(k);
  if ("grund" in status) return { an: false, text: status.grund };
  const vapid = weckSchluesselBytes(status.status.weckSchluessel);
  if (!vapid) return { an: false, text: t("set.weckenKnotenNicht") };
  if (await Notification.requestPermission() !== "granted") return { an: false, text: t("set.weckenKeineErlaubnis") };
  let registrierung: ServiceWorkerRegistration;
  try {
    registrierung = await navigator.serviceWorker.register(weckWorkerAdresse(getLang()));
    await navigator.serviceWorker.ready;
  } catch {
    // Etwa die App vom eigenen Knoten (B-10): dort liegt nur freedom.html, kein Worker
    return { an: false, text: t("set.weckenKeinWorker") };
  }
  try {
    const abo = await registrierung.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid });
    const endpunkt = pruefeWeckEndpunkt(abo.endpoint);
    if (!endpunkt) {
      await weckerAbmelden();
      return { an: false, text: t("set.weckenEndpunkt") };
    }
    const geraete = await (await import("./tabs/kommunikation.js")).geraeteBuch.alle(ich).catch(() => []);
    const r = await anKnoten(k, { aktion: "an", endpunkt, schluessel: weckSchluesselFuer(ich, geraete) });
    if ("grund" in r) {
      await weckerAbmelden();
      return { an: false, text: r.grund };
    }
    return { an: true, text: t("set.weckenAn", { n: r.schluessel }) };
  } catch (e) {
    await weckerAbmelden();
    return { an: false, text: t("set.statusFehler", { fehler: fehlerText(e) }) };
  }
}

/** Wecken ausschalten: beim Knoten abmelden, soweit er antwortet – lokal in jedem Fall. */
async function schalteAus(k: Kopplung | null): Promise<string> {
  const abo = await aktivesAbo();
  const endpunkt = abo ? pruefeWeckEndpunkt(abo.endpoint) : null;
  const r = k && endpunkt ? await anKnoten(k, { aktion: "ab", endpunkt, schluessel: [] }).catch((e: unknown) => ({ grund: fehlerText(e) })) : null;
  const offen = await weckerAbmelden();
  if (offen.length > 0) return t("set.weckenRest", { offen: offen.join(", ") });
  // Ohne Antwort des Knotens: Er vergisst die Adresse beim nächsten Wecken (410 vom Push-Dienst)
  return r && "grund" in r ? t("set.weckenAusOhneKnoten") : t("set.weckenAus");
}

/** Haken in der Karte „Mein Knoten“ (einmal beim Start) – zeigt nur, ob es ein Abo gibt. */
export function wireWecken(): void {
  const haken = document.getElementById("knoten-wecken") as HTMLInputElement | null;
  const anzeige = document.getElementById("knoten-status-anzeige");
  if (!haken || !anzeige) return;
  const zeige = (text: string) => anzeige.replaceChildren(el("div", text));
  void aktivesAbo().then((abo) => { haken.checked = abo !== null; });
  haken.addEventListener("change", () => void (async () => {
    const an = haken.checked;
    haken.disabled = true;
    try {
      if (!an) return zeige(await schalteAus(meineKopplung()));
      const k = meineKopplung();
      if (!k) { haken.checked = false; return; }
      if (!weckenMoeglich(globalThis)) { haken.checked = false; return zeige(t("set.weckenNichtHier")); }
      zeige(t("set.weckenFragt"));
      const r = await schalteAn(k);
      haken.checked = r.an;
      zeige(r.text);
    } catch (e) {
      haken.checked = (await aktivesAbo()) !== null;
      zeige(t("set.statusFehler", { fehler: fehlerText(e) }));
    } finally {
      haken.disabled = false;
    }
  })());
}
