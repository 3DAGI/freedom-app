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
import { LS_BUNKER, LS_KEY } from "./state.js";
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
 * gemerkte Sperren (refund-watcher.ts, seit 4.6c).
 * Die Namen stehen auch in tabs/waehrung.ts, tabs/agent.ts,
 * tabs/kommunikation.ts, swap-client.ts und sol-wallet.ts.
 */
function geheimnisse(): string[] {
  const fest = [LS_KEY, LS_BUNKER, "freedom.nwc.uri", "freedom.chats", "freedom.agentHistory", "freedom.swapHistory"];
  const praefixe = ["freedom.swap.", "freedom.htlc.", "freedom.solWallet", "freedom.pending."];
  const alle = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "");
  return [...fest, ...alle.filter((k) => praefixe.some((p) => k.startsWith(p)))];
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
  if (!tresor) throw new Error("Tresor gesperrt");
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
    melde(box, "Mindestens 8 Zeichen – besser ein kurzer Satz.");
    return null;
  }
  if (a !== feld(box, "tr-neu2")) {
    melde(box, "Die beiden Eingaben stimmen nicht überein.");
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
    toast("Der Tresor ist schon eingerichtet");
    return Promise.resolve(false);
  }
  const box = dialog(`
    <h3>Tresor einrichten</h3>
    <p id="tr-grund" class="mono-sm warn"></p>
    <p class="mono-sm">Eine Passphrase verschlüsselt deinen Schlüssel, Wallet-Zugänge,
    Swap-Geheimnisse und Unterhaltungen auf diesem Gerät. Beim Start fragt die App
    danach. Vergisst du sie, hilft nur deine Merkphrase (12 Wörter) – sichere sie vorher.</p>
    <input id="tr-neu1" type="password" autocomplete="new-password" placeholder="Passphrase (mind. 8 Zeichen)" />
    <input id="tr-neu2" type="password" autocomplete="new-password" placeholder="noch einmal" />
    <div id="tr-meldung" class="mono-sm err"></div>
    <button id="tr-ok" class="send-btn">einrichten</button>
    <button id="tr-abbruch" class="ghost">abbrechen</button>`);
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
        melde(box, "Kein Schlüssel zum Übernehmen gefunden – nichts geändert.");
        return;
      }
      melde(box, "richte ein – das dauert einen Moment …");
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
        toast("Tresor eingerichtet – deine Geheimnisse liegen jetzt verschlüsselt");
        resolve(true);
      } catch (e) {
        melde(box, `Nicht eingerichtet: ${(e as Error).message}`);
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
  return richteTresorEin(`Für ${wofuer} braucht die App zuerst den Tresor: ` +
    "Das Geheimnis dazu soll nicht unverschlüsselt im Browser liegen.");
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
    <h3>Tresor entsperren</h3>
    <p class="mono-sm">Dein Schlüssel liegt verschlüsselt auf diesem Gerät.</p>
    <input id="tr-pass" type="password" autocomplete="current-password" placeholder="Passphrase" />
    <div id="tr-meldung" class="mono-sm err"></div>
    <button id="tr-ok" class="send-btn">entsperren</button>
    <button id="tr-vergessen" class="ghost">Passphrase vergessen?</button>`);
  return new Promise<void>((resolve) => {
    box.querySelector("#tr-vergessen")!.addEventListener("click", () => {
      box.remove();
      void neuBeginnen().then(resolve);
    });
    beiAbsenden(box, "tr-ok", async () => {
      melde(box, "prüfe …");
      try {
        tresor = await unlock(feld(box, "tr-pass"));
        box.remove();
        resolve();
      } catch (e) {
        melde(box, e instanceof FalschePassphrase
          ? "Passphrase falsch."
          : `${(e as Error).message} – über „Passphrase vergessen?“ mit der Merkphrase neu beginnen.`);
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
    <h3>Mit der Merkphrase neu beginnen</h3>
    <p class="mono-sm">Der alte Tresor wird gelöscht. Deine Identität kommt aus den
    12 Wörtern (oder dem nsec) zurück. Unterhaltungen und Räume holst du danach über
    die verschlüsselte Sicherung zurück (Settings → Sicherheit).</p>
    <textarea id="tr-phrase" rows="3" autocomplete="off" placeholder="12 Wörter oder nsec1…"></textarea>
    <input id="tr-neu1" type="password" autocomplete="new-password" placeholder="neue Passphrase (mind. 8 Zeichen)" />
    <input id="tr-neu2" type="password" autocomplete="new-password" placeholder="noch einmal" />
    <div id="tr-meldung" class="mono-sm err"></div>
    <button id="tr-ok" class="send-btn">neu einrichten</button>
    <button id="tr-zurueck" class="ghost">zurück</button>`);
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
        melde(box, (e as Error).message);
        return;
      }
      const pass = neuePassphrase(box);
      if (!pass) return;
      melde(box, "richte neu ein – das dauert einen Moment …");
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
        toast("Tresor neu eingerichtet");
        resolve();
      } catch (e) {
        melde(box, `Nicht eingerichtet: ${(e as Error).message}`);
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
      toast(min === 0 ? "Automatische Sperre aus" : `Sperrt nach ${min} Minuten ohne Eingabe`);
    });
    $("#tresor-jetzt")?.addEventListener("click", sperreJetzt);
  }
}
