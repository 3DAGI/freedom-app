/**
 * Einrichtung beim ersten Start (Schritt 8.1b): Merkphrase, Schutz,
 * Standard-Schiene, private Voreinstellungen, Vorhaben. Logik ohne DOM in
 * `einrichtung.ts`; die Einstellungen setzt sie ueber dieselben Bedienelemente
 * wie die Settings, damit beide dasselbe tun.
 */
import {
  LS_EINRICHTUNG, LS_INTENT, LS_WERBER_ZUSTIMMUNG, datenschutzKurz, einrichtungsSeiten, zielNachEinrichtung,
  type Seite,
} from "../einrichtung.js";
import { t } from "../i18n.js";
import type { Intent } from "../onboarding.js";
import { pkShort } from "../shell-logic.js";
import { LS_STANDARD_SCHIENE, standardSchiene } from "../standard-schiene.js";
import { mitBunker, state } from "./state.js";
import { richteTresorEin, tresorEingerichtet } from "./tresor.js";
import { alsModal, beschrifte } from "./dialog.js";
import { el } from "./ui.js";

let laeuft = false;

/** Läuft die Einrichtung gerade? Dann bleibt die Onboarding-Leiste weg (C-39, E-1). */
export const einrichtungLaeuft = (): boolean => laeuft;

/** Seite fuer Seite; „ueberspringen“ beendet die Einrichtung, die Onboarding-Leiste fuehrt weiter. */
export async function zeigeEinrichtung(p: {
  /** Merkphrase zeigen und abfragen – nur fuer eine neue Identitaet. */
  sichern?: () => Promise<void>;
  /** „Ich habe schon eine Identität“ (C-55a): übernehmen statt der neuen – `true`, wenn übernommen. */
  importieren?: () => Promise<boolean>;
  /** Nach der letzten Seite in diesen Reiter. */
  oeffne: (tab: string) => void;
  /** Werbebeziehung veroeffentlichen – nur nach Zustimmung. */
  nenneWerber: () => void;
}): Promise<void> {
  if (laeuft) return;
  laeuft = true;
  document.getElementById("onboarding-bar")?.classList.add("hidden");
  try {
    // Begrüßung (C-55a): erst sagen, was das ist – dann die Merkphrase, oder eine vorhandene Identität übernehmen
    const weg = p.sichern ? await zeigeWillkommen(p.importieren) : "los";
    const seiten = einrichtungsSeiten({ merkphraseOffen: !!p.sichern && weg === "los", tresorDa: tresorEingerichtet(), mitBunker: mitBunker() });
    if (p.sichern && weg === "los") await p.sichern();
    // Gesehen – wer „spaeter“ waehlte und neu laedt, bekommt sie nicht gleich wieder
    localStorage.setItem(LS_EINRICHTUNG, "laeuft");
    const box = document.createElement("div");
    box.className = "onboarding-overlay";
    box.id = "einrichtung";
    document.body.appendChild(box);
    // Ein Dialog für Vorleser und Tastatur, die App dahinter nicht bedienbar (C-39b, Nutzertest E-4, E-5)
    alsModal(box, box);
    const rest = seiten.filter((s) => s !== "sichern");
    for (const [i, seite] of rest.entries()) {
      if ((await zeigeSeite(box, seite, seiten.length - rest.length + i + 1, seiten.length, p)) === "abbrechen") break;
    }
    box.remove();
    localStorage.setItem(LS_EINRICHTUNG, "fertig");
  } finally {
    laeuft = false;
  }
}

/**
 * Begrüßung (C-55a, Oberflächen-Review 15.10.2026): drei Sätze, „Loslegen“ und „Ich habe schon eine Identität“.
 * Bis jetzt war der erste Bildschirm die Merkphrase – ehe man wusste, wozu.
 */
function zeigeWillkommen(importieren?: () => Promise<boolean>): Promise<"los" | "importiert"> {
  const box = el("div", undefined, "onboarding-overlay");
  box.id = "willkommen";
  const karte = el("div", undefined, "onboarding-card willkommen-karte");
  const saetze = el("ul", undefined, "willkommen-saetze");
  saetze.append(...["ein.willkommen1", "ein.willkommen2", "ein.willkommen3"].map((k) => el("li", t(k))));
  const los = knopf("ein-loslegen", t("ein.loslegen"), true);
  const habe = knopf("ein-habe-schon", t("ein.habeSchon"));
  karte.append(el("h2", t("ein.willkommenTitel")), saetze, knoepfe(los, ...(importieren ? [habe] : [])));
  box.append(karte);
  document.body.appendChild(box);
  alsModal(box, karte);
  return new Promise((fertig) => {
    los.addEventListener("click", () => { box.remove(); fertig("los"); });
    habe.addEventListener("click", () => {
      // Abgebrochen oder ungültig: die Begrüßung bleibt
      void importieren?.().then((ok) => { if (ok) { box.remove(); fertig("importiert"); } });
    });
  });
}

// Über `style` (CSSOM) statt HTML-Text (seit C-6e); die Knöpfe seit C-39b über `.ein-knoepfe`
const ZEILE_STIL = "display:block;margin:8px 0"; // kein UI-Text

function knopf(id: string, text: string, haupt = false): HTMLButtonElement {
  const b = el("button", text, haupt ? "cta" : "ghost");
  b.id = id;
  b.type = "button";
  return b;
}

/** Die Knöpfe einer Seite untereinander, gleich breit, mit Abstand (C-39b, Nutzertest E-2, E-3). */
function knoepfe(...k: HTMLButtonElement[]): HTMLElement {
  const zeile = el("div", undefined, "ein-knoepfe");
  zeile.append(...k);
  return zeile;
}

/** Häkchen mit Text – nie vorausgewählt (Zustimmung heißt: selbst gesetzt). */
function kasten(id: string, text: string): HTMLLabelElement {
  const k = el("input");
  k.type = "checkbox";
  k.id = id;
  const l = el("label", undefined, "mono-sm");
  l.style.cssText = ZEILE_STIL;
  l.append(k, ` ${text}`);
  return l;
}

function leise(text: string): HTMLElement {
  const p = el("p", text, "mono-sm");
  p.classList.add("muted");
  return p;
}

function zeigeSeite(
  box: HTMLElement, seite: Seite, nr: number, von: number,
  p: { oeffne: (tab: string) => void; nenneWerber: () => void },
): Promise<"weiter" | "abbrechen"> {
  const karte = el("div", undefined, "onboarding-card");
  karte.dataset.seite = seite;
  const ueberspringen = el("button", t("ein.ueberspringen"), "ghost");
  ueberspringen.id = "ein-abbrechen";
  ueberspringen.style.cssText = "width:auto;padding:2px 8px;font-size:12px"; // kein UI-Text
  const fuss = leise(`${t("ein.schrittVon", { nr, von })} · `);
  fuss.style.marginTop = "14px";
  fuss.append(ueberspringen);
  karte.append(...inhalt(seite), fuss);
  box.replaceChildren(karte);
  beschrifte(box);
  karte.querySelector<HTMLElement>("button, select, input")?.focus();
  return new Promise((fertig) => {
    const beiKlick = (id: string, fn: () => unknown) => box.querySelector(`#${id}`)?.addEventListener("click", () => {
      void Promise.resolve(fn()).then(() => fertig("weiter"));
    });
    box.querySelector("#ein-abbrechen")?.addEventListener("click", () => fertig("abbrechen"));
    beiKlick("ein-weiter", () => (seite === "privat" ? uebernehmePrivat(p.nenneWerber) : undefined));
    beiKlick("ein-tresor", () => richteTresorEin());
    for (const s of ["lightning", "solana"] as const) beiKlick(`ein-${s}`, () => setzeSchiene(s));
    for (const i of ["nutzen", "kommunizieren", "verdienen"] as const) {
      beiKlick(`ein-${i}`, () => {
        localStorage.setItem(LS_INTENT, i);
        p.oeffne(zielNachEinrichtung(i as Intent));
      });
    }
  });
}

function inhalt(seite: Seite): HTMLElement[] {
  switch (seite) {
    case "schutz":
      return [el("h2", t("ein.schutz")), el("p", t("ein.schutzText"), "mono-sm"),
        knoepfe(knopf("ein-tresor", t("ein.passFestlegen"), true), knopf("ein-weiter", t("ein.spaeter")))];
    case "zahlen": {
      const jetzt = standardSchiene();
      return [el("h2", t("ein.womitZahlen")), el("p", t("ein.womitZahlenText"), "mono-sm"),
        knoepfe(knopf("ein-lightning", `${jetzt === "lightning" ? "✓ " : ""}${t("zahl.optLightning")}`),
          knopf("ein-solana", `${jetzt === "solana" ? "✓ " : ""}${t("zahl.optSolana")}`))];
    }
    case "privat": {
      const { belegt, offen } = datenschutzKurz();
      const werber = localStorage.getItem("freedom.referrer");
      const mitWerber = !!werber && /^[0-9a-f]{64}$/.test(werber) && werber !== state.keypair?.pk;
      const stand = el("p", undefined, "mono-sm");
      [...belegt.map((a) => `✓ ${a}`), ...offen.map((a) => `○ ${t("ein.nochNicht", { was: a })}`)]
        .forEach((zeile, i) => stand.append(...(i ? [el("br")] : []), zeile));
      const netz = el("select", undefined, "mono-sm");
      netz.id = "ein-netz";
      netz.append(new Option(t("set.netzKlar"), "klar"), new Option(t("set.netzTor"), "tor"), new Option(t("set.netzMixnet"), "mixnet"));
      const verbindung = el("label", undefined, "mono-sm");
      verbindung.style.cssText = ZEILE_STIL;
      verbindung.append(`${t("ein.verbindung")} `, netz);
      return [el("h2", t("ein.privat")), stand, verbindung, kasten("ein-kontakte", t("ein.kontakteAbgleichen")),
        ...(mitWerber ? [kasten("ein-werber", t("ein.werberNennen", { wer: pkShort(werber!) })), leise(t("ein.werberText"))] : []),
        leise(t("ein.spaeterSettings")), knoepfe(knopf("ein-weiter", t("ein.weiter"), true))];
    }
    case "los":
      return [el("h2", t("ein.womitAnfangen")), el("p", t("ein.leisteDanach"), "mono-sm"),
        knoepfe(knopf("ein-nutzen", t("ein.kiFragen")), knopf("ein-kommunizieren", t("ein.nachrichtenSchreiben")),
          knopf("ein-verdienen", t("ein.vermietenTitel")))];
    default:
      return [];
  }
}

/** Standard-Schiene wie in den Settings setzen – dort steht dieselbe Auswahl. */
function setzeSchiene(s: "lightning" | "solana"): void {
  localStorage.setItem(LS_STANDARD_SCHIENE, s);
  const sel = document.getElementById("standard-schiene") as HTMLSelectElement | null;
  if (sel) sel.value = s;
}

/** Ueber die Bedienelemente der Settings – deren Handler tun dasselbe wie dort (Relays sortieren, Liste sichern). */
function uebernehmePrivat(nenneWerber: () => void): void {
  const netz = (document.getElementById("ein-netz") as HTMLSelectElement | null)?.value ?? "klar";
  const netzSel = document.getElementById("net-mode") as HTMLSelectElement | null;
  if (netzSel && netzSel.value !== netz) {
    netzSel.value = netz;
    netzSel.dispatchEvent(new Event("change"));
  } else if (!netzSel) {
    localStorage.setItem("freedom.network", netz);
  }
  const kontakte = document.getElementById("ein-kontakte") as HTMLInputElement | null;
  const kontakteSel = document.getElementById("kontakte-sichern") as HTMLInputElement | null;
  if (kontakte?.checked && kontakteSel && !kontakteSel.checked) {
    kontakteSel.checked = true;
    kontakteSel.dispatchEvent(new Event("change"));
  }
  const werber = document.getElementById("ein-werber") as HTMLInputElement | null;
  if (werber) {
    localStorage.setItem(LS_WERBER_ZUSTIMMUNG, werber.checked ? "1" : "0");
    if (werber.checked) nenneWerber();
  }
}
