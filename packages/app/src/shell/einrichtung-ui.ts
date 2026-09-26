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
    `<p class="mono-sm muted" style="margin-top:14px">Schritt ${ganzeZahl(nr)} von ${ganzeZahl(von)} · ` +
    `<button id="ein-abbrechen" class="ghost" style="width:auto;padding:2px 8px;font-size:10px">Einrichtung überspringen</button></p></div>`;
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
      return `<h2>Schutz</h2>
        <p class="mono-sm">Eine Passphrase verschlüsselt deinen Schlüssel, Wallet-Zugänge und Unterhaltungen
        auf diesem Gerät; beim Start fragt die App danach. Vergisst du sie, hilft nur die Merkphrase.</p>
        <button id="ein-tresor" class="cta" style="width:auto;padding:8px 18px">Passphrase festlegen</button>
        <button id="ein-weiter" ${KNOPF}>später</button>`;
    case "zahlen": {
      const jetzt = standardSchiene();
      return `<h2>Womit zahlst du?</h2>
        <p class="mono-sm">Vorgabe für Trinkgeld und Zaps – bei jeder Zahlung änderbar. Die App zahlt nie still
        in der anderen Währung. Eine Wallet brauchst du erst, wenn du bezahlst.</p>
        <button id="ein-lightning" ${KNOPF}>${jetzt === "lightning" ? "✓ " : ""}sats (Lightning)</button>
        <button id="ein-solana" ${KNOPF}>${jetzt === "solana" ? "✓ " : ""}SOL (Solana)</button>`;
    }
    case "privat": {
      const { belegt, offen } = datenschutzKurz();
      const werber = localStorage.getItem("freedom.referrer");
      const mitWerber = !!werber && /^[0-9a-f]{64}$/.test(werber) && werber !== state.keypair?.pk;
      return `<h2>Privat von Anfang an</h2>
        <p class="mono-sm">${belegt.map((a) => `✓ ${escapeHtml(a)}`).join("<br>")}${offen.map((a) => `<br>○ Noch nicht: ${escapeHtml(a)}`).join("")}</p>
        <label class="mono-sm" style="display:block;margin:8px 0">Verbindung
          <select id="ein-netz" class="mono-sm">
            <option value="klar">direkt (Relays sehen deine IP)</option>
            <option value="tor">.onion-Relays bevorzugen (nur im Tor Browser wirksam)</option>
            <option value="mixnet">Mixnetz (nur wirksam, wenn du selbst eines nutzt)</option>
          </select></label>
        <label class="mono-sm" style="display:block;margin:8px 0">
          <input type="checkbox" id="ein-kontakte" /> Kontakte verschlüsselt zwischen Geräten abgleichen (Standard: aus)</label>
        ${mitWerber ? `<label class="mono-sm" style="display:block;margin:8px 0">
          <input type="checkbox" id="ein-werber" /> ${escapeHtml(pkShort(werber!))} öffentlich als meinen Werber nennen</label>
          <p class="mono-sm muted">Standard: aus. Dann bekommt dein Werber seinen Anteil an den Protokollgebühren
          deiner Zahlungen – und jeder kann sehen, dass ihr verbunden seid.</p>` : ""}
        <p class="mono-sm muted">Alles später unter Settings → Datenschutz.</p>
        <button id="ein-weiter" class="cta" style="width:auto;padding:8px 18px">weiter</button>`;
    }
    case "los":
      return `<h2>Womit fängst du an?</h2>
        <p class="mono-sm">Die Onboarding-Leiste oben zeigt danach immer genau einen nächsten Schritt.</p>
        <button id="ein-nutzen" ${KNOPF}>KI fragen</button>
        <button id="ein-kommunizieren" ${KNOPF}>Nachrichten schreiben</button>
        <button id="ein-verdienen" ${KNOPF}>Rechner vermieten</button>`;
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
