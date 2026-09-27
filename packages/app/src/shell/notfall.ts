/**
 * Notfall-Loeschung (Schritt 8.14): Settings → Sicherheit. Loescht alles
 * Lokale ueber `loescheAllesLokal()` (duress.ts) und prueft nach. Vorher
 * steht der Text aus `wipeConfirmation()` mit dem rechtlichen Hinweis (in der
 * Sprache der Oberflaeche: `loeschRueckfrage()`); bestaetigt wird durch
 * Eintippen von LÖSCHEN (englisch DELETE).
 *
 * Danach startet die App sofort neu: Was sie noch im Speicher hat
 * (Unterhaltungen, Zeitgeber), darf nicht zurueckgeschrieben werden – ohne
 * Tresor landete es sonst im Klartext in localStorage. Ein Merker in
 * sessionStorage laesst den Start ein zweites Mal loeschen, bevor irgendetwas
 * anderes laeuft; das Ergebnis zeigt die leere App.
 *
 * Der Dialog wird mit DOM-Aufrufen gebaut, nicht per innerHTML.
 */
import { type LoeschUmgebung, loescheAllesLokal } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { loeschRueckfrage } from "../protokoll-texte.js";
import { sucheVergessen } from "./suche-ui.js";
import { toast } from "./ui.js";

/** Nur zwischen Loeschen und Neustart gesetzt; der zweite Durchgang loescht ihn mit. */
const MERKER = "freedom.notfall.geloescht";
const BESTAETIGUNG = /^(L(Ö|OE)SCHEN|DELETE)$/;

function loescheDatenbank(name: string): Promise<void> {
  return new Promise((res, rej) => {
    const req = indexedDB.deleteDatabase(name);
    // Offene Verbindung („blocked“): warten, aber nicht ewig – dann benannt
    const frist = setTimeout(() => rej(new Error("blockiert")), 5000);
    req.onsuccess = () => { clearTimeout(frist); res(); };
    req.onerror = () => { clearTimeout(frist); rej(req.error); };
  });
}

function umgebung(): LoeschUmgebung {
  const liste = typeof indexedDB.databases === "function"
    ? async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter(Boolean)
    : null;
  return { local: localStorage, session: sessionStorage, loescheDatenbank, ...(liste ? { datenbanken: liste } : {}) };
}

/** Alles loeschen und sofort neu starten. */
export async function loescheJetzt(): Promise<void> {
  // Zeitgeber des Suchindex anhalten, sonst schreibt er gleich wieder
  await sucheVergessen().catch(() => undefined);
  const b = await loescheAllesLokal(umgebung());
  const offen = [...new Set([...b.failed, ...b.uebrig])];
  try {
    sessionStorage.setItem(MERKER, JSON.stringify({ n: b.cleared.length, offen }));
  } catch { /* ohne Merker kein zweiter Durchgang – das Ergebnis zeigt dann nur die leere App */ }
  location.reload();
}

/**
 * Beim Start, vor allem anderen: Kommt die App aus einer Notfall-Loeschung,
 * ein zweites Mal loeschen (was zwischen Loeschen und Neustart noch
 * geschrieben wurde) und das Ergebnis zeigen.
 */
export async function nachNotfallLoeschung(): Promise<void> {
  let merker: string | null = null;
  try {
    merker = sessionStorage.getItem(MERKER);
  } catch {
    return;
  }
  if (merker === null) return;
  let erster: { n?: number; offen?: string[] } = {};
  try {
    erster = JSON.parse(merker) as typeof erster;
  } catch { /* unlesbar – der zweite Durchgang zaehlt */ }
  const zweiter = await loescheAllesLokal(umgebung()).catch(() => null);
  const offen = zweiter ? [...new Set([...zweiter.failed, ...zweiter.uebrig])] : [t("ein.zweiterDurchgang")];
  // Was der erste nicht schaffte, der zweite aber schon, ist geloescht
  if (offen.length > 0 || !zweiter) {
    setTimeout(() => alert(t("ein.nichtAllesGeloescht", { offen: offen.join(", ") })), 0);
    return;
  }
  const n = Number.isSafeInteger(erster.n) ? erster.n : zweiter.cleared.length;
  const pruef = t(zweiter.nachgeprueft ? "ein.nachgeprueft" : "ein.nichtNachgeprueft");
  setTimeout(() => toast(t("ein.allesGeloescht", { n: n ?? 0, pruef })), 1500);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

/** Rueckfrage mit rechtlichem Hinweis; `geldLaeuft` warnt vor laufenden Tauschvorgaengen. */
function frageNach(geldLaeuft: () => boolean): void {
  const box = el("div", undefined, "modal-backdrop");
  const modal = el("div", undefined, "modal");
  const text = el("p", loeschRueckfrage(), "mono-sm");
  text.style.whiteSpace = "pre-wrap";
  const eingabe = el("input");
  eingabe.id = "notfall-bestaetigung";
  eingabe.placeholder = t("ein.loeschenEintippen");
  eingabe.autocomplete = "off";
  const los = el("button", t("ein.endgueltigLoeschen"), "send-btn");
  los.id = "notfall-los";
  los.disabled = true;
  const ab = el("button", t("ein.abbrechen"), "ghost");
  ab.id = "notfall-abbruch";
  modal.append(el("h3", t("ein.notfallTitel")), text);
  if (geldLaeuft()) modal.append(el("p", t("ein.geldLaeuft"), "mono-sm warn"));
  modal.append(eingabe, los, ab);
  box.append(modal);
  document.body.append(box);
  eingabe.focus();
  eingabe.addEventListener("input", () => { los.disabled = !BESTAETIGUNG.test(eingabe.value.trim().toUpperCase()); });
  ab.addEventListener("click", () => box.remove());
  los.addEventListener("click", () => {
    if (los.disabled) return;
    los.disabled = true;
    ab.disabled = true;
    los.textContent = t("ein.loesche");
    void loescheJetzt().catch((e: unknown) => {
      los.textContent = t("ein.endgueltigLoeschen");
      los.disabled = false;
      ab.disabled = false;
      toast(t("ein.loeschenGescheitert", { fehler: (e as Error).message }), true);
    });
  });
}

/** Knopf in Settings → Sicherheit verdrahten (einmal beim Start). */
export function wireNotfallLoeschung(geldLaeuft: () => boolean): void {
  document.getElementById("notfall-loeschen")?.addEventListener("click", () => frageNach(geldLaeuft));
}
