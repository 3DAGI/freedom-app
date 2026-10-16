/**
 * Projekte meines Knotens (VKl2, Entwurf `docs/VIBECODEN-ENTWURF.md`): „Projekte“ in der Karte „Mein Knoten“
 * fragt den gekoppelten Knoten versiegelt mit Nachweis (`baueCodeAuftrag()`, Aktion `liste`, frischer
 * Sitzungsschlüssel) über den Weg aus B-9c2 (`wegZumKnoten()`). Gezeigt wird nur Text.
 *
 * „In einen Raum stellen“ holt das Projekt als Bundle (Aktion `bundle`): Der Knoten legt es verschlüsselt unter
 * einem Wegwerfschlüssel ins Blob-Netz und gibt nur den Schlüssel zurück, versiegelt. Angekündigt wird wie jedes
 * Repo (`stelleKnotenProjektEin()`, `tabs/repos.ts`) – öffentlich, im offenen oder im privaten Raum. Nur auf
 * Knopfdruck, nie beim Start; eigenes Modul – `mein-knoten.ts` hält den Kopplungscode.
 */
import {
  KIND_BLOB_MANIFEST, KIND_DVM_KNOTEN_CODE, LocalSigner, baueCodeAuftrag, generateKeypair, leseCodeAntwort,
  type CodeAktion, type CodeAntwort, type Kopplung,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { BUNDLE_ZEIT_MS, CODE_TAKT_MS, CODE_ZEIT_MS, codeAblehnungText, projektZeile } from "../knoten-projekte.js";
import { fehlerText } from "../protokoll-texte.js";
import { powFuerKnoten } from "./knoten-status-ui.js";
import { warteAufKnoten, wegZumKnoten } from "./knoten-weg-ui.js";
import { meineKopplung } from "./mein-knoten.js";
import { ensurePool } from "./state.js";
import { stelleKnotenProjektEin } from "./tabs/repos.js";
import { el, toast } from "./ui.js";

/** Einen Code-Auftrag an meinen Knoten – zurück die gelesene Antwort oder ein Satz, warum es keine gibt. */
export async function frageKnotenCode(k: Kopplung, aktion: CodeAktion, zeitMs: number): Promise<{ antwort: CodeAntwort } | { grund: string }> {
  const powBits = await powFuerKnoten(k.knoten);
  const sitzung = new LocalSigner(generateKeypair().sk);
  // Alles über meinen Knoten (B-9c2): mit Haken nur über sein Relay – ohne Relay geht nichts hinaus
  const weg = await wegZumKnoten(k.knoten, sitzung);
  if (!weg) return { grund: t("set.knotenOhneRelay") };
  let antwort: Awaited<ReturnType<typeof warteAufKnoten>>;
  try {
    const { wrap, requestId } = await baueCodeAuftrag({ sitzung, kopplung: k, aktion, powBits });
    await weg.publish(wrap);
    antwort = await warteAufKnoten(weg, sitzung, requestId, KIND_DVM_KNOTEN_CODE + 1000, zeitMs, CODE_TAKT_MS);
  } finally {
    weg.schliesse();
  }
  if (!antwort) return { grund: t("set.statusSchweigt") };
  if ("abgelehnt" in antwort) return { grund: codeAblehnungText(antwort.fall) };
  const a = leseCodeAntwort(antwort.ergebnis, aktion.aktion);
  return a ? { antwort: a } : { grund: t("set.statusUnlesbar") };
}

/**
 * Das Projekt als Bundle von meinem Knoten – Blob und Schlüssel, oder null (der Grund steht dann im Toast). Erst
 * wenn das Manifest auch an meinen Relays liegt: Was ich nicht finde, fänden die im Raum auch nicht.
 */
export async function holeBundleVomKnoten(projekt: string): Promise<Extract<CodeAntwort, { aktion: "bundle" }> | null> {
  const k = meineKopplung();
  if (!k) return null;
  toast(t("set.projektPackt"));
  const r = await frageKnotenCode(k, { aktion: "bundle", projekt }, BUNDLE_ZEIT_MS);
  if ("grund" in r) {
    toast(t("set.projektKeinBundle", { grund: r.grund }), true);
    return null;
  }
  if (r.antwort.aktion !== "bundle") return null;
  const da = await (await ensurePool()).query({ kinds: [KIND_BLOB_MANIFEST], ids: [r.antwort.manifest], limit: 1 }).catch(() => []);
  if (da.length === 0) {
    toast(t("set.projektNichtImNetz"), true);
    return null;
  }
  return r.antwort;
}

/** Eine Zeile je Projekt – Text und der Knopf „In einen Raum stellen“. */
function zeile(name: string, text: string): HTMLElement {
  const z = el("div", undefined, "knoten-projekt");
  const knopf = el("button", t("set.projektInRaum"), "ghost");
  knopf.type = "button";
  knopf.setAttribute("aria-label", t("set.projektInRaumAria", { name }));
  knopf.addEventListener("click", () => void stelleKnotenProjektEin(name, () => holeBundleVomKnoten(name)));
  z.append(el("span", text), knopf);
  return z;
}

/** „Projekte“: einmal fragen, die Liste als Zeilen zeigen. */
export async function zeigeKnotenProjekte(): Promise<void> {
  const k = meineKopplung();
  const ziel = document.getElementById("knoten-projekte-liste");
  const knopf = document.getElementById("knoten-projekte") as HTMLButtonElement | null;
  if (!k || !ziel || !knopf) return;
  knopf.disabled = true;
  ziel.replaceChildren(el("div", t("set.statusFragt")));
  try {
    const r = await frageKnotenCode(k, { aktion: "liste" }, CODE_ZEIT_MS);
    if ("grund" in r) ziel.replaceChildren(el("div", r.grund));
    else if (r.antwort.aktion === "liste") {
      const p = r.antwort.projekte;
      ziel.replaceChildren(...(p.length ? p.map((x) => zeile(x.name, projektZeile(x))) : [el("div", t("set.projekteKeine"))]));
    }
  } catch (e) {
    ziel.replaceChildren(el("div", t("set.projekteFehler", { fehler: fehlerText(e) })));
  } finally {
    knopf.disabled = false;
  }
}

/** Knopf in der Karte „Mein Knoten“ (einmal beim Start) – gefragt wird erst beim Klick. */
export function wireKnotenProjekte(): void {
  document.getElementById("knoten-projekte")?.addEventListener("click", () => void zeigeKnotenProjekte());
}
