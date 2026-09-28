/**
 * Dialoge (Schritt C.2b1): statt `prompt()`, `confirm()` und `alert()`.
 *
 * Nur DOM und `textContent` – Namen, Kennungen und Texte von anderen landen
 * nie als HTML. Für Tastatur und Vorleser: `role="dialog"`, `aria-modal`, der
 * Titel beschriftet, der Rest der App ist solange `inert`; der Fokus bleibt im
 * Dialog (Tab läuft im Kreis), Esc bricht ab, Enter bestätigt (in
 * mehrzeiligen Feldern Strg+Enter), danach kehrt der Fokus zurück.
 *
 * Pflichtfelder und eigene Prüfungen melden sich im Dialog, statt ihn zu
 * schließen – ein Tippfehler im Schlüssel kostet nicht die ganze Eingabe.
 */
import { t } from "../i18n.js";
import { qrKnopf, scanKnopf } from "./qr-ui.js";

export interface Option { wert: string; text: string; hinweis?: string }

interface Basis { name: string; label: string }
export type Feld =
  | Basis & { art: "text" | "textarea"; wert?: string; pflicht?: boolean; fehler?: string; mono?: boolean; scannen?: boolean }
  | Basis & { art: "wahl"; optionen: Option[]; wert?: string; pflicht?: boolean; fehler?: string }
  | Basis & { art: "mehrfach"; optionen: Option[]; werte?: string[] }
  | Basis & { art: "nurlesen"; wert: string }
  // QR-Code auf Klick (11.1b); `geheim`: mit Warnung, verschwindet wieder
  | Basis & { art: "qr"; wert: string; geheim?: boolean };

/** Eingaben nach Feldname: Text und Wahl als Zeichenkette, Mehrfachwahl als Liste. */
export type Werte = Record<string, string | string[]>;

export interface DialogOptionen {
  titel: string;
  text?: string;
  felder?: Feld[];
  ok?: string;
  /** Beschriftung des Abbrechen-Knopfs; `false` = nur ein Knopf (Hinweis). */
  abbrechen?: string | false;
  /** Bestätigen rot, Fokus zuerst auf Abbrechen – für Löschen, Entfernen, Sperren. */
  gefahr?: boolean;
  /** Prüfung über die Felder hinweg: Fehlertext oder null. */
  pruefe?: (w: Werte) => string | null;
}

/**
 * Der erste Fehler der Eingaben, sonst null. Rein – ohne DOM prüfbar: Pflicht
 * heißt nicht leer (Leerzeichen zählen nicht), eine Wahl nur aus den Optionen.
 */
export function pruefeWerte(felder: readonly Feld[], w: Werte, pruefe?: (w: Werte) => string | null): { feld?: string; text: string } | null {
  for (const f of felder) {
    if (f.art === "mehrfach" || f.art === "nurlesen" || f.art === "qr") continue;
    const v = w[f.name];
    const leer = typeof v !== "string" || !v.trim();
    if (f.pflicht && leer) return { feld: f.name, text: f.fehler ?? t("dlg.pflicht") };
    if (f.art === "wahl" && !leer && !f.optionen.some((o) => o.wert === v)) return { feld: f.name, text: f.fehler ?? t("dlg.pflicht") };
  }
  const text = pruefe?.(w);
  return text ? { text } : null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

let zaehler = 0;
let offen = 0;

/** Ein Dialog; liefert die Eingaben oder null (abgebrochen). */
export function dialog(o: DialogOptionen): Promise<Werte | null> {
  const vorher = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const nr = ++zaehler;
  const id = (name: string) => `dlg-${nr}-${name}`;
  const felder = o.felder ?? [];

  const huelle = el("div", undefined, "modal-backdrop dlg-huelle");
  const box = el("div", undefined, "modal dlg-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  const titel = el("h3", o.titel, "dlg-titel");
  titel.id = id("titel");
  box.setAttribute("aria-labelledby", titel.id);
  box.append(titel);
  if (o.text) {
    const p = el("p", o.text, "dlg-text");
    p.id = id("text");
    box.setAttribute("aria-describedby", p.id);
    box.append(p);
  }

  const leser: Array<() => [string, string | string[]]> = [];
  const erstes: Record<string, HTMLElement> = {};
  for (const f of felder) {
    if (f.art === "qr") {
      box.append(el("p", f.label, "dlg-label"), qrKnopf(f.wert, { beschriftung: f.label, geheim: f.geheim }));
      continue;
    }
    if (f.art === "wahl" || f.art === "mehrfach") {
      const gruppe = el("fieldset", undefined, "dlg-wahl");
      gruppe.append(el("legend", f.label, "dlg-label"));
      const eingaben = f.optionen.map((opt, i) => {
        const zeile = el("label", undefined, "dlg-option");
        const e = el("input");
        e.type = f.art === "wahl" ? "radio" : "checkbox";
        e.name = id(f.name);
        e.value = opt.wert;
        e.id = id(`${f.name}-${i}`);
        e.checked = f.art === "wahl" ? opt.wert === f.wert : !!f.werte?.includes(opt.wert);
        zeile.htmlFor = e.id;
        const worte = el("span", opt.text, "dlg-option-text");
        if (opt.hinweis) worte.append(el("small", opt.hinweis, "dlg-hinweis"));
        zeile.append(e, worte);
        gruppe.append(zeile);
        return e;
      });
      erstes[f.name] = eingaben.find((e) => e.checked) ?? eingaben[0] ?? gruppe;
      leser.push(() => {
        const an = eingaben.filter((e) => e.checked).map((e) => e.value);
        return [f.name, f.art === "wahl" ? (an[0] ?? "") : an];
      });
      box.append(gruppe);
      continue;
    }
    const label = el("label", f.label, "dlg-label");
    label.htmlFor = id(f.name);
    const e = f.art === "textarea" ? el("textarea") : el("input");
    e.id = id(f.name);
    e.value = f.wert ?? "";
    if (e instanceof HTMLInputElement) e.type = "text";
    if (f.art === "textarea") (e as HTMLTextAreaElement).rows = 3;
    if (f.art === "nurlesen" || ("mono" in f && f.mono)) e.classList.add("mono");
    e.autocomplete = "off";
    e.spellcheck = f.art === "textarea";
    erstes[f.name] = e;
    if (f.art === "nurlesen") {
      e.readOnly = true;
      const zeile = el("div", undefined, "dlg-kopier");
      const kopieren = el("button", t("dlg.kopieren"), "ghost");
      kopieren.type = "button";
      kopieren.addEventListener("click", () => {
        void navigator.clipboard?.writeText(f.wert).then(() => { kopieren.textContent = t("dlg.kopiert"); }, () => e.select());
      });
      zeile.append(e, kopieren);
      box.append(label, zeile);
    } else {
      box.append(label, e);
      // Kamera nur auf Klick, sonst bleibt das Feld zum Einfügen (11.1b)
      if (f.scannen) box.append(scanKnopf(e));
    }
    leser.push(() => [f.name, e.value]);
  }

  const meldung = el("div", undefined, "dlg-meldung err");
  meldung.setAttribute("role", "alert");
  const knoepfe = el("div", undefined, "dlg-knoepfe");
  const ab = o.abbrechen === false ? null : el("button", o.abbrechen ?? t("dlg.abbrechen"), "ghost");
  const ok = el("button", o.ok ?? t("dlg.ok"), o.gefahr ? "dlg-gefahr" : undefined);
  for (const b of [ab, ok]) if (b) { b.type = "button"; knoepfe.append(b); }
  box.append(meldung, knoepfe);
  huelle.append(box);

  const app = document.getElementById("app");
  const warInert = app?.inert ?? false;
  if (app) app.inert = true;
  offen++;
  document.body.append(huelle);

  const fokussierbar = () => [...box.querySelectorAll<HTMLElement>("input, textarea, button")]
    .filter((e) => !(e as HTMLButtonElement).disabled);
  const zuerst = (o.gefahr && ab) ? ab : (felder.length ? erstes[felder[0]!.name] : ok);
  zuerst?.focus();
  if (zuerst instanceof HTMLInputElement && zuerst.readOnly) zuerst.select();

  return new Promise((fertig) => {
    const halteFokus = (e: FocusEvent) => {
      if (!box.contains(e.target as Node)) (fokussierbar()[0] ?? ok).focus();
    };
    const ende = (w: Werte | null) => {
      document.removeEventListener("focusin", halteFokus);
      huelle.remove();
      offen--;
      if (app && offen === 0) app.inert = warInert;
      if (vorher?.isConnected) vorher.focus();
      fertig(w);
    };
    const bestaetigen = () => {
      const w: Werte = Object.fromEntries(leser.map((l) => l()));
      const fehler = pruefeWerte(felder, w, o.pruefe);
      if (!fehler) return ende(w);
      meldung.textContent = fehler.text;
      if (fehler.feld) erstes[fehler.feld]?.focus();
    };
    document.addEventListener("focusin", halteFokus);
    ok.addEventListener("click", bestaetigen);
    ab?.addEventListener("click", () => ende(null));
    huelle.addEventListener("keydown", (e) => {
      const ziel = e.target as HTMLElement;
      if (e.key === "Escape") {
        e.preventDefault();
        ende(null);
      } else if (e.key === "Enter" && !(ziel instanceof HTMLButtonElement) && (!(ziel instanceof HTMLTextAreaElement) || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        bestaetigen();
      } else if (e.key === "Tab") {
        const liste = fokussierbar();
        const [erster, letzter] = [liste[0], liste[liste.length - 1]];
        if (e.shiftKey && document.activeElement === erster) {
          e.preventDefault();
          letzter?.focus();
        } else if (!e.shiftKey && document.activeElement === letzter) {
          e.preventDefault();
          erster?.focus();
        }
      }
    });
  });
}

/** Ja oder nein. */
export async function bestaetige(o: { titel: string; text?: string; ok?: string; gefahr?: boolean }): Promise<boolean> {
  return (await dialog(o)) !== null;
}

/** Nur lesen, ein Knopf. */
export async function hinweis(titel: string, text: string): Promise<void> {
  await dialog({ titel, text, ok: t("dlg.schliessen"), abbrechen: false });
}
