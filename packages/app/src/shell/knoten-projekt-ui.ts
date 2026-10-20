/**
 * Projekte-Seite (VKe, Entwurf `docs/VIBECODEN-ENTWURF.md`, VK6): ein Projekt meines Knotens als Blatt – Auftrag geben
 * (fragen oder frei), Schritte live (Gedanke, Befehl, Ausgabe), Freigaben mit Ja und Nein, Stopp, am Ende der Abschluss
 * des Agenten. Der Auftrag geht über `wegZumKnoten()` mit frischem Sitzungsschlüssel; Freigabe und Stopp sind eigene
 * Aufträge (`frageKnotenCode()`, hereingereicht – das Modul bleibt frei von Kreisen). „Verlauf“ (VKe2) zeigt die Commits,
 * ihre Änderungen über die Patch-Ansicht der Repos (`zeigePatch()`) und setzt nach Rückfrage auf einen zurück – als neuen
 * Commit, nichts geht verloren. „Vorschau“ (VKg1b, wie Replit) holt die Adresse, unter der der Knoten das Projekt live
 * ausliefert (eigener Ursprung, `vorschau.ts` im Knoten), und öffnet sie in einem neuen Tab – in der Hülle, die keine
 * Fenster öffnet, nur zum Kopieren und als QR-Code. „Bild“ (VKg2b) zeigt Programme ohne Web als Bildstrom über den eigenen TURN
 * und schickt Zeiger und Tasten zurück (`bild-ui.ts`); es endet, sobald das Blatt etwas anderes zeigt. Gezeigt wird nur Text, der
 * Abschluss über `markdownDom()`. Der Lauf gehört dem Knoten: Schließt man das Blatt, läuft er weiter; solange die App
 * offen ist, folgt sie ihm und zeigt ihn beim nächsten Öffnen wieder – nur im Speicher, nie gemerkt.
 */
import { CODE_GRENZEN, LocalSigner, baueCodeAuftrag, generateKeypair, leseCodeAntwort, type CodeCommit, type CodeModus } from "@freedomstack/protocol";
import { gebietsschema, t } from "../i18n.js";
import { LAUF_ZEIT_MS, codeText, endeText, neuerLauf, nimmSchritt, wartetAufMich, type LaufStand, type SchrittAnzeige } from "../knoten-lauf.js";
import { CODE_TAKT_MS, CODE_ZEIT_MS, codeAblehnungText, vorschauUnverschluesselt } from "../knoten-projekte.js";
import { fehlerText } from "../protokoll-texte.js";
import { zeigeBild } from "./bild-ui.js";
import { alsModal, bestaetige } from "./dialog.js";
import type { frageKnotenCode } from "./knoten-code-ui.js";
import { powFuerKnoten } from "./knoten-status-ui.js";
import { folgeLauf, wegZumKnoten } from "./knoten-weg-ui.js";
import { markdownDom } from "./markdown-ui.js";
import { meineKopplung } from "./mein-knoten.js";
import { huellenArt } from "./oberflaeche-huelle.js";
import { qrKnopf } from "./qr-ui.js";
import { zeigePatch } from "./tabs/patch-seite.js";
import { el, ladend, toast } from "./ui.js";

type Frage = typeof frageKnotenCode;

/** Je Projekt der letzte Lauf dieser Sitzung. */
const laeufe = new Map<string, LaufStand>();
/** Das offene Blatt – es zeichnet neu, wenn ein Schritt kommt. */
let offen: { projekt: string; zeichne: () => void; schliesse: () => void } | null = null;

const laeuft = (s: LaufStand | undefined): boolean => !!s && !s.ende && !s.fehler;
const zeichneNeu = (projekt: string): void => { if (offen?.projekt === projekt) offen.zeichne(); };

function knopf(text: string, klasse: string, aria?: string): HTMLButtonElement {
  const b = el("button", text, klasse);
  b.type = "button";
  if (aria) b.setAttribute("aria-label", aria);
  return b;
}

/** Ein Schritt: Nummer, Gedanke, Befehl, Freigabe oder Antwort, Ausgabe (aufklappbar). */
function schrittKarte(stand: LaufStand, z: SchrittAnzeige, antworte: (z: SchrittAnzeige, ja: boolean) => void): HTMLElement {
  const box = el("div", undefined, "projekt-schritt");
  box.append(el("div", t("set.laufSchritt", { nr: z.nr }), "projekt-nr"));
  if (z.gedanke) box.append(el("p", z.gedanke, "projekt-gedanke"));
  if (z.befehl) box.append(el("pre", z.befehl, "projekt-befehl"));
  if (wartetAufMich(z, stand)) {
    const ja = knopf(t("set.laufJa"), "projekt-ja", t("set.laufJaAria", { nr: z.nr }));
    const nein = knopf(t("set.laufNein"), "ghost", t("set.laufNeinAria", { nr: z.nr }));
    ja.addEventListener("click", () => antworte(z, true));
    nein.addEventListener("click", () => antworte(z, false));
    const reihe = el("div", undefined, "projekt-freigabe");
    reihe.append(el("span", t("set.laufWartet"), "mono-sm"), ja, nein);
    box.append(reihe);
  } else if (z.beantwortet && !z.ausgabe) {
    box.append(el("div", t(z.beantwortet === "ja" ? "set.laufFreigegeben" : "set.laufAbgelehntHier"), "mono-sm"));
  }
  if (z.ausgabe) {
    const d = el("details", undefined, "projekt-ausgabe");
    d.append(el("summary", t("set.laufAusgabe", { code: codeText(z.ausgabe.code) })), el("pre", z.ausgabe.text));
    if (z.ausgabe.gekuerzt) d.append(el("div", t("set.laufGekuerzt"), "mono-sm"));
    box.append(d);
  }
  return box;
}

/** Den Auftrag geben und dem Lauf folgen, bis er endet – auch wenn das Blatt zu ist. */
async function starte(projekt: string, text: string, modus: CodeModus): Promise<void> {
  const k = meineKopplung();
  if (!k) return;
  const sitzung = new LocalSigner(generateKeypair().sk);
  const weg = await wegZumKnoten(k.knoten, sitzung);
  if (!weg) return toast(t("set.knotenOhneRelay"), true);
  let stand: LaufStand | undefined;
  try {
    const { wrap, requestId } = await baueCodeAuftrag({ sitzung, kopplung: k, aktion: { aktion: "auftrag", projekt, text, modus }, powBits: await powFuerKnoten(k.knoten) });
    stand = neuerLauf(requestId, projekt, modus, text);
    laeufe.set(projekt, stand);
    zeichneNeu(projekt);
    await weg.publish(wrap);
    const s = stand;
    const r = await folgeLauf(weg, sitzung, requestId, {
      zeitMs: LAUF_ZEIT_MS, taktMs: CODE_TAKT_MS, schritt: (x) => { if (nimmSchritt(s, x)) zeichneNeu(projekt); },
    });
    if (!r) s.fehler = t("set.laufSchweigt");
    else if ("abgelehnt" in r) s.fehler = codeAblehnungText(r.fall);
    else {
      const a = leseCodeAntwort(r.ergebnis, "auftrag");
      if (a?.aktion === "auftrag") s.ende = a;
      else s.fehler = t("set.statusUnlesbar");
    }
  } catch (e) {
    if (stand) stand.fehler = fehlerText(e);
    else toast(fehlerText(e), true);
  } finally {
    weg.schliesse();
    zeichneNeu(projekt);
  }
}

/** Das Blatt eines Projekts öffnen – zeigt den letzten Lauf dieser Sitzung, wenn es einen gibt. */
export function oeffneProjekt(projekt: string, frage: Frage): void {
  const gekoppelt = meineKopplung();
  if (!gekoppelt) return;
  const k = gekoppelt;
  offen?.schliesse();
  const huelle = el("div", undefined, "modal-backdrop projekt-huelle");
  const karte = el("div", undefined, "modal projekt-blatt");
  const zu = knopf(t("set.projektSchliessen"), "ghost projekt-zu");
  const verlaufKnopf = knopf(t("set.projektVerlauf"), "ghost projekt-verlauf-knopf", t("set.projektVerlaufAria", { name: projekt }));
  const kopf = el("div", undefined, "projekt-kopf");
  const kopfKnoepfe = el("div", undefined, "projekt-kopf-knoepfe");
  const vorschauKnopf = knopf(t("set.projektVorschau"), "ghost projekt-vorschau-knopf", t("set.projektVorschauAria", { name: projekt }));
  const bildKnopf = knopf(t("set.projektBild"), "ghost projekt-bild-knopf", t("set.projektBildAria", { name: projekt }));
  kopfKnoepfe.append(vorschauKnopf, bildKnopf, verlaufKnopf, zu);
  kopf.append(el("h3", t("set.projektTitel", { name: projekt })), kopfKnoepfe);
  /** Verlauf und Änderungen (VKe2) stehen hier statt Schritten und Auftrag. */
  const neben = el("div", undefined, "projekt-neben");
  neben.hidden = true;
  const schritte = el("div", undefined, "projekt-schritte");
  schritte.setAttribute("aria-live", "polite");
  const ende = el("div", undefined, "projekt-ende");
  ende.setAttribute("role", "status");
  const wunsch = el("textarea", undefined, "projekt-wunsch");
  wunsch.rows = 3;
  wunsch.maxLength = CODE_GRENZEN.text;
  wunsch.placeholder = t("set.projektWunsch");
  wunsch.setAttribute("aria-label", t("set.projektWunsch"));
  const modus = el("select", undefined, "projekt-modus");
  modus.setAttribute("aria-label", t("set.projektModus"));
  for (const [wert, text] of [["fragen", t("set.modusFragen")], ["frei", t("set.modusFrei")]] as const) {
    const o = el("option", text);
    o.value = wert;
    modus.append(o);
  }
  const los = knopf(t("set.projektLos"), "projekt-los");
  const stopp = knopf(t("set.projektStopp"), "ghost projekt-stopp");
  const fuss = el("div", undefined, "projekt-fuss");
  const knoepfe = el("div", undefined, "projekt-knoepfe");
  knoepfe.append(modus, stopp, los);
  fuss.append(wunsch, knoepfe);
  karte.append(kopf, neben, schritte, ende, fuss);
  huelle.append(karte);

  const antworte = async (z: SchrittAnzeige, ja: boolean): Promise<void> => {
    const stand = laeufe.get(projekt);
    if (!stand) return;
    z.beantwortet = ja ? "ja" : "nein";
    zeichne();
    const r = await frage(k, { aktion: "freigabe", lauf: stand.lauf, schritt: z.nr, ja }, CODE_ZEIT_MS);
    if ("grund" in r) {
      delete z.beantwortet;
      toast(r.grund, true);
    } else if (r.antwort.aktion === "freigabe" && !r.antwort.ok) toast(t("set.laufFreigabeVorbei"), true);
    zeichneNeu(projekt);
  };

  function zeichne(): void {
    const stand = laeufe.get(projekt);
    schritte.replaceChildren(...(stand ? stand.schritte.map((z) => schrittKarte(stand, z, (x, ja) => void antworte(x, ja))) : [el("p", t("set.projektLeer"), "mono-sm")]));
    if (stand) schritte.prepend(el("p", stand.text, "projekt-auftrag"));
    ende.replaceChildren();
    if (stand?.ende) ende.append(el("div", endeText(stand.ende), "projekt-ende-zeile"), ...(stand.ende.abschluss ? [markdownDom(stand.ende.abschluss, "projekt-abschluss")] : []));
    else if (stand?.fehler) ende.append(el("div", stand.fehler, "projekt-ende-zeile"));
    else if (laeuft(stand)) ende.append(el("div", t("set.laufLaeuft"), "mono-sm"));
    const aktiv = laeuft(stand);
    los.disabled = aktiv;
    wunsch.disabled = aktiv;
    modus.disabled = aktiv;
    stopp.hidden = !aktiv;
  }

  /** Ein laufendes Bild (VKg2b) – endet, sobald das Blatt etwas anderes zeigt oder zugeht. */
  let bildStopp: (() => void) | null = null;
  const lauf = (an: boolean): void => {
    bildStopp?.();
    bildStopp = null;
    neben.hidden = an;
    for (const x of [schritte, ende, fuss]) x.hidden = !an;
    verlaufKnopf.textContent = t(an ? "set.projektVerlauf" : "set.projektZumAuftrag");
  };

  const zeigeAenderungen = async (c: CodeCommit): Promise<void> => {
    ladend(neben);
    const r = await frage(k, { aktion: "diff", projekt, commit: c.id }, CODE_ZEIT_MS);
    if ("grund" in r) return void neben.replaceChildren(el("p", r.grund, "mono-sm"));
    if (r.antwort.aktion !== "diff") return;
    neben.replaceChildren(...zeigePatch({
      betreff: c.nachricht, commit: c.id, text: r.antwort.text, aktionen: [], zeit: c.zeit,
      ...(r.antwort.gekuerzt ? { hinweis: t("set.projektDiffGekuerzt") } : {}),
      zurueck: { text: t("set.projektZumVerlauf"), tun: () => void zeigeVerlauf() },
    }));
  };

  const setzeZurueck = async (c: CodeCommit): Promise<void> => {
    if (!await bestaetige({ titel: t("set.projektZurueckTitel"), text: t("set.projektZurueckText", { nachricht: c.nachricht }), ok: t("set.projektZurueck") })) return;
    const r = await frage(k, { aktion: "zurueck", projekt, commit: c.id }, CODE_ZEIT_MS);
    if ("grund" in r) return toast(r.grund, true);
    if (r.antwort.aktion !== "zurueck") return;
    toast(r.antwort.commit ? t("set.projektZurueckOk", { kurz: r.antwort.commit.slice(0, 7) }) : t("set.projektZurueckGleich"));
    await zeigeVerlauf();
  };

  async function zeigeVerlauf(): Promise<void> {
    lauf(false);
    ladend(neben);
    const r = await frage(k, { aktion: "verlauf", projekt }, CODE_ZEIT_MS);
    if ("grund" in r) return void neben.replaceChildren(el("p", r.grund, "mono-sm"));
    if (r.antwort.aktion !== "verlauf") return;
    const commits = r.antwort.commits;
    neben.replaceChildren(...(commits.length ? commits.map((c) => {
      const z = el("div", undefined, "projekt-commit");
      const text = el("div", undefined, "projekt-commit-text");
      const datum = new Date(c.zeit * 1000).toLocaleString(gebietsschema(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      text.append(el("div", c.nachricht), el("div", t("set.projektCommitZeile", { datum, n: c.dateien }), "mono-sm"));
      const aend = knopf(t("set.projektAenderungen"), "ghost", t("set.projektAenderungenAria", { nachricht: c.nachricht }));
      aend.addEventListener("click", () => void zeigeAenderungen(c));
      const zur = knopf(t("set.projektZurueck"), "ghost", t("set.projektZurueckAria", { nachricht: c.nachricht }));
      zur.addEventListener("click", () => void setzeZurueck(c));
      z.append(text, aend, zur);
      return z;
    }) : [el("p", t("set.projektVerlaufLeer"), "mono-sm")]));
  }
  verlaufKnopf.addEventListener("click", () => (neben.hidden ? void zeigeVerlauf() : lauf(true)));

  /** Vorschau (VKg1b): die Adresse nur aus der versiegelten Antwort; geöffnet ohne Verweis zurück auf die App. */
  async function zeigeVorschau(): Promise<void> {
    lauf(false);
    ladend(neben);
    const r = await frage(k, { aktion: "vorschau", projekt }, CODE_ZEIT_MS);
    if ("grund" in r) return void neben.replaceChildren(el("p", r.grund, "mono-sm"));
    if (r.antwort.aktion !== "vorschau") return;
    const url = r.antwort.url;
    const teile: HTMLElement[] = [el("p", t("set.vorschauText"))];
    if (huellenArt()) teile.push(el("p", t("set.vorschauHuelle"), "mono-sm"));
    else {
      const link = el("a", t("set.vorschauOeffnen"), "projekt-vorschau-link");
      link.setAttribute("href", url);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer"); // kein UI-Text
      teile.push(link);
    }
    const adresse = el("div", url, "mono-sm projekt-vorschau-adresse");
    const kopieren = knopf(t("set.vorschauKopieren"), "ghost projekt-vorschau-kopieren");
    kopieren.addEventListener("click", () => void navigator.clipboard?.writeText(url).then(() => toast(t("dlg.kopiert"))));
    teile.push(adresse, kopieren, qrKnopf(url, { beschriftung: t("set.vorschauQr"), geheim: true }), el("p", t("set.vorschauGeheim"), "mono-sm"));
    if (vorschauUnverschluesselt(url)) teile.push(el("p", t("set.vorschauHttp"), "mono-sm projekt-vorschau-http"));
    neben.replaceChildren(...teile);
  }
  vorschauKnopf.addEventListener("click", () => void zeigeVorschau());
  bildKnopf.addEventListener("click", () => {
    lauf(false);
    bildStopp = zeigeBild(neben, projekt, k, frage);
  });

  const schliesse = (): void => {
    bildStopp?.();
    bildStopp = null;
    huelle.remove();
    if (offen?.projekt === projekt) offen = null;
    document.removeEventListener("keydown", taste);
  };
  const taste = (e: KeyboardEvent): void => { if (e.key === "Escape") schliesse(); };
  zu.addEventListener("click", schliesse);
  document.addEventListener("keydown", taste);
  los.addEventListener("click", () => {
    const text = wunsch.value.trim();
    if (!text) return toast(t("set.laufLeer"), true);
    if (text.length > CODE_GRENZEN.text) return toast(t("set.laufZuLang"), true);
    wunsch.value = "";
    void starte(projekt, text, modus.value === "frei" ? "frei" : "fragen");
  });
  stopp.addEventListener("click", async () => {
    const stand = laeufe.get(projekt);
    if (!laeuft(stand)) return;
    stopp.disabled = true;
    const r = await frage(k, { aktion: "stopp", lauf: stand!.lauf }, CODE_ZEIT_MS);
    stopp.disabled = false;
    if ("grund" in r) toast(r.grund, true);
    else if (r.antwort.aktion === "stopp" && !r.antwort.ok) toast(t("set.laufStoppVorbei"), true);
  });
  offen = { projekt, zeichne, schliesse };
  zeichne();
  document.body.append(huelle);
  alsModal(huelle, karte);
  wunsch.focus();
}
