/**
 * RNode verbinden (B-32b1, RN-W6 A): Region wählen und bestätigen, dann über WebSerial verbinden. Die Werte sind die
 * Vorgabe der Region aus `FUNK_REGIONEN` oder eigene (B-32b4), die `pruefeFunkParameter()` besteht – nur innerhalb der
 * Grenzen der Region; gemerkt wird die bestätigte Wahl (`freedom.reticulum.funk`). Danach läuft
 * Reticulum über die RNode (B-32b2, `starteReticulum()`): Was an die eigene LXMF-Adresse kommt, geht wie Funk weiter
 * (`nimmFunkInhalt()`). Gesendet wird (B-32b3) nur an die gemerkte Gegenstelle (`freedom.reticulum.gegenstelle`, in
 * `geheim`) über `sendeUeberReticulum()` – aus `sendeUeberFunk()`, wenn kein Meshtastic-Gerät verbunden ist. Ein zweiter
 * Klick trennt. Im Adressen-Dialog gibt man die eigene Adresse auf Wunsch versiegelt an Kontakte (B-32c1, `funk-kontakte.ts`).
 */
import { t } from "../i18n.js";
import {
  FUNK_REGIONEN, LORA_BANDBREITEN, LS_RETICULUM_FUNK, funkWahlText, leseFunkEingabe, leseFunkWahl, maxSendeleistungDbm, pruefeFunkParameter,
  verbindeRNode, type FunkFall, type FunkParameter, type FunkRegion, type FunkWahl, type RNodePort,
} from "../rnode-funk.js";
import { LS_RETICULUM_GEGENSTELLE, leseLxmfAdresse, type ReticulumFunk } from "../reticulum-funk.js";
import { ReticulumFehler, type ReticulumFall } from "../reticulum-umschlag.js";
import type { MeshKind } from "@freedomstack/protocol";
import { dialog } from "./dialog.js";
import { geheim, tresorEingerichtet, tresorOffen } from "./tresor.js";
import { alsGeraet } from "./state.js";
import { toast } from "./ui.js";

let verbunden: ReticulumFunk | null = null;
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const mhz = (hz: number): string => (hz / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });

const FUNK_FALL_TEXT: Record<FunkFall, string> = {
  region: "set.rnodeGrenzeRegion", frequenz: "set.rnodeGrenzeFrequenz", bandbreite: "set.rnodeGrenzeBandbreite",
  spreizfaktor: "set.rnodeGrenzeSf", kodierrate: "set.rnodeGrenzeCr", leistung: "set.rnodeGrenzeLeistung", form: "set.rnodeGrenzeForm",
};

/** Warum eigene Werte nicht gehen – je Fall der Prüfung ein Text. */
export function funkFallText(fall: FunkFall): string {
  return t(FUNK_FALL_TEXT[fall]);
}

/** Eigene Werte (B-32b4) – vorbelegt mit `start`, angenommen nur, was `pruefeFunkParameter()` besteht. Abbrechen: null. */
async function eigeneFunkWerte(region: FunkRegion, start: FunkParameter): Promise<FunkParameter | null> {
  const wahl = (name: string, label: string, werte: readonly number[], text: (n: number) => string, wert: number) => ({
    art: "wahl" as const, name, label, wert: String(wert), optionen: werte.map((n) => ({ wert: String(n), text: text(n) })),
  });
  const w = await dialog({
    titel: t("set.rnodeEigeneTitel"),
    text: t("set.rnodeEigeneText", { von: mhz(region.von), bis: mhz(region.bis), max: maxSendeleistungDbm(region) }),
    felder: [
      { art: "text", name: "frequenz", label: t("set.rnodeFrequenz"), wert: String(start.frequency / 1e6), mono: true },
      wahl("bandbreite", t("set.rnodeBandbreite"), LORA_BANDBREITEN.filter((b) => b <= region.bis - region.von), (b) => `${b / 1000} kHz`, start.bandwidth),
      wahl("sf", t("set.rnodeSf"), [7, 8, 9, 10, 11, 12], (n) => `SF ${n}`, start.spreadingFactor),
      wahl("cr", t("set.rnodeCr"), [5, 6, 7, 8], (n) => `4/${n}`, start.codingRate),
      { art: "text", name: "leistung", label: t("set.rnodeLeistung", { max: maxSendeleistungDbm(region) }), wert: String(start.txPower), mono: true },
    ],
    pruefe: (w) => {
      const p = leseFunkEingabe(w);
      const r = p ? pruefeFunkParameter(region.kennung, p) : { ok: false as const, fall: "form" as const };
      return r.ok ? null : funkFallText(r.fall);
    },
    ok: t("set.rnodeBestaetigen"),
  });
  return w ? leseFunkEingabe(w) : null;
}

/** Die Region wählen und bestätigen – ihre Vorgabe oder eigene Werte innerhalb ihrer Grenzen. Abbrechen: null. */
export async function waehleFunkRegion(): Promise<FunkWahl | null> {
  const gemerkt = leseFunkWahl(localStorage.getItem(LS_RETICULUM_FUNK));
  const eigenGemerkt = !!gemerkt && FUNK_REGIONEN.some((r) => r.kennung === gemerkt.region
    && (Object.keys(r.vorgabe) as Array<keyof FunkParameter>).some((k) => r.vorgabe[k] !== gemerkt.parameter[k]));
  const w = await dialog({
    titel: t("set.rnodeTitel"),
    text: t("set.rnodeText"),
    felder: [{
      art: "wahl", name: "region", label: t("set.rnodeRegion"), wert: gemerkt?.region ?? FUNK_REGIONEN[0]!.kennung,
      optionen: FUNK_REGIONEN.map((r) => ({
        wert: r.kennung,
        text: t("set.rnodeRegionZeile", { von: mhz(r.von), bis: mhz(r.bis), mw: r.maxErpMw, prozent: r.maxSendezeitProzent }),
        hinweis: t("set.rnodeVorgabe", {
          f: mhz(r.vorgabe.frequency), bw: r.vorgabe.bandwidth / 1000, sf: r.vorgabe.spreadingFactor, dbm: r.vorgabe.txPower,
          max: maxSendeleistungDbm(r), quelle: t(r.quelle),
        }),
      })),
    }, {
      art: "wahl", name: "werte", label: t("set.rnodeWerte"), wert: eigenGemerkt ? "eigene" : "vorgabe",
      optionen: [{ wert: "vorgabe", text: t("set.rnodeWerteVorgabe") }, { wert: "eigene", text: t("set.rnodeWerteEigene") }],
    }],
    ok: t("set.rnodeBestaetigen"),
  });
  const region = FUNK_REGIONEN.find((r) => r.kennung === w?.region);
  if (!region) return null;
  let parameter: FunkParameter = { ...region.vorgabe };
  if (w?.werte === "eigene") {
    // Vorbelegt mit den gemerkten eigenen Werten derselben Region, sonst mit der Vorgabe
    const eigene = await eigeneFunkWerte(region, gemerkt?.region === region.kennung ? gemerkt.parameter : region.vorgabe);
    if (!eigene || !pruefeFunkParameter(region.kennung, eigene).ok) return null;
    parameter = eigene;
  }
  const wahl: FunkWahl = { region: region.kennung, parameter, bestaetigt: Math.floor(Date.now() / 1000) };
  localStorage.setItem(LS_RETICULUM_FUNK, funkWahlText(wahl));
  return wahl;
}

/** Der Knopf „RNode“ im Funk-Bereich: bestätigen, Port wählen, verbinden – oder trennen. */
export async function rnodeKnopf(status: HTMLElement | null): Promise<void> {
  if (verbunden) {
    const r = verbunden;
    verbunden = null;
    await r.stoppe().catch(() => undefined);
    if (status) status.textContent = t("set.rnodeGetrennt");
    return;
  }
  const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<RNodePort> } }).serial;
  if (!serial) return toast(t("set.keinGeraetezugriff"), true);
  // Die Identität liegt in `geheim` – ein gesperrter Tresor gäbe keine und nähme keine neue an
  if (tresorEingerichtet() && !tresorOffen()) return toast(t("ein.tresorGesperrt"), true);
  const wahl = await waehleFunkRegion();
  if (!wahl) return;
  try {
    const port = await serial.requestPort();
    const rnode = await verbindeRNode(port, wahl);
    try {
      const [{ reticulumIdentitaet }, { starteReticulum }, { nimmFunkInhalt }] = await Promise.all([
        import("../reticulum-umschlag.js"), import("../reticulum-funk.js"), import("./tabs/mesh.js"),
      ]);
      const funk = await starteReticulum({
        rnode, identitaet: await reticulumIdentitaet(geheim), parameter: wahl.parameter, beiEmpfang: nimmFunkInhalt,
      });
      verbunden = funk;
      const p = wahl.parameter;
      if (status) {
        status.textContent = t("set.rnodeVerbunden", {
          f: mhz(p.frequency), bw: p.bandwidth / 1000, sf: p.spreadingFactor, dbm: p.txPower,
          prozent: FUNK_REGIONEN.find((r) => r.kennung === wahl.region)!.maxSendezeitProzent, adresse: hex(funk.adresse),
        });
      }
    } catch (e) {
      await rnode.disconnect().catch(() => undefined);
      throw e;
    }
    toast(t("set.funkVerbunden"));
  } catch (e) {
    // Abgebrochene Portwahl (NotFoundError) ist kein Fehler; die Meldungen der Bibliothek zeigen wir nicht
    if ((e as { name?: string }).name === "NotFoundError") return;
    if (status) status.textContent = t("set.rnodeNicht");
  }
}

const FEHLER_TEXT: Record<ReticulumFall, string> = {
  "identitaet-kaputt": "set.rnodeFallIdentitaet", adresse: "set.rnodeFallAdresse", "zu-gross": "set.rnodeFallZuGross",
  inhalt: "set.rnodeFallInhalt", sendezeit: "set.rnodeFallSendezeit",
};

/** Warum Senden über Reticulum nicht ging – nur über die Kennung, nie die Meldung der Bibliothek. */
export function reticulumFehlerText(e: unknown): string {
  return e instanceof ReticulumFehler ? t(FEHLER_TEXT[e.fall]) : t("set.rnodeSendenNicht");
}

/**
 * Über Reticulum an die Gegenstelle senden (B-32b3) – nur mit laufender RNode und gemerkter Gegenstelle, sonst false
 * (dann nimmt der Aufrufer den Datei-Weg). Scheitert es, sagt ein Text warum, und es bleibt beim Datei-Weg.
 */
export async function sendeUeberReticulum(payload: Uint8Array, kind: MeshKind, eigeneSchluessel: readonly string[]): Promise<boolean> {
  const funk = verbunden;
  const an = leseLxmfAdresse(geheim.getItem(LS_RETICULUM_GEGENSTELLE));
  if (!funk || !an) return false;
  toast(t("set.rnodeSendet"));
  try {
    await funk.sende(an, payload, kind, eigeneSchluessel);
    return true;
  } catch (e) {
    toast(reticulumFehlerText(e), true);
    return false;
  }
}

/**
 * Die eigene Adresse (Text und QR-Code – sie ist nicht geheim, sie steht in jeder Antwort im Funk) und die Gegenstelle:
 * eintippen oder scannen, gemerkt nur in `geheim`. Leer heißt: keine Gegenstelle mehr.
 */
export async function adressenDialog(): Promise<void> {
  if (tresorEingerichtet() && !tresorOffen()) return toast(t("ein.tresorGesperrt"), true);
  const { reticulumIdentitaet, lxmfAdresse } = await import("../reticulum-umschlag.js");
  const eigene = hex(verbunden?.adresse ?? await lxmfAdresse(await reticulumIdentitaet(geheim)));
  const gemerkt = leseLxmfAdresse(geheim.getItem(LS_RETICULUM_GEGENSTELLE));
  const { funkAdressStand, funkTeilenAn, setzeFunkTeilen } = await import("./funk-kontakte.js");
  const stand = funkAdressStand();
  const w = await dialog({
    titel: t("set.rnodeAdressenTitel"),
    text: t("set.rnodeAdressenText"),
    felder: [
      { art: "qr", name: "qr", label: t("set.rnodeEigeneQr"), wert: eigene },
      { art: "nurlesen", name: "eigene", label: t("set.rnodeEigene"), wert: eigene },
      { art: "text", name: "gegenstelle", label: t("set.rnodeGegenstelle"), wert: gemerkt ? hex(gemerkt) : "", mono: true, scannen: true },
      // B-32c1 (W2 A): nur als Person – Kontakte kennen den Geräteschlüssel nicht
      ...(alsGeraet() ? [] : [
        { art: "mehrfach" as const, name: "teilen", label: t("set.rnodeTeilen"), werte: funkTeilenAn() ? ["ja"] : [],
          optionen: [{ wert: "ja", text: t("set.rnodeTeilenJa"), hinweis: t("set.rnodeTeilenHinweis") }] },
        { art: "nurlesen" as const, name: "stand", label: t("set.rnodeKontakteStand"), wert: t("set.rnodeKontakteZahl", stand) },
      ]),
    ],
    pruefe: (w) => {
      const roh = String(w.gegenstelle ?? "").trim();
      if (!roh) return null;
      const a = leseLxmfAdresse(roh);
      return !a ? t("set.rnodeKeineAdresse") : hex(a) === eigene ? t("set.rnodeEigeneGegenstelle") : null;
    },
    ok: t("set.rnodeGegenstelleMerken"),
  });
  if (!w) return;
  if (!alsGeraet()) await setzeFunkTeilen(Array.isArray(w.teilen) && w.teilen.includes("ja"));
  const neu = leseLxmfAdresse(String(w.gegenstelle ?? ""));
  if (neu) await geheim.setItem(LS_RETICULUM_GEGENSTELLE, hex(neu));
  else await geheim.removeItem(LS_RETICULUM_GEGENSTELLE);
  toast(t(neu ? "set.rnodeGegenstelleGemerkt" : "set.rnodeGegenstelleWeg"));
}
