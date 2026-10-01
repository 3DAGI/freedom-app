/**
 * Tresor in der App (Schritt 1.2b): einrichten, beim Start entsperren,
 * „Passphrase vergessen“ – und der private Schluessel darin.
 *
 * Reihenfolge nach der Entscheidung vom 24.09.2026: erst benutzen, dann
 * einrichten. Ohne Tresor liegt der Schluessel wie bisher in localStorage
 * (freedom.nsec). Mit Tresor steht er nur verschluesselt in IndexedDB;
 * localStorage merkt sich lediglich, DASS es einen Tresor gibt.
 *
 * Die Dialoge setzen nur feste Texte per innerHTML; alles Eingegebene und
 * jede Fehlermeldung laeuft ueber textContent.
 */
import { toHex } from "@freedomstack/protocol";
import {
  type GeheimSpeicher,
  type Vault,
  FalschePassphrase,
  IndexedDbSpeicher,
  MIN_PASSPHRASE,
  createVault,
  geheimSpeicher,
  sollSperren,
  sperrMinuten,
  uebernehme,
  unlock,
  vaultExists,
} from "../vault.js";
import { t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { escapeHtml } from "../shell-logic.js";
import { LS_BUNKER, LS_KEY, LS_MERKPHRASE } from "./state.js";
import { $, toast } from "./ui.js";

/** Nur ein Merker, kein Geheimnis: Gibt es auf diesem Geraet einen Tresor? */
export const LS_TRESOR = "freedom.vault";
let tresor: Vault | null = null;

export function tresorEingerichtet(): boolean {
  return localStorage.getItem(LS_TRESOR) === "1";
}

/**
 * Speicher fuer alle Geheimnisse der App (Schritt 1.2c): mit Tresor
 * verschluesselt, ohne wie bisher localStorage.
 */
export const geheim: GeheimSpeicher = geheimSpeicher(() => tresor, tresorEingerichtet, localStorage);

/**
 * Was beim Einrichten aus localStorage in den Tresor wandert: privater
 * Schluessel, Bunker-Sitzung, Wallet-Verbindung (NWC), Preimages von Swaps und
 * Deposits, Unterhaltungen, Agent- und Swap-Verlauf, die eingebaute SOL-Wallet,
 * gemerkte Sperren (refund-watcher.ts, seit 4.6c), der Schluessel des
 * Suchindex (8.13) und gehaltene Nachfolge-Anteile (8.11) – beide entstehen
 * nur mit Tresor – sowie eigene Reklamationen mit ihrem Sitzungsschluessel (5.6b)
 * und der Schluessel des MLS-Zustands (2.2b-c) sowie die gesammelten Gebuehrenanteile (5.1.3)
 * und die Zahlkanaele mit ihren Sitzungsschluesseln (4.3d).
 * Die Namen stehen auch in tabs/waehrung.ts, tabs/agent.ts,
 * tabs/kommunikation.ts, swap-client.ts, sol-wallet.ts, suche-ui.ts,
 * nachfolge.ts, mls-speicher.ts, anteile-kasse.ts und zahlkanal.ts.
 */
const GEHEIM_FEST = [LS_KEY, LS_BUNKER, LS_MERKPHRASE, "freedom.nwc.uri", "freedom.chats", "freedom.agentHistory", "freedom.swapHistory", "freedom.suche.schluessel", "freedom.nachfolge", "freedom.reklamationen", "freedom.coverage.eintrag", "freedom.mls.schluessel", "freedom.raeume.privat", "freedom.raeume.meldungen.erledigt", "freedom.anteile", "freedom.mandate", "freedom.kanaele", "freedom.funk.gateway", "freedom.quittungen", "freedom.ruf.kontakte", "freedom.ruf.gesendet", "freedom.repos.gesehen", "freedom.repos.lokal", "freedom.knoten.kopplung", "freedom.kontakte.geprueft"];
const GEHEIM_PRAEFIXE = ["freedom.swap.", "freedom.htlc.", "freedom.solWallet", "freedom.pending."];

function geheimnisse(): string[] {
  const alle = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "");
  return [...new Set([...GEHEIM_FEST, ...alle.filter(istGeheimnis)])];
}

/** Liegt dieser Eintrag im Tresor (mit Tresor) – oder in localStorage? (Zustandssicherung, 8.12) */
export function istGeheimnis(k: string): boolean {
  return GEHEIM_FEST.includes(k) || GEHEIM_PRAEFIXE.some((p) => k.startsWith(p));
}

/** Privater Schluessel (hex): aus dem Tresor, wenn es einen gibt, sonst wie bisher. */
export function ladeSchluessel(): string | null {
  return tresorEingerichtet() ? tresor?.get(LS_KEY) ?? null : localStorage.getItem(LS_KEY);
}

/** Privaten Schluessel speichern – in den Tresor, wenn es einen gibt. */
export async function speichereSchluessel(hex: string): Promise<void> {
  if (!tresorEingerichtet()) {
    localStorage.setItem(LS_KEY, hex);
    return;
  }
  if (!tresor) throw new Error(t("ein.tresorGesperrt"));
  await tresor.set(LS_KEY, hex);
}

// ------------------------------------------------------------- Dialoge

function dialog(html: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "modal-backdrop";
  box.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(box);
  (box.querySelector("input, textarea") as HTMLElement | null)?.focus();
  return box;
}

function feld(box: HTMLElement, id: string): string {
  return (box.querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement).value;
}

function melde(box: HTMLElement, text: string): void {
  box.querySelector("#tr-meldung")!.textContent = text;
}

/** Klick und Enter loesen dieselbe Aktion aus; waehrenddessen gesperrt. */
function beiAbsenden(box: HTMLElement, knopf: string, f: () => Promise<void>): void {
  const btn = box.querySelector(`#${knopf}`) as HTMLButtonElement;
  const los = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await f(); } finally { btn.disabled = false; }
  };
  btn.addEventListener("click", () => void los());
  box.querySelectorAll("input").forEach((i) => i.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void los();
  }));
}

function neuePassphrase(box: HTMLElement): string | null {
  const a = feld(box, "tr-neu1");
  if (a.normalize("NFC").length < MIN_PASSPHRASE) {
    melde(box, t("ein.passMin", { n: MIN_PASSPHRASE }));
    return null;
  }
  if (a !== feld(box, "tr-neu2")) {
    melde(box, t("ein.passUngleich"));
    return null;
  }
  return a;
}

/**
 * Tresor einrichten (Settings → Sicherheit, Schritt 5, oder die Fuehrung).
 * Der Schluessel wandert geprueft hinein; scheitert die Pruefung, bleibt
 * alles wie vorher.
 */
export function richteTresorEin(grund = ""): Promise<boolean> {
  if (tresorEingerichtet()) {
    toast(t("ein.tresorSchon"));
    return Promise.resolve(false);
  }
  const box = dialog(`
    <h3>${escapeHtml(t("ein.tresorAktion"))}</h3>
    <p id="tr-grund" class="mono-sm warn"></p>
    <p class="mono-sm">${escapeHtml(t("ein.tresorErklaerung"))}</p>
    <input id="tr-neu1" type="password" autocomplete="new-password" placeholder="${escapeHtml(t("ein.passNeu"))}" />
    <input id="tr-neu2" type="password" autocomplete="new-password" placeholder="${escapeHtml(t("ein.nochEinmal"))}" />
    <div id="tr-meldung" class="mono-sm err"></div>
    <button id="tr-ok" class="send-btn">${escapeHtml(t("ein.einrichten"))}</button>
    <button id="tr-abbruch" class="ghost">${escapeHtml(t("ein.abbrechen"))}</button>`);
  const grundEl = box.querySelector("#tr-grund") as HTMLElement;
  grundEl.textContent = grund;
  grundEl.hidden = !grund;
  return new Promise<boolean>((resolve) => {
    box.querySelector("#tr-abbruch")!.addEventListener("click", () => { box.remove(); resolve(false); });
    beiAbsenden(box, "tr-ok", async () => {
      const pass = neuePassphrase(box);
      if (!pass) return;
      // Ohne Schluessel waere der Tresor leer – beim naechsten Start entstuende
      // eine neue Identitaet.
      if (localStorage.getItem(LS_KEY) === null) {
        melde(box, t("ein.keinSchluessel"));
        return;
      }
      melde(box, t("ein.richteEin"));
      const speicher = new IndexedDbSpeicher();
      try {
        const v = await createVault(pass, speicher);
        try {
          await uebernehme(v, localStorage, geheimnisse(), () => unlock(pass, speicher));
        } catch (e) {
          v.lock();
          await speicher.loeschen();   // nichts halb eingerichtet lassen
          throw e;
        }
        tresor = v;
        localStorage.setItem(LS_TRESOR, "1");
        box.remove();
        toast(t("ein.tresorEingerichtet"));
        resolve(true);
      } catch (e) {
        melde(box, t("ein.nichtEingerichtet", { fehler: fehlerText(e) }));
      }
    });
  });
}

/**
 * Vor Geld-Geheimnissen (Entscheidung zu 1.2): Wer eine Wallet verbindet oder
 * einen Swap bzw. ein Deposit startet, richtet vorher den Tresor ein.
 */
export async function verlangeTresor(wofuer: string): Promise<boolean> {
  if (tresorEingerichtet()) return true;
  return richteTresorEin(t("ein.tresorZuerst", { wofuer }));
}

/** Beim Start: Gibt es einen Tresor, erst entsperren. Ohne Tresor sofort weiter. */
export async function entsperreBeimStart(): Promise<void> {
  let vorhanden = tresorEingerichtet();
  if (!vorhanden) {
    // Merker verloren (localStorage geleert), Tresor aber noch da?
    try { vorhanden = await vaultExists(); } catch { vorhanden = false; }
    if (vorhanden) localStorage.setItem(LS_TRESOR, "1");
  }
  if (vorhanden) await entsperrDialog();
}

function entsperrDialog(): Promise<void> {
  const box = dialog(`
    <h3>${escapeHtml(t("ein.entsperrenTitel"))}</h3>
    <p class="mono-sm">${escapeHtml(t("ein.liegtVerschluesselt"))}</p>
    <input id="tr-pass" type="password" autocomplete="current-password" placeholder="${escapeHtml(t("ein.passphrase"))}" />
    <div id="tr-meldung" class="mono-sm err"></div>
    <button id="tr-ok" class="send-btn">${escapeHtml(t("ein.entsperren"))}</button>
    <button id="tr-vergessen" class="ghost">${escapeHtml(t("ein.vergessen"))}</button>`);
  return new Promise<void>((resolve) => {
    box.querySelector("#tr-vergessen")!.addEventListener("click", () => {
      box.remove();
      void neuBeginnen().then(resolve);
    });
    beiAbsenden(box, "tr-ok", async () => {
      melde(box, t("ein.pruefe"));
      try {
        tresor = await unlock(feld(box, "tr-pass"));
        box.remove();
        resolve();
      } catch (e) {
        melde(box, e instanceof FalschePassphrase
          ? t("ein.passFalsch")
          : t("ein.entsperrFehler", { fehler: fehlerText(e) }));
      }
    });
  });
}

/**
 * Passphrase vergessen: Die Identitaet kommt aus der Merkphrase (oder dem nsec)
 * zurueck, der alte Tresor wird geloescht, ein neuer mit neuer Passphrase
 * angelegt. Was nur im alten Tresor stand, ist weg – Unterhaltungen und Raeume
 * kommen ueber die verschluesselte Sicherung zurueck.
 */
function neuBeginnen(): Promise<void> {
  const box = dialog(`
    <h3>${escapeHtml(t("ein.neuTitel"))}</h3>
    <p class="mono-sm">${escapeHtml(t("ein.neuText"))}</p>
    <textarea id="tr-phrase" rows="3" autocomplete="off" placeholder="${escapeHtml(t("ein.phraseOderNsec"))}"></textarea>
    <input id="tr-neu1" type="password" autocomplete="new-password" placeholder="${escapeHtml(t("ein.passNeuNeu"))}" />
    <input id="tr-neu2" type="password" autocomplete="new-password" placeholder="${escapeHtml(t("ein.nochEinmal"))}" />
    <div id="tr-meldung" class="mono-sm err"></div>
    <button id="tr-ok" class="send-btn">${escapeHtml(t("ein.neuEinrichten"))}</button>
    <button id="tr-zurueck" class="ghost">${escapeHtml(t("ein.zurueck"))}</button>`);
  return new Promise<void>((resolve) => {
    box.querySelector("#tr-zurueck")!.addEventListener("click", () => {
      box.remove();
      void entsperrDialog().then(resolve);
    });
    beiAbsenden(box, "tr-ok", async () => {
      const { importIdentity, markHasMnemonic, markBackupConfirmed } = await import("../identity.js");
      let id: ReturnType<typeof importIdentity>;
      try {
        id = importIdentity(feld(box, "tr-phrase"));
      } catch (e) {
        melde(box, fehlerText(e));
        return;
      }
      const pass = neuePassphrase(box);
      if (!pass) return;
      melde(box, t("ein.richteNeuEin"));
      try {
        const speicher = new IndexedDbSpeicher();
        await speicher.loeschen();
        const v = await createVault(pass, speicher);
        await v.set(LS_KEY, toHex(id.sk));
        localStorage.removeItem(LS_KEY);
        localStorage.setItem(LS_TRESOR, "1");
        if (id.mnemonic) {
          // Wer alle zwoelf Woerter eintippt, hat sie nachweislich.
          markHasMnemonic();
          markBackupConfirmed();
        }
        tresor = v;
        box.remove();
        toast(t("ein.tresorNeu"));
        resolve();
      } catch (e) {
        melde(box, t("ein.nichtEingerichtet", { fehler: fehlerText(e) }));
      }
    });
  });
}

// ------------------------------------------------------------- Automatische Sperre (1.2d)

const LS_SPERRE = "freedom.vault.sperreMin";

/**
 * Sperrt den Tresor nach N Minuten ohne Eingabe (Standard 15, 0 = nie).
 * Gesperrt wird durch Neuladen: Das raeumt jeden entschluesselten Wert aus dem
 * Speicher der Seite, danach fragt der Start wieder nach der Passphrase.
 * Waehrend ein Tausch, ein Deposit oder ein Auftrag laeuft, wird nicht gesperrt.
 */
export function starteAutoSperre(beschaeftigt: () => boolean): void {
  let letzte = Date.now();
  for (const art of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(art, () => { letzte = Date.now(); }, { passive: true, capture: true });
  }
  setInterval(() => {
    if (sollSperren({
      jetzt: Date.now(),
      letzteEingabe: letzte,
      minuten: sperrMinuten(localStorage.getItem(LS_SPERRE)),
      offen: tresorEingerichtet() && !!tresor && !tresor.locked,
      beschaeftigt: beschaeftigt(),
    })) sperreJetzt();
  }, 20_000);
}

export function sperreJetzt(): void {
  tresor?.lock();
  tresor = null;
  location.reload();
}

/** Settings → Sicherheit: Sperrzeit einstellen, sofort sperren. Nur mit Tresor sichtbar. */
export function wireTresorKarte(): void {
  const karte = $("#tresor-karte");
  if (!karte) return;
  karte.hidden = !tresorEingerichtet();
  const feld = $("#tresor-sperre") as HTMLInputElement | null;
  if (feld && !feld.dataset.verdrahtet) {
    feld.dataset.verdrahtet = "1";
    feld.value = String(sperrMinuten(localStorage.getItem(LS_SPERRE)));
    feld.addEventListener("change", () => {
      const min = sperrMinuten(feld.value);
      localStorage.setItem(LS_SPERRE, String(min));
      feld.value = String(min);
      toast(min === 0 ? t("ein.sperreAus") : t("ein.sperrtNach", { n: min }));
    });
    $("#tresor-jetzt")?.addEventListener("click", sperreJetzt);
  }
}
