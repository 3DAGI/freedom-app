/**
 * Agenten in Räumen – „Agent hinzufügen“ (11.3e1, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P2, P4, P5): einen neuen Agenten auf diesem
 * Gerät anlegen oder einen vorhandenen nehmen, dazu das Budget je Monat und Tag.
 *
 * - Erst der Tresor: Schlüssel, Anweisung und Budget liegen nur dort.
 * - Ehrlich vorher: Der Agent antwortet nur, solange diese App offen ist, und ich
 *   bezahle jede Antwort aus dem Budget – auch für Fragen anderer (F3 B; im offenen
 *   Raum schreibt seit B-22 jeder). Mit SOL zahlt er nur über einen Zahlkanal.
 * - Eingeladen wird über die Bausteine aus 11.3c: offen `ladeAgentInOffenenRaum()`,
 *   privat `ladeAgentInPrivatenRaum()` – beide schreiben den Pflicht-Hinweis in den Raum.
 * Agenten auf einem Knoten lädt man in private Räume wie Menschen ein (11.3d2c).
 */
import { AGENT_GRENZEN } from "@freedomstack/protocol";
import { AGENTEN_BUCH_GRENZEN, type AgentDaten, type BudgetEinheit } from "../agenten-buch.js";
import { t } from "../i18n.js";
import { kiSchiene } from "../ki-schiene.js";
import { fehlerText } from "../protokoll-texte.js";
import type { RaumAgentKarte } from "../knoten-agent-wahl.js";
import { type BudgetFehler, budgetText, leseBudgetEingabe, verbraucht } from "../raum-agent-budget.js";
import { agentenBuch, entferneAgentAusOffenemRaum, ladeAgentInOffenenRaum, legeGeraeteAgentAn } from "./agenten.js";
import { bestaetige, dialog, type Option, type Werte } from "./dialog.js";
import type { MenuePunkt } from "./menue.js";
import { einladungsText, type PrivaterRaum } from "./raum-mls.js";
import { verlangeTresor } from "./tresor.js";
import { el, toast } from "./ui.js";

/** Wohin der Agent kommt: offener Raum über die Adresse des Gründers (B-7), privat über die Gruppe. */
export type AgentZiel = { adresse: string } | { privat: PrivaterRaum };

const NEU = "neu";
/** Was am Budget nicht passt – je Fall ein Text. */
const BUDGET_FEHLER: Record<BudgetFehler, string> = {
  monat: "agentUi.budgetFehler.monat", tag: "agentUi.budgetFehler.tag", "tag-groesser": "agentUi.budgetFehler.tag-groesser",
};
const wert = (w: Werte, n: string): string => String(w[n] ?? "").trim();
const laenge = (s: string): number => [...s].length;

/** Name, Beschreibung, Anweisung, Modell – in den Grenzen des Buchs (sonst sagt der Dialog, was nicht passt). */
function pruefeAgentDaten(w: Werte): string | null {
  if (laenge(wert(w, "name")) > AGENT_GRENZEN.name) return t("agentUi.zuLang", { feld: t("agentUi.name"), n: AGENT_GRENZEN.name });
  if (laenge(wert(w, "about")) > AGENT_GRENZEN.about) return t("agentUi.zuLang", { feld: t("agentUi.about"), n: AGENT_GRENZEN.about });
  if (laenge(wert(w, "persona")) > AGENTEN_BUCH_GRENZEN.persona) return t("agentUi.zuLang", { feld: t("agentUi.persona"), n: AGENTEN_BUCH_GRENZEN.persona });
  if (laenge(wert(w, "modell")) > AGENT_GRENZEN.modell) return t("agentUi.zuLang", { feld: t("agentUi.modell"), n: AGENT_GRENZEN.modell });
  return null;
}

async function neuerAgent(): Promise<AgentDaten | null> {
  const w = await dialog({
    titel: t("agentUi.neuTitel"), text: t("agentUi.neuText"), ok: t("agentUi.weiter"),
    felder: [
      { art: "text", name: "name", label: t("agentUi.name"), pflicht: true },
      { art: "text", name: "about", label: t("agentUi.about") },
      { art: "textarea", name: "persona", label: t("agentUi.persona"), pflicht: true },
      { art: "text", name: "modell", label: t("agentUi.modell") },
    ],
    pruefe: pruefeAgentDaten,
  });
  if (!w) return null;
  const about = wert(w, "about");
  const modell = wert(w, "modell");
  return { name: wert(w, "name"), persona: String(w.persona ?? "").trim(), ...(about ? { about } : {}), ...(modell ? { modell } : {}) };
}

/** Budget je Monat und Tag – leer vorbelegt: Wer SOL wählt, soll nie sats-Zahlen als SOL abschicken. */
async function budget(name: string, offen: boolean): Promise<{ einheit: BudgetEinheit; monat: number; tag: number } | null> {
  const einheit = (w: Werte): BudgetEinheit => (w.einheit === "lamports" ? "lamports" : "msat");
  const w = await dialog({
    titel: t("agentUi.budgetTitel", { name }),
    text: `${t("agentUi.budgetText")}${offen ? `\n\n${t("agentUi.budgetOffen")}` : ""}`,
    ok: t("agentUi.hinzufuegen"),
    felder: [
      { art: "wahl", name: "einheit", label: t("agentUi.einheit"), wert: kiSchiene() === "solana" ? "lamports" : "msat", optionen: [
        { wert: "msat", text: "sats" }, { wert: "lamports", text: "SOL", hinweis: t("agentUi.solKanal") },
      ] },
      { art: "text", name: "monat", label: t("agentUi.monat"), pflicht: true, mono: true },
      { art: "text", name: "tag", label: t("agentUi.tag"), pflicht: true, mono: true },
    ],
    pruefe: (w) => {
      const r = leseBudgetEingabe({ einheit: einheit(w), monat: wert(w, "monat"), tag: wert(w, "tag") });
      return r.ok ? null : t(BUDGET_FEHLER[r.fehler]);
    },
  });
  if (!w) return null;
  const r = leseBudgetEingabe({ einheit: einheit(w), monat: wert(w, "monat"), tag: wert(w, "tag") });
  return r.ok ? r.budget : null;
}

/** „Agent hinzufügen“ – true, wenn er im Raum ist (dann lädt der Aufrufer den Raum neu). */
export async function agentHinzufuegen(ziel: AgentZiel): Promise<boolean> {
  if (!(await verlangeTresor(t("agentRaum.wofuer")))) return false;
  const raum = "adresse" in ziel ? ziel.adresse : ziel.privat.gruppe;
  const vorhanden = agentenBuch.alle().filter((a) => !a.raeume.some((r) => r.raum === raum));
  let wahl = NEU;
  if (vorhanden.length) {
    const w = await dialog({
      titel: t("agentUi.titel"), ok: t("agentUi.weiter"),
      felder: [{ art: "wahl", name: "agent", label: t("agentUi.welcher"), wert: NEU, optionen: [
        { wert: NEU, text: t("agentUi.neuAnlegen") }, ...vorhanden.map((a): Option => ({ wert: a.pk, text: a.name })),
      ] }],
    });
    if (!w) return false;
    wahl = String(w.agent ?? NEU);
  }
  const daten = wahl === NEU ? await neuerAgent() : null;
  if (wahl === NEU && !daten) return false;
  const name = daten?.name ?? agentenBuch.agent(wahl)?.name ?? "";
  const b = await budget(name, "adresse" in ziel);
  if (!b) return false;
  try {
    // Erst anlegen (der Schlüssel liegt dann im Tresor), dann einladen – scheitert das, bleibt er für das nächste Mal
    const pk = daten ? (await legeGeraeteAgentAn(daten))?.pk : wahl;
    if (!pk) return false;
    toast(t("agentUi.laedtEin", { name }));
    if ("adresse" in ziel) {
      await ladeAgentInOffenenRaum(pk, ziel.adresse, b);
    } else {
      const { ladeAgentInPrivatenRaum } = await import("./agent-mls.js");
      const r = await ladeAgentInPrivatenRaum(pk, ziel.privat, b);
      if (r !== "eingeladen") throw new Error(einladungsText(r));
    }
    toast(t("agentUi.drin", { name }));
    return true;
  } catch (e) {
    toast(t("agentUi.nichtDrin", { name, grund: fehlerText(e) }), true);
    return false;
  }
}

// ------------------------------------------------------------ In der Mitgliederliste (11.3e2)

/** Kennzeichen eines Agenten: wo er läuft und wer seine Antworten bezahlt – nur Text aus der Karte. */
export function agentKennzeichen(k: Pick<RaumAgentKarte, "betrieb" | "bezahlung">): HTMLElement {
  const b = el("span", t("agentUi.kennzeichen"), "msg-role rolle-agent");
  b.title = `${t(k.betrieb === "knoten" ? "agentUi.aufKnoten" : "agentUi.aufGeraet")} · ${t(k.bezahlung === "fragender" ? "agentUi.zahltFragender" : "agentUi.zahltEinlader")}`;
  return b;
}

const raumVon = (ziel: AgentZiel): string => ("adresse" in ziel ? ziel.adresse : ziel.privat.gruppe);

/** Menü eines Agenten dieses Geräts mit Budget hier: Budget ändern, aus dem Raum nehmen. Sonst null. */
export function eigeneAgentAktionen(pk: string, ziel: AgentZiel, nachher: () => void): MenuePunkt[] | null {
  const agent = agentenBuch.agent(pk);
  if (!agent || !agentenBuch.budget(pk, raumVon(ziel))) return null;
  return [
    { text: t("agentUi.budgetAendern"), tun: () => void budgetAendern(pk, raumVon(ziel), agent.name).then((ok) => { if (ok) nachher(); }) },
    { text: t("agentUi.herausnehmen"), gefahr: true, tun: () => void herausnehmen(pk, ziel, agent.name).then((ok) => { if (ok) nachher(); }) },
  ];
}

/** Budget ändern – in seiner Einheit (eine andere begänne den Verbrauch neu: dafür herausnehmen und neu hinzufügen). */
async function budgetAendern(pk: string, raum: string, name: string): Promise<boolean> {
  const b = agentenBuch.budget(pk, raum);
  if (!b) return false;
  const v = verbraucht(b, Math.floor(Date.now() / 1000));
  const einheit = b.einheit === "lamports" ? "SOL" : "sats";
  const w = await dialog({
    titel: t("agentUi.budgetTitel", { name }),
    text: t("agentUi.verbraucht", { monat: budgetText(v.monat, b.einheit), tag: budgetText(v.tag, b.einheit), einheit }),
    ok: t("agentUi.speichern"),
    felder: [
      { art: "nurlesen", name: "einheit", label: t("agentUi.einheit"), wert: einheit },
      { art: "text", name: "monat", label: t("agentUi.monat"), wert: budgetText(b.monat, b.einheit), pflicht: true, mono: true },
      { art: "text", name: "tag", label: t("agentUi.tag"), wert: budgetText(b.tag, b.einheit), pflicht: true, mono: true },
    ],
    pruefe: (w) => {
      const r = leseBudgetEingabe({ einheit: b.einheit, monat: wert(w, "monat"), tag: wert(w, "tag") });
      return r.ok ? null : t(BUDGET_FEHLER[r.fehler]);
    },
  });
  if (!w) return false;
  const r = leseBudgetEingabe({ einheit: b.einheit, monat: wert(w, "monat"), tag: wert(w, "tag") });
  if (!r.ok) return false;
  await agentenBuch.setzeBudget(pk, raum, r.budget);
  toast(t("agentUi.budgetGespeichert", { name }));
  return true;
}

/** Aus dem Raum nehmen: offen die Rolle entziehen, privat ein Commit; das Budget fällt weg, der Agent bleibt auf dem Gerät. */
async function herausnehmen(pk: string, ziel: AgentZiel, name: string): Promise<boolean> {
  if (!(await bestaetige({ titel: t("agentUi.herausnehmenTitel", { name }), text: t("agentUi.herausnehmenText", { name }), ok: t("agentUi.herausnehmen"), gefahr: true }))) return false;
  try {
    if ("adresse" in ziel) {
      await entferneAgentAusOffenemRaum(pk, ziel.adresse);
    } else {
      const { entferneAgentAusPrivatemRaum } = await import("./agent-mls.js");
      if (!(await entferneAgentAusPrivatemRaum(pk, ziel.privat))) throw new Error(t("komm.nichtGeaendert"));
    }
    toast(t("agentUi.draussen", { name }));
    return true;
  } catch (e) {
    toast(t("agentUi.nichtDraussen", { name, grund: fehlerText(e) }), true);
    return false;
  }
}
