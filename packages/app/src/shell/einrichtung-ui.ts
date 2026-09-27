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
import { escapeHtml, pkShort } from "../shell-logic.js";
import { LS_STANDARD_SCHIENE, standardSchiene } from "../standard-schiene.js";
import { mitBunker, state } from "./state.js";
import { richteTresorEin, tresorEingerichtet } from "./tresor.js";
import { ganzeZahl } from "./ui.js";

let laeuft = false;

/** Seite fuer Seite; „ueberspringen“ beendet die Einrichtung, die Onboarding-Leiste fuehrt weiter. */
export async function zeigeEinrichtung(p: {
  /** Merkphrase zeigen und abfragen – nur fuer eine neue Identitaet. */
  sichern?: () => Promise<void>;
  /** Nach der letzten Seite in diesen Reiter. */
  oeffne: (tab: string) => void;
  /** Werbebeziehung veroeffentlichen – nur nach Zustimmung. */
  nenneWerber: () => void;
}): Promise<void> {
  if (laeuft) return;
  laeuft = true;
  try {
    const seiten = einrichtungsSeiten({ merkphraseOffen: !!p.sichern, tresorDa: tresorEingerichtet(), mitBunker: mitBunker() });
    if (p.sichern) await p.sichern();
    // Gesehen – wer „spaeter“ waehlte und neu laedt, bekommt sie nicht gleich wieder
    localStorage.setItem(LS_EINRICHTUNG, "laeuft");
    const box = document.createElement("div");
    box.className = "onboarding-overlay";
    box.id = "einrichtung";
    document.body.appendChild(box);
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

const KNOPF = 'class="ghost" style="width:auto;padding:8px 14px;margin:4px 6px 0 0"';

function zeigeSeite(
  box: HTMLElement, seite: Seite, nr: number, von: number,
  p: { oeffne: (tab: string) => void; nenneWerber: () => void },
): Promise<"weiter" | "abbrechen"> {
  box.innerHTML = `<div class="onboarding-card" data-seite="${escapeHtml(seite)}">${inhalt(seite)}` +
    `<p class="mono-sm muted" style="margin-top:14px">${escapeHtml(t("ein.schrittVon", { nr: ganzeZahl(nr), von: ganzeZahl(von) }))} · ` +
    `<button id="ein-abbrechen" class="ghost" style="width:auto;padding:2px 8px;font-size:10px">${escapeHtml(t("ein.ueberspringen"))}</button></p></div>`;
  return new Promise((fertig) => {
    const knopf = (id: string, fn: () => unknown) => box.querySelector(`#${id}`)?.addEventListener("click", () => {
      void Promise.resolve(fn()).then(() => fertig("weiter"));
    });
    box.querySelector("#ein-abbrechen")?.addEventListener("click", () => fertig("abbrechen"));
    knopf("ein-weiter", () => (seite === "privat" ? uebernehmePrivat(p.nenneWerber) : undefined));
    knopf("ein-tresor", () => richteTresorEin());
    for (const s of ["lightning", "solana"] as const) knopf(`ein-${s}`, () => setzeSchiene(s));
    for (const i of ["nutzen", "kommunizieren", "verdienen"] as const) {
      knopf(`ein-${i}`, () => {
        localStorage.setItem(LS_INTENT, i);
        p.oeffne(zielNachEinrichtung(i as Intent));
      });
    }
  });
}

function inhalt(seite: Seite): string {
  switch (seite) {
    case "schutz":
      return `<h2>${escapeHtml(t("ein.schutz"))}</h2>
        <p class="mono-sm">${escapeHtml(t("ein.schutzText"))}</p>
        <button id="ein-tresor" class="cta" style="width:auto;padding:8px 18px">${escapeHtml(t("ein.passFestlegen"))}</button>
        <button id="ein-weiter" ${KNOPF}>${escapeHtml(t("ein.spaeter"))}</button>`;
    case "zahlen": {
      const jetzt = standardSchiene();
      return `<h2>${escapeHtml(t("ein.womitZahlen"))}</h2>
        <p class="mono-sm">${escapeHtml(t("ein.womitZahlenText"))}</p>
        <button id="ein-lightning" ${KNOPF}>${jetzt === "lightning" ? "✓ " : ""}${escapeHtml(t("zahl.optLightning"))}</button>
        <button id="ein-solana" ${KNOPF}>${jetzt === "solana" ? "✓ " : ""}${escapeHtml(t("zahl.optSolana"))}</button>`;
    }
    case "privat": {
      const { belegt, offen } = datenschutzKurz();
      const werber = localStorage.getItem("freedom.referrer");
      const mitWerber = !!werber && /^[0-9a-f]{64}$/.test(werber) && werber !== state.keypair?.pk;
      return `<h2>${escapeHtml(t("ein.privat"))}</h2>
        <p class="mono-sm">${belegt.map((a) => `✓ ${escapeHtml(a)}`).join("<br>")}${offen.map((a) => `<br>○ ${escapeHtml(t("ein.nochNicht", { was: a }))}`).join("")}</p>
        <label class="mono-sm" style="display:block;margin:8px 0">${escapeHtml(t("ein.verbindung"))}
          <select id="ein-netz" class="mono-sm">
            <option value="klar">${escapeHtml(t("set.netzKlar"))}</option>
            <option value="tor">${escapeHtml(t("set.netzTor"))}</option>
            <option value="mixnet">${escapeHtml(t("set.netzMixnet"))}</option>
          </select></label>
        <label class="mono-sm" style="display:block;margin:8px 0">
          <input type="checkbox" id="ein-kontakte" /> ${escapeHtml(t("ein.kontakteAbgleichen"))}</label>
        ${mitWerber ? `<label class="mono-sm" style="display:block;margin:8px 0">
          <input type="checkbox" id="ein-werber" /> ${escapeHtml(t("ein.werberNennen", { wer: pkShort(werber!) }))}</label>
          <p class="mono-sm muted">${escapeHtml(t("ein.werberText"))}</p>` : ""}
        <p class="mono-sm muted">${escapeHtml(t("ein.spaeterSettings"))}</p>
        <button id="ein-weiter" class="cta" style="width:auto;padding:8px 18px">${escapeHtml(t("ein.weiter"))}</button>`;
    }
    case "los":
      return `<h2>${escapeHtml(t("ein.womitAnfangen"))}</h2>
        <p class="mono-sm">${escapeHtml(t("ein.leisteDanach"))}</p>
        <button id="ein-nutzen" ${KNOPF}>${escapeHtml(t("ein.kiFragen"))}</button>
        <button id="ein-kommunizieren" ${KNOPF}>${escapeHtml(t("ein.nachrichtenSchreiben"))}</button>
        <button id="ein-verdienen" ${KNOPF}>${escapeHtml(t("ein.vermietenTitel"))}</button>`;
    default:
      return "";
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
